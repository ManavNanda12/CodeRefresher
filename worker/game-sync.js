// game-sync.js → POST /api/game/sync  &  GET /api/game/load?userId=…
//
// Stores the arena game state (XP, mastery, streak, achievements) in a DEDICATED
// `game:{userId}` key, separate from the user/progress record, so a game sync can never
// clobber rounds/history (and vice-versa). Reads fall back to the legacy nested
// `user:{id}.game` for accounts created before the split.
// Writes are batched on the client (KV free tier ≈ 1k writes/day).
//
// Add to worker.js:
//   import { handleGameSync, handleGameLoad } from "./game-sync.js";
//   if (p === "/api/game/sync" && method === "POST") return withCors(await handleGameSync(request, env));
//   if (p === "/api/game/load" && method === "GET")  return withCors(await handleGameLoad(url, env));

import { updateLeaderboard } from "./leaderboard.js";

export async function handleGameSync(request, env) {
  const { userId, game } = await request.json();
  if (!userId || !game) {
    return Response.json({ success: false, error: "Missing userId or game" }, { status: 400 });
  }

  // Game state lives in its OWN key now — game-sync must NEVER read-modify-write the
  // user/progress record (that race was clobbering rounds). Back-compat: migrate game that
  // used to be nested inside the user record on first read.
  const existing =
    (await env.PROGRESS_KV.get(`game:${userId}`, "json")) ||
    (await env.PROGRESS_KV.get(`user:${userId}`, "json"))?.game ||
    null;

  // Server-side merge too, so two devices writing close together don't clobber.
  const merged = mergeGame(existing, game);

  // ── Anti-tamper clamp ──────────────────────────────────────────────────────────
  // XP is authored on the client (localStorage), so we cap it to a server-plausible
  // ceiling derived from data we already trust: rounds played (≤50 XP each) + questions
  // mastered (≤25 XP each), plus slack. A tampered localStorage value can no longer top
  // the leaderboard, and the cap is the most a player could legitimately have earned.
  const user = (await env.PROGRESS_KV.get(`user:${userId}`, "json")) || {};
  const rounds = Object.values(user.arenas || {}).reduce((s, a) => s + (a?.overall?.rounds || 0), 0);
  const masteredCount = Object.values(merged.mastered || {}).filter(Boolean).length;
  const maxXp = 100 + rounds * 50 + masteredCount * 25;
  merged.xp = Math.min(merged.xp || 0, maxXp);

  await env.PROGRESS_KV.put(`game:${userId}`, JSON.stringify(merged));
  await updateLeaderboard(env, userId, { game: merged, user });

  return Response.json({ success: true, game: merged });
}

export async function handleGameLoad(url, env) {
  const userId = url.searchParams.get("userId");
  if (!userId) return Response.json({ success: false, error: "Missing userId" }, { status: 400 });

  // Prefer the dedicated game key; fall back to the legacy nested copy for old accounts.
  const game =
    (await env.PROGRESS_KV.get(`game:${userId}`, "json")) ||
    (await env.PROGRESS_KV.get(`user:${userId}`, "json"))?.game ||
    null;
  return Response.json({ success: true, game });
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
