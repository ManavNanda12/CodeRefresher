// evaluate.js → POST /api/evaluate
//   { question, userAnswer, correctAnswer, codeExample?, simpleExample? }
//   → { score 1-10, verdict, strengths, missing, tip, _model? }
//
// Grades a candidate's typed answer against the ground-truth answer.
//
// Model handling lives in the shared engine (llm.js): this handler picks a
// starting TIER from the answer's complexity (short → 8b, medium → gemma2,
// code/long → 70b), and llm.js builds the fallback chain from there
// (other Groq models → Gemini). So simple answers never burn the 70B quota,
// and a 429 on any one model auto-falls-back to the next.
//
// CORS + routing are handled centrally in worker.js; this file is pure logic.

import { chat, chooseTier, looksLikeCode } from "./llm.js";

// Compact prompt — every token here is paid on EVERY request. Same JSON contract
// and verdict buckets as before; the verbose scoring rubric is condensed inline.
const SYSTEM_PROMPT =
  `You are a senior interviewer grading a developer's answer against the expected answer. ` +
  `Be encouraging but honest; score like a real interviewer; reward correct fragments even in short answers. ` +
  `Reply with ONLY valid JSON, no fences or prose: ` +
  `{"score":<1-10 int>,"verdict":"<nailed_it|good|partial|needs_work|missed>",` +
  `"strengths":"<what they got right, 1-2 sentences>",` +
  `"missing":"<key points missed, 1-2 sentences; 'Nothing major!' if score>=8>",` +
  `"tip":"<one actionable improvement, 1 sentence>"}. ` +
  `Score: 9-10 all key points + practical/code awareness; 7-8 solid, minor gaps; ` +
  `5-6 partial; 3-4 vague/surface; 1-2 off-topic or wrong.`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// NOTE: rate limiting is applied centrally in worker.js via rateLimited(... "evaluate" ...)
// — it's bucketed high enough to clear a full forkJoin'd quiz batch (see worker.js).

export async function evaluateHandler(request, env) {
  try {
    const body = await request.json();
    const { question, userAnswer, correctAnswer, codeExample, simpleExample } = body;

    if (!question || !userAnswer || !correctAnswer) {
      return jsonResponse(
        { error: "Missing required fields: question, userAnswer, correctAnswer" },
        400,
      );
    }

    const trimmedAnswer = userAnswer.slice(0, 2000);

    const userPrompt = [
      `**Question:** ${question}`,
      `**Expected Answer:** ${correctAnswer}`,
      codeExample ? `**Code Example:**\n${codeExample}` : null,
      simpleExample ? `**Analogy:** ${simpleExample}` : null,
      `**Candidate's Answer:** ${trimmedAnswer}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // ── Smart routing: pick a starting tier from the answer's complexity. ──
    const hasCode = looksLikeCode(trimmedAnswer) || looksLikeCode(codeExample || "");
    const length = question.length + trimmedAnswer.length + correctAnswer.length;
    const tier = chooseTier({ length, hasCode });

    const result = await chat(env, {
      system: SYSTEM_PROMPT,
      user: userPrompt,
      tier,
      temperature: 0.3,
      maxTokens: 180,
      json: true,
    });

    if (!result.ok) {
      console.error("All providers failed:", JSON.stringify(result.errors));
      return jsonResponse(
        { error: "All AI evaluation models are currently unavailable. Please try again later." },
        502,
      );
    }

    // ── Parse the AI response (tolerate stray fences / surrounding prose). ──
    const cleaned = result.content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    let evaluation;
    try {
      evaluation = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      try {
        evaluation = m ? JSON.parse(m[0]) : null;
      } catch {
        evaluation = null;
      }
    }

    if (!evaluation) {
      console.error(`JSON parse failed from ${result.model}. Raw:`, result.content);
      evaluation = {
        score: 5,
        verdict: "partial",
        strengths: "Your answer touched on the topic.",
        missing: "The evaluator couldn't fully parse feedback. Try rephrasing your answer.",
        tip: "Be specific — mention key terms and practical use cases.",
      };
    }

    // Validate + clamp the score.
    evaluation.score = Math.max(1, Math.min(10, Math.round(Number(evaluation.score) || 5)));

    // Which model actually served the answer — handy while tuning routing.
    evaluation._model = result.model;

    return jsonResponse(evaluation);
  } catch (err) {
    console.error("evaluate error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}
