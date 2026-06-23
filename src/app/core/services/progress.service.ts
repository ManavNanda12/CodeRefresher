import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { UserService, WORKER_BASE } from './user.service';

export const ARENA_IDS = ['angular', 'dotnet', 'sql'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];

/** One graded question inside a finished round. */
export interface QuestionResult {
  module: string;
  question: string;
  score: number;
}

/** A completed Test Me round (regular or focus). */
export interface RoundRecord {
  id: string;
  date: string; // ISO
  arena: string;
  level: string;
  levelName: string;
  score: number;
  time: number; // seconds
  questions: QuestionResult[];
}

export interface ModuleStat {
  tested: number;
  scores: number[];
  avg: number | null;
}

export interface ArenaProgress {
  overall: { rounds: number; avgScore: number; totalQsTested: number };
  modules: Record<string, ModuleStat>;
}

const PROGRESS_KEY = (arena: string) => `cr:progress:${arena}`;
const HISTORY_KEY = 'cr:history';
const HISTORY_MAX = 30;
const SCORES_MAX = 20; // cap per-module score history so KV/localStorage stay small

/**
 * Offline-first progress store. Writes land in localStorage instantly (the dashboard
 * renders from it), then fire-and-forget to Cloudflare KV which is the source of truth
 * for cross-device. On dashboard load we pull KV and reconcile back into localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ProgressService {
  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpClient);
  private user = inject(UserService);

  /** Bumped whenever local progress changes, so views can recompute. */
  readonly revision = signal(0);

  // ── reads ──────────────────────────────────────────────────
  getArenaProgress(arena: string): ArenaProgress | null {
    return this.readJson<ArenaProgress>(PROGRESS_KEY(arena));
  }

  getHistory(): RoundRecord[] {
    return this.readJson<RoundRecord[]>(HISTORY_KEY) ?? [];
  }

  // ── record a finished round ────────────────────────────────
  /** Update the local caches for a round, then sync to KV in the background. */
  recordRound(round: RoundRecord): void {
    if (isPlatformBrowser(this.platformId)) {
      this.applyRoundToArena(round);
      this.prependHistory(round);
      this.revision.update(v => v + 1);
    }
    this.syncRound(round);
  }

  private applyRoundToArena(round: RoundRecord): void {
    const current = this.getArenaProgress(round.arena) ?? {
      overall: { rounds: 0, avgScore: 0, totalQsTested: 0 },
      modules: {},
    };

    for (const q of round.questions) {
      const mod = current.modules[q.module] ?? { tested: 0, scores: [], avg: null };
      mod.scores = [...mod.scores, q.score].slice(-SCORES_MAX);
      mod.tested += 1;
      mod.avg = round2(mod.scores.reduce((s, x) => s + x, 0) / mod.scores.length);
      current.modules[q.module] = mod;
    }

    const rounds = current.overall.rounds + 1;
    current.overall = {
      rounds,
      avgScore: round2((current.overall.avgScore * current.overall.rounds + round.score) / rounds),
      totalQsTested: current.overall.totalQsTested + round.questions.length,
    };

    this.writeJson(PROGRESS_KEY(round.arena), current);
  }

  private prependHistory(round: RoundRecord): void {
    const history = [round, ...this.getHistory()].slice(0, HISTORY_MAX);
    this.writeJson(HISTORY_KEY, history);
  }

  // ── KV sync ────────────────────────────────────────────────
  private syncRound(round: RoundRecord): void {
    const userId = this.user.userId();
    if (!userId) return; // not onboarded yet — local-only
    // Send the email too: if register ever failed, the worker fills the gap so the
    // user stays reachable. The worker only sets it when the record's email is empty.
    this.http
      .post(`${WORKER_BASE}/api/progress/sync`, { userId, email: this.user.email(), round }, { headers: this.user.authHeader() })
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  /**
   * Pull the full dashboard payload from KV and reconcile it into localStorage so
   * subsequent renders are instant. Returns null when offline / not onboarded.
   */
  loadDashboard(): Observable<DashboardPayload | null> {
    const userId = this.user.userId();
    if (!userId) return of(null);
    return this.http
      .get<DashboardPayload>(`${WORKER_BASE}/api/progress/dashboard?userId=${encodeURIComponent(userId)}`, { headers: this.user.authHeader() })
      .pipe(
        tap(payload => this.mergeFromKv(payload)),
        catchError(() => of(null)),
      );
  }

  /**
   * Write a KV dashboard payload back into the local caches. Guarded: KV is eventually
   * consistent, so a momentarily-empty/stale response must NOT wipe good local data. We only
   * accept an arena (or the history) when KV is at least as complete as what we hold locally.
   */
  mergeFromKv(payload: DashboardPayload | null): void {
    if (!payload || !isPlatformBrowser(this.platformId)) return;
    if (payload.arenas) {
      for (const [arena, prog] of Object.entries(payload.arenas)) {
        const incomingRounds = prog?.overall?.rounds ?? 0;
        const localRounds = this.getArenaProgress(arena)?.overall.rounds ?? 0;
        // Keep local if KV looks emptier/staler for this arena (e.g. a sync race wiped it).
        if (incomingRounds >= localRounds) this.writeJson(PROGRESS_KEY(arena), prog);
      }
    }
    if (Array.isArray(payload.recentRounds)) {
      const localCount = this.getHistory().length;
      if (payload.recentRounds.length >= localCount) {
        this.writeJson(HISTORY_KEY, payload.recentRounds.slice(0, HISTORY_MAX));
      }
    }
    this.revision.update(v => v + 1);
  }

  /** Wipe all cached progress + history from localStorage (used by "delete my data"). */
  clearLocal(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    for (const id of ARENA_IDS) localStorage.removeItem(PROGRESS_KEY(id));
    localStorage.removeItem(HISTORY_KEY);
    this.revision.update(v => v + 1);
  }

  // ── localStorage plumbing ──────────────────────────────────
  private readJson<T>(key: string): T | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private writeJson(key: string, value: unknown): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota / disabled storage — ignore, KV still has it */
    }
  }
}

/** Shape returned by GET /api/progress/dashboard. */
export interface DashboardPayload {
  email?: string;
  lastActive?: string;
  arenas: Record<string, ArenaProgress>;
  recentRounds: RoundRecord[];
}

function round2(n: number): number {
  return Math.round(n * 10) / 10;
}
