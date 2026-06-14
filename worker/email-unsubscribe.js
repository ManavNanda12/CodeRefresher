// email-unsubscribe.js → GET /api/email/unsubscribe?u={userId}&c={recoveryCode}
//
// One-click opt-out linked from the footer of every digest email. The recovery
// code (cr_ + first 8 hex of the UUID) doubles as the unsubscribe token, so no
// extra storage is needed and links can't be trivially forged for other users.
//
// Add to worker.js:
//   import { handleUnsubscribe } from "./email-unsubscribe.js";
//   else if (url.pathname === "/api/email/unsubscribe" && request.method === "GET") {
//     return handleUnsubscribe(request, env);
//   }

export async function handleUnsubscribe(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u");
  const code = url.searchParams.get("c");

  if (!userId || !code) return htmlResponse("Invalid unsubscribe link.", 400);

  const expected = `cr_${userId.replace(/-/g, "").slice(0, 8)}`;
  if (code !== expected) return htmlResponse("Invalid unsubscribe link.", 403);

  const rec = await env.PROGRESS_KV.get(`user:${userId}`, "json");
  if (!rec) return htmlResponse("We couldn't find that account.", 404);

  rec.unsubscribed = true;
  await env.PROGRESS_KV.put(`user:${userId}`, JSON.stringify(rec));

  return htmlResponse(
    "✅ Unsubscribed — you won't get weekly progress emails anymore. Your saved progress is untouched.",
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
