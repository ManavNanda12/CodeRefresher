// register.js → POST /api/user/register
//
// Body: { userId, email, name? }
//   - preserves existing progress if the user already exists (don't wipe on re-register)
//   - stores an optional display name (used by the leaderboard)
//   - derives the recovery code the same way the frontend does (cr_ + first 8 hex of UUID)
// Doubles as the "update profile" call — re-registering with a new email/name upserts it.

import { updateLeaderboard } from "./leaderboard.js";

export async function handleUserRegister(request, env) {
  const { userId, email, name } = await request.json();

  if (!userId || !email) {
    return Response.json({ success: false, error: "Missing fields" }, { status: 400 });
  }

  const recoveryCode = `cr_${userId.replace(/-/g, "").slice(0, 8)}`;

  const existing = await env.PROGRESS_KV.get(`user:${userId}`);
  const userData = existing
    ? { ...JSON.parse(existing), email, recoveryCode } // keep arenas/recentRounds/game
    : { userId, email, recoveryCode, arenas: {}, recentRounds: [] };

  if (typeof name === "string" && name.trim()) userData.name = name.trim().slice(0, 24);

  await env.PROGRESS_KV.put(`user:${userId}`, JSON.stringify(userData));
  await env.PROGRESS_KV.put(`recovery:${recoveryCode}`, userId);

  // Refresh the leaderboard so a name change shows up for already-ranked users.
  // (updateLeaderboard skips users with no activity, so new sign-ups won't pollute it.)
  await updateLeaderboard(env, userId, userData);

  return Response.json({ success: true, recoveryCode });
}
