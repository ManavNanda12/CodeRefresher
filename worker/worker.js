// worker.js — main router with centralized CORS.
//
// Fixes browser (localhost + live site) calls being blocked: the API handlers
// return plain JSON with no CORS headers, so cross-origin register/sync preflights
// failed. Here we (a) answer every OPTIONS preflight, and (b) wrap every API
// response with CORS headers — so the handler files stay unchanged.

import { evaluateHandler, handleOptions } from "./evaluate.js";
import { handleUserRegister } from "./register.js";
import { handleDashboard } from "./dashboard.js";
import { handleProgressSync } from "./progress-sync.js";
import { handleRecover } from "./recover.js";
import { handleDeleteAccount } from "./delete-account.js";
import { handleAdminUsers } from "./admin-users.js";
import { handleUnsubscribe } from "./email-unsubscribe.js";
import { handleGameSync, handleGameLoad } from "./game-sync.js";
import { rateLimited, tooMany } from "./rate-limit.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Return a copy of a Response with CORS headers added.
function withCors(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    const method = request.method;

    // CORS preflight for every route.
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── /api/evaluate (existing) ──
    if (p === "/api/evaluate") {
      if (method === "POST") return withCors(await evaluateHandler(request, env));
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }

    // ── progress + user endpoints ──
    if (p === "/api/user/register" && method === "POST") {
      if (await rateLimited(request, env, "register", 20)) return withCors(tooMany());
      return withCors(await handleUserRegister(request, env));
    }
    if (p === "/api/progress/dashboard" && method === "GET") {
      return withCors(await handleDashboard(request, env));
    }
    if (p === "/api/progress/sync" && method === "POST") {
      return withCors(await handleProgressSync(request, env));
    }
    if (p === "/api/user/recover" && method === "POST") {
      if (await rateLimited(request, env, "recover", 30)) return withCors(tooMany());
      return withCors(await handleRecover(request, env));
    }
    if (p === "/api/user/delete" && method === "POST") {
      if (await rateLimited(request, env, "delete", 10)) return withCors(tooMany());
      return withCors(await handleDeleteAccount(request, env));
    }

    // ── arena game state ──
    if (p === "/api/game/sync" && method === "POST") {
      return withCors(await handleGameSync(request, env));
    }
    if (p === "/api/game/load" && method === "GET") {
      return withCors(await handleGameLoad(url, env));
    }

    // ── email outreach ──
    if (p === "/api/admin/users" && method === "GET") {
      return withCors(await handleAdminUsers(request, env));
    }
    if (p === "/api/email/unsubscribe" && method === "GET") {
      return withCors(await handleUnsubscribe(request, env));
    }

    // ── debug helper (optional, remove anytime) ──
    if (p === "/test-kv") {
      await env.PROGRESS_KV.put("hello", "world");
      return withCors(Response.json({ success: true, data: await env.PROGRESS_KV.get("hello") }));
    }

    return new Response("Hello World!");
  },
};
