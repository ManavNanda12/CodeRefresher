// share.js → POST /api/share/create  &  GET /share/{shareId}
//
// Powers "Share your scorecard". After a Test Me round the client mints a short
// shareId, builds the share URL locally (so the buttons work instantly), and
// fires /api/share/create in the background. The KV entry is read back by the
// public /share/{shareId} page, which renders a standalone, OG-tagged scorecard
// so Twitter / LinkedIn / WhatsApp generate a rich link preview.
//
// Why a standalone page (not an Angular route): social crawlers read OG meta
// from the FIRST HTML response and don't run JS, so the tags must be in the
// initial markup. The Worker bakes them in.

const SHARE_TTL = 90 * 24 * 60 * 60;          // 90 days, then auto-expire
const SHARE_ID_RE = /^s_[A-Za-z0-9]{6,16}$/;  // must match the client generator
const SITE = "https://coderefresher.pages.dev";

// ── POST /api/share/create ─────────────────────────────────────
// Body: { shareId, card } where `card` is the denormalized scorecard payload.
// Idempotent: re-posting the same id just refreshes the TTL.
export async function handleShareCreate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Bad JSON" }, { status: 400 });
  }

  const { shareId, card } = body || {};
  if (!shareId || !SHARE_ID_RE.test(shareId)) {
    return Response.json({ success: false, error: "Invalid shareId" }, { status: 400 });
  }
  if (!card || typeof card !== "object" || typeof card.score !== "number") {
    return Response.json({ success: false, error: "Invalid card" }, { status: 400 });
  }

  // Trust nothing from the client beyond a known, size-capped shape.
  const safe = sanitizeCard(card);
  safe.createdAt = new Date().toISOString();

  await env.PROGRESS_KV.put(`share:${shareId}`, JSON.stringify(safe), {
    expirationTtl: SHARE_TTL,
  });

  const origin = new URL(request.url).origin;
  return Response.json({ success: true, shareUrl: `${origin}/share/${shareId}` });
}

// ── POST /api/share/image?id={shareId} ─────────────────────────
// Body: raw PNG bytes. The card is rendered client-side and uploaded so link
// previews (og:image) show the visual card — no server-side image library or
// paid plan needed. Stored under share:img:{id} with the same 90-day TTL.
const MAX_IMG_BYTES = 600 * 1024;

export async function handleShareImage(request, env) {
  const shareId = new URL(request.url).searchParams.get("id") || "";
  if (!SHARE_ID_RE.test(shareId)) {
    return Response.json({ success: false, error: "Invalid shareId" }, { status: 400 });
  }
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_IMG_BYTES) {
    return Response.json({ success: false, error: "Bad image size" }, { status: 400 });
  }
  await env.PROGRESS_KV.put(`share:img:${shareId}`, bytes, { expirationTtl: SHARE_TTL });
  return Response.json({ success: true });
}

// ── GET /share/{shareId}/image.png ─────────────────────────────
// Public: crawlers fetch this as og:image. 404 (not an error page) when absent.
export async function handleShareImageGet(shareId, env) {
  const bytes = SHARE_ID_RE.test(shareId)
    ? await env.PROGRESS_KV.get(`share:img:${shareId}`, "arrayBuffer")
    : null;
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

// ── GET /share/{shareId} ───────────────────────────────────────
// Public (no origin gate): crawlers + humans land here. Returns full HTML.
// `origin` is where this page is actually served (the Worker), used for og:url.
export async function handleSharePage(shareId, env, origin) {
  const card = SHARE_ID_RE.test(shareId)
    ? await env.PROGRESS_KV.get(`share:${shareId}`, "json")
    : null;

  const found = !!card;
  const html = found ? renderCard(card, shareId, origin) : renderNotFound();

  return new Response(html, {
    status: found ? 200 : 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Crawlers re-fetch; let them cache the preview briefly.
      "Cache-Control": found ? "public, max-age=300" : "public, max-age=60",
    },
  });
}

// ── helpers ────────────────────────────────────────────────────
function sanitizeCard(c) {
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const questions = Array.isArray(c.questions)
    ? c.questions.slice(0, 12).map((q) => ({
        module: str(q.module, 40),
        score: Math.max(0, Math.min(10, num(q.score))),
      }))
    : [];
  return {
    v: 1,
    arena: str(c.arena, 24),
    arenaName: str(c.arenaName, 24),
    arenaIcon: str(c.arenaIcon, 8),
    accent: /^#[0-9a-fA-F]{3,8}$/.test(c.accent) ? c.accent : "#818cf8",
    level: str(c.level, 16),
    levelName: str(c.levelName, 24),
    levelBadge: str(c.levelBadge, 24),
    username: str(c.username, 24) || "A developer",
    score: Math.max(0, Math.min(10, num(c.score))),
    timeLabel: str(c.timeLabel, 12),
    streak: Math.max(0, Math.min(9999, Math.round(num(c.streak)))),
    userLevel: Math.max(1, Math.min(999, Math.round(num(c.userLevel) || 1))),
    questions,
  };
}

// HTML-escape every interpolated value — the payload is user-influenced.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function scoreColor(score) {
  if (score >= 8) return "#34d399";
  if (score >= 6) return "#fbbf24";
  if (score >= 4) return "#fb923c";
  return "#f87171";
}

function renderCard(c, shareId, origin) {
  const score = c.score.toFixed(1);
  const color = scoreColor(c.score);
  const qCount = c.questions.length;
  const arenaLine = [c.arenaName, c.levelName, c.levelBadge].filter(Boolean).join(" · ");

  const title = `${c.username} scored ${score}/10 on ${c.arenaName} (${c.levelName})`;
  const desc = `${qCount} questions answered${c.timeLabel ? ` in ${c.timeLabel}` : ""}. Think you can beat this? Try CodeRefresher — free AI-powered interview prep.`;
  // og:url must be where this page actually lives (the Worker). CTAs link into the app (SITE).
  const pageUrl = `${origin || SITE}/share/${shareId}`;
  const imageUrl = `${pageUrl}/image.png`;
  // Carry the opponent's name + score so the challenger's results can show a head-to-head.
  const challengeUrl = c.arena
    ? `${SITE}/test-me?arena=${encodeURIComponent(c.arena)}` +
      (c.level ? `&level=${encodeURIComponent(c.level)}` : "") +
      `&vs=${encodeURIComponent(c.username)}&vsScore=${c.score}`
    : `${SITE}/test-me`;

  // ring geometry (r=58, circ≈364.4)
  const circ = 2 * Math.PI * 58;
  const offset = circ - (c.score / 10) * circ;

  const bars = c.questions
    .map((q, i) => {
      const col = scoreColor(q.score);
      return `<div class="q">
        <span class="q-i">Q${i + 1}</span>
        <div class="q-track"><div class="q-fill" style="width:${q.score * 10}%;background:${col}"></div></div>
        <span class="q-v" style="color:${col}">${q.score}</span>
        <span class="q-m">${esc(q.module)}</span>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | CodeRefresher</title>
<meta name="description" content="${esc(desc)}">

<meta property="og:type" content="website">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="CodeRefresher">
<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(c.username)} scored ${score}/10 on ${esc(c.arenaName)}">
<meta name="twitter:description" content="Can you beat this score? Free AI-graded dev interview prep →">
<meta name="twitter:image" content="${esc(imageUrl)}">

<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:32px 16px 64px;
       background-image:radial-gradient(120% 90% at 0% 0%,${esc(c.accent)}1f,transparent 55%),radial-gradient(100% 80% at 100% 0%,#6366f11a,transparent 50%)}
  a{color:inherit;text-decoration:none}
  .wrap{width:100%;max-width:640px;display:flex;flex-direction:column;gap:28px}
  .topnav{display:flex;justify-content:space-between;align-items:center;width:100%;font-size:14px;color:#94a3b8}
  .brand{font-weight:700;color:#cbd5e1}
  .brand b{color:#818cf8}
  /* scorecard */
  .card{background:rgba(255,255,255,.04);border:1px solid color-mix(in srgb,${esc(c.accent)} 30%,rgba(255,255,255,.1));
        border-radius:24px;padding:32px;position:relative;overflow:hidden}
  .card::before{content:"";position:absolute;top:-90px;left:-60px;width:320px;height:320px;border-radius:50%;
        background:radial-gradient(circle,${esc(c.accent)}55,transparent 65%);filter:blur(46px);opacity:.5;pointer-events:none}
  .ch{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1;font-size:13px}
  .ch .left{font-weight:700;color:#cbd5e1}.ch .left b{color:#818cf8}
  .ch .right{color:#64748b}
  .arena{position:relative;z-index:1;margin:22px 0 4px;color:${esc(c.accent)};font-size:12px;font-weight:700;
        letter-spacing:2px;text-transform:uppercase}
  .hero{position:relative;z-index:1;display:flex;align-items:center;gap:28px;margin:18px 0 26px;flex-wrap:wrap}
  .ring{position:relative;width:140px;height:140px;flex-shrink:0}
  .ring svg{transform:rotate(-90deg)}
  .ring .c{text-align:center;position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .ring .c b{font-size:38px;font-weight:800;color:${color};line-height:1;letter-spacing:-.03em}
  .ring .c span{font-size:13px;color:#64748b;font-weight:600}
  .who b{display:block;font-size:26px;font-weight:800;color:#f8fafc;letter-spacing:-.02em}
  .who p{color:#94a3b8;font-size:15px;margin-top:6px}
  .who .meta{color:#cbd5e1;font-size:14px;margin-top:8px}
  .qs{position:relative;z-index:1;display:flex;flex-direction:column;gap:10px;margin-top:8px}
  .q{display:flex;align-items:center;gap:10px;font-size:13px}
  .q-i{color:#64748b;width:24px;font-weight:600}
  .q-track{flex:1;max-width:160px;height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}
  .q-fill{height:100%;border-radius:4px}
  .q-v{width:18px;font-weight:700;text-align:right}
  .q-m{color:#94a3b8;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .foot{position:relative;z-index:1;margin-top:26px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1);
        color:#818cf8;font-size:14px;font-weight:600}
  /* CTA */
  .cta{text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center}
  .cta h2{font-size:22px;color:#f1f5f9;font-weight:800}
  .btn{display:inline-block;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:700;
       padding:14px 28px;border-radius:14px;font-size:16px;box-shadow:0 10px 30px rgba(99,102,241,.45);transition:transform .15s}
  .btn:hover{transform:translateY(-2px)}
  .fine{color:#64748b;font-size:13px}
  .about{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:24px;
         text-align:center;color:#94a3b8;font-size:14px;line-height:1.6}
  .about h3{color:#e2e8f0;font-size:16px;margin-bottom:8px}
  .about a{color:#818cf8;font-weight:700}
  @media(max-width:520px){.hero{justify-content:center;text-align:center}.who{text-align:center}}
</style>
</head>
<body>
  <div class="wrap">
    <div class="topnav">
      <span class="brand">&lt;/&gt; <b>CodeRefresher</b></span>
      <a href="${esc(SITE)}">Try CodeRefresher →</a>
    </div>

    <div class="card">
      <div class="ch">
        <span class="left">&lt;/&gt; <b>CodeRefresher</b></span>
        <span class="right">coderefresher.pages.dev</span>
      </div>
      <div class="arena">${esc(c.arenaIcon)} ${esc(arenaLine)}</div>
      <div class="hero">
        <div class="ring">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="8"/>
            <circle cx="70" cy="70" r="58" fill="none" stroke="${color}" stroke-width="8"
                    stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
          </svg>
          <div class="c"><b>${score}</b><span>/10</span></div>
        </div>
        <div class="who">
          <b>${esc(c.username)}</b>
          <p>${qCount} questions answered${c.timeLabel ? ` in ${esc(c.timeLabel)}` : ""}</p>
          <div class="meta">🔥 ${c.streak} day streak · ⚡ Lv ${c.userLevel}</div>
        </div>
      </div>
      <div class="qs">${bars}</div>
      <div class="foot">Think you can beat this? Try free → coderefresher.pages.dev</div>
    </div>

    <div class="cta">
      <h2>Think you can do better?</h2>
      <a class="btn" href="${esc(challengeUrl)}">⚡ Take the Same Challenge →</a>
      <span class="fine">Free · No signup required · AI-graded</span>
    </div>

    <div class="about">
      <h3>What is CodeRefresher?</h3>
      AI-powered interview prep for Angular, .NET &amp; SQL. Answer questions from memory,
      get graded by AI, track your weak spots, and compete on the leaderboard.<br><br>
      <a href="${esc(SITE)}">Start Free →</a>
    </div>
  </div>
</body>
</html>`;
}

function renderNotFound() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scorecard not found | CodeRefresher</title>
<meta name="description" content="This scorecard has expired or doesn't exist. Try CodeRefresher — free AI-powered interview prep.">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;padding:24px}
  h1{font-size:28px;color:#f1f5f9}p{color:#94a3b8;max-width:420px;line-height:1.6}
  a{display:inline-block;margin-top:8px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:700;
    padding:14px 28px;border-radius:14px;text-decoration:none;box-shadow:0 10px 30px rgba(99,102,241,.45)}
</style></head>
<body>
  <h1>🔍 Scorecard not found</h1>
  <p>This share link has expired or never existed — but you can make your own in two minutes.</p>
  <a href="${SITE}/test-me">⚡ Take the Challenge →</a>
</body></html>`;
}
