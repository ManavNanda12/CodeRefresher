// interview-questions.js → POST /api/interview-questions
//   { tech, level, count, topics?: string[] }
//   → { questions: [{ question, expected, topic }] }
//
// Generates FRESH, interview-style questions (with a concise model answer each)
// so every mock interview feels unique — not the same static bank every time.
// One call PER STACK; the client fans these out and falls back to the static
// bank if generation fails, so the site keeps working even when quota is spent.
//
// CORS + routing are handled centrally in worker.js; this file is pure logic.

import { chat } from "./llm.js";

const KINDS = new Set(["theory", "query", "code", "scenario"]);

const LEVEL_HINT = {
  "0-1": "junior (0-1 yrs) — fundamentals, clear definitions, simple examples",
  "1-2": "early-career (1-2 yrs) — practical usage, common gotchas",
  "2-3": "senior (2-3 yrs) — trade-offs, real scenarios, 'how would you' design questions",
  "4+": "architect (4+ yrs) — deep scenarios, performance, system design, edge cases",
  focus: "mixed difficulty",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function interviewQuestionsHandler(request, env) {
  try {
    const body = await request.json();
    const tech = String(body?.tech ?? "").slice(0, 40) || "software engineering";
    const level = String(body?.level ?? "1-2");
    const count = Math.max(1, Math.min(6, Math.trunc(Number(body?.count)) || 5));
    const topics = Array.isArray(body?.topics)
      ? body.topics.filter(t => typeof t === "string").slice(0, 12)
      : [];

    const levelHint = LEVEL_HINT[level] || LEVEL_HINT["1-2"];

    const system =
      `You are a senior technical interviewer for ${tech}. Write ${count} realistic, DISTINCT interview ` +
      `questions at ${levelHint} level. ` +
      `Provide a BALANCED mix across the set — do NOT make them all scenario questions. Include: ` +
      `some pure THEORY/conceptual questions ("what is / why / explain"), ` +
      `some CODE or QUERY questions that ask the candidate to write a snippet or SQL query, ` +
      `and some real-world SCENARIO/design questions ("how would you..."). ` +
      `Aim for a spread, roughly: ~40% theory, ~35% code/query, ~25% scenario. ` +
      `Vary the phrasing — do not reuse textbook wording. ` +
      `For each, also give a concise MODEL ANSWER (2-3 sentences, the key points a strong candidate would hit), ` +
      `and tag its "kind" as exactly one of: "theory", "query", "code", "scenario". ` +
      `Use "query" for SQL/database questions that want a query, "code" for other code-writing questions. ` +
      `Reply with ONLY valid JSON, no fences or prose: ` +
      `{"questions":[{"question":"<the question>","expected":"<concise model answer>","topic":"<1-3 word topic>","kind":"<theory|query|code|scenario>"}]}. ` +
      `Return exactly ${count} questions.`;

    const user = topics.length
      ? `Prioritise these topic areas where sensible: ${topics.join(", ")}.`
      : `Cover a good spread of core ${tech} topics.`;

    const result = await chat(env, {
      system,
      user,
      tier: "mid",              // decent quality without draining the 70B quota
      temperature: 0.85,        // high for variety / uniqueness
      maxTokens: 130 * count + 120,
      json: true,
    });

    if (!result.ok) {
      console.error("interview-questions: providers failed:", JSON.stringify(result.errors));
      // Empty list → client falls back to the static bank. Not an error to the user.
      return jsonResponse({ questions: [] });
    }

    const cleaned = result.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    let parsed = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
    }

    const raw = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const questions = raw
      .filter(q => q && typeof q.question === "string" && q.question.trim())
      .slice(0, count)
      .map(q => ({
        question: q.question.trim().slice(0, 400),
        expected: String(q.expected ?? "").trim().slice(0, 500) || "A strong, specific answer covering the core concept.",
        topic: String(q.topic ?? "").trim().slice(0, 40) || "General",
        kind: KINDS.has(q.kind) ? q.kind : "theory",
      }));

    return jsonResponse({ questions, _model: result.model });
  } catch (err) {
    console.error("interview-questions error:", err);
    return jsonResponse({ questions: [] }); // graceful → bank fallback
  }
}
