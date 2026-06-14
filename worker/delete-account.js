// delete-account.js → POST /api/user/delete
//
// Permanently removes a user's KV record + recovery pointer. Authorized by the
// recovery code (cr_ + first 8 hex of the UUID) so a user can only delete their own.
//
// Add to worker.js:
//   import { handleDeleteAccount } from "./delete-account.js";
//   if (p === "/api/user/delete" && method === "POST") return withCors(await handleDeleteAccount(request, env));

export async function handleDeleteAccount(request, env) {
  const { userId, recoveryCode } = await request.json();

  if (!userId) {
    return Response.json({ success: false, error: "Missing userId" }, { status: 400 });
  }

  const expected = `cr_${String(userId).replace(/-/g, "").slice(0, 8)}`;
  if (recoveryCode !== expected) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  await env.PROGRESS_KV.delete(`user:${userId}`);
  await env.PROGRESS_KV.delete(`recovery:${expected}`);

  return Response.json({ success: true });
}
