// register.js → POST /api/user/register
//
// 🟡 OPTIONAL hardening over your current version:
//   - preserves existing progress if the user already exists (don't wipe on re-register)
//   - derives the recovery code with the same formula the frontend uses
//     (cr_ + first 8 hex of the UUID). For a standard UUID this equals
//     `userId.slice(0,8)`, but the explicit replace() keeps them in lockstep.

export async function handleUserRegister(request, env) {
  const { userId, email } = await request.json();

  if (!userId || !email) {
    return Response.json({ success: false, error: "Missing fields" }, { status: 400 });
  }

  const recoveryCode = `cr_${userId.replace(/-/g, "").slice(0, 8)}`;

  const existing = await env.PROGRESS_KV.get(`user:${userId}`);
  const userData = existing
    ? { ...JSON.parse(existing), email, recoveryCode }            // keep arenas/recentRounds
    : { userId, email, recoveryCode, arenas: {}, recentRounds: [] };

  await env.PROGRESS_KV.put(`user:${userId}`, JSON.stringify(userData));
  await env.PROGRESS_KV.put(`recovery:${recoveryCode}`, userId);

  return Response.json({ success: true, recoveryCode });
}
