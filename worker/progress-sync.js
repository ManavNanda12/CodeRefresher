// progress-sync.js → POST /api/progress/sync
//
// 🔴 REPLACES the old arena-level version.
// The frontend posts the WHOLE round (with per-question module + score):
//   { userId, round: { id, date, arena, level, levelName, score, time,
//                       questions: [ { module, question, score }, ... ] } }
// We merge it into per-module + overall stats so the dashboard heatmap and
// weak-spots can render. Math is identical to the client (progress.service.ts).

const SCORES_MAX = 20;   // keep last N scores per module
const HISTORY_MAX = 30;  // keep last N rounds

function round2(n) {
  return Math.round(n * 10) / 10;
}

export async function handleProgressSync(request, env) {
  const { userId, round } = await request.json();

  if (!userId || !round || !Array.isArray(round.questions)) {
    return Response.json({ success: false, error: "Missing or invalid round" }, { status: 400 });
  }

  // Fall back to a fresh record so a dropped register call never loses progress.
  const existing = await env.PROGRESS_KV.get(`user:${userId}`);
  const userData = existing
    ? JSON.parse(existing)
    : { userId, email: "", arenas: {}, recentRounds: [] };

  userData.arenas = userData.arenas || {};

  // ── merge this round into the arena's module + overall stats ──
  const arena = userData.arenas[round.arena] || {
    overall: { rounds: 0, avgScore: 0, totalQsTested: 0 },
    modules: {},
  };

  for (const q of round.questions) {
    const mod = arena.modules[q.module] || { tested: 0, scores: [], avg: null };
    mod.scores = [...mod.scores, q.score].slice(-SCORES_MAX);
    mod.tested += 1;
    mod.avg = round2(mod.scores.reduce((s, x) => s + x, 0) / mod.scores.length);
    arena.modules[q.module] = mod;
  }

  const rounds = arena.overall.rounds + 1;
  arena.overall = {
    rounds,
    avgScore: round2((arena.overall.avgScore * arena.overall.rounds + round.score) / rounds),
    totalQsTested: arena.overall.totalQsTested + round.questions.length,
  };

  userData.arenas[round.arena] = arena;

  // ── history: most-recent-first, capped ──
  userData.recentRounds = [round, ...(userData.recentRounds || [])].slice(0, HISTORY_MAX);
  userData.lastActive = new Date().toISOString();

  await env.PROGRESS_KV.put(`user:${userId}`, JSON.stringify(userData));

  return Response.json({ success: true });
}
