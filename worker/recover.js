// recover.js → POST /api/user/recover
//
// 🔴 REPLACES the old version that returned { success, data: {...} }.
// The frontend (user.service.ts) reads res.userId / res.email at the TOP level,
// so we must return them flat — otherwise restore "succeeds" but never sets identity.

export async function handleRecover(request, env) {
  const { recoveryCode } = await request.json();

  if (!recoveryCode) {
    return Response.json({ success: false, error: "Missing recovery code" }, { status: 400 });
  }

  // recovery:{code} → userId → user:{userId}
  const userId = await env.PROGRESS_KV.get(`recovery:${recoveryCode}`);
  if (!userId) {
    return Response.json({ success: false, error: "Invalid recovery code" }, { status: 404 });
  }

  const data = await env.PROGRESS_KV.get(`user:${userId}`);
  if (!data) {
    return Response.json({ success: false, error: "User not found" }, { status: 404 });
  }

  const userData = JSON.parse(data);

  return Response.json({
    success: true,
    userId,
    email: userData.email || "",
    name: userData.name || "",
    progress: {
      arenas: userData.arenas || {},
      recentRounds: userData.recentRounds || [],
    },
  });
}
