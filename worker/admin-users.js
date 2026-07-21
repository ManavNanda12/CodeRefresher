// admin-users.js → GET /api/admin/users
//
// Server-to-server only. Returns trimmed user records for the weekly digest /
// outreach export. Guarded by a bearer secret (set with `wrangler secret put ADMIN_SECRET`).
//
// Add to worker.js:
//   import { handleAdminUsers } from "./admin-users.js";
//   else if (url.pathname === "/api/admin/users" && request.method === "GET") {
//     return handleAdminUsers(request, env);
//   }

import { safeEqual, randomToken } from "./security.js";

export async function handleAdminUsers(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_SECRET || !safeEqual(token, env.ADMIN_SECRET)) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const users = [];
  let cursor;
  do {
    const list = await env.PROGRESS_KV.list({ prefix: "user:", cursor });
    for (const key of list.keys) {
      const rec = await env.PROGRESS_KV.get(key.name, "json");
      if (!rec) continue;

      // Self-heal: backfill a stored random unsubscribe token for any account
      // that predates it, so the outreach link this export feeds never has to
      // fall back to the forgeable derivable code.
      if (!rec.unsubToken) {
        rec.unsubToken = randomToken();
        await env.PROGRESS_KV.put(key.name, JSON.stringify(rec));
      }

      users.push({
        userId: rec.userId || key.name.slice("user:".length),
        email: rec.email || "",
        name: rec.name || "",
        // The login/recovery code — the welcome email includes it so a user who
        // loses it can dig it out of their inbox. Server-to-server only (this
        // export is ADMIN_SECRET-guarded), never exposed to the browser.
        recoveryCode: rec.recoveryCode || "",
        unsubToken: rec.unsubToken,
        unsubscribed: !!rec.unsubscribed,
        // Newsletter opt-in. Accounts created before the checkbox existed have no
        // flag — treat them as opted in (same consent basis as the weekly digest).
        allowUpdates: rec.allowUpdates !== false,
        createdAt: rec.createdAt || null,
        lastActive: rec.lastActive || null,
        arenas: rec.arenas || {},
        recentRounds: rec.recentRounds || [],
      });
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return Response.json({ success: true, count: users.length, users });
}
