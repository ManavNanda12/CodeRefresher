// embed-demo.js → POST /api/embed-demo   { question } → ranked sentences
//
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  STEP 1 OF LEARNING RAG: "What is an embedding?"                       ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// This is a TEACHING endpoint. It has 3 hardcoded sentences. You send it a
// question, and it tells you which sentence is closest in MEANING — using
// embeddings, NOT keyword matching.
//
// The "aha": try the question "how do I stop memory leaks from observables?"
// The winning sentence talks about "unsubscribing" and shares almost NO words
// with your question — yet it scores highest, because embeddings compare
// meaning, not text. That is the whole reason RAG works.
//
// ── How embeddings work (the one new idea) ──────────────────────────────
// An embedding model turns any text into a list of ~768 numbers (a "vector").
// Texts with similar MEANING get similar vectors. To measure "how similar are
// two texts?", we compare their vectors with COSINE SIMILARITY:
//   • 1.0  = identical meaning
//   • 0.0  = unrelated
// That's it. Retrieval in RAG is just "embed everything, find the closest."
//
// ── Setup needed (one time) ─────────────────────────────────────────────
// Workers AI gives us the embedding model. Add this to your wrangler.toml:
//   [ai]
//   binding = "AI"
// Then `env.AI` is available (free tier covers tons of requests).
//
// Add to worker.js:
//   import { handleEmbedDemo } from "./embed-demo.js";
//   if (p === "/api/embed-demo" && method === "POST")
//     return withCors(request, await handleEmbedDemo(request, env));

// The embedding model. bge-base returns a 768-number vector per text.
const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

// Our tiny "knowledge base" — 3 sentences. In real RAG these would be chunks
// of YOUR notes/PDFs. Notice none of them keyword-match a natural question.
const SENTENCES = [
  "Call unsubscribe in ngOnDestroy, or use takeUntilDestroyed, to clean up Observable subscriptions.",
  "Use trackBy in @for loops so Angular reuses DOM nodes instead of re-rendering the whole list.",
  "A SQL index speeds up reads by letting the database find rows without scanning the whole table.",
];

// Cosine similarity: dot(a,b) / (|a| * |b|). Higher = more similar in meaning.
// This is the ENTIRE math of retrieval. Read it once and you understand RAG.
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function handleEmbedDemo(request, env) {
  try {
    const { question } = await request.json();
    if (!question) {
      return Response.json({ error: "Send { question: '...' }" }, { status: 400 });
    }

    // Embed the question AND all 3 sentences in ONE call (cheaper + faster).
    // Workers AI returns { data: [ [768 numbers], [768 numbers], ... ] }
    // — one vector per input text, in order.
    const texts = [question, ...SENTENCES];
    const result = await env.AI.run(EMBED_MODEL, { text: texts });
    const vectors = result.data;

    const questionVector = vectors[0];          // first vector = the question
    const sentenceVectors = vectors.slice(1);   // the rest = our sentences

    // Score each sentence by how close its meaning is to the question,
    // then sort best-first. THIS is "retrieval".
    const ranked = SENTENCES
      .map((text, i) => ({
        text,
        score: Number(cosineSimilarity(questionVector, sentenceVectors[i]).toFixed(4)),
      }))
      .sort((a, b) => b.score - a.score);

    return Response.json({
      question,
      explanation:
        "Sorted by meaning-similarity (cosine). The top result is what RAG would feed to the LLM as context.",
      ranked,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
