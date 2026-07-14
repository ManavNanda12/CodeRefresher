# CodeRefresher 🏟️

**Get interviewed on your own résumé.** Upload it and the AI reads it, extracts your claims — that *"32% faster"*, that *"led the migration"* — and grills you on the specifics, then grades whether your answers actually **back up what you wrote**.

Around the flagship sits a full prep arena built with **Angular 22**: structured Q&A for Angular, .NET, SQL, React, Next.js & NestJS, AI-graded tests, a mock interviewer, a live readiness dashboard, and XP/streak gamification.

> Interview → Practice → Track → Improve. Free forever, no sign-up to browse.

---

## ✨ Features

### 📄 Résumé Interview — the flagship
Drop a PDF (parsed **in your browser** via pdf.js — the file never leaves it) or paste the text. Then:

1. **Claim extraction** — an animated laser-scan while the AI pulls out your verifiable claims, typed as `quantified` / `tech` / `project` / `responsibility`. Vague fluff is flagged, not asked about. You review the claims and untick any you'd rather not defend.
2. **Skills round** — the résumé's declared skills become **self-rating sliders** (add your own too). A high rating earns a *harder* question.
3. **Chat interview** — a real chat room: typing indicator, claim chips ("📄 About your résumé: …"), skill checks ("🛠️ you rated it 8/10"), CodeMirror for code/query answers, skeptical interviewer reactions between questions. **Answer by voice** (Web Speech API — free, in-browser, live transcript): pace and filler words are measured locally and the grader adds a one-line **delivery verdict**, because speaking an answer is a different skill from typing one.
4. **The verdict** — every claim stamped **Backed / Shaky / Busted**, a **"You said vs you showed"** board comparing self-ratings against actual scores (HONEST ✅ → DELULU 🥲), a roast, a meme, XP, and a dashboard record.

Token-lean by design: extraction is **cached in KV** (hashed, 24h TTL — résumés are PII and are never logged), questions are one call, grading is one batched call, and the between-question reactions are local theater — zero extra LLM cost.

### 🧳 Résumé × JD Match — pass the screen before a recruiter runs it
Paste a **job description** next to your résumé (same in-browser PDF parsing) and one call returns the recruiter's read:

- **Match score (0–100)** on an animated ring + a stamped verdict (**Strong / Good / Partial / Long shot**) and a 2–3 sentence honest summary — would this résumé pass the screen, and what decides it.
- **Every JD requirement bucketed**: ✅ **proven** (with the résumé line quoted as evidence), 😬 **close** (adjacent/transferable, with what you have instead), ❌ **missing** (split **must-have vs nice-to-have** — because only one of those blocks a screen — each with a tip to close or reframe the gap).
- **🃏 Extras** the JD never asked for (your differentiators) and a **✂️ tailoring checklist** of concrete edits for *this* application — "mirror the JD's exact term", "quantify that bullet" — never generic advice.
- **😂 Meme verdict** that names the exact skill that carried you (or blocked you), then a one-tap **"same résumé, another JD"** replay and a handoff into the Résumé Interview to defend it live.

Scoring is must-have-weighted, results are **KV-cached on a hash of both texts** (24h TTL, retries are free), and both documents are fenced as untrusted data against prompt injection.

### 📚 Structured Q&A ("Arenas")
Curated interview questions for **Angular**, **.NET / ASP.NET Core**, **SQL**, **React**, **Next.js**, and **NestJS** (100+ Q&A each), split by experience tier (0–1 / 1–2 / 2–3 / 4+ years). Every question ships with a detailed answer, a syntax-highlighted **code example**, and a plain-English **analogy** so concepts actually stick. Each card is a **challenge card** — difficulty tier, XP value, and a **"Master ✓"** toggle.

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

### 🗣️ Speak Mode — the Communication Coach
You know the answer — can you **say** it? Pick from ~50 speaking prompts (💡 *explain a concept to a non-techie*, ⭐ *behavioral STAR stories*, 💬 *workplace talk* like stand-ups and pushing back on scope), answer **out loud**, and get coached:

- **Voice-first, privacy-first** — your browser transcribes the answer live (Web Speech API); **audio never reaches the server**, only the transcript text. A 🔊 button reads the question aloud (browser TTS) for listening practice, and a 3-2-1 countdown gives you a breath before the mic opens.
- **Delivery stats, computed locally & free** — words-per-minute pace bands (🐢 → ✅ ideal 110–160 → 🌀 racing), filler-word density ("um", "you know", "basically"…), and duration vs the prompt's target time. Editing the transcript fixes mis-heard words for the grader, but **doesn't launder your fillers or pace** — honest by design.
- **One LLM coaching call** returns 1–10 scores for **clarity / structure / grammar**, up to 5 **grammar fixes as before → after cards** (tense, articles, agreement — the slips non-native speakers actually make, never ASR punctuation artifacts), structure feedback per prompt type (STAR for behavioral, definition → analogy for concepts), **2–3 "stronger way to say it" rewrites** in natural spoken English, and one genuine confidence boost.
- **Typed fallback everywhere** — no Web Speech (Firefox), blocked mic, or heavy accent? Type the answer instead; the coach reviews it as spoken English. Meme verdict, XP, streaks, achievements (🎙️ *Find Your Voice*, 🗣️ *Smooth Talker*) and dashboard records included.

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

### 📬 Email outreach
All email runs on **GitHub Actions + SMTP** (transport-swappable to Resend) with themed dark-arena HTML templates — the Worker never talks to a mail server:
- **Welcome email** — a `repository_dispatch` fired on sign-up triggers an Action that sends the arena tour.
- **Weekly digest** — an opt-out Monday cron emails each user their progress recap, weakest module, and a streak nudge.
- **Monthly newsletter** — a 1st-of-month cron sends `scripts/newsletters/{YYYY-MM}.json` if an issue exists for the month.

### 📮 Contact Us
A validated, rate-limited contact form that reuses the same serverless email pipeline:
1. The Worker validates the submission (field lengths, 2000-char message cap), stores it in **KV** (90-day TTL + a last-100 admin index) and fires a **`repository_dispatch`** carrying only the `contactId` — never the message itself.
2. The GitHub Action fetches the record from the Bearer-secured admin endpoint and sends **two themed emails**: a *"thanks for reaching out"* confirmation to the sender (their message echoed back, 24–48h reply promise) and an **admin notification** with the full message and `Reply-To` set to the sender — replying in Gmail goes straight to them.

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
| AI grading & generation | **Groq · LLaMA 3.3 70B** via the Worker (claim extraction, grading, hints, follow-ups, Ask My Notes) |
| Résumé parsing | **pdf.js** — client-side text extraction; the PDF never leaves the browser |
| RAG / vector search | **Cloudflare Vectorize** (vector DB) + **Workers AI** embeddings (`bge-base-en-v1.5`) |
| Email | **GitHub Actions** (crons + `repository_dispatch`) + `nodemailer` (SMTP), transport-swappable to Resend |
| Persistence | Cookie (identity) + localStorage (fast cache) + KV (source of truth) |

---

## 🗂️ Architecture

```
Browser (Angular SSR)
  ├─ cookie: opaque userId + email (identity)
  ├─ localStorage: progress + game state (instant, offline-first cache)
  └─ HTTPS → Cloudflare Worker
                ├─ /api/evaluate              → AI grades a Test Me answer
                ├─ /api/resume-extract        → résumé text → typed claims + skills (KV-cached, 24h TTL)
                ├─ /api/resume-interview-questions → claims + self-rated skills → targeted questions
                ├─ /api/resume-jd-match       → résumé + JD → match score, buckets, tailoring plan (KV-cached)
                ├─ /api/interview-questions   → generate fresh interview questions (per stack)
                ├─ /api/interview-grade       → grade a whole round in one call (+ claim substantiation)
                ├─ /api/speak-grade           → coach a spoken answer: grammar fixes, structure, rewrites
                ├─ /api/rag-ingest|query|ask  → Ask My Notes (embed → Vectorize → LLaMA)
                ├─ /api/user/register|recover|delete
                ├─ /api/progress/sync|dashboard   → per-module stats + history
                ├─ /api/game/sync|load            → XP / mastery / streak (batched writes)
                ├─ /api/leaderboard               → cached top-20 boards (O(1) read)
                ├─ /api/share/create|image        → write a public scorecard + og:image
                ├─ /share/{id}[/image.png]        → public OG-tagged scorecard page + PNG
                ├─ /api/contact                   → contact form → KV + repository_dispatch
                ├─ /api/admin/users               → email export (Bearer secret)
                ├─ /api/admin/contact             → contact export (Bearer secret)
                └─ /api/email/unsubscribe
                        │
                        └─ Workers KV  (user:{id} = profile + progress + game · leaderboard = cached boards
                                        · share:{id} = public scorecard, 90-day TTL · email:{addr} = dedup index
                                        · contact:{id} = submission, 90-day TTL)

GitHub Actions
  ├─ weekly cron              → scripts/send-weekly-digest.mjs      → SMTP → users
  ├─ monthly cron             → scripts/send-monthly-newsletter.mjs → SMTP → users
  ├─ repository_dispatch (sign-up)      → scripts/send-welcome-email.mjs → SMTP → new user
  └─ repository_dispatch (contact form) → scripts/send-contact-email.mjs → SMTP → sender (thanks) + admin (notification)
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
                         · test-me · interview · resume-interview · resume-jd-match
                         · speak · dashboard · leaderboard · ask-notes · contact
public/data/             angular.json · dotnet.json · sql.json · react.json
                         · nextjs.json · nestjs.json   (Q&A content)
                         · speak.json   (speaking prompts)
worker/                  Worker endpoint reference files + KV/EMAIL setup docs
scripts/                 send-weekly-digest.mjs · send-welcome-email.mjs
                         · send-monthly-newsletter.mjs · send-contact-email.mjs
                         · templates/ (themed HTML emails) · newsletters/ (monthly issues)
.github/workflows/       weekly-digest.yml · welcome-email.yml
                         · monthly-newsletter.yml · contact-email.yml
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
- [x] More arenas — React, Next.js & NestJS (100+ Q&A each)
- [x] AI-generated questions — multi-stack **Mock Interview** with a code editor & meme verdict
- [x] **Résumé Interview** — claim extraction, chat interview, substantiation grading (Backed/Shaky/Busted)
  - [x] Skills round — self-rated skills → calibrated questions + "you said vs you showed" verdict
  - [x] Voice answers (Web Speech) with delivery feedback
  - [x] **Résumé × JD Match** — match score, proven/close/missing buckets, tailoring plan, meme verdict
- [x] **Speak Mode** — communication coach: speak your answer, get grammar fixes, delivery stats & rewrites
- [x] **Contact Us** — validated form → Worker KV → `repository_dispatch` → themed thanks + admin-notification emails
- [ ] Further arenas (Python, AWS, Docker) & deeper question banks
- [ ] Spaced repetition for mastered questions

---

Built by [Manav Nanda](https://manav-personal-portfolio.pages.dev/) · Made for developers, by developers.
