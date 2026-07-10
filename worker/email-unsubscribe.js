// email-unsubscribe.js → GET /api/email/unsubscribe?u={userId}&c={recoveryCode}[&t=newsletter]
//
// One-click opt-out linked from the footer of every digest email. Authorized by
// the account's stored random `unsubToken` (minted at registration), so a link
// can't be forged from a known userId. Accounts that predate the token still
// accept the old derivable `cr_<8hex>` code until they get one.
//
// &t=newsletter drops ONLY the monthly newsletter (allowUpdates=false); without
// it the user is unsubscribed from all outreach email (unsubscribed=true).
//
// Add to worker.js:
//   import { handleUnsubscribe } from "./email-unsubscribe.js";
//   else if (url.pathname === "/api/email/unsubscribe" && request.method === "GET") {
//     return handleUnsubscribe(request, env);
//   }

import { isUserId, safeEqual } from "./security.js";

export async function handleUnsubscribe(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u");
  const code = url.searchParams.get("c");

  if (!isUserId(userId) || !code) return htmlResponse("Invalid unsubscribe link.", 400);

  const rec = await env.PROGRESS_KV.get(`user:${userId}`, "json");
  if (!rec) return htmlResponse("We couldn't find that account.", 404);

  // Prefer the stored random token; fall back to the derivable legacy code only
  // for accounts that never got one (i.e. emails sent before this shipped).
  const expected = rec.unsubToken || `cr_${userId.replace(/-/g, "").slice(0, 8)}`;
  if (!safeEqual(code, expected)) return htmlResponse("Invalid unsubscribe link.", 403);

  const newsletterOnly = url.searchParams.get("t") === "newsletter";
  if (newsletterOnly) {
    rec.allowUpdates = false;
  } else {
    rec.unsubscribed = true;
  }
  await env.PROGRESS_KV.put(`user:${userId}`, JSON.stringify(rec));

  return htmlResponse(
    newsletterOnly
      ? "✅ Done — no more monthly newsletters. You'll still get your weekly progress recap. Your saved progress is untouched."
      : "✅ Unsubscribed — you won't get any more emails from us. Your saved progress is untouched.",
    200,
  );
}

function htmlResponse(message, status) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CodeRefresher</title></head>
<body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#070d1c;color:#e2e8f0;display:grid;place-items:center;min-height:100vh">
<div style="text-align:center;max-width:420px;padding:2rem">
<div style="font-size:2.5rem;margin-bottom:.5rem">📭</div>
<p style="font-size:1.05rem;line-height:1.6;color:#cbd5e1">${message}</p>
</div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
