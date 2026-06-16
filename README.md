# CodeRefresher 🏟️

An interview-prep **arena** built with **Angular 22**. Don't just *read* about Angular, .NET & SQL — **refresh** structured Q&A, **test** yourself against an AI examiner, **track** your readiness on a live dashboard, and **level up** as you clear the gaps.

> Learn → Test → Track → Improve. A complete, gamified prep loop — free forever, no sign-up to browse.

---

## ✨ Features

### 📚 Structured Q&A ("Arenas")
Curated interview questions for **Angular**, **.NET / ASP.NET Core**, and **SQL**, split by experience tier (0–1 / 1–2 / 2–3 / 4+ years). Every question ships with a detailed answer, a syntax-highlighted **code example**, and a plain-English **analogy** so concepts actually stick. Each card is a **challenge card** — difficulty tier, XP value, and a **"Master ✓"** toggle.

### 🧪 Test Me — AI-graded mock interview
Pick a tech + level, answer **5 random questions from memory**, and a large language model grades each answer **0–10 against an expert response** — returning a verdict, your **strengths**, **what you missed**, and a **tip**. Results screen shows an overall score ring, a rank, a per-question breakdown, and XP earned.

### 📊 Smart Dashboard
Every round feeds a live, **cross-device** dashboard:
- **Readiness rings** per technology
- A colour-coded **module heatmap** (strong → weak → untested)
- Your top **weak spots** and **recent rounds**
- A copyable **recovery code** to restore progress on any device (no password)

### 🎯 Adaptive Focus Rounds
One tap builds a quiz **weighted toward your weakest and untested modules** — drill exactly what needs work. Clear a whole module and a **"test yourself"** challenge fires a focus round on it.

### 🕹️ Arena gamification
- **XP & levels** (earned by mastering questions + finishing rounds)
- A **daily streak 🔥** and **achievements**
- A BGMI-style **level-up crate** animation + achievement toasts
- A live **HUD** (level · XP bar · streak) in the header

### 🏆 Leaderboard
Climb the arena: three ranked boards — **Top Rank** (XP), **Most Tests**, and **Best Score** — with an animated **top-3 podium**, your own row highlighted, and a friendly display name (set yours, or a generated alias). Built **scale-safe**: one cached KV key holds the top 20 per board, updated incrementally, so reads stay O(1) no matter how many users join.

### 📬 Weekly progress emails
An opt-out **weekly digest** (GitHub Actions cron + SMTP) emails each user their progress recap, weakest module, and a nudge to keep the streak alive.

### 🎨 Light / Dark theme
A signature dark **arena** theme with an opt-in **daylight** mode (browse surfaces flip to light; immersive game surfaces stay dark by design). Choice is persisted, with no flash on load.

---

## 🧱 Tech Stack

| Layer | Choice |
|---|---|
| Framework | Angular 22 (standalone components, **SSR**) |
| SEO | Per-page meta + canonical, OG/Twitter cards, `robots.txt` + `sitemap.xml`, `WebSite`/`WebApplication` + per-page `FAQPage`/`BreadcrumbList` JSON-LD, `noindex` on private pages |
| Reactivity | Signals (`signal`, `computed`, `effect`, `afterNextRender`) |
| Routing | Lazy routes + `withViewTransitions()` |
| Styling | Plain CSS — custom-property design tokens, `color-mix()`, keyframe animations |
| Backend | **Cloudflare Worker** + **Workers KV** (progress, game state, users) |
| AI grading | LLM via the Worker (`/api/evaluate`) |
| Email | **GitHub Actions** cron + `nodemailer` (SMTP), transport-swappable to Resend |
| Persistence | Cookie (identity) + localStorage (fast cache) + KV (source of truth) |

---

## 🗂️ Architecture

```
Browser (Angular SSR)
  ├─ cookie: opaque userId + email (identity)
  ├─ localStorage: progress + game state (instant, offline-first cache)
  └─ HTTPS → Cloudflare Worker
                ├─ /api/evaluate              → AI grades a Test Me answer
                ├─ /api/user/register|recover|delete
                ├─ /api/progress/sync|dashboard   → per-module stats + history
                ├─ /api/game/sync|load            → XP / mastery / streak (batched writes)
                ├─ /api/leaderboard               → cached top-20 boards (O(1) read)
                ├─ /api/admin/users               → email export (Bearer secret)
                └─ /api/email/unsubscribe
                        │
                        └─ Workers KV  (user:{id} = profile + progress + game · leaderboard = cached boards)

GitHub Actions (weekly cron) → scripts/send-weekly-digest.mjs → SMTP → users
```

**Offline-first:** writes hit localStorage instantly, then sync to KV (game writes are **debounced** to respect KV's free-tier write budget). On load, KV is merged back so any device stays in sync.

---

## 📁 Project Structure

```
src/app/
  core/services/        data · seo · user · progress · game · theme · focus · leaderboard
  shared/components/     layout (header HUD + footer) · card (challenge card)
                         · tech-page (arena) · onboarding-modal · game-events
                         (level-up crate + toasts)
  pages/                 home · angular · dotnet · sql · test-me · dashboard · leaderboard
public/data/             angular.json · dotnet.json · sql.json   (Q&A content)
worker/                  Worker endpoint reference files + KV/EMAIL setup docs
scripts/                 send-weekly-digest.mjs
.github/workflows/       weekly-digest.yml
```

Adding a new tech arena: drop a `public/data/{tech}.json`, a thin page wrapper, a route, a nav item, and a `TECH_META` entry. (See `worker/KV-SETUP.md` and `worker/EMAIL-SETUP.md` for backend setup.)

---

## 🚀 Getting Started

```bash
npm install
npm start            # dev server → http://localhost:4200
npm run build        # production (SSR) build
```

### Backend (Cloudflare)
1. Create a KV namespace `CODEREFRESHER_PROGRESS`, bind it as `PROGRESS_KV`.
2. Deploy the Worker with the routes in `worker/worker.js` (keep your `GROK_API_KEY`, set `ADMIN_SECRET`).
3. For weekly emails, add the GitHub Actions secrets listed in `worker/EMAIL-SETUP.md`.

Full details: [`worker/KV-SETUP.md`](worker/KV-SETUP.md) · [`worker/EMAIL-SETUP.md`](worker/EMAIL-SETUP.md)

---

## 🗺️ Roadmap

- [x] AI-graded Test Me
- [x] Smart dashboard + cross-device sync
- [x] Adaptive focus rounds
- [x] Arena gamification (XP / streak / achievements / level-up)
- [x] Leaderboard (XP / tests / best score)
- [x] Weekly email digest
- [x] Light / dark theme
- [ ] More arenas (React, Python, AWS, Docker) & deeper question banks
- [ ] Daily Challenge
- [ ] AI-generated questions & follow-up probing
- [ ] Spaced repetition for mastered questions

---

Built by [Manav Nanda](https://manav-personal-portfolio.pages.dev/) · Made for developers, by developers.
