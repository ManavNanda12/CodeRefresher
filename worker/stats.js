// stats.js — public homepage counters (social proof) + increment helper.
//
//   GET /api/stats → { verdictsTotal, resumesTotal, resumesToday, resumesMonth }
//
// Counters live in KV as plain integers. Increments are read-modify-write, so
// under heavy concurrency a bump can be lost — irrelevant at this scale and a
// fair trade for zero extra infra (same pattern as the welcome-email day cap).
//
// The day/month résumé keys are date-stamped so "today" and "this month" fall
// out of a single get each; the daily key self-expires after ~40 days so old
// buckets don't accumulate forever. Totals never expire.
//
// Fail-soft everywhere: a stats hiccup must never break the flow that triggered
// it (a résumé upload / a grading call) nor the homepage — a missing counter
// just reads as 0.

const DAY_TTL = 60 * 60 * 24 * 40; // ~40 days — long enough to never clip the current day

const utcDay = () => new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
const utcMonth = () => new Date().toISOString().slice(0, 7);  // YYYY-MM

/** Read a counter as an int (0 when absent / unparseable). */
async function readCount(env, key) {
  const raw = await env.PROGRESS_KV.get(key);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/** +1 a counter. `ttl` (seconds) lets date-bucketed keys self-expire. */
async function bump(env, key, ttl) {
  const next = (await readCount(env, key)) + 1;
  await env.PROGRESS_KV.put(key, String(next), ttl ? { expirationTtl: ttl } : undefined);
}

/**
 * Record one "résumé put on trial" — all-time total + today + this month.
 * Fail-soft: never throws into the caller.
 */
export async function bumpResumeCount(env) {
  if (!env?.PROGRESS_KV) return;
  try {
    await bump(env, "stats:resumes:total");
    await bump(env, `stats:resumes:day:${utcDay()}`, DAY_TTL);
    await bump(env, `stats:resumes:month:${utcMonth()}`, DAY_TTL);
  } catch (err) {
    console.error("bumpResumeCount error:", err?.message);
  }
}

/**
 * Record one verdict delivered (any graded round — mock OR résumé interview).
 * Fail-soft: never throws into the caller.
 */
export async function bumpVerdictCount(env) {
  if (!env?.PROGRESS_KV) return;
  try {
    await bump(env, "stats:verdicts:total");
  } catch (err) {
    console.error("bumpVerdictCount error:", err?.message);
  }
}

/**
 * POST /api/stats/verdict — record one verdict delivered.
 *
 * Called by the client when a results screen is shown (résumé OR mock
 * interview), so it counts every delivered verdict — including all-skipped
 * rounds and locally-graded fallbacks that never hit /api/interview-grade.
 * Rate-limited at the router; fail-soft here.
 */
export async function handleVerdictBump(request, env) {
  await bumpVerdictCount(env);
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /api/stats — the homepage social-proof numbers. */
export async function handleStats(request, env) {
  try {
    const [verdictsTotal, resumesTotal, resumesToday, resumesMonth] = await Promise.all([
      readCount(env, "stats:verdicts:total"),
      readCount(env, "stats:resumes:total"),
      readCount(env, `stats:resumes:day:${utcDay()}`),
      readCount(env, `stats:resumes:month:${utcMonth()}`),
    ]);
    return new Response(
      JSON.stringify({ verdictsTotal, resumesTotal, resumesToday, resumesMonth }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          // Cache at the edge for 5 min so the homepage doesn't hit KV on every view.
          "Cache-Control": "public, max-age=300",
        },
      },
    );
  } catch (err) {
    console.error("handleStats error:", err?.message);
    return new Response(
      JSON.stringify({ verdictsTotal: 0, resumesTotal: 0, resumesToday: 0, resumesMonth: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
}
