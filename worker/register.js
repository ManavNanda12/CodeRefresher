// register.js → POST /api/user/register
//
// Body: { userId, email, name? }
//   - One email = one account. We keep an `email:{lowercased}` → userId index so a
//     returning user who re-enters their email ADOPTS the existing account instead
//     of silently creating a duplicate. (No password — this app is low-stakes; the
//     recovery code remains the explicit cross-device restore.)
//   - preserves existing progress if the user already exists (don't wipe on re-register)
//   - stores an optional display name (used by the leaderboard)
// Doubles as the "update profile" call — re-registering with a new email/name upserts it.

import { updateLeaderboard } from "./leaderboard.js";

const recoveryCodeFor = (id) => `cr_${id.replace(/-/g, "").slice(0, 8)}`;
const normEmail = (e) => String(e || "").trim().toLowerCase();

export async function handleUserRegister(request, env) {
  const { userId, email, name } = await request.json();

  if (!userId || !email) {
    return Response.json({ success: false, error: "Missing fields" }, { status: 400 });
  }

  const emailKey = `email:${normEmail(email)}`;

  // ── Already an account for this email? Adopt it (no duplicate). ──
  const ownerId = await env.PROGRESS_KV.get(emailKey);
  if (ownerId && ownerId !== userId) {
    const ownerRaw = await env.PROGRESS_KV.get(`user:${ownerId}`);
    if (ownerRaw) {
      const owner = JSON.parse(ownerRaw);
      // Let the caller set/update their display name on the adopted account.
      if (typeof name === "string" && name.trim()) {
        owner.name = name.trim().slice(0, 24);
        await env.PROGRESS_KV.put(`user:${ownerId}`, JSON.stringify(owner));
      }
      return Response.json({
        success: true,
        adopted: true,
        userId: ownerId,
        recoveryCode: recoveryCodeFor(ownerId),
        name: owner.name || "",
        progress: { arenas: owner.arenas || {}, recentRounds: owner.recentRounds || [] },
      });
    }
    // Stale index (owner record gone) — fall through and (re)claim it below.
  }

  const recoveryCode = recoveryCodeFor(userId);

  const existing = await env.PROGRESS_KV.get(`user:${userId}`);
  const userData = existing
    ? { ...JSON.parse(existing), email, recoveryCode } // keep arenas/recentRounds/game
    : { userId, email, recoveryCode, arenas: {}, recentRounds: [] };

  if (typeof name === "string" && name.trim()) userData.name = name.trim().slice(0, 24);

  await env.PROGRESS_KV.put(`user:${userId}`, JSON.stringify(userData));
  await env.PROGRESS_KV.put(`recovery:${recoveryCode}`, userId);
  await env.PROGRESS_KV.put(emailKey, userId); // claim the email for this account

  // Refresh the leaderboard so a name change shows up for already-ranked users.
  // (updateLeaderboard skips users with no activity, so new sign-ups won't pollute it.)
  await updateLeaderboard(env, userId, { user: userData });

  return Response.json({ success: true, adopted: false, userId, recoveryCode });
}
