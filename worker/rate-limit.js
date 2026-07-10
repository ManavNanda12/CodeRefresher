// rate-limit.js → per-IP rate limiter
//
// FAIL-CLOSED: a KV namespace named `RATE_LIMIT` MUST be bound. Without it the
// limiter can't enforce anything, so instead of silently waving traffic through
// to the paid AI / email paths (the old behaviour, an abuse hole) we deny the
// request. Binding RATE_LIMIT is now a hard requirement for every rate-limited
// endpoint to serve traffic. Applied to the account + AI + email vectors that
// could spam KV writes, mass-create users, or run up LLM/embedding spend.
// High-frequency progress/game sync is left uncounted so it doesn't burn the KV
// write budget on the limiter itself.

export async function rateLimited(request, env, bucket, max, windowSec = 3600) {
  if (!env.RATE_LIMIT) {
    // Misconfiguration, not a client error — make it loud so it's caught in logs.
    console.error(
      "RATE_LIMIT KV namespace is not bound — denying abuse-prone request (fail-closed). Bind RATE_LIMIT to restore service.",
    );
    return true; // block
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `rl:${bucket}:${ip}`;
  const current = parseInt(await env.RATE_LIMIT.get(key)) || 0;
  if (current >= max) return true;
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: windowSec });
  return false;
}

export function tooMany() {
  return Response.json(
    { success: false, error: "Too many requests — try again later." },
    { status: 429 },
  );
}
