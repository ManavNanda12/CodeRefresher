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
  } else if (rec.recoveryCode) {
    // Account has a real (high-entropy) recovery code — require exactly that.
    // Do NOT also accept the derivable `cr_<8hex>` code: it's a public transform
    // of the userId, so accepting it would let anyone who knows the UUID delete
    // the account.
    authorized = safeEqual(recoveryCode, rec.recoveryCode);
  } else {
    // Truly legacy account that never minted a recovery code. The derivable code
    // is the only credential it has; this path closes the moment the account's
    // client re-registers (register.js mints a random recoveryCode then).
    const legacy = `cr_${userId.replace(/-/g, "").slice(0, 8)}`;
    authorized = safeEqual(recoveryCode, legacy);
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
