# CodeRefresher 🏟️

An interview-prep **arena** built with **Angular 22**. Don't just *read* about Angular, .NET, SQL, React, Next.js & NestJS — **refresh** structured Q&A, **test** yourself against an AI examiner, **track** your readiness on a live dashboard, and **level up** as you clear the gaps.

> Learn → Test → Track → Improve. A complete, gamified prep loop — free forever, no sign-up to browse.

---

## ✨ Features

### 📚 Structured Q&A ("Arenas")
Curated interview questions for **Angular**, **.NET / ASP.NET Core**, **SQL**, **React**, **Next.js**, and **NestJS** (100 Q&A each for the latter three), split by experience tier (0–1 / 1–2 / 2–3 / 4+ years). Every question ships with a detailed answer, a syntax-highlighted **code example**, and a plain-English **analogy** so concepts actually stick. Each card is a **challenge card** — difficulty tier, XP value, and a **"Master ✓"** toggle.

### 🧪 Test Me — AI-graded mock interview
Pick a tech + level, answer **5 random questions from memory**, and a large language model grades each answer **0–10 against an expert response** — returning a verdict, your **strengths**, **what you missed**, and a **tip**. Answers can include prose and optional code, and the quiz validates each question independently so empty or failed evaluations are handled gracefully. A playful anti-cheat guard watches for tab switches during a live round and shows funny warning messages when you look away.

- A hint lifeline is available during Test Me: the first hint is free, and each additional hint costs **20 XP**.
- **AI follow-up probing** — on up to 2 random questions, when you give a real answer the AI reads it and fires **one deeper follow-up** ("ok, but *why*? when would that break?") inline before you move on. If your answer is a non-answer or off-topic, the AI stays silent and you just advance — it never probes `hello world`. Your follow-up reply is folded into grading.

### 🎤 AI Mock Interview — multi-stack, fresh questions, meme verdict
A distinct, animated interview simulation. **Combine up to 3 stacks** (pick a preset like *Full-Stack = Angular + .NET* or *The Full Gauntlet = Angular + .NET + SQL*, or build your own), **rate your confidence per stack (1–10)**, and get **5 fresh AI-generated questions per stack** — so a 2-stack interview is 10 questions, 3 is 15.

- **Balanced question mix** — the generator is prompted for a spread of **theory**, **code/query** (write-a-snippet), and **scenario/design** questions, tagged with a `kind` so the UI adapts — not an endless wall of "how would you…".
- **Code editor with IntelliSense** — code & query questions get a **CodeMirror editor** (language auto-set per stack: SQL / C# / TypeScript); on theory questions you can opt in with *"＋ Add a code snippet"*. Your code is folded into the graded answer.
- **Self-rating drives difficulty** — your rating maps to a question tier per stack (`0–1` → `4+`).
- **Meme verdict + XP** — a pass/fail meme (rendered purely from a URL, zero extra API calls) plus XP, and **every round saves to your dashboard** (one record per stack).
- **Token-lean** — questions are generated **once per stack** and the whole round is **graded in one batched call per stack**; skipped answers are scored locally and never sent. If generation is unavailable it **falls back to the static bank**, so it always works.

### 🧠 Ask My Notes — chat with your own notes (RAG)
Paste your own study notes — or your résumé — and ask questions in plain English. An LLM answers **only from what you saved**, never invented facts, and **shows the exact notes it used** as cited sources. Built as a real **Retrieval-Augmented Generation** pipeline on Cloudflare's edge:

```
question → embed (Workers AI · bge-base-en-v1.5) → Vectorize.query (cosine, per-user namespace)
        → inject closest notes into the prompt → LLaMA 3.3 70B "answer using ONLY these" → answer + sources
```

- **Semantic retrieval** — notes are embedded into vectors and stored in **Cloudflare Vectorize**; questions match by *meaning*, not keywords.
- **Grounded** — a relevance threshold returns *"not in your notes"* instead of hallucinating when nothing matches.
- **Per-user isolation** — each user's notes live in their own Vectorize **namespace** (keyed on `userId`).

### 🎯 Daily Challenge
One question **per calendar day, the same for everyone** (picked deterministically from the pooled question bank by the date). For logged-in users it **bounces in** once a day; answer it once, get **AI-graded feedback**, earn **XP + a daily bonus**, and keep your **streak** alive. A "come back tomorrow" state locks it to one attempt per day, and the completion syncs across devices via game state.

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

### 📣 Share Scorecard
After any Test Me round, share your result — every share links back to CodeRefresher, turning a good score into free reach.
- **Rich link previews** — paste the link into Twitter/X, LinkedIn or WhatsApp and a server-rendered, **OG-tagged** scorecard page generates the preview (crawlers read the meta from the first HTML response — no client JS needed).
- **Downloadable card** — a 1200×630 PNG built **entirely client-side with zero dependencies** (a self-contained SVG rasterised through canvas, not html2canvas) for Instagram stories or manual shares. The same card is uploaded as the `og:image` so feed previews show the visual scorecard.
- **🤺 Challenge a friend** — the share page's *"Take the Same Challenge"* button drops them into the **exact arena + level**, and after their round shows a **head-to-head** ("Manav 8.2 · You 6.8") with a one-tap **rematch**.
- Share entries **auto-expire after 90 days**, and sharing works even before sign-up.

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
| Backend | **Cloudflare Worker** + **Workers KV** (progress, game state, users, shared scorecards) |
| AI grading & generation | **Groq · LLaMA 3.3 70B** via the Worker (grading, hints, follow-ups, Ask My Notes) |
| RAG / vector search | **Cloudflare Vectorize** (vector DB) + **Workers AI** embeddings (`bge-base-en-v1.5`) |
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
                ├─ /api/interview-questions   → generate fresh interview questions (per stack)
                ├─ /api/interview-grade       → grade a whole interview round in one call
                ├─ /api/rag-ingest|query|ask  → Ask My Notes (embed → Vectorize → LLaMA)
                ├─ /api/user/register|recover|delete
                ├─ /api/progress/sync|dashboard   → per-module stats + history
                ├─ /api/game/sync|load            → XP / mastery / streak (batched writes)
                ├─ /api/leaderboard               → cached top-20 boards (O(1) read)
                ├─ /api/share/create|image        → write a public scorecard + og:image
                ├─ /share/{id}[/image.png]        → public OG-tagged scorecard page + PNG
                ├─ /api/admin/users               → email export (Bearer secret)
                └─ /api/email/unsubscribe
                        │
                        └─ Workers KV  (user:{id} = profile + progress + game · leaderboard = cached boards
                                        · share:{id} = public scorecard, 90-day TTL · email:{addr} = dedup index)

GitHub Actions (weekly cron) → scripts/send-weekly-digest.mjs → SMTP → users
```

**Offline-first:** writes hit localStorage instantly, then sync to KV (game writes are **debounced** to respect KV's free-tier write budget). On load, KV is merged back so any device stays in sync.

---

## 📁 Project Structure

```
src/app/
  core/services/        data · seo · user · progress · game · theme · focus · leaderboard
                         · share · scorecard-image
  shared/components/     layout (header HUD + footer) · card (challenge card)
                         · tech-page (arena) · onboarding-modal · game-events
                         (level-up crate + toasts)
  pages/                 home · angular · dotnet · sql · react · nextjs · nestjs
                         · test-me · interview · dashboard · leaderboard · ask-notes
public/data/             angular.json · dotnet.json · sql.json · react.json
                         · nextjs.json · nestjs.json   (Q&A content)
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
3. For **Ask My Notes**, bind **Workers AI** as `AI`, create a Vectorize index and bind it as `VECTORIZE`:
   ```bash
   npx wrangler vectorize create coderefresher-notes --dimensions=768 --metric=cosine
   ```
4. For weekly emails, add the GitHub Actions secrets listed in `worker/EMAIL-SETUP.md`.

Full details: [`worker/KV-SETUP.md`](worker/KV-SETUP.md) · [`worker/EMAIL-SETUP.md`](worker/EMAIL-SETUP.md)

---

## 🗺️ Roadmap

- [x] AI-graded Test Me
- [x] Smart dashboard + cross-device sync
- [x] Adaptive focus rounds
- [x] Arena gamification (XP / streak / achievements / level-up)
- [x] Leaderboard (XP / tests / best score)
- [x] Share scorecard (rich link previews · downloadable card · head-to-head challenge)
- [x] Weekly email digest
- [x] Light / dark theme
- [x] AI follow-up probing in Test Me
- [x] Daily Challenge
- [x] Ask My Notes — RAG over your own notes (Vectorize + LLaMA 3.3)
- [x] More arenas — React, Next.js & NestJS (100 Q&A each)
- [x] AI-generated questions — multi-stack **Mock Interview** with a code editor & meme verdict
- [ ] Further arenas (Python, AWS, Docker) & deeper question banks
- [ ] Spaced repetition for mastered questions

---

Built by [Manav Nanda](https://manav-personal-portfolio.pages.dev/) · Made for developers, by developers.
