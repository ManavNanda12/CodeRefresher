// rate-limit.js → optional per-IP rate limiter
//
// No-op unless a KV namespace `RATE_LIMIT` is bound (same pattern as evaluate.js),
// so it never breaks if you haven't set it up. Applied to the account endpoints
// (register / recover / delete) — the abuse vectors that could spam KV writes or
// mass-create users. High-frequency endpoints (sync/game) are left uncounted so
// they don't burn the KV write budget on the limiter itself.

export async function rateLimited(request, env, bucket, max, windowSec = 3600) {
  if (!env.RATE_LIMIT) return false; // not configured → allow
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
