// game-sync.js → POST /api/game/sync  &  GET /api/game/load?userId=…
//
// Stores the arena game state (XP, mastery, streak, achievements) inside the
// existing user record under `.game`, so it follows the user across devices.
// Writes are batched on the client (KV free tier ≈ 1k writes/day).
//
// Add to worker.js:
//   import { handleGameSync, handleGameLoad } from "./game-sync.js";
//   if (p === "/api/game/sync" && method === "POST") return withCors(await handleGameSync(request, env));
//   if (p === "/api/game/load" && method === "GET")  return withCors(await handleGameLoad(url, env));

export async function handleGameSync(request, env) {
  const { userId, game } = await request.json();
  if (!userId || !game) {
    return Response.json({ success: false, error: "Missing userId or game" }, { status: 400 });
  }

  const rec =
    (await env.PROGRESS_KV.get(`user:${userId}`, "json")) ||
    { userId, email: "", arenas: {}, recentRounds: [] };

  // Server-side merge too, so two devices writing close together don't clobber.
  rec.game = mergeGame(rec.game, game);
  await env.PROGRESS_KV.put(`user:${userId}`, JSON.stringify(rec));

  return Response.json({ success: true, game: rec.game });
}

export async function handleGameLoad(url, env) {
  const userId = url.searchParams.get("userId");
  if (!userId) return Response.json({ success: false, error: "Missing userId" }, { status: 400 });

  const rec = await env.PROGRESS_KV.get(`user:${userId}`, "json");
  return Response.json({ success: true, game: rec?.game ?? null });
}

function mergeGame(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    xp: Math.max(a.xp || 0, b.xp || 0),
    mastered: { ...(a.mastered || {}), ...(b.mastered || {}) },
    streak:
      (a.streak?.lastActive || "") >= (b.streak?.lastActive || "")
        ? a.streak || { count: 0, lastActive: "" }
        : b.streak,
    achievements: [...new Set([...(a.achievements || []), ...(b.achievements || [])])],
  };
}
