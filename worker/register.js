// register.js → POST /api/user/register
//
// Body: { userId, email, name? }   ·  optional header: Authorization: Bearer {token}
//   - One email = one account. We keep an `email:{lowercased}` → userId index.
//   - Mints a 256-bit session TOKEN on first registration (stored as a hash) and a strong
//     random RECOVERY CODE (not derivable from the userId). Both are returned ONCE so the
//     client can persist them.
//   - SECURITY: registering with an email that already belongs to a DIFFERENT account no
//     longer hands that account over — the caller must restore it with its recovery code.
//   - Doubles as "update profile": once an account has a token, updates require that token.
//   - Legacy accounts (no token / derived recovery code) are upgraded on first call.

import { updateLeaderboard } from "./leaderboard.js";
import {
  isUserId,
  safeEqual,
  sha256Hex,
  randomToken,
  randomRecoveryCode,
  bearerToken,
} from "./security.js";

const legacyRecoveryCodeFor = (id) => `cr_${id.replace(/-/g, "").slice(0, 8)}`;
const normEmail = (e) => String(e || "").trim().toLowerCase();

export async function handleUserRegister(request, env) {
  const { userId, email, name } = await request.json();

  if (!isUserId(userId) || !email || typeof email !== "string") {
    return Response.json({ success: false, error: "Missing fields" }, { status: 400 });
  }

  const emailKey = `email:${normEmail(email)}`;

  // ── Email already belongs to a DIFFERENT account ──
  // Never surrender an account just because the caller knows the email. Tell the client to
  // restore via recovery code instead. (A same-userId re-register falls through below.)
  const ownerId = await env.PROGRESS_KV.get(emailKey);
  if (ownerId && ownerId !== userId) {
    return Response.json(
      { success: false, error: "email_in_use", emailInUse: true },
      { status: 409 },
    );
  }

  const existing = await env.PROGRESS_KV.get(`user:${userId}`);
  const userData = existing
    ? JSON.parse(existing) // keep arenas/recentRounds/game
    : { userId, email, arenas: {}, recentRounds: [] };

  // ── Ownership check on an already-secured account ──
  // If this account already carries a token, the caller must present a matching one —
  // stops anyone who merely knows userId+email from overwriting the profile or rebinding it.
  if (userData.tokenHash) {
    const token = bearerToken(request);
    const hash = token ? await sha256Hex(token) : "";
    if (!token || !safeEqual(hash, userData.tokenHash)) {
      return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
  }

  userData.email = email;
  if (typeof name === "string" && name.trim()) userData.name = name.trim().slice(0, 24);

  // ── Mint a session token on first secure registration ──
  let newToken = null;
  if (!userData.tokenHash) {
    newToken = randomToken();
    userData.tokenHash = await sha256Hex(newToken);
  }

  // ── Recovery code: mint a strong random one; retire any legacy derivable code ──
  let newRecoveryCode = null;
  const legacy = legacyRecoveryCodeFor(userId);
  if (!userData.recoveryCode || userData.recoveryCode === legacy) {
    newRecoveryCode = randomRecoveryCode();
    userData.recoveryCode = newRecoveryCode;
    await env.PROGRESS_KV.put(`recovery:${newRecoveryCode}`, userId);
    await env.PROGRESS_KV.delete(`recovery:${legacy}`); // old derivable code can no longer restore
  }

  await env.PROGRESS_KV.put(`user:${userId}`, JSON.stringify(userData));
  await env.PROGRESS_KV.put(emailKey, userId); // claim the email for this account

  // Refresh the leaderboard so a name change shows up for already-ranked users.
  await updateLeaderboard(env, userId, { user: userData });

  return Response.json({
    success: true,
    adopted: false,
    userId,
    ...(newToken ? { token: newToken } : {}),
    ...(newRecoveryCode ? { recoveryCode: newRecoveryCode } : {}),
  });
}
