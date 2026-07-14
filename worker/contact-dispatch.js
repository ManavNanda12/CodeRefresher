const DEFAULT_REPO = "ManavNanda12/CodeRefresher";

export async function dispatchContactEmail(env, userId) {
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
        event_type: "contact-email",
        client_payload: { userId },
      }),
    });
    if (res.status !== 204) {
      console.error(`contact dispatch failed: ${res.status} ${await res.text()}`);
    }
    return res.status === 204;
  } catch (err) {
    console.error("contact dispatch error:", err);
    return false;
  }
}
