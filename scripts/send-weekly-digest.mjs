/**
 * Weekly progress digest — sends each user a recap of their CodeRefresher progress,
 * their weakest module, and a CTA to run a Focus Round.
 *
 * Runs from a Node runtime (GitHub Actions cron), NOT the Cloudflare Worker —
 * Workers can't open raw SMTP connections. It pulls the user list from the worker's
 * secured /api/admin/users endpoint, builds a per-user digest, and sends via SMTP
 * (nodemailer) by default — or via Resend's HTTP API if EMAIL_PROVIDER=resend.
 *
 * Required env (GitHub Actions secrets):
 *   WORKER_BASE     e.g. https://coderefresherworker.manavnanda2404.workers.dev
 *   ADMIN_SECRET    matches the worker's ADMIN_SECRET
 *   SMTP_FROM       e.g. "CodeRefresher <progress@yourdomain.com>"
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   (for the default SMTP transport)
 * Optional:
 *   SMTP_SECURE     "true" to force TLS (else inferred: true for port 465)
 *   APP_BASE_URL    site URL used in links (default https://devrefresher.app)
 *   EMAIL_PROVIDER  "resend" to send via Resend instead of SMTP
 *   RESEND_API_KEY  required when EMAIL_PROVIDER=resend
 *   DRY_RUN         "true" to log recipients without sending
 */

const {
  WORKER_BASE,
  ADMIN_SECRET,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PORT = "587",
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  APP_BASE_URL = "https://devrefresher.app",
  EMAIL_PROVIDER = "smtp",
  RESEND_API_KEY,
  DRY_RUN,
} = process.env;

const ARENA_NAMES = { angular: "Angular", dotnet: ".NET", sql: "SQL" };
const ARENA_ICONS = { angular: "⚡", dotnet: "🔷", sql: "🗄️" };

// ── env validation ───────────────────────────────────────────
function validateEnv() {
  const missing = [];
  if (!WORKER_BASE) missing.push("WORKER_BASE");
  if (!ADMIN_SECRET) missing.push("ADMIN_SECRET");
  if (!SMTP_FROM) missing.push("SMTP_FROM");
  if (EMAIL_PROVIDER === "resend") {
    if (!RESEND_API_KEY) missing.push("RESEND_API_KEY");
  } else {
    if (!SMTP_HOST) missing.push("SMTP_HOST");
    if (!SMTP_USER) missing.push("SMTP_USER");
    if (!SMTP_PASS) missing.push("SMTP_PASS");
  }
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// ── data ─────────────────────────────────────────────────────
async function fetchUsers() {
  const res = await fetch(`${WORKER_BASE}/api/admin/users`, {
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
  });
  if (!res.ok) throw new Error(`GET /api/admin/users → ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.users || [];
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Build the digest model, or null if the user has nothing worth emailing about. */
function buildDigest(user) {
  const arenaEntries = Object.entries(user.arenas || {}).filter(
    ([, a]) => a?.overall?.rounds > 0,
  );
  if (!arenaEntries.length) return null;

  let weakest = null;
  for (const [aid, a] of arenaEntries) {
    for (const [module, st] of Object.entries(a.modules || {})) {
      if (st.tested > 0 && st.avg != null) {
        if (!weakest || st.avg < weakest.avg) weakest = { arena: aid, module, avg: st.avg };
      }
    }
  }

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const roundsThisWeek = (user.recentRounds || []).filter(
    r => Date.parse(r.date) >= weekAgo,
  ).length;
  const totalRounds = arenaEntries.reduce((s, [, a]) => s + a.overall.rounds, 0);

  return { arenaEntries, weakest, roundsThisWeek, totalRounds };
}

function unsubscribeUrl(user) {
  const code = `cr_${String(user.userId).replace(/-/g, "").slice(0, 8)}`;
  return `${WORKER_BASE}/api/email/unsubscribe?u=${encodeURIComponent(user.userId)}&c=${code}`;
}

function band(avg) {
  if (avg == null) return "#64748b";
  if (avg >= 7) return "#34d399";
  if (avg >= 4) return "#fbbf24";
  return "#f87171";
}

// ── email rendering (inline styles for client compatibility) ──
function renderEmail(user, d) {
  const focusUrl = `${APP_BASE_URL}/dashboard`;
  const unsub = unsubscribeUrl(user);

  const arenaRows = d.arenaEntries
    .map(([aid, a]) => {
      const name = ARENA_NAMES[aid] || aid;
      const icon = ARENA_ICONS[aid] || "📦";
      const avg = round1(a.overall.avgScore);
      return `<tr>
        <td style="padding:8px 0;color:#cbd5e1;font-size:15px">${icon} ${name}</td>
        <td style="padding:8px 0;text-align:right;font-weight:700;color:${band(avg)};font-size:15px">${avg}/10</td>
        <td style="padding:8px 0;text-align:right;color:#64748b;font-size:13px">${a.overall.rounds} round${a.overall.rounds === 1 ? "" : "s"}</td>
      </tr>`;
    })
    .join("");

  const weakLine = d.weakest
    ? `<p style="margin:0 0 6px;color:#94a3b8;font-size:14px">🎯 Your softest spot right now</p>
       <p style="margin:0;font-size:18px;font-weight:700;color:#fcd34d">
         ${ARENA_ICONS[d.weakest.arena] || ""} ${d.weakest.module}
         <span style="color:${band(d.weakest.avg)};font-size:15px">· ${round1(d.weakest.avg)}/10</span>
       </p>`
    : `<p style="margin:0;color:#94a3b8;font-size:14px">No weak modules yet — keep exploring new topics!</p>`;

  const weekLine =
    d.roundsThisWeek > 0
      ? `You ran <strong style="color:#e2e8f0">${d.roundsThisWeek}</strong> round${d.roundsThisWeek === 1 ? "" : "s"} this week.`
      : `You didn't practice this week — a quick 5-question round is all it takes to keep momentum.`;

  const subject = d.weakest
    ? `Your weekly recap — time to drill ${d.weakest.module}`
    : `Your weekly CodeRefresher recap`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#070d1c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="text-align:center;margin-bottom:24px">
      <span style="font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#a5b4fc">📊 Weekly Recap</span>
    </div>
    <div style="background:linear-gradient(160deg,#0d152b,#0a1024);border:1px solid rgba(99,102,241,.28);border-radius:18px;padding:28px 24px">
      <h1 style="margin:0 0 4px;font-size:22px;color:#f1f5f9">Here's where you stand</h1>
      <p style="margin:0 0 20px;color:#94a3b8;font-size:14px;line-height:1.5">${weekLine} Total: ${d.totalRounds} rounds.</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(148,163,184,.14);border-bottom:1px solid rgba(148,163,184,.14);margin-bottom:22px">
        ${arenaRows}
      </table>

      <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:12px;padding:16px 18px;margin-bottom:24px">
        ${weakLine}
      </div>

      <a href="${focusUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:12px">
        🎯 Run a Focus Round →
      </a>
    </div>

    <p style="text-align:center;color:#475569;font-size:12px;line-height:1.6;margin:20px 0 0">
      You're getting this because you saved progress on CodeRefresher.<br>
      <a href="${unsub}" style="color:#64748b;text-decoration:underline">Unsubscribe</a>
    </p>
  </div>
</body></html>`;

  const text = [
    `Your weekly CodeRefresher recap`,
    ``,
    `${weekLine.replace(/<[^>]+>/g, "")} Total: ${d.totalRounds} rounds.`,
    ``,
    ...d.arenaEntries.map(([aid, a]) => `- ${ARENA_NAMES[aid] || aid}: ${round1(a.overall.avgScore)}/10 (${a.overall.rounds} rounds)`),
    ``,
    d.weakest ? `Softest spot: ${d.weakest.module} (${round1(d.weakest.avg)}/10)` : `No weak modules yet.`,
    ``,
    `Run a Focus Round: ${focusUrl}`,
    ``,
    `Unsubscribe: ${unsub}`,
  ].join("\n");

  return { subject, html, text, unsub };
}

// ── transport (swappable) ────────────────────────────────────
let _smtp;
async function getSmtp() {
  if (!_smtp) {
    const nodemailer = (await import("nodemailer")).default;
    _smtp = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === "true" || Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return _smtp;
}

async function sendEmail({ to, subject, html, text, unsub }) {
  const listUnsub = unsub ? { "List-Unsubscribe": `<${unsub}>` } : undefined;

  if (EMAIL_PROVIDER === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SMTP_FROM, to, subject, html, text, headers: listUnsub }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return;
  }

  const transport = await getSmtp();
  await transport.sendMail({ from: SMTP_FROM, to, subject, html, text, headers: listUnsub });
}

// ── main ─────────────────────────────────────────────────────
async function main() {
  validateEnv();
  const dryRun = DRY_RUN === "true";
  const users = await fetchUsers();
  console.log(`Fetched ${users.length} users. provider=${EMAIL_PROVIDER || "smtp"} dryRun=${dryRun}`);

  let sent = 0, skipped = 0, failed = 0;
  for (const user of users) {
    if (!user.email) { console.log(`skip ${user.userId}: no email on record`); skipped++; continue; }
    if (user.unsubscribed) { console.log(`skip ${user.email}: unsubscribed`); skipped++; continue; }
    const digest = buildDigest(user);
    if (!digest) {
      const keys = Object.keys(user.arenas || {});
      const reason = keys.length
        ? `arenas [${keys.join(", ")}] present but none have overall.rounds — likely pre-fix data; complete a fresh round`
        : `no arenas synced yet — no completed rounds in KV`;
      console.log(`skip ${user.email}: ${reason}`);
      skipped++;
      continue;
    }

    const mail = renderEmail(user, digest);
    if (dryRun) {
      console.log(`[dry-run] → ${user.email} · "${mail.subject}"`);
      sent++;
      continue;
    }
    try {
      await sendEmail({ to: user.email, ...mail });
      sent++;
      await new Promise(r => setTimeout(r, 400)); // gentle pacing for SMTP limits
    } catch (err) {
      failed++;
      console.error(`✗ ${user.email}: ${err.message}`);
    }
  }

  console.log(`Done. sent=${sent} skipped=${skipped} failed=${failed}`);
  if (failed > 0 && sent === 0) process.exit(1); // surface a fully-failed run in CI
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
