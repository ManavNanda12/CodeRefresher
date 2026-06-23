// security.js — small shared hardening helpers for the Worker.
//
// Add to worker.js (no route needed; imported by handlers):
//   import { isUserId, safeEqual } from "./security.js";

/** Standard UUID v4 shape (what crypto.randomUUID + the client fallback produce). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject junk / oversized ids before they become KV keys. */
export function isUserId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

/** Recovery code shape — accepts legacy (`cr_`+8 hex) and new (`cr_`+24 base32) codes. */
export function isRecoveryCode(code) {
  return typeof code === "string" && /^cr_[A-Za-z0-9]{6,40}$/.test(code);
}

/**
 * Constant-time string comparison — avoids the early-exit timing leak of `===`/`!==`
 * when checking secrets (the admin bearer token, recovery/unsubscribe codes). Lengths
 * are fixed/known for these tokens, so the length check leaks nothing useful.
 */
export function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Session token + recovery code (proper, high-entropy secrets) ────────────────
const enc = new TextEncoder();

/** SHA-256 hex of a string. We store only the HASH of a session token in KV. */
export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(String(input)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 256-bit session token (64 hex chars). Proves ownership of a userId. */
export function randomToken() {
  return randomHex(32);
}

/**
 * High-entropy recovery code: `cr_` + 24 unambiguous base32 chars (~120 bits). Unlike the
 * legacy `cr_`+8-hex code, this is NOT derivable from the userId.
 */
export function randomRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 ambiguity
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += alphabet[a[i] % alphabet.length];
  return "cr_" + s;
}

/** The bearer token from an Authorization header, or "". */
export function bearerToken(request) {
  return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Ownership gate for per-user endpoints. Returns { ok, rec } where rec is the parsed user
 * record (so callers can reuse it without a second read). Backward-compatible: an account
 * with no `tokenHash` yet (legacy, pre-migration) is allowed through — brand-new accounts
 * always have one, so this grace window only covers un-migrated users until their client
 * re-registers and mints a token.
 */
export async function requireToken(request, env, userId) {
  const rec = await env.PROGRESS_KV.get(`user:${userId}`, "json");
  if (!rec || !rec.tokenHash) return { ok: true, rec };
  const token = bearerToken(request);
  if (!token) return { ok: false, rec };
  const hash = await sha256Hex(token);
  return { ok: safeEqual(hash, rec.tokenHash), rec };
}
