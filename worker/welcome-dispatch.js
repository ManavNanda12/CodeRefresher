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

export async function dispatchWelcomeEmail(env, userId) {
  const token = env.GITHUB_DISPATCH_TOKEN;
  if (!token) return false; // feature not configured yet — silently skip

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
