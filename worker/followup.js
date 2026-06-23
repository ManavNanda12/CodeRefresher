// followup.js → POST /api/followup   { question, userAnswer, correctAnswer } → { followup: string | null }
//
// The Test Me "interviewer follow-up". Given the candidate's answer, the LLM FIRST decides
// whether the answer is a genuine, on-topic attempt worth digging into. If yes, it returns
// ONE short probing question grounded in what they wrote. If the answer is junk / off-topic /
// a non-answer ("hello world", "idk"), it returns the sentinel NO_FOLLOWUP, which we map to
// `followup: null` so the frontend simply advances — we never probe a non-answer.
//
// Unlike /api/hint (which always falls back to a generic nudge because the user ASKED for help),
// a follow-up is unsolicited: on any failure we DECLINE (return null) rather than invent a probe.
//
// Add to worker.js:
//   import { handleFollowup } from "./followup.js";
//   if (p === "/api/followup" && method === "POST") return withCors(request, await handleFollowup(request, env));

const SYSTEM_PROMPT = `You are a senior technical interviewer in a live interview.
You are given an interview question and the candidate's answer.

FIRST decide whether the answer is a genuine, on-topic attempt that demonstrates some real
understanding worth digging into. Treat as NOT worth probing: blanks, "I don't know"/"idk",
placeholders or nonsense ("hello world", "asdf", random text), answers that are off-topic or
unrelated to the question, or answers so vague they show no actual claim to probe.

- If it is NOT worth probing, output EXACTLY: NO_FOLLOWUP
- If it IS worth probing, output ONE short follow-up question (max ~25 words) that digs deeper
  into THEIR specific answer — a "why", a trade-off, an edge case, or "when would this break?".
  Ground it in what they actually wrote. Do NOT reveal the model answer or give hints.

Output only the follow-up question OR the token NO_FOLLOWUP — no quotes, no prefix, no extra text.`;

const SENTINEL = "NO_FOLLOWUP";

export async function handleFollowup(request, env) {
  try {
    const { question, userAnswer, correctAnswer } = await request.json();
    if (!question) return Response.json({ error: "Missing question" }, { status: 400 });

    // No answer reached us → nothing to probe. (The client gates this too, but be safe.)
    if (!userAnswer || !userAnswer.trim()) return Response.json({ followup: null });

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
          {
            role: "user",
            content: `Question: ${question}\nCandidate answer: ${userAnswer}\nExpert answer (for your context only): ${correctAnswer || ""}\n\nFollow-up:`,
          },
        ],
        temperature: 0.5,
        max_tokens: 60,
      }),
    });

    // On model/network failure we DECLINE rather than ask a generic probe — we can't verify
    // relevance, and a blind "why does that work?" is exactly what we want to avoid.
    if (!res.ok) return Response.json({ followup: null });

    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");
    // Treat the sentinel (or an empty / sentinel-containing reply) as "no probe".
    const declined = !raw || raw.toUpperCase().includes(SENTINEL);
    return Response.json({ followup: declined ? null : raw });
  } catch {
    return Response.json({ followup: null });
  }
}
