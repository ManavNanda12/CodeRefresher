// worker.js — main router with centralized CORS + origin lock.
//
// Browser endpoints are locked to ALLOWED_ORIGINS. Server-to-server / public-link
// endpoints (admin export, email unsubscribe) are EXEMPT from the origin gate —
// they send no browser Origin and are protected by their own auth (bearer secret /
// recovery-code token) instead.

import { evaluateHandler } from "./evaluate.js";
import { handleUserRegister } from "./register.js";
import { handleDashboard } from "./dashboard.js";
import { handleProgressSync } from "./progress-sync.js";
import { handleRecover } from "./recover.js";
import { handleDeleteAccount } from "./delete-account.js";
import { handleAdminUsers } from "./admin-users.js";
import { handleUnsubscribe } from "./email-unsubscribe.js";
import { handleGameSync, handleGameLoad } from "./game-sync.js";
import { handleLeaderboard } from "./leaderboard.js";
import { handleHint } from "./hint.js";
import { handleShareCreate, handleSharePage, handleShareImage, handleShareImageGet } from "./share.js";
import { rateLimited, tooMany } from "./rate-limit.js";

// ── Allowed browser origins ────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://coderefresher.pages.dev",
  "http://localhost:4200", // Angular dev server
];

// Endpoints with NO browser origin — skip the origin gate (own auth protects them):
//   /api/admin/users      → GitHub Actions (Bearer ADMIN_SECRET)
//   /api/email/unsubscribe → email link / top-level navigation (recovery-code token)
const ORIGIN_EXEMPT = ["/api/admin/users", "/api/email/unsubscribe"];

function getOrigin(request) {
  return request.headers.get("Origin") || "";
}

function isAllowed(request) {
  return ALLOWED_ORIGINS.includes(getOrigin(request));
}

function corsHeaders(request) {
  const origin = getOrigin(request);
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function withCors(request, res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsHeaders(request))) out.headers.set(k, v);
  return out;
}

function forbidden() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    const method = request.method;
    const exempt = ORIGIN_EXEMPT.includes(p);

    // ── CORS preflight — only for allowed origins (exempt paths aren't browser fetches) ──
    if (method === "OPTIONS") {
      if (!isAllowed(request)) return forbidden();
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ── Public share page + og:image (crawlers + humans; no browser Origin) ──
    // Served outside the origin gate so social crawlers can read the OG tags.
    if (method === "GET" && p.startsWith("/share/")) {
      const imgMatch = p.match(/^\/share\/([^/]+)\/image\.png$/);
      if (imgMatch) return handleShareImageGet(decodeURIComponent(imgMatch[1]), env);
      return handleSharePage(decodeURIComponent(p.slice("/share/".length)), env, url.origin);
    }

    // ── Origin gate — block browser endpoints not from our frontend ──
    // Exempt: server-to-server (admin) + public email links (unsubscribe).
    if (p.startsWith("/api/") && !exempt && !isAllowed(request)) {
      return forbidden();
    }

    // ── /api/evaluate ──
    if (p === "/api/evaluate") {
      if (method === "POST") return withCors(request, await evaluateHandler(request, env));
      return withCors(request, new Response("Method not allowed", { status: 405 }));
    }

    // ── /api/hint (Test Me lifeline) ──
    if (p === "/api/hint" && method === "POST") {
      if (await rateLimited(request, env, "hint", 120)) return withCors(request, tooMany());
      return withCors(request, await handleHint(request, env));
    }

    // ── progress + user endpoints ──
    if (p === "/api/user/register" && method === "POST") {
      if (await rateLimited(request, env, "register", 20)) return withCors(request, tooMany());
      return withCors(request, await handleUserRegister(request, env));
    }
    if (p === "/api/progress/dashboard" && method === "GET") {
      return withCors(request, await handleDashboard(request, env));
    }
    if (p === "/api/progress/sync" && method === "POST") {
      return withCors(request, await handleProgressSync(request, env));
    }
    if (p === "/api/user/recover" && method === "POST") {
      if (await rateLimited(request, env, "recover", 30)) return withCors(request, tooMany());
      return withCors(request, await handleRecover(request, env));
    }
    if (p === "/api/user/delete" && method === "POST") {
      if (await rateLimited(request, env, "delete", 10)) return withCors(request, tooMany());
      return withCors(request, await handleDeleteAccount(request, env));
    }

    // ── arena game state ──
    if (p === "/api/game/sync" && method === "POST") {
      return withCors(request, await handleGameSync(request, env));
    }
    if (p === "/api/game/load" && method === "GET") {
      return withCors(request, await handleGameLoad(url, env));
    }
    if (p === "/api/leaderboard" && method === "GET") {
      return withCors(request, await handleLeaderboard(env));
    }

    // ── share scorecard (write a public share entry) ──
    if (p === "/api/share/create" && method === "POST") {
      if (await rateLimited(request, env, "share", 60)) return withCors(request, tooMany());
      return withCors(request, await handleShareCreate(request, env));
    }
    if (p === "/api/share/image" && method === "POST") {
      if (await rateLimited(request, env, "share", 60)) return withCors(request, tooMany());
      return withCors(request, await handleShareImage(request, env));
    }

    // ── email outreach (exempt from origin gate; auth'd separately) ──
    if (p === "/api/admin/users" && method === "GET") {
      return withCors(request, await handleAdminUsers(request, env));
    }
    if (p === "/api/email/unsubscribe" && method === "GET") {
      return withCors(request, await handleUnsubscribe(request, env));
    }

    return new Response("Hello World!");
  },
};
