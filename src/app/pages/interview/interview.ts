import { Component, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { DataService } from '../../core/services/data.service';
import { SeoService } from '../../core/services/seo.service';
import { GameService } from '../../core/services/game.service';
import { MemeService, MemeResult } from '../../core/services/meme.service';
import { ProgressService, RoundRecord } from '../../core/services/progress.service';
import { RefresherData } from '../../core/models/refresher-item.model';
import { CodeEditorComponent, EditorLang } from '../../shared/components/code-editor/code-editor';
import { InterviewService, GradeItem, GradeInput, GenQuestion, QuestionKind } from '../../services/interview-service/interview.service';

type Stage = 'ready' | 'pick' | 'rate' | 'loading' | 'quiz' | 'grading' | 'results';

interface Tech {
  id: string;
  name: string;
  icon: string;
  accent: string;
  blurb: string;
}

interface Preset {
  label: string;
  hint: string;
  techs: string[];
}

/** One question in the running interview, tagged with its stack. */
interface IvQuestion {
  stackId: string;
  stackName: string;
  stackIcon: string;
  module: string;
  question: string;
  expected: string;
  kind: QuestionKind;
}

/** Nice label per question kind, shown as a chip in the quiz. */
const KIND_LABEL: Record<QuestionKind, string> = {
  theory: '💭 Theory',
  query: '🗄️ Write a query',
  code: '⌨️ Write code',
  scenario: '🧩 Scenario',
};

const TECHS: Tech[] = [
  { id: 'angular', name: 'Angular', icon: '⚡',  accent: '#ff4857', blurb: 'Signals, DI, RxJS' },
  { id: 'dotnet',  name: '.NET',    icon: '🔷',  accent: '#9333ea', blurb: 'Async, LINQ, EF Core' },
  { id: 'sql',     name: 'SQL',     icon: '🗄️', accent: '#0ea5e9', blurb: 'JOINs, indexing, tuning' },
  { id: 'react',   name: 'React',   icon: '⚛️', accent: '#61dafb', blurb: 'Hooks, context, perf' },
  { id: 'nextjs',  name: 'Next.js', icon: '🔼',  accent: '#6b7280', blurb: 'App Router, RSC' },
  { id: 'nestjs',  name: 'NestJS',  icon: '🐱',  accent: '#e0234e', blurb: 'Modules, DI, guards' },
];

const PRESETS: Preset[] = [
  { label: 'Frontend',        hint: 'Angular',               techs: ['angular'] },
  { label: 'Full-Stack',      hint: 'Angular + .NET',        techs: ['angular', 'dotnet'] },
  { label: 'Backend + DB',    hint: '.NET + SQL',            techs: ['dotnet', 'sql'] },
  { label: 'The Full Gauntlet', hint: 'Angular + .NET + SQL', techs: ['angular', 'dotnet', 'sql'] },
];

const LEVEL_ORDER = ['0-1', '1-2', '2-3', '4+'];
const LEVEL_NAME: Record<string, string> = { '0-1': 'Rookie', '1-2': 'Builder', '2-3': 'Senior', '4+': 'Architect' };
const PER_STACK = 5;      // questions per selected stack (2 stacks → 10, 3 → 15)
const MAX_STACKS = 3;
const PASS_MARK = 6;      // overall score (0-10) at or above this = "passed"

@Component({
  selector: 'app-interview',
  imports: [RouterLink, FormsModule, CodeEditorComponent],
  templateUrl: './interview.html',
  styleUrl: './interview.css',
})
export class InterviewComponent {
  private platformId = inject(PLATFORM_ID);
  private dataService = inject(DataService);
  private interview = inject(InterviewService);
  private memeSvc = inject(MemeService);
  private progress = inject(ProgressService);
  readonly game = inject(GameService);

  readonly techs = TECHS;
  readonly presets = PRESETS;
  readonly PASS_MARK = PASS_MARK;
  readonly MAX_STACKS = MAX_STACKS;
  readonly PER_STACK = PER_STACK;

  // ── State machine ───────────────────────────────────────────
  stage = signal<Stage>('ready');
  loadError = signal(false);

  /** Selected stacks (ordered), and a self-rating per stack id. */
  selectedStacks = signal<Tech[]>([]);
  ratings = signal<Record<string, number>>({});

  /** Per-stack resolved bank level (set during build) — for dashboard records. */
  private stackLevel: Record<string, string> = {};

  questions = signal<IvQuestion[]>([]);
  answers = signal<string[]>([]);
  codes = signal<string[]>([]);            // per-question code snippet (editor)
  editorOpen = signal<Set<number>>(new Set()); // theory/scenario Qs where user opened the editor
  currentIndex = signal(0);
  private startedAt = 0;

  readonly KIND_LABEL = KIND_LABEL;

  results = signal<GradeItem[]>([]);
  meme = signal<MemeResult | null>(null);
  memeFailed = signal(false);
  xpEarned = signal(0);

  constructor() {
    inject(SeoService).update({
      title: 'AI Mock Interview — Rate Yourself, Get Grilled',
      description:
        'The most fun mock interview you\'ll ever take. Combine stacks, rate your confidence, answer fresh AI-generated questions, earn XP, and get a meme verdict.',
      keywords: 'mock interview, ai interview practice, full stack interview, coding interview game',
    });
  }

  // ── Rating display helpers (take a value → pure) ────────────
  labelFor(r: number): string {
    if (r <= 2) return 'Rookie';
    if (r <= 4) return 'Junior';
    if (r <= 6) return 'Mid-level';
    if (r <= 8) return 'Senior';
    return 'Expert';
  }
  colorFor(r: number): string {
    if (r <= 2) return '#34d399';
    if (r <= 4) return '#60a5fa';
    if (r <= 6) return '#a78bfa';
    if (r <= 8) return '#fb923c';
    return '#f87171';
  }

  // ── Stack selection ─────────────────────────────────────────
  isSelected(id: string): boolean {
    return this.selectedStacks().some(t => t.id === id);
  }
  readonly selectedCount = computed(() => this.selectedStacks().length);
  readonly totalQuestions = computed(() => this.selectedCount() * PER_STACK);
  readonly atMax = computed(() => this.selectedCount() >= MAX_STACKS);

  toggleTech(tech: Tech): void {
    this.selectedStacks.update(list => {
      const exists = list.some(t => t.id === tech.id);
      if (exists) return list.filter(t => t.id !== tech.id);
      if (list.length >= MAX_STACKS) return list; // cap
      return [...list, tech];
    });
  }

  applyPreset(p: Preset): void {
    const picked = p.techs
      .map(id => TECHS.find(t => t.id === id))
      .filter((t): t is Tech => !!t)
      .slice(0, MAX_STACKS);
    this.selectedStacks.set(picked);
  }

  goToRate(): void {
    if (!this.selectedCount()) return;
    // Seed a default rating for any newly-selected stack.
    this.ratings.update(r => {
      const next = { ...r };
      for (const t of this.selectedStacks()) if (next[t.id] == null) next[t.id] = 5;
      return next;
    });
    this.stage.set('rate');
  }

  setRating(id: string, value: number): void {
    this.ratings.update(r => ({ ...r, [id]: value }));
  }

  ratingFor(id: string): number {
    return this.ratings()[id] ?? 5;
  }

  // ── Derived quiz state ──────────────────────────────────────
  readonly current = computed<IvQuestion | null>(() => this.questions()[this.currentIndex()] ?? null);
  readonly total = computed(() => this.questions().length);
  readonly progressPct = computed(() => {
    const t = this.total();
    return t ? Math.round(((this.currentIndex() + 1) / t) * 100) : 0;
  });
  readonly isLast = computed(() => this.currentIndex() === this.total() - 1);
  readonly currentAnswer = computed(() => this.answers()[this.currentIndex()] ?? '');
  readonly currentCode = computed(() => this.codes()[this.currentIndex()] ?? '');
  /** A question counts as answered if it has prose OR a code snippet. */
  readonly answeredCount = computed(() =>
    this.questions().reduce((n, _q, i) =>
      n + (((this.answers()[i] ?? '').trim() || (this.codes()[i] ?? '').trim()) ? 1 : 0), 0));

  // ── Code editor (IntelliSense via CodeMirror) ───────────────
  /** Code/query questions get the editor by default; theory/scenario can opt in. */
  readonly wantsCode = computed(() => {
    const k = this.current()?.kind;
    return k === 'code' || k === 'query';
  });
  readonly editorVisible = computed(() =>
    this.wantsCode() || this.editorOpen().has(this.currentIndex()) || this.currentCode().trim().length > 0);
  /** Editor syntax follows the current question's stack. */
  readonly currentLang = computed<EditorLang>(() => this.langFor(this.current()?.stackId));
  readonly currentLangLabel = computed(() => {
    switch (this.currentLang()) {
      case 'sql': return 'SQL';
      case 'csharp': return 'C#';
      default: return 'TypeScript';
    }
  });

  private langFor(stackId?: string): EditorLang {
    if (stackId === 'sql') return 'sql';
    if (stackId === 'dotnet') return 'csharp';
    return 'typescript';
  }

  toggleEditor(): void {
    const i = this.currentIndex();
    this.editorOpen.update(set => {
      const next = new Set(set);
      if (next.has(i) || this.currentCode().trim().length) next.delete(i);
      else next.add(i);
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

  // ── Results derived ─────────────────────────────────────────
  readonly overall = computed(() => {
    const r = this.results();
    if (!r.length) return 0;
    return Math.round((r.reduce((s, x) => s + x.score, 0) / r.length) * 10) / 10;
  });
  readonly passed = computed(() => this.overall() >= PASS_MARK);

  // ── Flow ────────────────────────────────────────────────────
  begin(): void {
    this.stage.set('pick');
  }

  backToPick(): void {
    this.stage.set('pick');
  }

  /**
   * Build the round: for each stack, load its bank (for topics + fallback), resolve
   * a level from that stack's self-rating, then generate FRESH questions via AI —
   * falling back to the static bank if generation is empty/unavailable.
   */
  startInterview(): void {
    const stacks = this.selectedStacks();
    if (!stacks.length) return;
    this.loadError.set(false);
    this.stage.set('loading');

    forkJoin(
      stacks.map(t => this.dataService.loadData(t.id).pipe(catchError(() => of(null))))
    ).subscribe(datas => {
      // Plan each stack: level + topic list from the bank.
      const plans = stacks.map((tech, i) => {
        const data = datas[i];
        const rating = this.ratingFor(tech.id);
        const level = data ? this.resolveLevel(data, this.desiredIdx(rating)) : '1-2';
        this.stackLevel[tech.id] = level;
        const topics = data ? this.moduleNames(data, level) : [];
        return { tech, data, level, topics };
      });

      // Generate per stack (AI) with bank fallback.
      forkJoin(
        plans.map(pl =>
          this.interview.generateQuestions(pl.tech.id, pl.level, PER_STACK, pl.topics).pipe(
            map(gen => this.toIvQuestions(pl.tech, gen.length ? gen : this.bankQuestions(pl.data, pl.level, pl.tech.id))),
            catchError(() => of(this.toIvQuestions(pl.tech, this.bankQuestions(pl.data, pl.level, pl.tech.id)))),
          )
        )
      ).subscribe(perStack => {
        const all = perStack.flat();
        if (!all.length) {
          this.loadError.set(true);
          return;
        }
        this.questions.set(all);
        this.answers.set(all.map(() => ''));
        this.codes.set(all.map(() => ''));
        this.editorOpen.set(new Set());
        this.currentIndex.set(0);
        this.results.set([]);
        this.startedAt = this.now();
        this.stage.set('quiz');
      });
    });
  }

  /** Self-rating (1-10) → index into LEVEL_ORDER. */
  private desiredIdx(rating: number): number {
    return rating <= 3 ? 0 : rating <= 5 ? 1 : rating <= 7 ? 2 : 3;
  }

  private toIvQuestions(tech: Tech, gen: GenQuestion[]): IvQuestion[] {
    return gen.slice(0, PER_STACK).map(g => ({
      stackId: tech.id,
      stackName: tech.name,
      stackIcon: tech.icon,
      module: g.topic || tech.name,
      question: g.question,
      expected: g.expected,
      kind: g.kind ?? 'theory',
    }));
  }

  /** Nearest available level to the desired index (search outward). */
  private resolveLevel(data: RefresherData, desiredIdx: number): string {
    const has = (i: number) => {
      const key = LEVEL_ORDER[i];
      const cat = data.categories[key];
      return !!cat && Object.values(cat.modules).some(m => m.questions.length > 0);
    };
    if (has(desiredIdx)) return LEVEL_ORDER[desiredIdx];
    for (let d = 1; d < LEVEL_ORDER.length; d++) {
      if (desiredIdx - d >= 0 && has(desiredIdx - d)) return LEVEL_ORDER[desiredIdx - d];
      if (desiredIdx + d < LEVEL_ORDER.length && has(desiredIdx + d)) return LEVEL_ORDER[desiredIdx + d];
    }
    return Object.keys(data.categories)[0] ?? LEVEL_ORDER[0];
  }

  private moduleNames(data: RefresherData, level: string): string[] {
    const cat = data.categories[level];
    return cat ? Object.keys(cat.modules) : [];
  }

  /** Random questions from the static bank at the given level → GenQuestion shape. */
  private bankQuestions(data: RefresherData | null, level: string, techId: string): GenQuestion[] {
    if (!data) return [];
    const cat = data.categories[level];
    if (!cat) return [];
    const pool: GenQuestion[] = [];
    for (const [name, mod] of Object.entries(cat.modules)) {
      for (const q of mod.questions) {
        const kind: QuestionKind = q.codeExample ? (techId === 'sql' ? 'query' : 'code') : 'theory';
        pool.push({ question: q.question, expected: q.answer ?? '', topic: name, kind });
      }
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, PER_STACK);
  }

  updateAnswer(value: string): void {
    this.answers.update(arr => {
      const next = [...arr];
      next[this.currentIndex()] = value;
      return next;
    });
  }

  /** Prose + fenced code snippet, so the AI grades both together. */
  private combinedAnswer(i: number): string {
    const text = (this.answers()[i] ?? '').trim();
    const code = (this.codes()[i] ?? '').trim();
    if (!code) return text;
    const lang = this.langFor(this.questions()[i]?.stackId);
    const block = '```' + lang + '\n' + code + '\n```';
    return text ? `${text}\n\n${block}` : block;
  }

  next(): void { if (!this.isLast()) this.currentIndex.update(i => i + 1); }
  prev(): void { if (this.currentIndex() > 0) this.currentIndex.update(i => i - 1); }
  goTo(i: number): void { if (i >= 0 && i < this.total()) this.currentIndex.set(i); }

  // ── Grade — one batched call PER STACK (each ≤ 5 items) ─────
  submit(): void {
    this.stage.set('grading');
    const qs = this.questions();
    const ans = this.answers();

    const stackIds = [...new Set(qs.map(q => q.stackId))];
    const calls = stackIds.map(sid => {
      const picked = qs
        .map((q, i) => ({ q, i }))
        .filter(x => x.q.stackId === sid && this.combinedAnswer(x.i).length > 0);
      if (!picked.length) return of({ idxs: [] as number[], results: [] as GradeItem[] });
      const payload: GradeInput[] = picked.map(x => ({
        question: x.q.question, expected: x.q.expected, answer: this.combinedAnswer(x.i),
      }));
      return this.interview.gradeBatch(sid, payload).pipe(
        map(results => ({ idxs: picked.map(x => x.i), results })),
        catchError(() => of({
          idxs: picked.map(x => x.i),
          results: picked.map(() => ({ score: 0, verdict: 'needs_work' as const, note: 'Grading failed — try again.' })),
        })),
      );
    });

    forkJoin(calls).subscribe(groups => {
      const full: GradeItem[] = qs.map(() => ({
        score: 0,
        verdict: 'missed' as const,
        note: 'No answer submitted — this one costs you.',
      }));
      for (const g of groups) g.results.forEach((r, k) => { full[g.idxs[k]] = r; });
      this.results.set(full);
      this.finalize();
    });
  }

  /** Award XP, record per-stack rounds to the dashboard, mint the meme, reveal. */
  private finalize(): void {
    const xp = Math.round(this.results().reduce((s, r) => s + r.score, 0));
    this.xpEarned.set(xp);
    if (xp > 0) this.game.awardXp(xp);

    this.recordRounds();

    this.memeFailed.set(false);
    this.meme.set(this.memeSvc.forScore(this.overall()));

    const reveal = () => this.stage.set('results');
    if (isPlatformBrowser(this.platformId)) setTimeout(reveal, 900);
    else reveal();
  }

  /** One RoundRecord per stack → feeds the dashboard's per-arena stats + history. */
  private recordRounds(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const qs = this.questions();
    const res = this.results();
    const time = Math.max(0, Math.round((this.now() - this.startedAt) / 1000));
    const stackIds = [...new Set(qs.map(q => q.stackId))];

    for (const sid of stackIds) {
      const idxs = qs.map((q, i) => ({ q, i })).filter(x => x.q.stackId === sid);
      if (!idxs.length) continue;
      const scores = idxs.map(x => res[x.i]?.score ?? 0);
      const avg = Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10;
      const level = this.stackLevel[sid] ?? '1-2';
      const round: RoundRecord = {
        id: 'iv_' + Math.random().toString(36).slice(2, 10) + this.now().toString(36),
        date: new Date().toISOString(),
        arena: sid,
        level,
        levelName: `Interview · ${LEVEL_NAME[level] ?? level}`,
        score: avg,
        time: Math.round(time / stackIds.length),
        questions: idxs.map(x => ({
          module: x.q.module,
          question: x.q.question,
          score: res[x.i]?.score ?? 0,
        })),
      };
      this.progress.recordRound(round);
    }
  }

  onMemeError(): void { this.memeFailed.set(true); }

  // ── Restart / replay ────────────────────────────────────────
  playAgain(): void {
    // Same stacks + ratings, fresh questions.
    this.startInterview();
  }

  restart(): void {
    this.selectedStacks.set([]);
    this.ratings.set({});
    this.stackLevel = {};
    this.questions.set([]);
    this.answers.set([]);
    this.codes.set([]);
    this.editorOpen.set(new Set());
    this.results.set([]);
    this.meme.set(null);
    this.currentIndex.set(0);
    this.stage.set('ready');
  }

  // ── Display helpers ─────────────────────────────────────────
  ringColor(score: number): string {
    if (score >= 9) return '#34d399';
    if (score >= 7) return '#60a5fa';
    if (score >= 5) return '#fbbf24';
    if (score >= 3) return '#fb923c';
    return '#f87171';
  }

  readonly RING_CIRC = 2 * Math.PI * 52;
  ringOffset(score: number): number {
    return this.RING_CIRC - (Math.max(0, Math.min(10, score)) / 10) * this.RING_CIRC;
  }

  private now(): number {
    return isPlatformBrowser(this.platformId) ? Date.now() : 0;
  }
}
