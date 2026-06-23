// delete-account.js → POST /api/user/delete
//
// Permanently removes a user's KV records. Authorized by the session TOKEN (Authorization:
// Bearer) for secured accounts, or — for legacy accounts that don't have a token yet — by a
// matching recovery code. Unlike the read/write endpoints there is NO lenient "no token →
// allow" path here, because deletion is destructive.

import { isUserId, safeEqual, sha256Hex, bearerToken } from "./security.js";

export async function handleDeleteAccount(request, env) {
  const { userId, recoveryCode } = await request.json();

  if (!isUserId(userId)) {
    return Response.json({ success: false, error: "Missing userId" }, { status: 400 });
  }

  const rec = await env.PROGRESS_KV.get(`user:${userId}`, "json");
  if (!rec) return Response.json({ success: true }); // already gone

  let authorized = false;
  if (rec.tokenHash) {
    const token = bearerToken(request);
    authorized = !!token && safeEqual(await sha256Hex(token), rec.tokenHash);
  } else {
    // Legacy account (no token yet): accept its stored code or the derived legacy code.
    const legacy = `cr_${userId.replace(/-/g, "").slice(0, 8)}`;
    authorized =
      (!!rec.recoveryCode && safeEqual(recoveryCode, rec.recoveryCode)) ||
      safeEqual(recoveryCode, legacy);
  }
  if (!authorized) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  await env.PROGRESS_KV.delete(`user:${userId}`);
  await env.PROGRESS_KV.delete(`game:${userId}`);
  if (rec.recoveryCode) await env.PROGRESS_KV.delete(`recovery:${rec.recoveryCode}`);
  await env.PROGRESS_KV.delete(`recovery:cr_${userId.replace(/-/g, "").slice(0, 8)}`);
  if (rec.email) {
    await env.PROGRESS_KV.delete(`email:${String(rec.email).trim().toLowerCase()}`);
  }

  return Response.json({ success: true });
}
