# Plan — AI Follow-up Probing in Test Me

> **Goal:** On **up to 2 random questions** out of the 5 in a Test Me round, after the user
> answers and clicks **Next**, the AI **reads what they actually wrote** and — *only if the
> answer is substantive and on-topic* — fires **one short probing follow-up** ("ok, but *why*?
> when would that break?") inline on the *same* question. The user answers (or skips) it,
> then clicks Next again to advance. The follow-up makes Test Me feel like a real interview
> where the examiner digs deeper — not a one-shot quiz.
>
> **Critical:** the probe must be grounded in the user's answer. If they typed `hello world`,
> `idk`, a blank, or something off-topic, the AI returns **no follow-up** and we just advance —
> we never ask "why does that work?" about a non-answer. The AI is the judge of this, not a
> character count.

This is the first of two features. The next module after this is the **Daily Challenge**.

---

## 1. Behaviour & trigger rules (exact)

A question is **follow-up eligible** if it is one of the 2 randomly chosen indices for the round.

When the user clicks **Next** (or **Submit** on the last question) on an eligible question:

There are **two gates**: a cheap client-side gate (is there enough to even send?) and the
**AI relevance gate** (is the answer good enough to deserve a probe?).

| Condition | What happens |
|---|---|
| Eligible, follow-up not yet resolved, **and** answer passes the client min-length gate | **Send to AI.** AI decides: a real probe → reveal it inline (don't advance); not worth probing → mark resolved + **advance** |
| Follow-up already resolved for this question (shown *or* AI declined) | Advance normally (their follow-up answer, if any, is kept) |
| **Not** eligible | Advance normally |
| Eligible but **empty/skipped**, or below the client min-length gate (e.g. `hi`, `idk`) | Advance normally — **never even ask the AI** |

Key precision points (matching the request):
- The probe is triggered **only on the Next/Submit click**, never on typing or on skip.
- **Client min-length gate** = a fast pre-filter so we don't burn an API call on `"hi"`: require the *combined* prose+code to be at least ~25 non-whitespace chars (tune later). This is "is there anything to send", **not** "is it correct".
- **AI relevance gate** = the real judge. The worker reads the question + the user's answer and returns a probe **only if** the answer is a genuine, on-topic attempt worth digging into. Garbage / off-topic / placeholder (`hello world`) / "I don't know" → the worker returns **no follow-up** and the round just advances. (Contract + prompt in §5.)
- Answering the follow-up is **optional** — same philosophy as skipping a main question. If they leave it blank and click Next, we just advance.
- "Has content" reuses the existing rule: prose **or** code, both `.trim()`-ed (mirror `currentAnswered` / `answeredCount` in [test-me.ts](../src/app/pages/test-me/test-me.ts#L174-L209)).
- The eligible indices are **fixed at quiz build time** (up to 2, random), so navigation via Prev / dots and coming back does not re-roll or re-trigger. Because the AI may *decline* to probe, a round can end up with 0–2 actual follow-ups — by design.

---

## 2. The follow-up's effect on scoring

Zero changes to the `/api/evaluate` contract. We **fold the follow-up exchange into the
answer text** for that question, exactly like code is already folded in by
[`answersWithCode()`](../src/app/pages/test-me/test-me.ts#L583-L592). When grading, the
evaluator then naturally rewards (or penalises) the deeper reasoning.

For an eligible question with a follow-up answer, the text sent to the evaluator becomes:

```
<original prose answer>

```<lang>
<code if any>
```

[Interviewer follow-up] <the AI's follow-up question>
[My answer] <the user's follow-up answer>
```

If the follow-up was shown but left unanswered, we still append the question with an empty
answer marker (so the AI knows it was asked and dodged) — or simply omit it. **Decision:
omit when unanswered** to avoid penalising a skipped probe harder than a skipped question.

---

## 3. Frontend changes — `src/app/pages/test-me/test-me.ts`

### New signals / state
```ts
// Which question indices are eligible for a probe this round (up to 2, fixed at build).
followupIndices = signal<Set<number>>(new Set());
// index → AI follow-up question text — present ONLY when the AI chose to probe.
followups = signal<Record<number, string>>({});
// index → user's answer to the follow-up.
followupAnswers = signal<Record<number, string>>({});
// index set: we've already asked the AI for this index (it probed OR declined).
// Distinct from `followups`: a declined index is resolved but has no probe text.
followupResolved = signal<Set<number>>(new Set());
followupLoading = signal(false);

/** Client pre-filter: don't even call the AI on a near-empty answer like "hi". */
private readonly MIN_PROBE_CHARS = 25;
```

### Derived
```ts
readonly currentIsEligible = computed(() => this.followupIndices().has(this.currentIndex()));
readonly currentFollowup   = computed(() => this.followups()[this.currentIndex()] ?? null);
readonly currentFollowupAnswer = computed(() => this.followupAnswers()[this.currentIndex()] ?? '');

/** Combined prose + code for the current question (what we'd send the AI to judge). */
private readonly currentProbeSource = computed(() =>
  `${this.currentAnswer().trim()} ${this.currentCode().trim()}`.trim()
);

/**
 * True when clicking Next should ASK THE AI instead of advancing. Note: passing this gate
 * only means "worth asking" — the AI still decides whether to actually probe (§5). Once it
 * answers (probe or decline) the index is `resolved`, so this flips false and Next advances.
 */
readonly pendingFollowup = computed(() =>
  this.currentIsEligible() &&
  !this.followupResolved().has(this.currentIndex()) &&
  this.currentProbeSource().replace(/\s+/g, '').length >= this.MIN_PROBE_CHARS
);
```

### Pick the 2 indices — helper called from every quiz builder
```ts
private pickFollowupIndices(count: number): void {
  const n = this.total();
  const want = Math.min(2, n);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {       // Fisher–Yates
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  this.followupIndices.set(new Set(idx.slice(0, want)));
}
private resetFollowups(): void {
  this.followups.set({});
  this.followupAnswers.set({});
  this.followupResolved.set(new Set());
  this.followupLoading.set(false);
}
```
Call `this.resetFollowups()` then `this.pickFollowupIndices()` in **all three** quiz starts:
`pickLevel()`, `launchFocusFromData()`, and `retrySameLevel()` (alongside the existing
`resetHints()` / `resetShare()` calls — see [test-me.ts:307-322](../src/app/pages/test-me/test-me.ts#L307-L322),
[L359-L379](../src/app/pages/test-me/test-me.ts#L359-L379), [L780-L804](../src/app/pages/test-me/test-me.ts#L780-L804)).
Also clear them in `restart()`.

### Intercept the navigation
```ts
next(): void {
  this.hintConfirm.set(false);
  if (this.pendingFollowup()) { this.askFollowup(this.currentIndex()); return; }
  if (!this.isLast()) this.currentIndex.update(i => i + 1);
}

/**
 * Ask the AI whether this answer is worth a probe. Two outcomes:
 *  • probe text  → reveal it inline and STAY (user answers, clicks Next again to advance)
 *  • declined    → mark resolved and ADVANCE immediately (the answer wasn't substantive)
 * Either way the index is `resolved`, so we never re-ask it.
 */
private askFollowup(index: number): void {
  const q = this.questions()[index];
  if (!q || this.followupLoading()) return;
  this.followupLoading.set(true);
  const userAnswer = this.currentProbeSource();           // prose + code, so the AI judges the full answer
  this.testMe.getFollowup(q.question, userAnswer, q.answer ?? '').subscribe(probe => {
    this.followupResolved.update(s => { const n = new Set(s); n.add(index); return n; });
    this.followupLoading.set(false);
    if (probe) {
      this.followups.update(f => ({ ...f, [index]: probe }));   // probe → reveal, stay put
    } else {
      this.advanceAfterFollowup(index);                          // declined → just move on
    }
  });
}

/** Advance (or submit, if last) after the AI declined — guarding against mid-flight nav. */
private advanceAfterFollowup(index: number): void {
  if (this.currentIndex() !== index) return;   // user navigated away while the request was in flight
  if (this.isLast()) this.submitQuiz();
  else this.currentIndex.update(i => i + 1);
}

updateFollowupAnswer(value: string): void {
  this.followupAnswers.update(a => ({ ...a, [this.currentIndex()]: value }));
}
```
> **Last-question note:** `submitQuiz()` is wired to the Submit button. Add the same guard at
> the top: `if (this.pendingFollowup()) { this.askFollowup(this.currentIndex()); return; }`
> so the last eligible question gets its probe-check before the round can be submitted. If the
> AI declines, `advanceAfterFollowup()` calls `submitQuiz()` again — now `pendingFollowup()` is
> false (index resolved), so it proceeds. The wide "All answered — Submit now" shortcut and dot
> navigation are **not** gated (keeps them simple); follow-ups are a Next-click nicety, not a hard gate.

### Fold into evaluation — extend `answersWithCode()`
```ts
private answersWithCode(): string[] {
  const lang = this.editorLanguage();
  return this.questions().map((_q, i) => {
    const answer = (this.answers()[i] ?? '').trim();
    const code = (this.codes()[i] ?? '').trim();
    const fq = this.followups()[i];
    const fa = (this.followupAnswers()[i] ?? '').trim();
    let out = answer;
    if (code) {
      const block = '```' + lang + '\n' + code + '\n```';
      out = out ? `${out}\n\n${block}` : block;
    }
    if (fq && fa) out = `${out}\n\n[Interviewer follow-up] ${fq}\n[My answer] ${fa}`;
    return out;
  });
}
```

### Results screen (optional but nice)
Show the probe + the user's reply inside the expanded breakdown card so they remember it.
Add a `💬 Follow-up` block in [test-me.html](../src/app/pages/test-me/test-me.html#L433-L470)
next to "Your answer", guarded by `@if (followups()[i]; as fq)`. Tag the breakdown header
with a small `💬 probed` badge for eligible questions (mirror the existing `💡 hint used` badge
at [test-me.html:424](../src/app/pages/test-me/test-me.html#L424)).

---

## 4. Template changes — `src/app/pages/test-me/test-me.html`

Inside the question card, **between** the answer textarea/code zone and `.q-foot`
([around L208-210](../src/app/pages/test-me/test-me.html#L208-L210)):

```html
@if (followupLoading()) {
  <div class="followup loading">
    <span class="fu-spark">💬</span> The interviewer is reading your answer…
  </div>
} @else if (currentFollowup(); as fq) {
  <div class="followup">
    <div class="fu-head"><span class="fu-ico">🎙️</span> Follow-up</div>
    <p class="fu-q">{{ fq }}</p>
    <textarea class="q-input fu-input" rows="3"
              [value]="currentFollowupAnswer()"
              (input)="updateFollowupAnswer($any($event.target).value)"
              placeholder="Answer the follow-up — or click Next to skip it."></textarea>
  </div>
}
```

The Next button label hints the AI is about to *check* the answer (not that a probe is
guaranteed — the AI may decline and the click simply advances)
([L217-220](../src/app/pages/test-me/test-me.html#L217-L220)):
```html
<button class="btn-accent" type="button" (click)="next()" [disabled]="followupLoading()">
  @if (followupLoading()) { ⏳ Checking… }
  @else if (pendingFollowup()) { Next → }
  @else { {{ currentAnswered() ? 'Next →' : 'Skip →' }} }
</button>
```
> Keep the label as a plain "Next →" even when `pendingFollowup()` is true — promising a
> follow-up that the AI then declines would feel broken. The brief `⏳ Checking…` state covers
> the request, after which the probe appears inline *or* the round advances.
Add matching styles (`.followup`, `.fu-*`) in `test-me.css` reusing the existing
`--accent` token and the hint-reveal look at `.hint-reveal`.

---

## 5. Backend — new `worker/followup.js` (clone of `hint.js`)

`POST /api/followup  { question, userAnswer, correctAnswer } → { followup: string | null }`

**This is where the "is the answer worth probing?" decision lives.** The prompt makes the
model *first judge* the answer, then either emit a probe or a sentinel meaning "no probe".
We use the sentinel token `NO_FOLLOWUP` and map it to `followup: null`.

```js
const SYSTEM_PROMPT = `You are a senior technical interviewer in a live interview.
You are given an interview question and the candidate's answer.

FIRST decide whether the answer is a genuine, on-topic attempt that demonstrates some real
understanding worth digging into. Treat as NOT worth probing: blanks, "I don't know"/"idk",
placeholders or nonsense ("hello world", "asdf", random text), answers that are off-topic or
unrelated to the question, or answers so vague they show no actual claim to probe.

- If it is NOT worth probing, output EXACTLY: NO_FOLLOWUP
- If it IS worth probing, output ONE short follow-up question (max ~25 words) that digs deeper
  into THEIR specific answer — a "why", a trade-off, an edge case, or "when would this break?".
  Ground it in what they actually wrote. Do NOT reveal the model answer or give hints.

Output only the follow-up question OR the token NO_FOLLOWUP — no quotes, no prefix, no extra text.`;

const SENTINEL = "NO_FOLLOWUP";

export async function handleFollowup(request, env) {
  try {
    const { question, userAnswer, correctAnswer } = await request.json();
    if (!question) return Response.json({ error: "Missing question" }, { status: 400 });

    // No answer reached us → nothing to probe. (Client already gates this, but be safe.)
    if (!userAnswer || !userAnswer.trim()) return Response.json({ followup: null });

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROK_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Question: ${question}\nCandidate answer: ${userAnswer}\nExpert answer (for your context only): ${correctAnswer || ""}\n\nFollow-up:` },
        ],
        temperature: 0.5,
        max_tokens: 60,
      }),
    });

    // On model/network failure we DECLINE rather than ask a generic probe — we can't verify
    // relevance, and a blind "why does that work?" is exactly what we want to avoid.
    if (!res.ok) return Response.json({ followup: null });

    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");
    // Treat the sentinel (or an empty / sentinel-containing reply) as "no probe".
    const declined = !raw || raw.toUpperCase().includes(SENTINEL);
    return Response.json({ followup: declined ? null : raw });
  } catch {
    return Response.json({ followup: null });
  }
}
```

> **Why decline-on-failure (not a generic fallback like `hint.js` uses):** the hint lifeline
> can always fall back to a generic nudge because the user explicitly asked for help. A
> follow-up is unsolicited — if we can't confirm the answer deserves one, staying silent and
> advancing is the correct, non-annoying behaviour.

### Wire it in `worker/worker.js`
- Import: `import { handleFollowup } from "./followup.js";` (next to the hint import,
  [L18](../worker/worker.js#L18)).
- Route (next to `/api/hint`, [L94-97](../worker/worker.js#L94-L97)):
  ```js
  if (p === "/api/followup" && method === "POST") {
    if (await rateLimited(request, env, "followup", 120)) return withCors(request, tooMany());
    return withCors(request, await handleFollowup(request, env));
  }
  ```
- No CORS change needed — origin gate + `GET, POST, OPTIONS` already cover it
  ([L46](../worker/worker.js#L46)). Reuses the existing `GROK_API_KEY`.

---

## 6. Service — `src/app/services/test-me-service/test-me-service.ts`

Add next to `getHint()` ([L64-71](../src/app/services/test-me-service/test-me-service.ts#L64-L71)).
Note the return is **`string | null`** — `null` means "the AI declined to probe", and the
component treats that as "advance". On any error we also return `null` (decline), mirroring the
worker's decline-on-failure stance — never invent a generic probe.
```ts
getFollowup(question: string, userAnswer: string, correctAnswer: string): Observable<string | null> {
  return this.http
    .post<{ followup: string | null }>(`${this.base}/api/followup`, { question, userAnswer, correctAnswer })
    .pipe(
      map(r => (r?.followup && r.followup.trim()) ? r.followup.trim() : null),
      catchError(() => of(null)),
    );
}
```

---

## 7. Edge cases & decisions

- **Fewer than 2 questions** (tiny focus pool): pick `min(2, total)` — handled by `pickFollowupIndices`.
- **AI declines (`hello world`, off-topic, too vague):** worker returns `followup: null` → index
  marked `resolved`, round advances with no probe shown. **This is the headline behaviour.** A
  round therefore yields **0–2** probes, not always 2 — eligibility is fixed, but the AI gates it.
- **Near-empty answer (`hi`, `idk`):** blocked by the **client min-length gate** before any API
  call — `pendingFollowup` is false, Next just advances.
- **Network / model failure on the probe:** service + worker both return `null` (decline) — we
  **never** invent a generic "why does that work?". Round advances; never blocks.
- **Re-navigation:** `followupResolved` makes the outcome sticky — revisiting an eligible question
  shows the same probe (if one was given) and keeps the typed reply; if the AI declined, Next just
  advances. No re-fetch either way.
- **Leave-guard / anti-cheat:** unchanged — follow-up lives entirely within the `quiz` stage.
- **Skipped main answer on an eligible question:** `pendingFollowup` is false → no probe. ✅
- **Hint + follow-up on the same question:** independent; both can occur.
- **Last question:** guarded in `submitQuiz()`; on decline, `advanceAfterFollowup()` re-calls
  `submitQuiz()` (now ungated). The wide/global submit + dots stay ungated by design.

---

## 8. Testing checklist

- [ ] Eligible question, **substantive** prose → Next shows probe; second Next advances.
- [ ] Eligible question, **substantive** code only (no prose) → still probes.
- [ ] **Eligible question, `hello world` / `asdf` / off-topic → AI declines → Next advances, NO probe.** ← the fix
- [ ] Eligible question, `hi` / `idk` → blocked by client min-length gate, no API call.
- [ ] Eligible question, empty → Next advances, **no probe**.
- [ ] Non-eligible question → never probes.
- [ ] Probe answer folds into evaluation (verify request payload contains `[My answer]`).
- [ ] Unanswered probe is omitted from the graded text.
- [ ] Prev/dots back to a resolved question keeps probe + typed reply (or stays declined), no re-fetch.
- [ ] Up to 2 probes per round (0–2 depending on AI decisions); works in Focus Rounds and Rematch.
- [ ] Worker `/api/followup` returns `{ followup: null }` for junk, a string for real answers; rate-limit verified.
- [ ] Manual worker check: junk answer → `null`; solid answer → a grounded question; `res.ok === false` path → `null`.
- [ ] Results breakdown shows the `💬 Follow-up` block only for questions that were actually probed.
- [ ] SSR build clean (`npm run build`); no `Date.now()`/DOM in non-browser paths.

---

## 9. Out of scope (future)

- Multi-turn probing (a follow-up to the follow-up).
- Separately *scoring* the follow-up as its own line item (current plan folds it in).
- Adaptive eligibility (probe the questions answered most confidently / fastest).

---

## 10. Touch list

| File | Change |
|---|---|
| `worker/followup.js` | **new** — probe endpoint (clone of `hint.js`) |
| `worker/worker.js` | import + route `/api/followup` with rate-limit |
| `src/app/services/test-me-service/test-me-service.ts` | `getFollowup()` |
| `src/app/pages/test-me/test-me.ts` | signals, pick/reset helpers, `next()`/`submitQuiz()` guard, `answersWithCode()` fold, results helpers |
| `src/app/pages/test-me/test-me.html` | inline follow-up block, Next-label hint, results follow-up block + badge |
| `src/app/pages/test-me/test-me.css` | `.followup` / `.fu-*` styles |
| `README.md` | mention AI follow-up probing under Test Me (flip roadmap item) |
