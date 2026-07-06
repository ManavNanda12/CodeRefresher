/**
 * Welcome email — sent once, right after a user first registers their email.
 *
 * Runs from a Node runtime (GitHub Actions), NOT the Cloudflare Worker — Workers
 * can't open raw SMTP connections. The worker fires a repository_dispatch with
 * ONLY the userId; this script pulls the email + name from the secured
 * /api/admin/users endpoint (so no PII ever passes through GitHub) and sends the
 * dark arena welcome template via SMTP (nodemailer) — or Resend's HTTP API if
 * EMAIL_PROVIDER=resend. Same transport contract as send-weekly-digest.mjs.
 *
 * Required env (GitHub Actions secrets — all already set for the weekly digest):
 *   WORKER_BASE     e.g. https://coderefresherworker.manavnanda2404.workers.dev
 *   ADMIN_SECRET    matches the worker's ADMIN_SECRET
 *   SMTP_FROM       e.g. "CodeRefresher <hello@yourdomain.com>"
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   USER_ID         from the dispatch payload — who to welcome
 * Optional:
 *   SMTP_SECURE, APP_BASE_URL, EMAIL_PROVIDER=resend, RESEND_API_KEY, DRY_RUN
 */

import { readFile } from "node:fs/promises";

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
  USER_ID,
  DRY_RUN,
} = process.env;

// ── env validation ───────────────────────────────────────────
function validateEnv() {
  const missing = [];
  if (!WORKER_BASE) missing.push("WORKER_BASE");
  if (!ADMIN_SECRET) missing.push("ADMIN_SECRET");
  if (!SMTP_FROM) missing.push("SMTP_FROM");
  if (!USER_ID) missing.push("USER_ID");
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
async function fetchUser(userId) {
  const res = await fetch(`${WORKER_BASE}/api/admin/users`, {
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
  });
  if (!res.ok) throw new Error(`GET /api/admin/users → ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.users || []).find(u => u.userId === userId) || null;
}

/**
 * The dispatch fires seconds after the KV write and KV is eventually consistent —
 * the fresh record may not be visible from the Action's colo yet. Retry briefly.
 */
async function fetchUserWithRetry(userId, attempts = 5, delayMs = 20_000) {
  for (let i = 1; i <= attempts; i++) {
    const user = await fetchUser(userId);
    if (user && user.email) return user;
    if (i < attempts) {
      console.log(`user ${userId} not visible yet (attempt ${i}/${attempts}) — waiting ${delayMs / 1000}s for KV propagation…`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

// ── rendering ────────────────────────────────────────────────
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function unsubscribeUrl(userId) {
  const code = `cr_${String(userId).replace(/-/g, "").slice(0, 8)}`;
  return `${WORKER_BASE}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&c=${code}`;
}

async function renderEmail(user) {
  const template = await readFile(
    new URL("./templates/welcome-email.html", import.meta.url),
    "utf8",
  );

  const name = (user.name || "").trim();
  const heroTitle = name
    ? `${esc(name)}, your prep arena is&nbsp;open.`
    : `Your prep arena is&nbsp;open.`;
  const unsub = unsubscribeUrl(user.userId);

  const html = template
    .replaceAll("{{HERO_TITLE}}", heroTitle)
    .replaceAll("{{APP_URL}}", APP_BASE_URL)
    .replaceAll("{{APP_HOST}}", new URL(APP_BASE_URL).host)
    .replaceAll("{{UNSUB_URL}}", unsub);

  const subject = name
    ? `Welcome to the arena, ${name} 🏟️`
    : `Welcome to the arena 🏟️`;

  const text = [
    name ? `${name}, your prep arena is open.` : `Your prep arena is open.`,
    ``,
    `CodeRefresher gets you interview-ready by interviewing YOU — on your own résumé.`,
    `Practice, get AI-graded, track your readiness, and keep the streak alive.`,
    ``,
    `⭐ The flagship: drop your résumé PDF (it never leaves your browser) and the AI`,
    `grills you on your own claims — every one stamped Backed, Shaky or Busted.`,
    ``,
    `Also in your arena:`,
    `- Test Me — pick your battle: 5, 10 or 15 questions, AI-graded 0-10`,
    `- AI Mock Interview — up to 3 stacks, real code editor, meme verdict`,
    `- Smart Dashboard — readiness rings, heatmap, weak spots, synced everywhere`,
    `- XP, streaks & leaderboard`,
    ``,
    `Enter the arena: ${APP_BASE_URL}`,
    ``,
    `Unsubscribe: ${unsub}`,
  ].join("\n");

  return { subject, html, text, unsub };
}

// ── transport (same contract as send-weekly-digest.mjs) ──────
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

  const user = await fetchUserWithRetry(USER_ID);
  if (!user) {
    // Not fatal for CI — a bogus/aborted registration shouldn't page anyone.
    console.log(`No user with an email found for ${USER_ID} after retries — nothing to send.`);
    return;
  }
  if (user.unsubscribed) {
    console.log(`skip ${user.email}: unsubscribed`);
    return;
  }

  const mail = await renderEmail(user);
  if (dryRun) {
    console.log(`[dry-run] → ${user.email} · "${mail.subject}"`);
    return;
  }
  await sendEmail({ to: user.email, ...mail });
  console.log(`✓ Welcome email sent to ${user.email}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
