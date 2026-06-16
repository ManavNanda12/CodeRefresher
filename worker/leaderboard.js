// leaderboard.js → GET /api/leaderboard  +  updateLeaderboard(env, userId, rec)
//
// SCALE-SAFE: a single KV key `leaderboard` holds the top-N per category. We never
// scan all users (KV can't sort, and listing everyone would blow the read budget).
// updateLeaderboard() is called from progress/game sync; it upserts just this user's
// entry into the cached boards and only writes back if a board actually changed.
//
// Categories: xp (overall rank) · rounds (most tests) · best (highest round score).
// Privacy: entries use a generated alias, never the user's email.

const TOP_N = 20;
const LB_KEY = "leaderboard";

const ADJ = ["Swift","Silent","Brave","Sharp","Clever","Mighty","Cosmic","Turbo","Pixel","Quantum","Rapid","Stealth","Hyper","Neon","Iron","Golden","Shadow","Crimson"];
const NOUN = ["Falcon","Ninja","Coder","Wizard","Dragon","Phoenix","Tiger","Comet","Ranger","Samurai","Vortex","Hawk","Wolf","Byte","Cipher","Knight","Specter","Nomad"];

function hashNum(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
function alias(userId) {
  const h = hashNum(String(userId));
  return `${ADJ[h % ADJ.length]} ${NOUN[(h >> 5) % NOUN.length]}`;
}
/** Public display name: the part of the email before "@", falling back to an alias. */
function displayName(email, userId) {
  if (email && email.includes("@")) return email.split("@")[0];
  return alias(userId);
}
function shortId(userId) {
  return String(userId).replace(/-/g, "").slice(0, 12);
}
function levelFromXp(xp) {
  return Math.floor(Math.sqrt((xp || 0) / 50)) + 1;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Insert/replace this user's entry, sort desc, keep TOP_N. Returns the new array. */
function upsert(list, entry) {
  const next = (list || []).filter(e => e.id !== entry.id);
  next.push(entry);
  next.sort((a, b) => b.value - a.value);
  return next.slice(0, TOP_N);
}

export async function updateLeaderboard(env, userId, rec) {
  if (!rec) return;
  const xp = rec.game?.xp || 0;
  // NOTE: the user record stores arenas under `arenas` (not `progress`).
  const rounds = Object.values(rec.arenas || {}).reduce((s, a) => s + (a?.overall?.rounds || 0), 0);
  const best = (rec.recentRounds || []).reduce((m, r) => Math.max(m, r.score || 0), 0);

  // Skip users with no activity yet — keeps fresh sign-ups off the boards.
  if (xp === 0 && rounds === 0 && best === 0) return;

  const id = shortId(userId);
  const name = rec.name || displayName(rec.email, userId);
  const level = levelFromXp(xp);
  const base = { id, name, level };

  const lb = (await env.PROGRESS_KV.get(LB_KEY, "json")) || { xp: [], rounds: [], best: [] };
  const before = JSON.stringify([lb.xp, lb.rounds, lb.best]);

  lb.xp = upsert(lb.xp, { ...base, value: xp });
  lb.rounds = upsert(lb.rounds, { ...base, value: rounds });
  lb.best = upsert(lb.best, { ...base, value: round1(best) });

  // Only spend a KV write if a board actually changed (keeps us well under the budget).
  if (JSON.stringify([lb.xp, lb.rounds, lb.best]) === before) return;
  lb.updatedAt = new Date().toISOString();
  await env.PROGRESS_KV.put(LB_KEY, JSON.stringify(lb));
}

export async function handleLeaderboard(env) {
  const lb = (await env.PROGRESS_KV.get(LB_KEY, "json")) || { xp: [], rounds: [], best: [], updatedAt: null };
  return Response.json(lb);
}
