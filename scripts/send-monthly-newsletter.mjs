/**
 * Monthly newsletter — a block-based, git-versioned issue sent to every user
 * who opted in ("allow updates" at onboarding; pre-checkbox accounts count as
 * opted in, same consent basis as the weekly digest).
 *
 * Each issue is a JSON file in scripts/newsletters/{YYYY-MM}.json — an ordered
 * list of blocks the author edits freely (text, memes by URL, feature
 * announcements) plus COMPUTED blocks the script fills from live data:
 *   topPerformer  → #1 on the XP leaderboard (public /api/leaderboard)
 *   signupCount   → users whose createdAt falls inside the issue month
 *
 * Block types:
 *   { "type": "text",    "title"?, "body", "link"?, "linkLabel"? }
 *   { "type": "meme",    "url", "alt", "caption"? }            // https image URL
 *   { "type": "feature", "emoji"?, "kicker"?, "title", "body", "link"?, "linkLabel"? }
 *   { "type": "topPerformer", "note"? }
 *   { "type": "signupCount",  "note"? }
 *   { "type": "divider" }
 * `**bold**` inside body/intro text is rendered as <strong>.
 *
 * Runs from Node (GitHub Actions cron on the 1st), NOT the Worker — Workers
 * can't open raw SMTP connections. Same transport contract as the digest.
 *
 * Required env (already set as Actions secrets for the digest):
 *   WORKER_BASE, ADMIN_SECRET, SMTP_FROM, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Optional:
 *   ISSUE           which issue to send, e.g. "2026-07" (default: current month UTC)
 *   PREVIEW_TO      send ONE copy to this address and exit — proof the issue before the cron
 *   PREVIEW_FILE    also write the rendered HTML here (open in a browser while authoring)
 *   SMTP_SECURE, APP_BASE_URL, EMAIL_PROVIDER=resend, RESEND_API_KEY, DRY_RUN
 */

import { readFile, writeFile } from "node:fs/promises";

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
  ISSUE,
  PREVIEW_TO,
  PREVIEW_FILE,
  DRY_RUN,
} = process.env;

const FONT = "'Inter',-apple-system,'Segoe UI',Arial,sans-serif";

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

// ── issue + data ─────────────────────────────────────────────
function issueId() {
  if (ISSUE) {
    if (!/^\d{4}-\d{2}$/.test(ISSUE)) throw new Error(`ISSUE must look like 2026-07, got "${ISSUE}"`);
    return ISSUE;
  }
  return new Date().toISOString().slice(0, 7); // current month UTC
}

function monthLabel(id) {
  const [y, m] = id.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

async function loadIssue(id) {
  const path = new URL(`./newsletters/${id}.json`, import.meta.url);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // Not fatal for CI — a month without an authored issue simply sends nothing.
    console.log(`No issue file for ${id} (scripts/newsletters/${id}.json) — nothing to send.`);
    process.exit(0);
  }
  const issue = JSON.parse(raw);
  if (!issue.subject || !Array.isArray(issue.blocks)) {
    throw new Error(`Issue ${id} needs at least { subject, blocks[] }`);
  }
  return issue;
}

async function fetchUsers() {
  const res = await fetch(`${WORKER_BASE}/api/admin/users`, {
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
  });
  if (!res.ok) throw new Error(`GET /api/admin/users → ${res.status} ${await res.text()}`);
  return (await res.json()).users || [];
}

async function fetchLeaderboard() {
  try {
    const res = await fetch(`${WORKER_BASE}/api/leaderboard`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** New signups inside the issue month (createdAt only exists on newer accounts). */
function signupStats(users, id) {
  const inMonth = users.filter(u => u.createdAt && u.createdAt.slice(0, 7) === id).length;
  return { inMonth, total: users.length };
}

// ── rendering helpers ────────────────────────────────────────
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Escape, then allow **bold** as an authoring nicety. */
const rich = (s) =>
  esc(s).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e2e8f0;">$1</strong>');

const plain = (s) => String(s).replace(/\*\*(.+?)\*\*/g, "$1");

function unsubscribeUrl(userId, newsletterOnly) {
  const code = `cr_${String(userId).replace(/-/g, "").slice(0, 8)}`;
  const t = newsletterOnly ? "&t=newsletter" : "";
  return `${WORKER_BASE}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&c=${code}${t}`;
}

/** A full-width row inside the email card. */
const row = (inner, pad = "28px 40px 0") =>
  `                <tr>\n                  <td style="padding:${pad};font-family:${FONT};">\n${inner}\n                  </td>\n                </tr>`;

const arrowLink = (link, label) =>
  `<div style="padding-top:10px;"><a href="${esc(link)}" target="_blank" style="font-size:13px;font-weight:700;color:#818cf8;text-decoration:none;">${esc(label || "Check it out")} &rarr;</a></div>`;

/** Absolute-ify site-relative links ("/interview") against APP_BASE_URL. */
const absLink = (link) => (link && link.startsWith("/") ? `${APP_BASE_URL}${link}` : link);

// ── block renderers → { html, text } ─────────────────────────
function renderText(b) {
  const title = b.title
    ? `<div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#64748b;padding-bottom:8px;">${esc(b.title).toUpperCase()}</div>`
    : "";
  const link = b.link ? arrowLink(absLink(b.link), b.linkLabel) : "";
  return {
    html: row(`${title}<div style="font-size:15px;line-height:24px;color:#94a3b8;">${rich(b.body)}</div>${link}`),
    text: [b.title ? `## ${b.title}` : null, plain(b.body), b.link ? `→ ${absLink(b.link)}` : null],
  };
}

function renderMeme(b) {
  if (!/^https:\/\//.test(b.url || "")) {
    console.warn(`skip meme block: url must be https (${b.url})`);
    return null;
  }
  const caption = b.caption
    ? `<div style="padding-top:10px;font-size:13px;font-style:italic;color:#64748b;">${rich(b.caption)}</div>`
    : "";
  const inner = `                    <div style="text-align:center;">
                      <img src="${esc(b.url)}" alt="${esc(b.alt || "you had to be there")}" width="520" style="width:100%;max-width:520px;height:auto;border-radius:12px;border:1px solid #26314a;display:inline-block;">
                      ${caption}
                    </div>`;
  return {
    html: row(inner),
    text: [`[image: ${b.alt || b.url}]${b.caption ? ` — ${plain(b.caption)}` : ""}`],
  };
}

/** The #111b36 highlight panel shared by feature/topPerformer/signupCount. */
function panel(kickerColor, kicker, title, body) {
  return `                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111b36" style="background-color:#111b36;background-image:linear-gradient(#111b36,#111b36);border:1px solid #2b3654;border-radius:12px;">
                      <tr>
                        <td style="padding:22px 24px;font-family:${FONT};">
                          <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:${kickerColor};padding-bottom:8px;">${kicker}</div>
                          <div style="font-size:17px;font-weight:700;color:#f1f5f9;padding-bottom:8px;">${title}</div>
                          <div style="font-size:14px;line-height:22px;color:#94a3b8;">${body}</div>
                        </td>
                      </tr>
                    </table>`;
}

function renderFeature(b) {
  const kicker = esc(b.kicker || "NEW IN THE ARENA").toUpperCase();
  const emoji = b.emoji ? `${b.emoji} ` : "";
  const link = b.link ? arrowLink(absLink(b.link), b.linkLabel || "Try it") : "";
  return {
    html: row(panel("#c084fc", `&#128640; ${kicker}`, `${emoji}${esc(b.title)}`, `${rich(b.body)}${link}`)),
    text: [`🚀 NEW: ${b.title}`, plain(b.body), b.link ? `→ ${absLink(b.link)}` : null],
  };
}

function renderTopPerformer(b, ctx) {
  const top = ctx.leaderboard?.xp?.[0];
  if (!top) {
    console.warn("skip topPerformer block: leaderboard is empty");
    return null;
  }
  const note = b.note || "Think you can dethrone them? The arena awaits.";
  return {
    html: row(
      panel(
        "#facc15",
        "&#127942; TOP PERFORMER OF THE MONTH",
        esc(top.name),
        `Level ${Number(top.level) || 1} &middot; <strong style="color:#facc15;">${Number(top.value).toLocaleString("en-US")} XP</strong><br>${rich(note)}`,
      ),
    ),
    text: [`🏆 Top performer: ${top.name} — Level ${top.level}, ${top.value} XP`, plain(note)],
  };
}

function renderSignupCount(b, ctx) {
  const { inMonth, total } = ctx.signups;
  const headline = inMonth > 0 ? `+${inMonth.toLocaleString("en-US")} devs joined in ${ctx.monthName}` : `The arena is now ${total.toLocaleString("en-US")} devs strong`;
  const note = b.note || (inMonth > 0 ? `That makes ${total.toLocaleString("en-US")} of us sharpening up for interviews.` : "And growing every week.");
  return {
    html: row(panel("#0ea5e9", "&#128200; ARENA GROWTH", esc(headline), rich(note))),
    text: [`📈 ${headline}`, plain(note)],
  };
}

const renderDivider = () => ({
  html: row(`<div style="border-top:1px solid #1d2740;font-size:0;line-height:0;">&nbsp;</div>`, "28px 40px 0"),
  text: [""],
});

const RENDERERS = {
  text: renderText,
  meme: renderMeme,
  feature: renderFeature,
  topPerformer: renderTopPerformer,
  signupCount: renderSignupCount,
  divider: renderDivider,
};

// ── issue → email ────────────────────────────────────────────
async function renderIssue(issue, ctx) {
  const template = await readFile(new URL("./templates/newsletter.html", import.meta.url), "utf8");

  const htmlBlocks = [];
  const textBlocks = [];
  for (const b of issue.blocks) {
    const renderer = RENDERERS[b.type];
    if (!renderer) {
      console.warn(`skip unknown block type "${b.type}"`);
      continue;
    }
    const out = renderer(b, ctx);
    if (!out) continue;
    htmlBlocks.push(out.html);
    textBlocks.push(out.text.filter(Boolean).join("\n"));
  }

  const kicker = issue.kicker || `THE MONTHLY DROP &middot; ${ctx.monthName.toUpperCase()}`;
  const heroTitle = issue.heroTitle || `What went down in ${ctx.monthName}`;

  const html = template
    .replaceAll("{{PREHEADER}}", esc(issue.preheader || issue.subject))
    .replaceAll("{{KICKER}}", kicker)
    .replaceAll("{{HERO_TITLE}}", rich(heroTitle))
    .replaceAll("{{INTRO}}", issue.intro ? rich(issue.intro) : "")
    .replaceAll("{{BLOCKS}}", htmlBlocks.join("\n"))
    .replaceAll("{{APP_URL}}", APP_BASE_URL)
    .replaceAll("{{APP_HOST}}", new URL(APP_BASE_URL).host);
  // {{UNSUB_NEWS_URL}} / {{UNSUB_ALL_URL}} stay — swapped in per recipient.

  const text = [
    plain(heroTitle),
    issue.intro ? plain(issue.intro) : null,
    "",
    ...textBlocks.flatMap(t => [t, ""]),
    `Back to the arena: ${APP_BASE_URL}`,
    "",
    "Stop the newsletter: {{UNSUB_NEWS_URL}}",
    "Unsubscribe from all emails: {{UNSUB_ALL_URL}}",
  ].filter(l => l !== null).join("\n");

  return { subject: issue.subject, html, text };
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── main ─────────────────────────────────────────────────────
async function main() {
  validateEnv();
  const dryRun = DRY_RUN === "true";

  const id = issueId();
  const issue = await loadIssue(id);
  const users = await fetchUsers();
  const leaderboard = await fetchLeaderboard();
  const ctx = { monthName: monthLabel(id), leaderboard, signups: signupStats(users, id) };

  const rendered = await renderIssue(issue, ctx);
  console.log(`Issue ${id} · "${rendered.subject}" · ${issue.blocks.length} blocks`);

  if (PREVIEW_FILE) {
    await writeFile(PREVIEW_FILE, personalize(rendered, "00000000-0000-4000-8000-000000000000").html, "utf8");
    console.log(`Preview HTML written to ${PREVIEW_FILE}`);
  }

  // Proof mode: one copy to yourself, real unsub links pointing at nothing harmful.
  if (PREVIEW_TO) {
    const mail = personalize(rendered, "00000000-0000-4000-8000-000000000000");
    await sendEmail({ to: PREVIEW_TO, ...mail });
    console.log(`✓ Preview sent to ${PREVIEW_TO} — no subscribers emailed.`);
    return;
  }

  const recipients = users.filter(u => u.email && !u.unsubscribed && u.allowUpdates !== false);
  console.log(`${recipients.length}/${users.length} users opted in`);

  let sent = 0, failed = 0;
  for (const user of recipients) {
    const mail = personalize(rendered, user.userId);
    if (dryRun) {
      console.log(`[dry-run] → ${user.email}`);
      continue;
    }
    try {
      await sendEmail({ to: user.email, ...mail });
      sent++;
      console.log(`✓ ${user.email}`);
    } catch (err) {
      failed++;
      console.error(`✗ ${user.email}: ${err.message}`);
    }
    await sleep(300); // be gentle with the SMTP relay
  }
  console.log(dryRun ? `[dry-run] would send to ${recipients.length}` : `Done — sent ${sent}, failed ${failed}.`);
  if (failed > 0 && sent === 0) process.exit(1);
}

function personalize(rendered, userId) {
  const news = unsubscribeUrl(userId, true);
  const all = unsubscribeUrl(userId, false);
  return {
    subject: rendered.subject,
    html: rendered.html.replaceAll("{{UNSUB_NEWS_URL}}", news).replaceAll("{{UNSUB_ALL_URL}}", all),
    text: rendered.text.replaceAll("{{UNSUB_NEWS_URL}}", news).replaceAll("{{UNSUB_ALL_URL}}", all),
    unsub: news,
  };
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
