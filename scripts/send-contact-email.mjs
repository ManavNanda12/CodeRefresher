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
async function fetchContact(id) {
  const res = await fetch(`${WORKER_BASE}/api/admin/contact`, {
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
  });
  if (!res.ok) throw new Error(`GET /api/admin/contact → ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.users || []).find(u => u.id === id) || null;
}

/**
 * The dispatch fires seconds after the KV write and KV is eventually consistent —
 * the fresh record may not be visible from the Action's colo yet. Retry briefly.
 */
async function fetchContactWithRetry(id, attempts = 5, delayMs = 20_000) {
  for (let i = 1; i <= attempts; i++) {
    const contact = await fetchContact(id);
    if (contact && contact.email) return contact;
    if (i < attempts) {
      console.log(`contact ${id} not visible yet (attempt ${i}/${attempts}) — waiting ${delayMs / 1000}s for KV propagation…`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

// ── rendering ────────────────────────────────────────────────
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function renderEmail(contact) {
  const template = await readFile(
    new URL("./templates/welcome-email.html", import.meta.url),
    "utf8",
  );

  const name = (contact.name || "").trim();
  const heroTitle = name
    ? `${esc(name)}, your prep arena is&nbsp;open.`
    : `Your prep arena is&nbsp;open.`;
  const unsub = unsubscribeUrl(contact);

  const html = template
    .replaceAll("{{HERO_TITLE}}", heroTitle)
    .replaceAll("{{APP_URL}}", APP_BASE_URL)
    .replaceAll("{{APP_HOST}}", new URL(APP_BASE_URL).host)
    .replaceAll("{{UNSUB_URL}}", unsub);

  const subject = name
    ? `Welcome to the arena, ${name} 🏟️`
    : `Welcome to the arena 🏟️`;

  const text = [
    name ? `${name}, 'Contact Us Testing'` : 'Contact Us Testing'
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

  const user = await fetchContactWithRetry(USER_ID);
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
