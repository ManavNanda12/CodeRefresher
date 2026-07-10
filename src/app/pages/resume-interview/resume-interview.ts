import { Component, ElementRef, HostListener, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanComponentDeactivate } from '../../core/guards/can-deactivate-guard';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../core/services/seo.service';
import { ArenaModeService } from '../../core/services/arena-mode.service';
import { GameService } from '../../core/services/game.service';
import { MemeService, MemeResult } from '../../core/services/meme.service';
import { ProgressService, RoundRecord } from '../../core/services/progress.service';
import { CodeEditorComponent, EditorLang } from '../../shared/components/code-editor/code-editor';
import { ArenaEntryComponent } from '../../shared/components/arena-entry/arena-entry';
import { QuestionKind } from '../../services/interview-service/interview.service';
import {
  RatedSkill,
  ResumeInterviewService,
  ResumeClaim,
  ResumeExtract,
  ResumeGradeInput,
  ResumeGradeItem,
  ResumeQuestion,
  VoiceStats,
} from '../../services/resume-interview/resume-interview.service';

/** Conservative filler-word set — avoids technical uses of "like". */
const FILLER_RE = /\b(u+m+|u+h+|hmm+|erm+|you know|i mean|kind of|sort of|basically|actually)\b/gi;

type Stage = 'intro' | 'scanning' | 'review' | 'interview' | 'deliberating' | 'results';

/** One bubble in the interview chat. */
interface ChatMsg {
  from: 'ai' | 'user';
  text: string;
  /** Résumé claim chip rendered above an AI question ("About your résumé: …"). */
  claim?: string;
  /** Skill-check chip ("Skill check: Angular — you rated it 8/10"). */
  skill?: string;
  skillRating?: number;
  kindLabel?: string;
  code?: string;
}

/** One row of the verdict's "you said vs you showed" board. */
interface SkillVerdict {
  name: string;
  said: number;
  showed: number;
  label: string;
  icon: string;
}

const QUESTION_COUNT = 5;        // claims-only rounds
const QUESTION_COUNT_SKILLS = 6; // rounds that include skill-checks
const MAX_SKILLS = 12;      // hard cap on the rated list (worker accepts 12)
const SEED_SKILLS = 8;      // auto-detected skills — leaves room for user adds
const HINT_COST_XP = 20;         // first hint per round is free; each extra costs this
const PASS_MARK = 6;
const MAX_FILE_MB = 10;
const MAX_CLAIMS_SENT = 8;

const KIND_LABEL: Record<QuestionKind, string> = {
  theory: '💭 Theory',
  query: '🗄️ Write a query',
  code: '⌨️ Write code',
  scenario: '🧩 Scenario',
};

const TYPE_META: Record<string, { label: string; icon: string }> = {
  quantified: { label: 'Quantified', icon: '📈' },
  tech: { label: 'Tech', icon: '🛠️' },
  project: { label: 'Project', icon: '🏗️' },
  responsibility: { label: 'Soft', icon: '💤' },
};

/** Rotating lines on the arena-entry gate while the questions are generated. */
const ENTRY_LINES = [
  'The interviewer is re-reading your résumé…',
  'Highlighting the boldest claims…',
  'Arranging the exhibits on the desk…',
  'Warming up the follow-up questions…',
  'No pressure. Okay — some pressure…',
];

/** Rotating status lines while the laser scans the résumé. */
const SCAN_STATUS = [
  'Reading your résumé…',
  'Hunting for bold claims…',
  'Cross-checking the buzzwords…',
  'Ooh, numbers. Numbers get questions…',
  'Sharpening the follow-ups…',
];

/** Canned skeptical acknowledgements between questions — zero LLM cost, full drama. */
const REACTIONS = [
  'Hmm. Noted. 🧐',
  'Interesting… we\'ll see.',
  'Bold answer. Moving on.',
  '*scribbles something in the notepad* 📝',
  'Okay. I have follow-up thoughts. Later.',
  'That\'s… one way to put it. Next.',
  'Filing that under "to be verified". 🗂️',
];

const DELIBERATION_LINES = [
  'Cross-checking your answers against your résumé…',
  'Comparing what you SAID with what you WROTE…',
  'The panel is arguing about you…',
  'Consulting the résumé one last time…',
];

/** Verdict roasts by score band — TMKOC × Bollywood × Hollywood × dev humor. */
const ROASTS: Record<string, string[]> = {
  legend: [
    'This was pure main character energy. HR is already typing the offer letter. ✨',
    'Straight out of a Netflix finale — everything connected, no plot holes. 🎬',
    '"Aaj khush toh bahut hoge tum." Every answer matched the résumé perfectly. 👑',
    'If this was an interview, you just unlocked the premium package. No free trial needed. 🚀',
  ],

  strong: [
    'Jethalal would say: "Wah bhai wah." Solid answers, only minor hiccups. 😎',
    'Bollywood hero entry level confidence, and mostly backed by skill too. 🔥',
    'You had interviewer attention from question one. Pretty strong showing. 🎯',
    'Not perfect, but definitely giving "shortlisted for round 2" vibes. 💼',
  ],

  pass: [
    'Good enough for release… but this one is not winning Filmfare yet. 🎭',
    'A few answers felt like a Netflix filler episode — decent, but could be tighter. 🍿',
    'CID verdict: "Case solved… but evidence thoda weak tha." 🕵️',
    'Resume looked premium, answers were somewhere in standard subscription tier. 📺',
  ],

  close: [
    'Babita ji impressed hoti… but Iyer would still have questions. 😬',
    'Almost there. Giving serious "picture abhi baaki hai" energy. 🎥',
    'You knew the concept… execution felt like buffering at 2%. 📶',
    'Strong résumé, but some answers felt like watching the trailer instead of the full movie. 🍿',
  ],

  fail: [
    'Resume said blockbuster. Answers felt like direct OTT release nobody watched. 🥲',
    'TMKOC verdict: "Yeh toh ulta ho gaya bhai." Claims didn’t survive questioning. 😵',
    'This had big confidence… but the facts left the chat halfway through. 💀',
    'Interviewer expected Hollywood production quality. Got low budget pilot episode. 🎬',
    'Time for a rewrite. Right now the résumé is overselling harder than a movie trailer. 📉',
  ]
};

@Component({
  selector: 'app-resume-interview',
  imports: [RouterLink, FormsModule, CodeEditorComponent, ArenaEntryComponent],
  templateUrl: './resume-interview.html',
  styleUrl: './resume-interview.css',
})
export class ResumeInterviewComponent implements OnDestroy, CanComponentDeactivate {
  private platformId = inject(PLATFORM_ID);
  private arena = inject(ArenaModeService);
  private svc = inject(ResumeInterviewService);
  private memeSvc = inject(MemeService);
  private progress = inject(ProgressService);
  readonly game = inject(GameService);

  readonly PASS_MARK = PASS_MARK;
  readonly TYPE_META = TYPE_META;

  private chatLog = viewChild<ElementRef<HTMLDivElement>>('chatLog');
  private timers: ReturnType<typeof setTimeout>[] = [];
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  // ── State machine ───────────────────────────────────────────
  stage = signal<Stage>('intro');

  // Intro / upload
  pasteMode = signal(false);
  pasteText = signal('');
  dragOver = signal(false);
  fileBusy = signal(false);
  introError = signal('');

  // Scanning
  scanLines = signal<string[]>([]);
  scanStatus = signal(SCAN_STATUS[0]);
  private resumeText = '';

  // Review
  candidate = signal<ResumeExtract | null>(null);
  deselected = signal<Set<string>>(new Set());

  // Skills round — declared by the résumé (or added by the user), self-rated 1-10.
  skills = signal<string[]>([]);
  skillRatings = signal<Record<string, number>>({});
  newSkill = signal('');

  // Interview
  questions = signal<ResumeQuestion[]>([]);
  messages = signal<ChatMsg[]>([]);
  typing = signal(false);
  qIndex = signal(0);
  answers = signal<string[]>([]);
  codes = signal<string[]>([]);
  draft = signal('');
  draftCode = signal('');
  editorOpen = signal(false);
  /** Composer unlocked only while a question is on the table. */
  awaitingAnswer = signal(false);
  chatError = signal(false);
  private startedAt = 0;
  private lastReaction = -1;

  // Arena-entry gate — covers the chat while the questions are generated.
  readonly ENTRY_LINES = ENTRY_LINES;
  entryVisible = signal(false);
  entryClosing = signal(false);
  private entryOpenedAt = 0;

  // Voice answers — Web Speech API (browser-native STT, zero server cost).
  speechSupported = signal(false);
  recording = signal(false);
  interim = signal('');
  voiceError = signal('');
  // Web Speech types aren't in lib.dom — vendor-prefixed in Chrome.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recog: any = null;
  private voiceSegmentStart = 0;
  /** Per-question spoken transcript + seconds — feeds delivery grading. */
  private voiceText: Record<number, string> = {};
  private voiceSeconds: Record<number, number> = {};

  // Deliberation + results
  deliberationLine = signal(DELIBERATION_LINES[0]);
  results = signal<ResumeGradeItem[]>([]);
  meme = signal<MemeResult | null>(null);
  memeFailed = signal(false);
  roast = signal('');
  xpEarned = signal(0);
  detailOpen = signal<Set<number>>(new Set());

  constructor() {
    this.speechSupported.set(!!this.speechCtor());
    // Arena mode while the trial is live: footer gone, page clamped to the
    // viewport, the chat log owns its own scrolling.
    effect(() => {
      const s = this.stage();
      if (s === 'interview' || s === 'deliberating') this.arena.enter();
      else this.arena.exit();
    });
    inject(SeoService).update({
      title: 'Résumé Interview — Can You Back Up Your Own CV?',
      description:
        'Upload your résumé and get grilled on it. The AI extracts your claims, attacks the specifics, and grades whether your answers actually substantiate what you wrote.',
      keywords: 'resume interview, cv interview practice, ai resume grilling, mock interview from resume',
    });
  }

  ngOnDestroy(): void {
    this.timers.forEach(t => clearTimeout(t));
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.stopVoice();
    this.arena.exit();
  }

  // ── Voice answers (Web Speech API — free, in-browser STT) ───
  private speechCtor(): (new () => unknown) | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const w = window as unknown as Record<string, unknown>;
    return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition']) as (new () => unknown) | null;
  }

  toggleVoice(): void {
    if (this.recording()) this.stopVoice();
    else this.startVoice();
  }

  private startVoice(): void {
    const Ctor = this.speechCtor();
    if (!Ctor || !this.awaitingAnswer()) return;
    this.voiceError.set('');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = new (Ctor as any)();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      let interim = '';
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const text = e.results[k][0]?.transcript ?? '';
        if (e.results[k].isFinal) this.acceptFinalSpeech(text);
        else interim += text;
      }
      this.interim.set(interim.trim());
    };
    r.onend = () => {
      // Chrome auto-stops after silence — restart while the mic is meant to be live.
      if (this.recording() && this.recog === r) {
        try { r.start(); } catch { this.stopVoice(); }
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        this.stopVoice();
        this.voiceError.set('Mic blocked — allow microphone access and try again. Typing still works!');
      }
      // 'no-speech' etc. → onend fires and we restart; nothing to do.
    };

    try {
      r.start();
    } catch {
      this.voiceError.set("Couldn't start the mic — typing still works!");
      return;
    }
    this.recog = r;
    this.recording.set(true);
    this.voiceSegmentStart = this.now();
  }

  stopVoice(): void {
    if (!this.recording() && !this.recog) return;
    this.recording.set(false);
    this.interim.set('');
    if (this.voiceSegmentStart) {
      const i = this.qIndex();
      this.voiceSeconds[i] = (this.voiceSeconds[i] ?? 0) + (this.now() - this.voiceSegmentStart) / 1000;
      this.voiceSegmentStart = 0;
    }
    try { this.recog?.stop(); } catch { /* already stopped */ }
    this.recog = null;
  }

  /** A finalized speech chunk: append to the draft + remember it was spoken. */
  private acceptFinalSpeech(text: string): void {
    const t = text.trim();
    if (!t) return;
    const i = this.qIndex();
    this.voiceText[i] = ((this.voiceText[i] ?? '') + ' ' + t).trim();
    this.draft.update(d => (d.trim() ? d.replace(/\s+$/, '') + ' ' : '') + t);
  }

  /** Delivery stats for a question — only when a real spoken transcript exists. */
  private voiceStatsFor(i: number): VoiceStats | undefined {
    const text = (this.voiceText[i] ?? '').trim();
    if (!text) return undefined;
    const words = text.split(/\s+/).length;
    if (words < 5) return undefined; // a mumble isn't a spoken answer
    const fillers = (text.match(FILLER_RE) ?? []).length;
    return { seconds: Math.round(this.voiceSeconds[i] ?? 0), words, fillers };
  }

  private later(fn: () => void, ms: number): void {
    if (!isPlatformBrowser(this.platformId)) { fn(); return; }
    this.timers.push(setTimeout(fn, ms));
  }

  // ── Intro: upload / paste ───────────────────────────────────
  onDragOver(e: DragEvent): void { e.preventDefault(); this.dragOver.set(true); }
  onDragLeave(): void { this.dragOver.set(false); }
  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) this.readFile(file);
  }

  onFilePicked(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.readFile(file);
    input.value = '';
  }

  private async readFile(file: File): Promise<void> {
    this.introError.set('');
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      this.introError.set(`That file is over ${MAX_FILE_MB}MB — résumés are usually a lot lighter. 😅`);
      return;
    }
    this.fileBusy.set(true);
    try {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      const text = isPdf ? await this.extractPdfText(file) : await file.text();
      this.fileBusy.set(false);
      this.startScan(text);
    } catch {
      this.fileBusy.set(false);
      this.introError.set("Couldn't read that file. Try a PDF or plain text — or just paste the résumé below.");
    }
  }

  /**
   * Client-side PDF → text via pdf.js. The raw PDF never leaves the browser —
   * only the extracted text is sent for claim analysis.
   */
  private async extractPdfText(file: File): Promise<string> {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const doc = await task.promise;
    let out = '';
    const pages = Math.min(doc.numPages, 6);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      out += tc.items.map(it => ('str' in it ? it.str : '')).join(' ') + '\n';
    }
    void task.destroy();
    return out;
  }

  usePaste(): void {
    this.introError.set('');
    const text = this.pasteText().trim();
    if (text.length < 150) {
      this.introError.set('That looks too short to be a résumé — paste the whole thing, claims included. 📄');
      return;
    }
    this.startScan(text);
  }

  // ── Scanning: laser sweep while /api/resume-extract runs ───
  private startScan(text: string): void {
    const cleaned = text.replace(/\r/g, '').trim();
    if (cleaned.length < 150) {
      this.introError.set("We couldn't find enough text in that file — try pasting the résumé instead.");
      return;
    }
    this.resumeText = cleaned;
    this.scanLines.set(
      cleaned.split(/\n+/).flatMap(l => l.match(/.{1,72}(\s|$)/g) ?? []).slice(0, 34),
    );
    this.stage.set('scanning');

    let i = 0;
    if (isPlatformBrowser(this.platformId)) {
      this.scanTimer = setInterval(() => {
        i = (i + 1) % SCAN_STATUS.length;
        this.scanStatus.set(SCAN_STATUS[i]);
      }, 1600);
    }

    this.svc.extract(cleaned).subscribe({
      next: extract => {
        this.stopScanTimer();
        this.candidate.set(extract);
        this.deselected.set(new Set());
        this.seedSkills(extract);
        this.stage.set('review');
      },
      error: (err: Error) => {
        this.stopScanTimer();
        this.stage.set('intro');
        this.introError.set(err.message || 'The interviewer dozed off mid-read. Try again?');
      },
    });
  }

  private stopScanTimer(): void {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    this.scanStatus.set(SCAN_STATUS[0]);
  }

  // ── Review: pick which claims go on trial ───────────────────
  readonly probeClaims = computed(() =>
    (this.candidate()?.claims ?? []).filter(c => c.probeWorthy));
  readonly fluffClaims = computed(() =>
    (this.candidate()?.claims ?? []).filter(c => !c.probeWorthy));
  readonly selectedClaims = computed(() =>
    this.probeClaims().filter(c => !this.deselected().has(c.id)).slice(0, MAX_CLAIMS_SENT));

  toggleClaim(id: string): void {
    this.deselected.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  isDeselected(id: string): boolean { return this.deselected().has(id); }

  // ── Skills: rate what the résumé declares (or add your own) ─
  /** Skills come from the extract's skills list + techs named in claims (deduped). */
  private seedSkills(extract: ResumeExtract): void {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const s of [...extract.skills, ...extract.claims.flatMap(c => c.tech)]) {
      const key = s.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push(s.trim());
      if (list.length >= SEED_SKILLS) break; // leave headroom for custom adds
    }
    this.skills.set(list);
    this.skillRatings.set(Object.fromEntries(list.map(s => [s, 5])));
  }

  skillRating(name: string): number { return this.skillRatings()[name] ?? 5; }
  setSkillRating(name: string, value: number): void {
    this.skillRatings.update(r => ({ ...r, [name]: value }));
  }

  skillLabel(r: number): string {
    if (r <= 2) return 'Rookie';
    if (r <= 4) return 'Junior';
    if (r <= 6) return 'Mid-level';
    if (r <= 8) return 'Senior';
    return 'Expert';
  }
  skillColor(r: number): string {
    if (r <= 2) return '#34d399';
    if (r <= 4) return '#60a5fa';
    if (r <= 6) return '#a78bfa';
    if (r <= 8) return '#fb923c';
    return '#f87171';
  }

  /** Feedback for the add-skill row — a silent no-op reads as a bug. */
  skillMsg = signal('');

  addSkill(): void {
    const name = this.newSkill().trim().slice(0, 40);
    if (!name) return;
    if (this.skills().some(s => s.toLowerCase() === name.toLowerCase())) {
      this.skillMsg.set(`“${name}” is already on the list.`);
      return;
    }
    if (this.skills().length >= MAX_SKILLS) {
      this.skillMsg.set(`That's the max (${MAX_SKILLS}) — remove one (✕) to add another.`);
      return;
    }
    this.skills.update(list => [...list, name]);
    this.skillRatings.update(r => ({ ...r, [name]: 5 }));
    this.skillMsg.set('');
    this.newSkill.set('');
  }

  removeSkill(name: string): void {
    this.skills.update(list => list.filter(s => s !== name));
    this.skillMsg.set('');
  }

  readonly ratedSkills = computed<RatedSkill[]>(() =>
    this.skills().map(name => ({ name, rating: this.skillRating(name) })));

  // ── Interview: the chat room ────────────────────────────────
  readonly firstName = computed(() =>
    (this.candidate()?.name || 'Candidate').split(/\s+/)[0]);
  readonly initial = computed(() => this.firstName().charAt(0).toUpperCase() || '?');
  readonly total = computed(() => this.questions().length);
  readonly answeredCount = computed(() =>
    Math.min(this.qIndex(), this.total()));
  readonly pips = computed(() =>
    Array.from({ length: this.total() || QUESTION_COUNT }, (_, i) => i < this.answeredCount()));

  readonly currentQuestion = computed<ResumeQuestion | null>(() =>
    this.questions()[this.qIndex()] ?? null);
  readonly wantsCode = computed(() => {
    const k = this.currentQuestion()?.kind;
    return k === 'code' || k === 'query';
  });
  readonly editorVisible = computed(() =>
    this.awaitingAnswer() && (this.wantsCode() || this.editorOpen() || this.draftCode().trim().length > 0));

  /** Editor syntax follows the tech named by the claim (or skill) under attack. */
  readonly currentLang = computed<EditorLang>(() => {
    const q = this.currentQuestion();
    if (!q) return 'typescript';
    if (q.kind === 'query') return 'sql';
    const tech = [q.skill ?? '', ...(this.claimFor(q.claimId)?.tech ?? [])].join(' ').toLowerCase();
    if (/sql|postgres|mysql|oracle|db2/.test(tech)) return 'sql';
    if (/c#|csharp|\.net|dotnet|asp/.test(tech)) return 'csharp';
    return 'typescript';
  });
  readonly currentLangLabel = computed(() => {
    switch (this.currentLang()) {
      case 'sql': return 'SQL';
      case 'csharp': return 'C#';
      default: return 'TypeScript';
    }
  });

  claimFor(id: string | undefined): ResumeClaim | null {
    if (!id) return null;
    return (this.candidate()?.claims ?? []).find(c => c.id === id) ?? null;
  }

  beginInterview(): void {
    const claims = this.selectedClaims();
    if (!claims.length) return;
    this.chatError.set(false);
    this.messages.set([]);
    this.qIndex.set(0);
    this.results.set([]);
    this.voiceText = {};
    this.voiceSeconds = {};
    this.voiceError.set('');
    this.tabLeaves.set(0);
    this.resetHints();
    this.stage.set('interview');
    this.typing.set(true);
    this.openEntry();

    const rated = this.ratedSkills();
    const count = rated.length ? QUESTION_COUNT_SKILLS : QUESTION_COUNT;
    this.svc.generateQuestions(claims, count, rated, this.candidate()?.years ?? null).subscribe(qs => {
      this.closeEntry();
      if (!qs.length) {
        this.typing.set(false);
        this.chatError.set(true);
        return;
      }
      this.questions.set(qs);
      this.answers.set(qs.map(() => ''));
      this.codes.set(qs.map(() => ''));
      this.startedAt = this.now();
      this.pushMsg({
        from: 'ai',
        text: `So, ${this.firstName()}… I read your résumé. All of it. Let's find out how much of it reads back. 😏`,
      });
      this.later(() => this.askQuestion(0), 1400);
    });
  }

  retryQuestions(): void { this.beginInterview(); }

  private askQuestion(i: number): void {
    const q = this.questions()[i];
    if (!q) return;
    this.qIndex.set(i);
    this.typing.set(true);
    this.later(() => {
      const claim = this.claimFor(q.claimId);
      this.pushMsg({
        from: 'ai',
        text: q.question,
        claim: claim?.text,
        skill: q.skill,
        skillRating: q.skill ? this.skillRating(q.skill) : undefined,
        kindLabel: KIND_LABEL[q.kind],
      });
      this.draft.set('');
      this.draftCode.set('');
      this.editorOpen.set(false);
      this.awaitingAnswer.set(true);
    }, 1100 + Math.random() * 700);
  }

  readonly canSend = computed(() =>
    this.awaitingAnswer() && (this.draft().trim().length > 0 || this.draftCode().trim().length > 0));

  send(): void {
    if (!this.canSend()) return;
    this.commitAnswer(this.draft().trim(), this.draftCode().trim());
  }

  skip(): void {
    if (!this.awaitingAnswer()) return;
    this.commitAnswer('', '', true);
  }

  private commitAnswer(text: string, code: string, skipped = false): void {
    this.stopVoice();
    const i = this.qIndex();
    this.awaitingAnswer.set(false);
    this.answers.update(a => { const n = [...a]; n[i] = text; return n; });
    this.codes.update(a => { const n = [...a]; n[i] = code; return n; });

    this.pushMsg({
      from: 'user',
      text: skipped ? '…I\'d rather not answer that one. 😅' : text,
      code: code || undefined,
    });

    this.typing.set(true);
    this.later(() => {
      this.pushMsg({
        from: 'ai',
        text: skipped ? 'Noted. That one stays on the record. 📋' : this.pickReaction(),
      });
      const next = i + 1;
      if (next >= this.total()) {
        this.qIndex.set(next); // all answered → progress pips fill
        this.later(() => this.deliberate(), 900);
      } else {
        this.later(() => this.askQuestion(next), 700);
      }
    }, 800 + Math.random() * 600);
  }

  private pickReaction(): string {
    let idx = Math.floor(Math.random() * REACTIONS.length);
    if (idx === this.lastReaction) idx = (idx + 1) % REACTIONS.length;
    this.lastReaction = idx;
    return REACTIONS[idx];
  }

  toggleEditor(): void { this.editorOpen.update(v => !v); }

  // ── Hint lifeline (1 free per round; each extra costs XP) ───
  readonly HINT_COST_XP = HINT_COST_XP;
  hints = signal<Record<number, string>>({});   // question index → hint text
  hintsUsed = signal(0);
  hintLoading = signal(false);
  hintConfirm = signal(false);

  readonly currentHint = computed(() => this.hints()[this.qIndex()] ?? null);
  readonly hintIsFree = computed(() => this.hintsUsed() === 0);
  readonly canAffordHint = computed(() => this.game.xp() >= HINT_COST_XP);
  readonly hintAvailable = computed(() =>
    this.awaitingAnswer() && !this.currentHint() && !this.hintLoading() &&
    (this.hintIsFree() || this.canAffordHint()));

  requestHint(): void {
    if (!this.hintAvailable()) return;
    this.hintConfirm.set(true);
  }

  confirmHint(): void {
    this.hintConfirm.set(false);
    this.fetchHint(this.qIndex(), !this.hintIsFree());
  }

  cancelHint(): void { this.hintConfirm.set(false); }

  private fetchHint(index: number, paid: boolean): void {
    const q = this.questions()[index];
    if (!q) return;
    this.hintLoading.set(true);
    this.svc.getHint(q.question, q.expected).subscribe(hint => {
      this.hints.update(h => ({ ...h, [index]: hint }));
      this.hintsUsed.update(n => n + 1);
      if (paid) this.game.spendXp(HINT_COST_XP);
      this.hintLoading.set(false);
    });
  }

  private resetHints(): void {
    this.hints.set({});
    this.hintsUsed.set(0);
    this.hintLoading.set(false);
    this.hintConfirm.set(false);
  }

  /**
   * The entry gate stays up for a minimum beat (so it never flashes) and
   * otherwise exactly as long as question generation takes — the loading
   * wait IS the arena-entrance animation.
   */
  private openEntry(): void {
    this.entryClosing.set(false);
    this.entryVisible.set(true);
    this.entryOpenedAt = this.now();
  }

  private closeEntry(): void {
    if (!this.entryVisible()) return;
    const wait = Math.max(0, 1900 - (this.now() - this.entryOpenedAt));
    this.later(() => {
      this.entryClosing.set(true);
      this.later(() => this.entryVisible.set(false), 420);
    }, wait);
  }

  private pushMsg(m: ChatMsg): void {
    // Own messages always stick to the bottom; incoming ones only when the
    // user is already reading the newest — never yank them mid-scrollback.
    const stick = m.from === 'user' || this.isNearBottom();
    this.typing.set(false);
    this.messages.update(list => [...list, m]);
    if (stick) this.scrollChat();
  }

  private isNearBottom(): boolean {
    if (!isPlatformBrowser(this.platformId)) return true;
    const el = this.chatLog()?.nativeElement;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  }

  private scrollChat(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.timers.push(setTimeout(() => {
      const el = this.chatLog()?.nativeElement;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 60));
  }

  // ── Deliberation → grading (one batched call) ───────────────
  private deliberate(): void {
    this.stage.set('deliberating');
    let i = 0;
    if (isPlatformBrowser(this.platformId)) {
      this.scanTimer = setInterval(() => {
        i = (i + 1) % DELIBERATION_LINES.length;
        this.deliberationLine.set(DELIBERATION_LINES[i]);
      }, 1800);
    }

    const qs = this.questions();
    const answered = qs
      .map((q, idx) => ({ q, idx }))
      .filter(x => this.combinedAnswer(x.idx).length > 0);

    // Skill-check answers defend the self-rating instead of a résumé claim, so
    // the substantiation verdict reads as "did you back up what you rated yourself".
    const payload: ResumeGradeInput[] = answered.map(x => ({
      question: x.q.question,
      expected: x.q.expected,
      answer: this.combinedAnswer(x.idx),
      claim: x.q.skill
        ? `Self-rated ${x.q.skill} at ${this.skillRating(x.q.skill)}/10 on their résumé`
        : this.claimFor(x.q.claimId)?.text ?? '',
      voice: this.voiceStatsFor(x.idx),
    }));

    this.svc.gradeBatch(payload).subscribe(graded => {
      // Skipped answers are scored locally — we never pay tokens for silence.
      const full: ResumeGradeItem[] = qs.map(() => ({
        score: 0,
        verdict: 'missed' as const,
        note: 'No answer given — in a real interview, silence is an answer too.',
        sub: 'busted' as const,
        subNote: 'No defense offered — the claim stands unproven.',
      }));
      graded.forEach((r, k) => { full[answered[k].idx] = r; });
      this.results.set(full);
      this.finalize();
    });
  }

  private combinedAnswer(i: number): string {
    const text = (this.answers()[i] ?? '').trim();
    const code = (this.codes()[i] ?? '').trim();
    if (!code) return text;
    const block = '```' + this.currentLang() + '\n' + code + '\n```';
    return text ? `${text}\n\n${block}` : block;
  }

  private finalize(): void {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }

    const xp = Math.round(this.results().reduce((s, r) => s + r.score, 0));
    this.xpEarned.set(xp);
    if (xp > 0) this.game.awardXp(xp);

    this.recordRound();

    this.roast.set(this.pickRoast(this.overall()));
    this.memeFailed.set(false);
    this.meme.set(this.memeSvc.forScore(this.overall(), this.memeTag()));

    this.later(() => this.stage.set('results'), 900);
  }

  /**
   * The skill/tech this round hinged on — the lowest scorer when failing (the
   * wound), the highest when passing (the flex) — so the meme caption names
   * something the user actually just lived through.
   */
  private memeTag(): string {
    const qs = this.questions();
    const res = this.results();
    if (!qs.length || !res.length) return '';
    const score = (i: number) => res[i]?.score ?? 0;
    const pick = qs.reduce((best, _, i) =>
      (this.passed() ? score(i) > score(best) : score(i) < score(best)) ? i : best, 0);
    const q = qs[pick];
    return q.skill || this.claimFor(q.claimId)?.tech[0] || q.topic || '';
  }

  private pickRoast(score: number): string {
    const band =
      score >= 9 ? 'legend' : score >= 7.5 ? 'strong' : score >= 6 ? 'pass' : score >= 4 ? 'close' : 'fail';
    const pool = ROASTS[band];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private recordRound(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const qs = this.questions();
    const res = this.results();
    if (!qs.length) return;
    const round: RoundRecord = {
      id: 'rz_' + Math.random().toString(36).slice(2, 10) + this.now().toString(36),
      date: new Date().toISOString(),
      arena: 'resume',
      level: 'resume',
      levelName: 'Résumé Interview',
      score: this.overall(),
      time: Math.max(0, Math.round((this.now() - this.startedAt) / 1000)),
      questions: qs.map((q, i) => ({
        module: q.topic,
        question: q.question,
        score: res[i]?.score ?? 0,
      })),
    };
    this.progress.recordRound(round);
  }

  // ── Results ─────────────────────────────────────────────────
  readonly overall = computed(() => {
    const r = this.results();
    if (!r.length) return 0;
    return Math.round((r.reduce((s, x) => s + x.score, 0) / r.length) * 10) / 10;
  });
  readonly passed = computed(() => this.overall() >= PASS_MARK);
  readonly backedCount = computed(() => this.results().filter(r => r.sub === 'backed').length);

  /** The claim-trial board: each probed claim with its substantiation verdict.
   *  Skill-checks live on the skillBoard instead. */
  readonly claimBoard = computed(() =>
    this.questions()
      .map((q, i) => ({ q, i }))
      .filter(x => !x.q.skill)
      .map(x => ({
        claim: this.claimFor(x.q.claimId)?.text ?? x.q.topic,
        type: this.claimFor(x.q.claimId)?.type ?? 'project',
        sub: this.results()[x.i]?.sub ?? 'shaky',
        subNote: this.results()[x.i]?.subNote ?? '',
      })));

  /** "You said vs you showed" — self-rating against actual performance per skill. */
  readonly skillBoard = computed<SkillVerdict[]>(() => {
    const res = this.results();
    const byName = new Map<string, { said: number; scores: number[] }>();
    this.questions().forEach((q, i) => {
      if (!q.skill) return;
      const entry = byName.get(q.skill) ?? { said: this.skillRating(q.skill), scores: [] };
      entry.scores.push(res[i]?.score ?? 0);
      byName.set(q.skill, entry);
    });
    return [...byName.entries()].map(([name, e]) => {
      const showed = Math.round((e.scores.reduce((s, x) => s + x, 0) / e.scores.length) * 10) / 10;
      const gap = e.said - showed;
      let label: string, icon: string;
      if (gap <= -0.5) { label = 'UNDERSOLD'; icon = '😎'; }
      else if (gap <= 1.5) { label = 'HONEST'; icon = '✅'; }
      else if (gap <= 3.5) { label = 'STRETCHING'; icon = '😬'; }
      else { label = 'DELULU'; icon = '🥲'; }
      return { name, said: e.said, showed, label, icon };
    });
  });

  subMeta(sub: string): { label: string; icon: string } {
    if (sub === 'backed') return { label: 'BACKED', icon: '✅' };
    if (sub === 'busted') return { label: 'BUSTED', icon: '❌' };
    return { label: 'SHAKY', icon: '😬' };
  }

  toggleDetail(i: number): void {
    this.detailOpen.update(set => {
      const next = new Set(set);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  onMemeError(): void { this.memeFailed.set(true); }

  answerShown(i: number): string {
    const t = (this.answers()[i] ?? '').trim();
    const c = (this.codes()[i] ?? '').trim();
    return [t, c].filter(Boolean).join('\n\n') || '(no answer)';
  }

  scoreColor(score: number): string {
    if (score >= 9) return '#34d399';
    if (score >= 7) return '#60a5fa';
    if (score >= 5) return '#fbbf24';
    if (score >= 3) return '#fb923c';
    return '#f87171';
  }

  // ── Leave-guard + anti-cheat (same rules as Test Me) ────────
  /** The round is "live" while answering or being graded — leaving loses work. */
  readonly roundLive = computed(() =>
    this.stage() === 'interview' || this.stage() === 'deliberating');

  /** Controls the animated "Walk out?" dialog (in-app navigation only). */
  showLeaveDialog = signal(false);
  private leaveResolver: ((proceed: boolean) => void) | null = null;

  /** How many times the user switched away from this tab mid-interview. */
  tabLeaves = signal(0);

  /**
   * Router CanDeactivate hook. While the interview is live we suspend the
   * navigation and show our own dialog, resolving the promise with the choice.
   * (Refresh / tab-close can't use a custom dialog — see beforeUnloadHandler.)
   */
  canDeactivate(): boolean | Promise<boolean> {
    if (!this.roundLive() || !isPlatformBrowser(this.platformId)) return true;
    this.showLeaveDialog.set(true);
    return new Promise<boolean>(resolve => (this.leaveResolver = resolve));
  }

  /** "Leave anyway" — abandon the round and let the navigation through. */
  confirmLeave(): void {
    this.showLeaveDialog.set(false);
    this.leaveResolver?.(true);
    this.leaveResolver = null;
  }

  /** "Stay & finish" — cancel the navigation, keep the round intact. */
  stayInInterview(): void {
    this.showLeaveDialog.set(false);
    this.leaveResolver?.(false);
    this.leaveResolver = null;
  }

  /** Native browser warning for refresh / tab-close — cannot be styled. */
  @HostListener('window:beforeunload', ['$event'])
  beforeUnloadHandler(event: BeforeUnloadEvent): void {
    if (this.roundLive() && isPlatformBrowser(this.platformId)) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  /**
   * Anti-cheat: count tab switches mid-round. The call-out renders as a banner
   * pinned above the chat (not a bubble — it would drown the conversation).
   */
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (!this.roundLive() || !isPlatformBrowser(this.platformId) || !document.hidden) return;
    this.tabLeaves.update(n => n + 1);
  }

  /** Current escalating call-out for the banner ('' when clean). */
  readonly cheatMsg = computed(() =>
    this.tabLeaves() > 0 ? this.tabLeaveMessage(this.tabLeaves()) : '');

  /** Escalating call-outs — mirrors Test Me's getTabLeaveMessage. */
  private tabLeaveMessage(count: number): string {
    const messages = [
      '👀 First tab switch already? The interview just started...',
      '🤨 Came back quick... checking notes already?',
      '📚 3 times? That textbook must be getting attention.',
      '😏 We’re starting to feel ignored here.',
      '🚨 5 tab switches... confidence level dropping.',
      '🕵️ Interesting strategy... very interesting.',
      '💀 At this point, Google knows the answers better than you.',
      '📸 We’ve noticed a pattern developing here...',
      '🤖 The tab counter is working harder than you right now.',
      '☠️ Double digits soon? This is becoming a side quest.',
    ];
    if (count <= messages.length) return messages[count - 1];
    return `🚔 You left ${count} times... honestly, just trust yourself at this point.`;
  }

  // ── Replay ──────────────────────────────────────────────────
  /** Same claims, fresh questions. */
  grillAgain(): void {
    this.detailOpen.set(new Set());
    this.meme.set(null);
    this.beginInterview();
  }

  /** Full reset — new résumé. */
  restart(): void {
    this.stage.set('intro');
    this.pasteMode.set(false);
    this.pasteText.set('');
    this.introError.set('');
    this.candidate.set(null);
    this.deselected.set(new Set());
    this.skills.set([]);
    this.skillRatings.set({});
    this.newSkill.set('');
    this.questions.set([]);
    this.messages.set([]);
    this.answers.set([]);
    this.codes.set([]);
    this.results.set([]);
    this.meme.set(null);
    this.detailOpen.set(new Set());
    this.resumeText = '';
    this.stopVoice();
    this.voiceText = {};
    this.voiceSeconds = {};
    this.tabLeaves.set(0);
    this.showLeaveDialog.set(false);
    this.resetHints();
  }

  private now(): number {
    return isPlatformBrowser(this.platformId) ? Date.now() : 0;
  }
}
