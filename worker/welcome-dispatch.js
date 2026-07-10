// welcome-dispatch.js — fire the "welcome-email" GitHub Action on first registration.
//
// Workers can't open SMTP connections, so (same split as the weekly digest) the
// actual SENDING happens in GitHub Actions via scripts/send-welcome-email.mjs.
// This helper just pokes GitHub's repository_dispatch API over HTTPS.
//
// PRIVACY: only the userId goes into the dispatch payload — never the email or
// name. The Action pulls those from the secured /api/admin/users endpoint, so no
// PII ever lands in GitHub event payloads or run logs.
//
// Setup (one-time):
//   wrangler secret put GITHUB_DISPATCH_TOKEN   ← fine-grained PAT, repo "Contents:
//                                                 Read and write" on CodeRefresher
//   (optional) GITHUB_REPO var to override the default owner/repo below.
//
// Fail-soft by design: a missing token or a GitHub hiccup must NEVER break
// registration — the user still gets their account; they just miss one email.

const DEFAULT_REPO = "ManavNanda12/CodeRefresher";

// Hard ceiling on welcome emails triggered per UTC day, across ALL callers/IPs.
// The per-IP register limit caps a single source; this bounds the worst case
// under distributed / rotated-IP abuse so the app can never blast more than this
// many unsolicited emails from our SMTP identity in a day. Legitimate sign-up
// volume is far below it; override with env.WELCOME_DAILY_CAP if needed.
const DEFAULT_WELCOME_DAILY_CAP = 200;

/** Reserve a slot in today's welcome-email budget. Fail-soft: allows if no KV. */
async function withinDailyWelcomeBudget(env) {
  if (!env.PROGRESS_KV) return true;
  const cap = Number(env.WELCOME_DAILY_CAP) || DEFAULT_WELCOME_DAILY_CAP;
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const key = `welcome:count:${day}`;
  const used = parseInt(await env.PROGRESS_KV.get(key)) || 0;
  if (used >= cap) return false;
  // 2-day TTL so the counter self-expires without a cleanup job.
  await env.PROGRESS_KV.put(key, String(used + 1), { expirationTtl: 172800 });
  return true;
}

export async function dispatchWelcomeEmail(env, userId) {
  const token = env.GITHUB_DISPATCH_TOKEN;
  if (!token) return false; // feature not configured yet — silently skip

  // Abuse cap: never exceed the daily welcome-email budget, whatever the source.
  if (!(await withinDailyWelcomeBudget(env))) {
    console.error("welcome dispatch skipped: daily welcome-email cap reached");
    return false;
  }

  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "coderefresher-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "welcome-email",
        client_payload: { userId },
      }),
    });
    if (res.status !== 204) {
      console.error(`welcome dispatch failed: ${res.status} ${await res.text()}`);
    }
    return res.status === 204;
  } catch (err) {
    console.error("welcome dispatch error:", err);
    return false;
  }
}
