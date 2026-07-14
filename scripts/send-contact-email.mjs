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
  ADMIN_EMAIL = "manavnanda2404@gmail.com",
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

// Contact messages come from a plain textarea — keep line breaks in HTML.
const nl2br = (s) => esc(s).replace(/\r?\n/g, "<br>");

function receivedAt(contact) {
  const d = new Date(contact.timestamp || NaN);
  return Number.isNaN(d.getTime()) ? "—" : d.toUTCString();
}

async function loadTemplate(name) {
  return readFile(new URL(`./templates/${name}`, import.meta.url), "utf8");
}

// Confirmation to the person who submitted the form.
async function renderThanksEmail(contact) {
  const template = await loadTemplate("contact-thanks.html");

  const name = (contact.name || "").trim();
  const heroTitle = name
    ? `Thanks for reaching out, ${esc(name)}.`
    : `Thanks for reaching out.`;

  const html = template
    .replaceAll("{{HERO_TITLE}}", heroTitle)
    .replaceAll("{{SUBJECT}}", esc(contact.subject || "(no subject)"))
    .replaceAll("{{MESSAGE}}", nl2br(contact.message || ""))
    .replaceAll("{{APP_URL}}", APP_BASE_URL)
    .replaceAll("{{APP_HOST}}", new URL(APP_BASE_URL).host);

  const subject = name
    ? `Thanks for contacting CodeRefresher, ${name} — we got your message`
    : `Thanks for contacting CodeRefresher — we got your message`;

  const text = [
    name ? `Hi ${name},` : `Hi,`,
    "",
    "Thanks for contacting CodeRefresher — your message just landed in the arena.",
    "A real human reads every single one; you'll usually hear back within 24–48 hours.",
    "",
    `Your message${contact.subject ? ` — ${contact.subject}` : ""}:`,
    contact.message || "",
    "",
    `— CodeRefresher · ${APP_BASE_URL}`,
  ].join("\n");

  return { subject, html, text };
}

// Internal notification to the admin inbox.
async function renderAdminEmail(contact) {
  const template = await loadTemplate("contact-admin.html");

  const name = (contact.name || "").trim() || "Someone";
  const subjectLine = contact.subject || "(no subject)";

  const html = template
    .replaceAll("{{NAME}}", esc(name))
    .replaceAll("{{EMAIL}}", esc(contact.email))
    .replaceAll("{{SUBJECT}}", esc(subjectLine))
    .replaceAll("{{RECEIVED}}", esc(receivedAt(contact)))
    .replaceAll("{{MESSAGE}}", nl2br(contact.message || ""))
    .replaceAll("{{REPLY_SUBJECT}}", encodeURIComponent(`Re: ${subjectLine}`))
    .replaceAll("{{APP_URL}}", APP_BASE_URL)
    .replaceAll("{{APP_HOST}}", new URL(APP_BASE_URL).host);

  const subject = `📬 Contact form: ${subjectLine} — from ${name}`;

  const text = [
    "New contact form message",
    "",
    `From: ${name} <${contact.email}>`,
    `Subject: ${subjectLine}`,
    `Received: ${receivedAt(contact)}`,
    "",
    contact.message || "",
  ].join("\n");

  return { subject, html, text };
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

async function sendEmail({ to, subject, html, text, replyTo }) {
  if (EMAIL_PROVIDER === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SMTP_FROM, to, subject, html, text, reply_to: replyTo }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return;
  }

  const transport = await getSmtp();
  await transport.sendMail({ from: SMTP_FROM, to, subject, html, text, replyTo });
}

// ── main ─────────────────────────────────────────────────────
async function main() {
  validateEnv();
  const dryRun = DRY_RUN === "true";

  const contact = await fetchContactWithRetry(USER_ID);
  if (!contact) {
    // Not fatal for CI — a bogus/aborted submission shouldn't page anyone.
    console.log(`No contact with an email found for ${USER_ID} after retries — nothing to send.`);
    return;
  }

  const thanks = await renderThanksEmail(contact);
  const admin = await renderAdminEmail(contact);

  if (dryRun) {
    console.log(`[dry-run] thanks → ${contact.email} · "${thanks.subject}"`);
    console.log(`[dry-run] admin  → ${ADMIN_EMAIL} · "${admin.subject}"`);
    return;
  }

  // Send both even if one fails — the admin should still hear about the
  // submission when the sender's mailbox bounces, and vice versa.
  const failures = [];

  try {
    await sendEmail({ to: ADMIN_EMAIL, replyTo: contact.email, ...admin });
    console.log(`✓ Admin notification sent to ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error(`✗ Admin notification to ${ADMIN_EMAIL} failed:`, err);
    failures.push("admin");
  }

  try {
    await sendEmail({ to: contact.email, ...thanks });
    console.log(`✓ Thanks email sent to ${contact.email}`);
  } catch (err) {
    console.error(`✗ Thanks email to ${contact.email} failed:`, err);
    failures.push("thanks");
  }

  if (failures.length) throw new Error(`Failed to send: ${failures.join(", ")}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
