import { Component, computed, inject, signal, PLATFORM_ID, HostListener } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { SeoService } from '../../core/services/seo.service';
import { ProgressService, RoundRecord } from '../../core/services/progress.service';
import { GameService } from '../../core/services/game.service';
import { FocusRoundService } from '../../core/services/focus.service';
import { RefresherData, RefresherItem } from '../../core/models/refresher-item.model';
import { CodeEditorComponent, EditorLang } from '../../shared/components/code-editor/code-editor';
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
const BEST_KEY = 'testme_best_score';
const TAKEN_KEY = 'testme_total_taken';
const HISTORY_KEY = 'testme_history';
const HISTORY_MAX = 6;

@Component({
  selector: 'app-test-me',
  imports: [RouterLink, CodeEditorComponent],
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

  /** XP earned on the round just finished (shown on the results screen). */
  xpEarned = signal(0);

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

  private rawData = signal<RefresherData | null>(null);

  questions = signal<QuizQuestion[]>([]);
  answers = signal<string[]>([]);
  /** Optional per-question code snippet, folded into the answer sent to the AI. */
  codes = signal<string[]>([]);
  /** Question indices where the user explicitly opened the code editor. */
  editorOpen = signal<Set<number>>(new Set());
  currentIndex = signal(0);

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
    if (focus) this.startFocus(focus.arena, focus.module);
  }

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
    this.editorOpen.update(set => {
      const next = new Set(set);
      if (next.has(idx) && this.currentCode().trim().length === 0) {
        next.delete(idx); // only collapse when there's no code to lose
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  goTo(index: number): void {
    if (index < 0 || index >= this.total()) return;
    this.currentIndex.set(index);
  }

  next(): void {
    if (!this.isLast()) this.currentIndex.update(i => i + 1);
  }

  prev(): void {
    if (this.currentIndex() > 0) this.currentIndex.update(i => i - 1);
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
      if (!code) return answer;
      const block = '```' + lang + '\n' + code + '\n```';
      return answer ? `${answer}\n\n${block}` : block;
    });
  }

  // ── Stage 4: evaluate ──────────────────────────────────────
  submitQuiz(): void {
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
    this.stage.set('quiz');
  }

  changeLevel(): void {
    this.results.set([]);
    this.expanded.set(new Set());
    this.focusMode.set(false);
    this.focusTargets.set([]);
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
    const v = Number(localStorage.getItem(BEST_KEY) ?? '0');
    if (!Number.isNaN(v)) this.bestScore.set(v);
  }

  private loadHistory(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) this.history.set(JSON.parse(raw));
    } catch {
      /* ignore corrupt history */
    }
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
