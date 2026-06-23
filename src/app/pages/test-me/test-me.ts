import { Component, computed, inject, signal, PLATFORM_ID, HostListener, ViewChild, ViewContainerRef, ComponentRef, Injector } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { SeoService } from '../../core/services/seo.service';
import { ProgressService, RoundRecord } from '../../core/services/progress.service';
import { GameService, questionId } from '../../core/services/game.service';
import { FocusRoundService } from '../../core/services/focus.service';
import { UserService } from '../../core/services/user.service';
import { ShareService, ScoreCard, ShareLinks } from '../../core/services/share.service';
import { ScorecardImageService } from '../../core/services/scorecard-image.service';
import { RefresherData, RefresherItem } from '../../core/models/refresher-item.model';
import { EditorLang } from '../../shared/components/code-editor/code-editor';
import {
  TestMeService,
  EvalResult,
  VERDICT_DISPLAY,
  VerdictStyle,
  scoreColor,
  rankFor,
  Rank,
} from '../../services/test-me-service/test-me-service';

type Stage = 'pick-tech' | 'pick-level' | 'focus-loading' | 'quiz' | 'evaluating' | 'results';

interface Arena {
  id: string;
  name: string;
  icon: string;
  tag: string;
  blurb: string;
  gradient: string;
  accent: string;
}

interface LevelOption {
  key: string;
  label: string;
  badge: string;
  count: number;
  difficulty: number; // 1..4 — drives the strength meter
}

interface QuizQuestion extends RefresherItem {
  module: string;
  icon: string;
}

const ARENAS: Arena[] = [
  {
    id: 'angular',
    name: 'Angular',
    icon: '⚡',
    tag: 'Frontend Framework',
    blurb: 'Components, signals, DI, RxJS & change detection.',
    gradient: 'linear-gradient(135deg, #c3002f 0%, #ff4857 100%)',
    accent: '#ff4857',
  },
  {
    id: 'dotnet',
    name: '.NET',
    icon: '🔷',
    tag: 'Backend Platform',
    blurb: 'Async, LINQ, EF Core, middleware & SOLID.',
    gradient: 'linear-gradient(135deg, #512bd4 0%, #9333ea 100%)',
    accent: '#9333ea',
  },
  {
    id: 'sql',
    name: 'SQL',
    icon: '🗄️',
    tag: 'Database Language',
    blurb: 'JOINs, window functions, indexing & transactions.',
    gradient: 'linear-gradient(135deg, #0050a0 0%, #0ea5e9 100%)',
    accent: '#0ea5e9',
  },
];

const LEVEL_META: Record<string, { label: string; badge: string; difficulty: number }> = {
  '0-1': { label: 'Rookie', badge: '0–1 yr', difficulty: 1 },
  '1-2': { label: 'Builder', badge: '1–2 yrs', difficulty: 2 },
  '2-3': { label: 'Senior', badge: '2–3 yrs', difficulty: 3 },
  '4+': { label: 'Architect', badge: '4+ yrs', difficulty: 4 },
};

const QUIZ_SIZE = 5;
const HINT_COST_XP = 20; // first hint per round is free; each extra costs this
const MASTER_ABOVE = 7;    // score strictly above this on a question → auto-master it
const UNMASTER_BELOW = 5;  // score strictly below this → drop mastery (with a kind nudge)
const BEST_KEY = 'testme_best_score';
const TAKEN_KEY = 'testme_total_taken';
const HISTORY_KEY = 'testme_history';
const HISTORY_MAX = 6;

@Component({
  selector: 'app-test-me',
  imports: [RouterLink],
  templateUrl: './test-me.html',
  styleUrl: './test-me.css',
})
export class TestMeComponent {
  private platformId = inject(PLATFORM_ID);
  private dataService = inject(DataService);
  private testMe = inject(TestMeService);
  private progressService = inject(ProgressService);
  private focusRound = inject(FocusRoundService);
  private game = inject(GameService);
  private user = inject(UserService);
  private share = inject(ShareService);
  private scorecard = inject(ScorecardImageService);

  /** XP earned on the round just finished (shown on the results screen). */
  xpEarned = signal(0);

  /** Mastery changes from the round just graded — drives the results banner. */
  masteryGained = signal(0);
  masteryLost = signal(0);

  readonly arenas = ARENAS;
  readonly verdictMap = VERDICT_DISPLAY;

  // ── State machine ──────────────────────────────────────────
  stage = signal<Stage>('pick-tech');
  loadingLevels = signal(false);
  loadError = signal(false);

  selectedArena = signal<Arena | null>(null);
  selectedLevel = signal<LevelOption | null>(null);

  // Adaptive "Focus Round" state
  focusMode = signal(false);
  focusTargets = signal<string[]>([]);
  private focusModule: string | null = null;

  // ── Hint lifeline (1 free per round; each extra costs XP) ───
  readonly HINT_COST = HINT_COST_XP;
  hints = signal<Record<number, string>>({}); // question index → hint text
  hintedIndices = signal<Set<number>>(new Set());
  hintsUsed = signal(0);
  hintLoading = signal(false);
  hintConfirm = signal(false);

  readonly currentHint = computed(() => this.hints()[this.currentIndex()] ?? null);
  readonly hintIsFree = computed(() => this.hintsUsed() === 0);
  readonly canAffordHint = computed(() => this.game.xp() >= HINT_COST_XP);

  private rawData = signal<RefresherData | null>(null);

  questions = signal<QuizQuestion[]>([]);
  answers = signal<string[]>([]);
  /** Optional per-question code snippet, folded into the answer sent to the AI. */
  codes = signal<string[]>([]);
  /** Question indices where the user explicitly opened the code editor. */
  editorOpen = signal<Set<number>>(new Set());
  currentIndex = signal(0);

  // ── Interviewer follow-up (up to 2 random questions get an AI probe) ──────────
  /** Question indices eligible for a probe this round (fixed at quiz build). */
  followupIndices = signal<Set<number>>(new Set());
  /** index → AI follow-up text — present ONLY when the AI chose to probe. */
  followups = signal<Record<number, string>>({});
  /** index → the user's answer to the follow-up. */
  followupAnswers = signal<Record<number, string>>({});
  /** index set: we've already asked the AI (it probed OR declined) — so Next now advances. */
  followupResolved = signal<Set<number>>(new Set());
  followupLoading = signal(false);
  /** Client pre-filter: don't even call the AI on a near-empty answer like "hi". */
  private readonly MIN_PROBE_CHARS = 25;

  results = signal<EvalResult[]>([]);
  evalProgress = signal(0); // 0..QUIZ_SIZE, drives the grading animation

  private startedAt = 0;
  private elapsedSeconds = 0;
  elapsedLabel = signal('');

  // ── Derived ────────────────────────────────────────────────
  readonly levels = computed<LevelOption[]>(() => {
    const data = this.rawData();
    if (!data) return [];
    return Object.entries(data.categories)
      .map(([key, cat]) => {
        const count = Object.values(cat.modules).reduce((s, m) => s + m.questions.length, 0);
        const meta = LEVEL_META[key] ?? { label: key, badge: key, difficulty: 2 };
        return { key, label: meta.label, badge: meta.badge, count, difficulty: meta.difficulty };
      })
      .filter(l => l.count > 0);
  });

  readonly current = computed<QuizQuestion | null>(() => this.questions()[this.currentIndex()] ?? null);
  readonly total = computed(() => this.questions().length);
  // A question counts as answered if it has prose OR a code snippet.
  readonly answeredCount = computed(() =>
    this.questions().reduce((n, _q, i) => {
      const hasText = (this.answers()[i] ?? '').trim().length > 0;
      const hasCode = (this.codes()[i] ?? '').trim().length > 0;
      return n + (hasText || hasCode ? 1 : 0);
    }, 0),
  );

  // ── Code editor (per question, language-aware) ─────────────
  /** Editor language follows the chosen arena so syntax highlighting matches the stack. */
  readonly editorLanguage = computed<EditorLang>(() => {
    switch (this.selectedArena()?.id) {
      case 'sql': return 'sql';
      case 'dotnet': return 'csharp';
      default: return 'typescript';
    }
  });
  readonly editorLangLabel = computed(() => {
    switch (this.editorLanguage()) {
      case 'sql': return 'SQL';
      case 'csharp': return 'C#';
      default: return 'TypeScript';
    }
  });
  readonly currentCode = computed(() => this.codes()[this.currentIndex()] ?? '');
  /** Show the editor if the user opened it for this question, or it already holds code. */
  readonly currentCodeOpen = computed(
    () => this.editorOpen().has(this.currentIndex()) || this.currentCode().trim().length > 0,
  );
  readonly progressPct = computed(() => {
    const t = this.total();
    return t ? Math.round(((this.currentIndex() + 1) / t) * 100) : 0;
  });
  readonly isLast = computed(() => this.currentIndex() === this.total() - 1);
  readonly currentAnswer = computed(() => this.answers()[this.currentIndex()] ?? '');
  readonly currentAnswered = computed(() => this.currentAnswer().trim().length > 0);
  readonly allAnswered = computed(() => this.answeredCount() === this.total() && this.total() > 0);
  readonly skippedCount = computed(() => this.total() - this.answeredCount());

  // ── Follow-up derived state ────────────────────────────────
  readonly currentIsEligible = computed(() => this.followupIndices().has(this.currentIndex()));
  readonly currentFollowup = computed<string | null>(() => this.followups()[this.currentIndex()] ?? null);
  readonly currentFollowupAnswer = computed(() => this.followupAnswers()[this.currentIndex()] ?? '');
  /** Combined prose + code for the current question — what we'd send the AI to judge. */
  private readonly currentProbeSource = computed(() =>
    `${this.currentAnswer().trim()} ${this.currentCode().trim()}`.trim(),
  );
  /**
   * True when clicking Next should ASK the AI instead of advancing. Passing this gate only
   * means "worth asking" — the AI still decides whether to probe. Once it answers (probe or
   * decline) the index is `resolved`, so this flips false and Next advances.
   */
  readonly pendingFollowup = computed(() =>
    this.currentIsEligible() &&
    !this.followupResolved().has(this.currentIndex()) &&
    this.currentProbeSource().replace(/\s+/g, '').length >= this.MIN_PROBE_CHARS,
  );

  readonly overallScore = computed(() => {
    const r = this.results();
    if (!r.length) return 0;
    return Math.round((r.reduce((s, x) => s + x.score, 0) / r.length) * 10) / 10;
  });
  readonly rank = computed<Rank>(() => rankFor(this.overallScore()));
  readonly bestScore = signal(0);
  history = signal<Record<string, number[]>>({});

  /** Recent scores (most recent last, max 3) for a given level of the selected arena. */
  recentAttempts(levelKey: string): number[] {
    const arena = this.selectedArena();
    if (!arena) return [];
    return (this.history()[`${arena.id}:${levelKey}`] ?? []).slice(-3);
  }

  constructor() {
    inject(SeoService).update({
      title: 'Test Me — AI Interview Practice',
      description:
        'Put your skills to the test. Pick a technology and level, answer 5 random interview questions, and get instant AI feedback scored against expert answers.',
      keywords: 'angular quiz, dotnet quiz, sql quiz, ai interview practice, mock interview, developer test',
    });
    this.loadBest();
    this.loadHistory();

    // Launched from a "Focus My Weak Spots" / "Test Yourself" challenge?
    const focus = this.focusRound.consume();
    if (focus) {
      this.startFocus(focus.arena, focus.module);
      return;
    }

    // Launched from a shared scorecard's "Take the Same Challenge" link?
    // (?arena=angular&level=2-3&vs=Manav&vsScore=8.2) — drop the visitor straight
    // into that round, and remember the opponent for the head-to-head on results.
    if (isPlatformBrowser(this.platformId)) {
      const qp = inject(ActivatedRoute).snapshot.queryParamMap;
      const arena = ARENAS.find(a => a.id === qp.get('arena'));
      if (arena) {
        this.pendingLevelKey = qp.get('level');
        const vs = qp.get('vs');
        const vsScore = Number(qp.get('vsScore'));
        if (vs && Number.isFinite(vsScore)) {
          this.opponent.set({ name: vs.slice(0, 24), score: Math.max(0, Math.min(10, vsScore)) });
        }
        this.pickArena(arena);
      }
    }
  }

  /** Level to auto-select once arena data lands (set by a shared challenge link). */
  private pendingLevelKey: string | null = null;

  /** The scorecard owner we're racing, when arriving from a challenge link. */
  opponent = signal<{ name: string; score: number } | null>(null);
  readonly challengeOutcome = computed<'win' | 'lose' | 'tie' | null>(() => {
    const opp = this.opponent();
    if (!opp) return null;
    const you = this.overallScore();
    return you > opp.score ? 'win' : you < opp.score ? 'lose' : 'tie';
  });

  // Dynamic editor host (we create/destroy the heavy editor on demand)
  @ViewChild('editorHost', { read: ViewContainerRef }) private editorHost!: ViewContainerRef;
  private injector = inject(Injector);
  private editorCompRef: ComponentRef<any> | null = null;

  // ── Stage 1: pick a tech arena ─────────────────────────────
  pickArena(arena: Arena): void {
    this.selectedArena.set(arena);
    this.loadError.set(false);
    this.loadingLevels.set(true);
    this.stage.set('pick-level');
    this.dataService.loadData(arena.id).subscribe({
      next: data => {
        this.rawData.set(data);
        this.loadingLevels.set(false);
        // Auto-advance into the quiz when arriving from a shared challenge link.
        if (this.pendingLevelKey) {
          const key = this.pendingLevelKey;
          this.pendingLevelKey = null;
          const lvl = this.levels().find(l => l.key === key);
          if (lvl) this.pickLevel(lvl);
        }
      },
      error: () => {
        this.loadError.set(true);
        this.loadingLevels.set(false);
      },
    });
  }

  // ── Stage 2: pick a level → build the quiz ─────────────────
  pickLevel(level: LevelOption): void {
    this.selectedLevel.set(level);
    const data = this.rawData();
    if (!data) return;
    this.questions.set(this.buildQuiz(data, level.key));
    this.answers.set(this.questions().map(() => ''));
    this.codes.set(this.questions().map(() => ''));
    this.editorOpen.set(new Set());
    this.results.set([]);
    this.currentIndex.set(0);
    this.tabLeaves.set(0);
    this.startedAt = this.now();
    this.resetHints();
    this.resetShare();
    this.resetFollowups();
    this.pickFollowupIndices();
    this.stage.set('quiz');
  }

  private buildQuiz(data: RefresherData, levelKey: string): QuizQuestion[] {
    const cat = data.categories[levelKey];
    const pool: QuizQuestion[] = [];
    for (const [name, mod] of Object.entries(cat.modules)) {
      for (const q of mod.questions) {
        pool.push({ ...q, module: name, icon: mod.icon });
      }
    }
    // Fisher–Yates shuffle, then take the first N.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(QUIZ_SIZE, pool.length));
  }

  // ── Adaptive "Focus Round" ─────────────────────────────────
  /** Entry point from the Dashboard: load the arena, then build a weighted quiz. */
  startFocus(arenaId: string, module?: string): void {
    const arena = ARENAS.find(a => a.id === arenaId);
    if (!arena) return;
    this.focusModule = module ?? null;
    this.selectedArena.set(arena);
    this.focusMode.set(true);
    this.loadError.set(false);
    this.stage.set('focus-loading');
    this.dataService.loadData(arena.id).subscribe({
      next: data => {
        this.rawData.set(data);
        this.launchFocusFromData(data, arena.id);
      },
      error: () => this.loadError.set(true),
    });
  }

  private launchFocusFromData(data: RefresherData, arenaId: string): void {
    const questions = this.buildFocusQuiz(data, arenaId, this.focusModule);
    if (!questions.length) {
      this.loadError.set(true);
      return;
    }
    // Synthetic level so results still record under arena + 'focus'.
    this.selectedLevel.set({ key: 'focus', label: 'Focus Round', badge: 'adaptive', count: questions.length, difficulty: 0 });
    this.questions.set(questions);
    this.answers.set(questions.map(() => ''));
    this.codes.set(questions.map(() => ''));
    this.editorOpen.set(new Set());
    this.results.set([]);
    this.expanded.set(new Set());
    this.currentIndex.set(0);
    this.tabLeaves.set(0);
    this.startedAt = this.now();
    this.resetHints();
    this.resetShare();
    this.resetFollowups();
    this.pickFollowupIndices();
    this.stage.set('quiz');
  }

  /**
   * Pull every question for the arena (all levels) grouped by module, weight each
   * module by how much it needs work, then weighted-sample QUIZ_SIZE distinct
   * questions. Untested + weak modules dominate; strong ones rarely appear.
   */
  private buildFocusQuiz(data: RefresherData, arenaId: string, targetModule?: string | null): QuizQuestion[] {
    // Module-targeted challenge ("you cleared X — prove it"): pull only that module.
    if (targetModule) {
      const pool: QuizQuestion[] = [];
      for (const cat of Object.values(data.categories)) {
        const mod = cat.modules[targetModule];
        if (mod) for (const q of mod.questions) pool.push({ ...q, module: targetModule, icon: mod.icon });
      }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      this.focusTargets.set([targetModule]);
      return pool.slice(0, Math.min(QUIZ_SIZE, pool.length));
    }

    const pools = new Map<string, QuizQuestion[]>();
    for (const cat of Object.values(data.categories)) {
      for (const [name, mod] of Object.entries(cat.modules)) {
        const arr = pools.get(name) ?? [];
        for (const q of mod.questions) arr.push({ ...q, module: name, icon: mod.icon });
        pools.set(name, arr);
      }
    }

    const stats = this.progressService.getArenaProgress(arenaId)?.modules ?? {};
    const weightFor = (module: string): number => {
      const st = stats[module];
      if (!st || st.tested === 0 || st.avg === null) return 6; // untested
      if (st.avg < 4) return 8;  // weak
      if (st.avg < 6) return 5;  // shaky
      if (st.avg < 8) return 2;  // decent
      return 1;                  // strong
    };
    const weighted = [...pools.keys()].map(module => ({ module, weight: weightFor(module) }));

    const chosen: QuizQuestion[] = [];
    let guard = 0;
    while (chosen.length < QUIZ_SIZE && guard < 500) {
      guard++;
      const available = weighted.filter(w => (pools.get(w.module)?.length ?? 0) > 0);
      if (!available.length) break;
      const total = available.reduce((s, w) => s + w.weight, 0);
      let r = Math.random() * total;
      let pick = available[available.length - 1].module;
      for (const w of available) {
        r -= w.weight;
        if (r <= 0) { pick = w.module; break; }
      }
      const pool = pools.get(pick)!;
      const q = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      chosen.push(q);
    }

    this.focusTargets.set([...new Set(chosen.map(q => q.module))]);
    return chosen;
  }

  // ── Stage 3: the quiz ──────────────────────────────────────
  updateAnswer(value: string): void {
    this.answers.update(arr => {
      const next = [...arr];
      next[this.currentIndex()] = value;
      return next;
    });
  }

  updateCode(value: string): void {
    this.codes.update(arr => {
      const next = [...arr];
      next[this.currentIndex()] = value;
      return next;
    });
  }

  /** Reveal/hide the code editor for the current question (kept per-index). */
  toggleEditor(): void {
    const idx = this.currentIndex();
    const isOpen = this.editorOpen().has(idx) || this.currentCode().trim().length > 0;
    const willOpen = !isOpen;

    // update signal synchronously
    this.editorOpen.update(set => {
      const next = new Set(set);
      if (willOpen) next.add(idx);
      else if (next.has(idx) && this.currentCode().trim().length === 0) next.delete(idx);
      return next;
    });

    // perform dynamic creation/destruction outside the signal update
    if (willOpen && !this.editorCompRef && this.editorHost) {
      this.ensureEditorCreated().catch(e => console.error('Failed to lazy-load editor', e));
    }

    if (!willOpen && this.editorCompRef && this.currentCode().trim().length === 0) {
      try { this.editorCompRef.destroy(); } catch {}
      this.editorCompRef = null;
    }
  }

  private async ensureEditorCreated(): Promise<void> {
    if (this.editorCompRef || !this.editorHost) return;
    try {
      const mod = await import('../../shared/components/code-editor/code-editor');
      const Editor = mod.CodeEditorComponent;
      const compRef = this.editorHost.createComponent(Editor, { injector: this.injector });
      // set inputs via setInput to satisfy typed inputs
      if (typeof compRef.setInput === 'function') {
        compRef.setInput('language', this.editorLanguage());
        compRef.setInput('value', this.currentCode());
      } else {
        // fallback — assign directly (less type-safe)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        compRef.instance.language = this.editorLanguage();
        // @ts-ignore
        compRef.instance.value = this.currentCode();
      }

      // wire output if present
      // some output shapes may not be an Observable; guard accordingly
      const out = (compRef.instance as any).valueChange;
      if (out && typeof out.subscribe === 'function') {
        out.subscribe((v: string) => this.updateCode(v));
      } else if (out && typeof out === 'function') {
        // older-style callback — try assigning
        try { out((v: string) => this.updateCode(v)); } catch {}
      }

      this.editorCompRef = compRef;
    } catch (e) {
      console.error('ensureEditorCreated error', e);
    }
  }

  goTo(index: number): void {
    if (index < 0 || index >= this.total()) return;
    this.hintConfirm.set(false);
    this.currentIndex.set(index);
  }

  next(): void {
    this.hintConfirm.set(false);
    if (this.pendingFollowup()) { this.askFollowup(this.currentIndex()); return; }
    if (!this.isLast()) this.currentIndex.update(i => i + 1);
  }

  /**
   * Ask the AI whether this answer deserves a probe. Two outcomes:
   *  • probe text → reveal it inline and STAY (user answers, clicks Next again to advance)
   *  • declined   → mark resolved and ADVANCE immediately (answer wasn't substantive)
   * Either way the index is `resolved`, so we never re-ask it.
   */
  private askFollowup(index: number): void {
    const q = this.questions()[index];
    if (!q || this.followupLoading()) return;
    this.followupLoading.set(true);
    const userAnswer = this.currentProbeSource(); // prose + code, so the AI judges the full answer
    this.testMe.getFollowup(q.question, userAnswer, q.answer ?? '').subscribe(probe => {
      this.followupResolved.update(s => { const n = new Set(s); n.add(index); return n; });
      this.followupLoading.set(false);
      if (probe) {
        this.followups.update(f => ({ ...f, [index]: probe })); // probe → reveal, stay put
      } else {
        this.advanceAfterFollowup(index);                       // declined → just move on
      }
    });
  }

  /** Advance (or submit, if last) after the AI declined — guarding against mid-flight nav. */
  private advanceAfterFollowup(index: number): void {
    if (this.currentIndex() !== index) return; // user navigated away while the request was in flight
    if (this.isLast()) this.submitQuiz();
    else this.currentIndex.update(i => i + 1);
  }

  updateFollowupAnswer(value: string): void {
    this.followupAnswers.update(a => ({ ...a, [this.currentIndex()]: value }));
  }

  prev(): void {
    this.hintConfirm.set(false);
    if (this.currentIndex() > 0) this.currentIndex.update(i => i - 1);
  }

  // ── Hint lifeline ──────────────────────────────────────────
  requestHint(): void {
    const i = this.currentIndex();
    if (this.hints()[i] || this.hintLoading()) return; // already shown / loading
    if (!this.hintIsFree() && !this.canAffordHint()) return; // can't afford a paid hint
    this.hintConfirm.set(true); // confirm the lifeline (free or paid)
  }

  confirmHint(): void {
    this.hintConfirm.set(false);
    this.fetchHint(this.currentIndex(), !this.hintIsFree());
  }

  cancelHint(): void {
    this.hintConfirm.set(false);
  }

  private fetchHint(index: number, paid: boolean): void {
    const q = this.questions()[index];
    if (!q) return;
    this.hintLoading.set(true);
    this.testMe.getHint(q.question, q.answer ?? '').subscribe(hint => {
      this.hints.update(h => ({ ...h, [index]: hint }));
      this.hintedIndices.update(s => { const next = new Set(s); next.add(index); return next; });
      this.hintsUsed.update(n => n + 1);
      if (paid) this.game.spendXp(HINT_COST_XP);
      this.hintLoading.set(false);
    });
  }

  private resetHints(): void {
    this.hints.set({});
    this.hintedIndices.set(new Set());
    this.hintsUsed.set(0);
    this.hintLoading.set(false);
    this.hintConfirm.set(false);
  }

  // ── Follow-up lifecycle ────────────────────────────────────
  /** Choose up to 2 random question indices as probe-eligible for this round. */
  private pickFollowupIndices(): void {
    const n = this.total();
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {       // Fisher–Yates shuffle
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    this.followupIndices.set(new Set(idx.slice(0, Math.min(2, n))));
  }

  private resetFollowups(): void {
    this.followups.set({});
    this.followupAnswers.set({});
    this.followupResolved.set(new Set());
    this.followupLoading.set(false);
  }

  isHinted(i: number): boolean {
    return this.hintedIndices().has(i);
  }

  /** Was this question actually probed (AI gave a follow-up)? Drives the results badge. */
  isFollowedUp(i: number): boolean {
    return !!this.followups()[i];
  }

  /**
   * Merge each question's code snippet into its prose answer as a fenced block so the
   * AI evaluator (worker contract unchanged) grades both together. Empty code is a no-op.
   */
  private answersWithCode(): string[] {
    const lang = this.editorLanguage();
    return this.questions().map((_q, i) => {
      const answer = (this.answers()[i] ?? '').trim();
      const code = (this.codes()[i] ?? '').trim();
      let out = answer;
      if (code) {
        const block = '```' + lang + '\n' + code + '\n```';
        out = out ? `${out}\n\n${block}` : block;
      }
      // Fold in the interviewer follow-up exchange so the grader rewards the deeper reasoning.
      // Only when the probe was both asked AND answered (skipped probes don't penalise).
      const followupQ = this.followups()[i];
      const followupA = (this.followupAnswers()[i] ?? '').trim();
      if (followupQ && followupA) {
        out = `${out}\n\n[Interviewer follow-up] ${followupQ}\n[My answer] ${followupA}`;
      }
      return out;
    });
  }

  // ── Stage 4: evaluate ──────────────────────────────────────
  submitQuiz(): void {
    // Last question is probe-eligible? Run the AI check first. If it declines,
    // advanceAfterFollowup() re-calls submitQuiz() (now ungated) and the round proceeds.
    if (this.pendingFollowup()) { this.askFollowup(this.currentIndex()); return; }

    const elapsedMs = this.now() - this.startedAt;
    this.elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1000));
    this.elapsedLabel.set(this.formatElapsed(elapsedMs));
    this.stage.set('evaluating');
    this.evalProgress.set(0);
    this.runProgressAnimation();

    this.testMe.evaluateBatch(this.questions(), this.answersWithCode()).subscribe({
      next: res => {
        this.results.set(res);
        this.evalProgress.set(this.total());
        this.finishToResults();
      },
      error: () => {
        // evaluateBatch already swallows per-item errors; this is a safety net.
        const fallback: EvalResult = {
          score: 0, verdict: 'needs_work', strengths: '—', missing: 'Evaluation failed.', tip: 'Try again.',
        };
        this.results.set(this.questions().map(() => fallback));
        this.finishToResults();
      },
    });
  }

  private finishToResults(): void {
    // small delay so the grading animation feels complete
    const reveal = () => {
      this.persistStats();
      this.recordProgress();
      this.syncMasteryFromResults();
      this.stage.set('results');
    };
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(reveal, 650);
    } else {
      reveal();
    }
  }

  private runProgressAnimation(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const total = this.total();
    let step = 0;
    const tick = () => {
      if (this.stage() !== 'evaluating') return;
      if (step >= total) return;
      step++;
      // don't overshoot past whatever the real results already set
      this.evalProgress.update(p => Math.max(p, Math.min(step, total)));
      if (step < total) setTimeout(tick, 700);
    };
    setTimeout(tick, 500);
  }

  // ── Share scorecard ────────────────────────────────────────
  /** Lazily minted on the first share action so we only write KV when used. */
  shareLinks = signal<ShareLinks | null>(null);
  private shareCard: ScoreCard | null = null;
  /** Which action just copied — drives the inline "Copied!" confirmation. */
  copied = signal<'link' | 'challenge' | null>(null);
  /** Bumped on each successful copy so the @for-keyed burst replays from frame 0. */
  burstKey = signal(0);
  shareParticles = signal<{ x: string; y: string; delay: string }[]>([]);

  private buildCard(): ScoreCard | null {
    const arena = this.selectedArena();
    const level = this.selectedLevel();
    const results = this.results();
    if (!arena || !level || !results.length) return null;
    return {
      arena: arena.id,
      arenaName: arena.name,
      arenaIcon: arena.icon,
      accent: arena.accent,
      level: level.key,
      levelName: level.label,
      levelBadge: level.badge,
      username: this.user.name() || 'A developer',
      score: this.overallScore(),
      timeLabel: this.elapsedLabel(),
      streak: this.game.streak(),
      userLevel: this.game.level(),
      questions: this.questions().map((q, i) => ({ module: q.module, score: results[i]?.score ?? 0 })),
    };
  }

  /** Build the share link + fire the background KV write once, on first use. */
  private ensureShare(): ShareLinks | null {
    const existing = this.shareLinks();
    if (existing) return existing;
    const card = this.buildCard();
    if (!card) return null;
    this.shareCard = card;
    const links = this.share.create(card);
    this.shareLinks.set(links);
    return links;
  }

  shareTwitter(): void {
    const l = this.ensureShare();
    if (l && this.shareCard) this.openShare(this.share.twitterUrl(this.shareCard, l.url));
  }

  shareLinkedIn(): void {
    const l = this.ensureShare();
    if (l) this.openShare(this.share.linkedInUrl(l.url));
  }

  shareWhatsApp(): void {
    const l = this.ensureShare();
    if (l && this.shareCard) this.openShare(this.share.whatsAppUrl(this.shareCard, l.url));
  }

  async copyLink(): Promise<void> {
    const l = this.ensureShare();
    if (l && (await this.share.copy(l.url))) this.flashCopied('link');
  }

  async copyChallenge(): Promise<void> {
    const l = this.ensureShare();
    if (l && this.shareCard && (await this.share.copy(this.share.challengeText(this.shareCard, l.url)))) {
      this.flashCopied('challenge');
    }
  }

  /** Render + download the scorecard PNG (client-side, no link needed). */
  downloading = signal(false);
  async downloadCard(): Promise<void> {
    if (this.downloading()) return;
    const card = this.shareCard ?? this.buildCard();
    if (!card) return;
    this.shareCard = card;
    this.downloading.set(true);
    try {
      await this.scorecard.download(card);
    } finally {
      this.downloading.set(false);
    }
  }

  private openShare(url: string): void {
    if (isPlatformBrowser(this.platformId)) window.open(url, '_blank', 'noopener,noreferrer');
  }

  private flashCopied(which: 'link' | 'challenge'): void {
    this.copied.set(which);
    this.shareParticles.set(this.makeShareParticles());
    this.burstKey.update(k => k + 1);
    setTimeout(() => this.copied.set(null), 2200);
  }

  private makeShareParticles(): { x: string; y: string; delay: string }[] {
    return Array.from({ length: 14 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 14 + (Math.random() - 0.5) * 0.5;
      const dist = 55 + Math.random() * 55;
      return {
        x: (Math.cos(angle) * dist).toFixed(0) + 'px',
        y: (Math.sin(angle) * dist).toFixed(0) + 'px',
        delay: (Math.random() * 80).toFixed(0) + 'ms',
      };
    });
  }

  /** Drop the previous round's share link so the next round mints a fresh one. */
  private resetShare(): void {
    this.shareLinks.set(null);
    this.shareCard = null;
    this.copied.set(null);
  }

  // ── Stage 5: results actions ───────────────────────────────
  expanded = signal<Set<number>>(new Set());

  toggleExpand(i: number): void {
    this.expanded.update(set => {
      const next = new Set(set);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  isExpanded(i: number): boolean {
    return this.expanded().has(i);
  }

  retrySameLevel(): void {
    const data = this.rawData();
    const level = this.selectedLevel();
    if (!data || !level) {
      this.restart();
      return;
    }
    // In focus mode, re-roll a fresh adaptive set instead of a fixed level.
    if (this.focusMode()) {
      this.launchFocusFromData(data, this.selectedArena()!.id);
      return;
    }
    this.questions.set(this.buildQuiz(data, level.key));
    this.answers.set(this.questions().map(() => ''));
    this.codes.set(this.questions().map(() => ''));
    this.editorOpen.set(new Set());
    this.results.set([]);
    this.expanded.set(new Set());
    this.currentIndex.set(0);
    this.tabLeaves.set(0);
    this.startedAt = this.now();
    this.resetHints();
    this.resetShare();
    this.resetFollowups();
    this.pickFollowupIndices();
    this.stage.set('quiz');
  }

  changeLevel(): void {
    this.results.set([]);
    this.expanded.set(new Set());
    this.focusMode.set(false);
    this.focusTargets.set([]);
    this.opponent.set(null); // different level → no longer the same challenge
    this.stage.set('pick-level');
  }

  restart(): void {
    this.selectedArena.set(null);
    this.selectedLevel.set(null);
    this.focusMode.set(false);
    this.focusTargets.set([]);
    this.focusModule = null;
    this.rawData.set(null);
    this.questions.set([]);
    this.answers.set([]);
    this.codes.set([]);
    this.editorOpen.set(new Set());
    this.results.set([]);
    this.expanded.set(new Set());
    this.currentIndex.set(0);
    this.resetHints();
    this.resetShare();
    this.resetFollowups();
    this.followupIndices.set(new Set());
    this.opponent.set(null);
    this.stage.set('pick-tech');
  }

  // ── Display helpers (used by template) ─────────────────────
  verdictStyle(v: EvalResult['verdict']): VerdictStyle {
    return this.verdictMap[v] ?? this.verdictMap.partial;
  }

  ringColor(score: number): string {
    return scoreColor(score);
  }

  /** stroke-dashoffset for a 0–10 score on an r=28 ring (circ ≈ 175.93). */
  ringOffset(score: number): number {
    const circ = 2 * Math.PI * 28;
    return circ - (Math.max(0, Math.min(10, score)) / 10) * circ;
  }

  readonly RING_CIRC = 2 * Math.PI * 28;

  // ── localStorage stats (SSR-safe) ──────────────────────────
  private loadBest(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const local = Number(localStorage.getItem(BEST_KEY) ?? '0');
    // Personal best must follow the account. testme_best_score is device-local and
    // isn't restored on sign-in, but the round history (cr:history) IS synced — so
    // derive the best from it too and keep the higher of the two.
    const fromHistory = this.progressService
      .getHistory()
      .reduce((m, r) => Math.max(m, r.score ?? 0), 0);
    const best = Math.max(Number.isNaN(local) ? 0 : local, fromHistory);
    this.bestScore.set(best);
    if (best > 0) localStorage.setItem(BEST_KEY, String(best));
  }

  private loadHistory(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    let local: Record<string, number[]> = {};
    try {
      local = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') || {};
    } catch {
      local = {}; // ignore corrupt history
    }
    // Rebuild per arena:level trends from synced rounds (oldest→newest) so a freshly
    // signed-in device shows the trend even without the device-local testme_history.
    const derived: Record<string, number[]> = {};
    for (const r of [...this.progressService.getHistory()].reverse()) {
      const key = `${r.arena}:${r.level}`;
      (derived[key] ??= []).push(r.score);
    }
    this.history.set({ ...derived, ...local });
  }

  totalTaken = signal(0);
  newBest = signal(false);

  private persistStats(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const score = this.overallScore();
    // capture "new best" BEFORE bumping the stored best, else it's always true
    this.newBest.set(score > 0 && score > this.bestScore());
    const best = Math.max(this.bestScore(), score);
    this.bestScore.set(best);
    localStorage.setItem(BEST_KEY, String(best));
    const taken = Number(localStorage.getItem(TAKEN_KEY) ?? '0') + 1;
    this.totalTaken.set(taken);
    localStorage.setItem(TAKEN_KEY, String(taken));

    // record this attempt under arena:level so the level screen can show a trend
    const arena = this.selectedArena();
    const level = this.selectedLevel();
    if (arena && level) {
      const key = `${arena.id}:${level.key}`;
      this.history.update(h => {
        const arr = [...(h[key] ?? []), score].slice(-HISTORY_MAX);
        const next = { ...h, [key]: arr };
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    }
  }

  isNewBest(): boolean {
    return this.newBest();
  }

  /**
   * Build a round record from the graded answers and hand it to ProgressService,
   * which updates the local cache (per-module stats + history) and fires a
   * non-blocking sync to Cloudflare KV. Drives the Dashboard.
   */
  private recordProgress(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const arena = this.selectedArena();
    const level = this.selectedLevel();
    const results = this.results();
    if (!arena || !level || !results.length) return;

    const round: RoundRecord = {
      id: 'r_' + Math.random().toString(36).slice(2, 10) + this.now().toString(36),
      date: new Date().toISOString(),
      arena: arena.id,
      level: level.key,
      levelName: level.label,
      score: this.overallScore(),
      time: this.elapsedSeconds,
      questions: this.questions().map((q, i) => ({
        module: q.module,
        question: q.question,
        score: results[i]?.score ?? 0,
      })),
    };
    this.progressService.recordRound(round);

    // Award XP for the effort (sum of per-answer scores) — may trigger a level-up.
    const xp = Math.round(results.reduce((s, r) => s + r.score, 0));
    this.xpEarned.set(xp);
    this.game.awardXp(xp);
  }

  /**
   * Reconcile question mastery with how the user actually performed this round:
   *  • score > 7  → master the question (proved it)
   *  • score < 5  → un-master it if it was mastered (it slipped — nudge them kindly)
   *  • 5–7        → unchanged
   * Counts feed the motivational results banner.
   */
  private syncMasteryFromResults(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const arena = this.selectedArena();
    const results = this.results();
    if (!arena || !results.length) return;

    let gained = 0;
    let lost = 0;
    this.questions().forEach((q, i) => {
      const score = results[i]?.score ?? 0;
      const qid = questionId(q.question);
      if (score > MASTER_ABOVE) {
        if (this.game.masterQuestion(arena.id, qid)) gained++;
      } else if (score < UNMASTER_BELOW) {
        if (this.game.unmasterQuestion(arena.id, qid)) lost++;
      }
    });
    this.masteryGained.set(gained);
    this.masteryLost.set(lost);
  }

  // ── time helpers ───────────────────────────────────────────
  private now(): number {
    return isPlatformBrowser(this.platformId) ? Date.now() : 0;
  }

  private formatElapsed(ms: number): string {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }


  // ── Leave-guard + anti-cheat ───────────────────────────────
  /** A round is "live" while answering or grading — leaving now loses work / invites cheating. */
  readonly quizInProgress = computed(() => this.stage() === 'quiz' || this.stage() === 'evaluating');

  /** Controls the animated "Leave the arena?" dialog (in-app navigation only). */
  showLeaveDialog = signal(false);
  private leaveResolver: ((proceed: boolean) => void) | null = null;

  /** How many times the user switched away from this tab mid-round (look-up attempts). */
  tabLeaves = signal(0);

  /**
   * Router CanDeactivate hook. While a round is live we suspend the navigation and
   * show our own animated dialog, resolving the returned promise with the choice.
   * (Refresh / tab-close can't use a custom dialog — see beforeUnloadHandler.)
   */
  canDeactivate(): boolean | Promise<boolean> {
    if (!this.quizInProgress() || !isPlatformBrowser(this.platformId)) return true;
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
  stayInQuiz(): void {
    this.showLeaveDialog.set(false);
    this.leaveResolver?.(false);
    this.leaveResolver = null;
  }

  /** Native browser warning for refresh / tab-close / external links — cannot be styled. */
  @HostListener('window:beforeunload', ['$event'])
  beforeUnloadHandler(event: BeforeUnloadEvent): void {
    if (this.quizInProgress() && isPlatformBrowser(this.platformId)) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  /** Anti-cheat: flag every time the tab is hidden (switching to another site/window) mid-round. */
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (this.quizInProgress() && isPlatformBrowser(this.platformId) && document.hidden) {
      this.tabLeaves.update(n => n + 1);
    }
  }

  /** Message to display when the user attempts to leave the page mid-round. */
  getTabLeaveMessage(count: number): string {
    const messages = [
      "👀 First tab switch already? The test just started...",
      "🤨 Came back quick... checking notes already?",
      "📚 3 times? That textbook must be getting attention.",
      "😏 We’re starting to feel ignored here.",
      "🚨 5 tab switches... confidence level dropping.",
      "🕵️ Interesting strategy... very interesting.",
      "💀 At this point, Google knows the answers better than you.",
      "📸 We’ve noticed a pattern developing here...",
      "🤖 The tab counter is working harder than you right now.",
      "☠️ Double digits soon? This is becoming a side quest."
    ];

    if (count <= messages.length) {
      return messages[count - 1];
    }

    return `🚔 You left ${count} times... honestly, just trust yourself at this point.`;
  }
}
