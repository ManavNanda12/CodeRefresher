// hint.js → POST /api/hint   { question, correctAnswer } → { hint }
//
// Returns ONE short nudge toward the answer WITHOUT revealing it — the Test Me
// "lifeline". Uses the same Groq LLM as /api/evaluate. Falls back to a generic
// nudge if the model is unavailable, so the lifeline always returns something.
//
// Add to worker.js:
//   import { handleHint } from "./hint.js";
//   if (p === "/api/hint" && method === "POST") return withCors(request, await handleHint(request, env));

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

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Question: ${question}\nExpert answer: ${correctAnswer || ""}\n\nHint:` },
        ],
        temperature: 0.5,
        max_tokens: 60,
      }),
    });

    if (!res.ok) return Response.json({ hint: FALLBACK });

    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");
    return Response.json({ hint: raw || FALLBACK });
  } catch {
    return Response.json({ hint: FALLBACK });
  }
}
