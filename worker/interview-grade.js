// interview-grade.js → POST /api/interview-grade
//   { tech, items: [{ question, expected, answer }] }
//   → { results: [{ score 1-10, verdict, note }], _model? }
//
// Grades an ENTIRE mock-interview round in ONE LLM call (vs one call per
// question like /api/evaluate). This is the token-saving heart of the free
// Interview mode: 4-5 answers → a single request. Empty answers are filtered
// client-side and scored 0 locally, so we only pay for answers actually given.
//
// CORS + routing are handled centrally in worker.js; this file is pure logic.

import { chat, chooseTier, looksLikeCode } from "./llm.js";

// Compact prompt — grade the whole array at once, return a JSON array in order.
const SYSTEM_PROMPT =
  `You are a senior technical interviewer grading a batch of a candidate's answers against the expected answers. ` +
  `Be encouraging but honest; score each like a real interviewer; reward correct fragments even in short answers. ` +
  `You are given a numbered list of items (question / expected / candidate). ` +
  `Reply with ONLY valid JSON, no fences or prose: ` +
  `{"results":[{"i":<item index int>,"score":<1-10 int>,"verdict":"<nailed_it|good|partial|needs_work|missed>","note":"<one short sentence of feedback>"}]}. ` +
  `Return exactly one entry per item, same order. ` +
  `Score: 9-10 all key points; 7-8 solid, minor gaps; 5-6 partial; 3-4 vague/surface; 1-2 off-topic or wrong.`;

const VERDICTS = new Set(["nailed_it", "good", "partial", "needs_work", "missed"]);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function verdictFromScore(s) {
  if (s >= 9) return "nailed_it";
  if (s >= 7) return "good";
  if (s >= 5) return "partial";
  if (s >= 3) return "needs_work";
  return "missed";
}

export async function interviewGradeHandler(request, env) {
  try {
    const body = await request.json();
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!items.length) {
      return jsonResponse({ error: "Missing required field: items[]" }, 400);
    }
    // Cap the batch so a bad request can't blow the token budget.
    const capped = items.slice(0, 8);

    // Build one compact prompt block per item. Truncate hard — every token is paid.
    const userPrompt = capped
      .map((it, i) => {
        const q = String(it?.question ?? "").slice(0, 400);
        const expected = String(it?.expected ?? "").slice(0, 350);
        const answer = String(it?.answer ?? "").slice(0, 700);
        return [
          `### Item ${i}`,
          `Question: ${q}`,
          `Expected: ${expected}`,
          `Candidate: ${answer || "(no answer)"}`,
        ].join("\n");
      })
      .join("\n\n");

    // Routing: a multi-item batch is inherently longer → let complexity decide,
    // but never start below "mid" so batched reasoning has enough headroom.
    const joined = capped.map(it => `${it?.answer ?? ""} ${it?.expected ?? ""}`).join(" ");
    const hasCode = looksLikeCode(joined);
    const length = userPrompt.length;
    let tier = chooseTier({ length, hasCode });
    if (tier === "small") tier = "mid";

    const result = await chat(env, {
      system: SYSTEM_PROMPT,
      user: userPrompt,
      tier,
      temperature: 0.3,
      // ~55 tokens/item of JSON + scaffolding; generous ceiling for up to 8 items.
      maxTokens: 90 * capped.length + 120,
      json: true,
    });

    if (!result.ok) {
      console.error("interview-grade: all providers failed:", JSON.stringify(result.errors));
      return jsonResponse(
        { error: "All AI evaluation models are currently unavailable. Please try again later." },
        502,
      );
    }

    // Parse (tolerate stray fences / surrounding prose).
    const cleaned = result.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    let parsed = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
    }

    const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];

    // Normalise into a dense, index-aligned array — one entry per submitted item,
    // regardless of how the model ordered/omitted things.
    const byIndex = new Map();
    for (const r of rawResults) {
      const i = Math.trunc(Number(r?.i));
      if (Number.isFinite(i)) byIndex.set(i, r);
    }

    const results = capped.map((_it, i) => {
      const r = byIndex.get(i) ?? rawResults[i] ?? null;
      let score = Math.max(1, Math.min(10, Math.round(Number(r?.score) || 5)));
      let verdict = typeof r?.verdict === "string" && VERDICTS.has(r.verdict)
        ? r.verdict
        : verdictFromScore(score);
      const note = (typeof r?.note === "string" && r.note.trim())
        ? r.note.trim().slice(0, 220)
        : "Graded.";
      return { score, verdict, note };
    });

    return jsonResponse({ results, _model: result.model });
  } catch (err) {
    console.error("interview-grade error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}
