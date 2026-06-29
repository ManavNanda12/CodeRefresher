// hint.js → POST /api/hint   { question, correctAnswer } → { hint }
//
// Returns ONE short nudge toward the answer WITHOUT revealing it — the Test Me
// "lifeline". Uses the same Groq LLM as /api/evaluate. Falls back to a generic
// nudge if the model is unavailable, so the lifeline always returns something.
//
// Add to worker.js:
//   import { handleHint } from "./hint.js";
//   if (p === "/api/hint" && method === "POST") return withCors(request, await handleHint(request, env));

import { chat } from "./llm.js";

const SYSTEM_PROMPT = `You are an interview coach giving a hint during a quiz.
Given a question and its expert answer, output ONE short hint (max ~20 words) that nudges
the candidate toward the answer WITHOUT revealing it — do not state the answer, key terms
verbatim, or code. Output only the hint sentence: no quotes, no "Hint:" prefix.`;

const FALLBACK = "Think about the core concept this question is really testing.";

export async function handleHint(request, env) {
  try {
    const { question, correctAnswer } = await request.json();
    if (!question) {
      return Response.json({ error: "Missing question" }, { status: 400 });
    }

    // A one-line hint is trivial — start on the small tier (frees 70B quota);
    // llm.js escalates to other models/providers only if it's rate-limited.
    const { ok, content } = await chat(env, {
      system: SYSTEM_PROMPT,
      user: `Question: ${question}\nExpert answer: ${correctAnswer || ""}\n\nHint:`,
      tier: "small",
      temperature: 0.5,
      maxTokens: 60,
    });

    if (!ok) return Response.json({ hint: FALLBACK });

    const hint = content.replace(/^["']|["']$/g, "");
    return Response.json({ hint: hint || FALLBACK });
  } catch {
    return Response.json({ hint: FALLBACK });
  }
}
