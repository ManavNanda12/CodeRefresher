// dashboard.js → GET /api/progress/dashboard?userId=xxx
//
// ✅ Your current version works (it returns the whole user object, and the frontend
// reads .arenas + .recentRounds). This is just a tidier equivalent that returns a
// normalized payload and an empty-but-valid shape for unknown users (so a brand-new
// device renders cleanly instead of erroring). Swapping to this is OPTIONAL.

import { isUserId, requireToken } from "./security.js";

export async function handleDashboard(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (!isUserId(userId)) {
    return Response.json({ success: false, error: "Missing userId" }, { status: 400 });
  }

  const { ok, rec } = await requireToken(request, env, userId);
  if (!ok) return Response.json({ success: false, error: "Forbidden" }, { status: 403 });

  if (!rec) {
    return Response.json({ lastActive: null, arenas: {}, recentRounds: [] });
  }

  // NOTE: email is deliberately NOT returned — the client already has it from the cookie,
  // so echoing it here would only widen PII exposure.
  return Response.json({
    lastActive: rec.lastActive || null,
    arenas: rec.arenas || {},
    recentRounds: (rec.recentRounds || []).slice(0, 10),
  });
}
