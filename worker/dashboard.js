// dashboard.js → GET /api/progress/dashboard?userId=xxx
//
// ✅ Your current version works (it returns the whole user object, and the frontend
// reads .arenas + .recentRounds). This is just a tidier equivalent that returns a
// normalized payload and an empty-but-valid shape for unknown users (so a brand-new
// device renders cleanly instead of erroring). Swapping to this is OPTIONAL.

export async function handleDashboard(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return Response.json({ success: false, error: "Missing userId" }, { status: 400 });
  }

  const data = await env.PROGRESS_KV.get(`user:${userId}`);

  if (!data) {
    return Response.json({ email: "", lastActive: null, arenas: {}, recentRounds: [] });
  }

  const userData = JSON.parse(data);
  return Response.json({
    email: userData.email || "",
    lastActive: userData.lastActive || null,
    arenas: userData.arenas || {},
    recentRounds: (userData.recentRounds || []).slice(0, 10),
  });
}
