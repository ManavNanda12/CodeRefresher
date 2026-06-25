// rag-demo.js → two endpoints that turn the toy into a REAL vector search.
//
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  STEP 2 OF LEARNING RAG: "Store vectors in a database (Vectorize)"     ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// In Step 1 (embed-demo.js) we had 3 sentences hardcoded and compared them by
// hand with a cosine loop. That does NOT scale — 10,000 notes = 10,000 loops
// per question.
//
// Vectorize is a DATABASE built for vectors. You "upsert" (insert/update)
// vectors once, and later ask "give me the 3 closest to THIS vector" — and it
// finds them instantly, no manual loop. The cosine math you learned still
// happens; Vectorize just does it for you, fast, at scale.
//
// Two endpoints:
//   POST /api/rag-ingest  { notes: ["...", "..."] }  → embed each note, store it
//   POST /api/rag-query   { question }               → find the 3 closest notes
//
// ── Setup needed (one time) ─────────────────────────────────────────────
//  1. Create a Vectorize index named "coderefresher-notes"
//        dimensions = 768   (bge-base-en-v1.5 outputs 768 numbers)
//        metric     = cosine (the same closeness measure from Step 1)
//  2. Bind it to the worker with variable name "VECTORIZE"
//     (both done in the dashboard — see the chat steps)
//
// Add to worker.js:
//   import { handleRagIngest, handleRagQuery } from "./rag-demo.js";
//   if (p === "/api/rag-ingest" && method === "POST")
//     return withCors(request, await handleRagIngest(request, env));
//   if (p === "/api/rag-query" && method === "POST")
//     return withCors(request, await handleRagQuery(request, env));

const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

// Embed an array of texts → array of 768-number vectors (same as Step 1).
async function embed(env, texts) {
  const result = await env.AI.run(EMBED_MODEL, { text: texts });
  return result.data;
}

// Make a STABLE id from the note text (SHA-256 hex). Why: if you ingest the
// same note twice, it overwrites itself instead of creating a duplicate.
// We prefix with the namespace so the SAME note text saved by two different
// users gets two distinct ids (one per user).
async function idFor(ns, text) {
  const bytes = new TextEncoder().encode(`${ns || "_"}::${text}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// PER-USER SCOPING via Vectorize "namespaces":
// Each user's notes live in their own namespace (= their userId). A query with
// { namespace } only searches that user's vectors, so users never see each
// other's notes. Namespaces need NO index config (unlike metadata filtering),
// which is why we use them here. Falls back to a shared default when no userId
// is sent (so the PowerShell learning demos still work).
function nsOf(userId) {
  return typeof userId === "string" && userId.length ? userId.slice(0, 64) : undefined;
}

// ── INGEST: store notes as vectors ──────────────────────────────────────
export async function handleRagIngest(request, env) {
  try {
    const { notes, userId } = await request.json();
    if (!Array.isArray(notes) || notes.length === 0) {
      return Response.json({ error: "Send { notes: ['...', '...'] }" }, { status: 400 });
    }
    const ns = nsOf(userId);

    // 1. Turn every note into a vector.
    const vectors = await embed(env, notes);

    // 2. Build Vectorize records. We store the original text in `metadata`
    //    so that when we retrieve a match later, we get the words back —
    //    a vector alone is just numbers; metadata carries the human text.
    //    `namespace` scopes the vector to this user.
    const records = await Promise.all(
      notes.map(async (text, i) => {
        const rec = { id: await idFor(ns, text), values: vectors[i], metadata: { text } };
        if (ns) rec.namespace = ns;
        return rec;
      })
    );

    // 3. Upsert = insert or update. This is the "write everything once" step.
    await env.VECTORIZE.upsert(records);

    return Response.json({ ingested: records.length, ids: records.map((r) => r.id) });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  STEP 3 OF LEARNING RAG: "Generation" — let the LLM write the answer   ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// handleRagQuery (below) RETRIEVES the closest notes. That's the "R".
// handleRagAsk RETRIEVES them, then feeds them to Llama 3.3 as context and
// asks it to WRITE the answer using ONLY those notes. That's the full RAG loop:
//   embed question → find notes (Vectorize) → stuff notes into prompt → LLM answers
//
// The key trick is the prompt: we literally paste the retrieved notes in and
// say "answer using ONLY this context." That's what stops the model from
// making things up — it's grounded in YOUR notes, not its training memory.
//
// Add to worker.js:
//   import { handleRagAsk } from "./rag-demo.js";
//   if (p === "/api/rag-ask" && method === "POST")
//     return withCors(request, await handleRagAsk(request, env));

// How close a note must be (cosine 0–1) to count as relevant. Below this we
// treat the question as "not covered by your notes" and skip the LLM entirely —
// that's what gives a clean "I couldn't find that" instead of fake sources.
const MIN_SCORE = 0.45;

export async function handleRagAsk(request, env) {
  try {
    const { question, userId } = await request.json();
    if (!question) {
      return Response.json({ error: "Send { question: '...' }" }, { status: 400 });
    }
    const ns = nsOf(userId);

    // ── R: retrieve (exactly what rag-query does), scoped to this user ──
    const [questionVector] = await embed(env, [question]);
    const queryOpts = { topK: 3, returnMetadata: "all" };
    if (ns) queryOpts.namespace = ns;
    const results = await env.VECTORIZE.query(questionVector, queryOpts);

    // Keep only notes that are actually close enough to be relevant.
    const strong = (results.matches || []).filter((m) => m.score >= MIN_SCORE);
    const notes = strong.map((m) => m.metadata?.text).filter(Boolean);

    // Nothing relevant → don't call the LLM, don't show misleading sources.
    if (notes.length === 0) {
      return Response.json({
        answer: "I couldn't find anything in your notes about that. Try rephrasing, or save more notes on this topic.",
        sources: [],
        noMatch: true,
      });
    }

    // ── A: augment — build a prompt that injects the retrieved notes ──
    // Numbering them helps the model cite which note it used.
    const context = notes.map((n, i) => `[${i + 1}] ${n}`).join("\n");
    const systemPrompt =
      "You are a study assistant. Answer the question using ONLY the provided notes. " +
      "If the notes do not cover it, say you don't have that information. " +
      "Be concise and practical.";
    const userPrompt = `Notes:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;

    // ── G: generate — same Groq/Llama call pattern as hint.js ──
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3, // low = stick to the notes, don't get creative
        max_tokens: 300,
      }),
    });

    if (!res.ok) {
      return Response.json({ error: "LLM call failed", sources: notes }, { status: 502 });
    }

    const data = await res.json();
    const answer = (data.choices?.[0]?.message?.content || "").trim();

    // Return the answer AND the sources — so you can SEE it was grounded in
    // your notes, not invented. This "show your sources" pattern is how real
    // RAG apps build trust.
    return Response.json({ question, answer, sources: notes });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// ── QUERY: find the closest notes to a question ─────────────────────────
export async function handleRagQuery(request, env) {
  try {
    const { question, userId } = await request.json();
    if (!question) {
      return Response.json({ error: "Send { question: '...' }" }, { status: 400 });
    }
    const ns = nsOf(userId);

    // 1. Embed the question (one vector).
    const [questionVector] = await embed(env, [question]);

    // 2. Ask Vectorize for the 3 closest stored vectors. It runs the cosine
    //    comparison against EVERY stored note for us, and returns the winners
    //    already sorted best-first. This is the line that replaces our manual
    //    loop from Step 1 — and it scales to millions of notes.
    const queryOpts = { topK: 3, returnMetadata: "all" }; // metadata = stored text back
    if (ns) queryOpts.namespace = ns;
    const results = await env.VECTORIZE.query(questionVector, queryOpts);

    const matches = results.matches.map((m) => ({
      text: m.metadata?.text ?? "(text not stored)",
      score: Number(m.score.toFixed(4)),
    }));

    return Response.json({
      question,
      explanation: "Vectorize found these by cosine-closeness — same idea as Step 1, now from a database.",
      matches,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
