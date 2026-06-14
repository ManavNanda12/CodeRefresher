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

export async function handleAdminUsers(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_SECRET || token !== env.ADMIN_SECRET) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const users = [];
  let cursor;
  do {
    const list = await env.PROGRESS_KV.list({ prefix: "user:", cursor });
    for (const key of list.keys) {
      const rec = await env.PROGRESS_KV.get(key.name, "json");
      if (!rec) continue;
      users.push({
        userId: rec.userId || key.name.slice("user:".length),
        email: rec.email || "",
        unsubscribed: !!rec.unsubscribed,
        lastActive: rec.lastActive || null,
        arenas: rec.arenas || {},
        recentRounds: rec.recentRounds || [],
      });
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return Response.json({ success: true, count: users.length, users });
}
