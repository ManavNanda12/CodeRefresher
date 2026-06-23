// recover.js → POST /api/user/recover
//
// Restores an account on a new device from its recovery code. This is now the ONLY way to
// re-enter an account you don't hold a token for (email alone no longer restores it).
//   - Rotates the session token on every restore (a deliberate "make THIS device the owner";
//     invalidates other devices) and returns the fresh token.
//   - Upgrades a legacy derivable code (`cr_`+8 hex) to a strong random one.
// Returns userId / email / name / token / recoveryCode / progress flat (the client reads
// them at the top level).

import { isRecoveryCode, sha256Hex, randomToken, randomRecoveryCode } from "./security.js";

const legacyRecoveryCodeFor = (id) => `cr_${id.replace(/-/g, "").slice(0, 8)}`;

export async function handleRecover(request, env) {
  const { recoveryCode } = await request.json();

  if (!isRecoveryCode(recoveryCode)) {
    return Response.json({ success: false, error: "Invalid recovery code" }, { status: 404 });
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

  // Rotate the session token (the recovering device becomes the owner).
  const token = randomToken();
  userData.tokenHash = await sha256Hex(token);

  // Upgrade a legacy derivable code to a strong random one; otherwise keep their code.
  let code = userData.recoveryCode || recoveryCode;
  if (recoveryCode === legacyRecoveryCodeFor(userId) || !userData.recoveryCode) {
    code = randomRecoveryCode();
    userData.recoveryCode = code;
    await env.PROGRESS_KV.put(`recovery:${code}`, userId);
    if (code !== recoveryCode) await env.PROGRESS_KV.delete(`recovery:${recoveryCode}`);
  }

  // Backfill the email→userId index so a later same-email re-register dedupes correctly.
  if (userData.email) {
    await env.PROGRESS_KV.put(`email:${String(userData.email).trim().toLowerCase()}`, userId);
  }
  await env.PROGRESS_KV.put(`user:${userId}`, JSON.stringify(userData));

  return Response.json({
    success: true,
    userId,
    email: userData.email || "",
    name: userData.name || "",
    token,
    recoveryCode: code,
    progress: {
      arenas: userData.arenas || {},
      recentRounds: userData.recentRounds || [],
    },
  });
}
