import { Injectable, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { UserService, WORKER_BASE } from './user.service';

/**
 * The "arena" game engine — XP, levels, daily streak, question mastery and
 * achievements. Pure client-side (localStorage), SSR-safe, signal-driven so any
 * component (header HUD, challenge cards, dashboards) reacts instantly.
 *
 * XP curve: level L starts at 50·(L-1)² XP → 0 / 50 / 200 / 450 / 800 …
 */
export interface Achievement {
  id: string;
  icon: string;
  title: string;
  desc: string;
}

export interface LevelUpData {
  from: number;
  to: number;
  rankTitle?: string;       // "Platinum II"
  rankSub?: string;         // "New rank unlocked"
  xpLabel?: string;         // "12,400 / 14,000" — overrides xpCurrent/xpMax
  xpCurrent?: number;
  xpMax?: number;
  xpPct?: number;           // 0–100, drives the bar fill width
  rewards?: { label: string; value: string }[];
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_blood', icon: '🎯', title: 'First Blood', desc: 'Master your first question' },
  { id: 'ten', icon: '⚔️', title: 'Sharpening Up', desc: 'Master 10 questions' },
  { id: 'fifty', icon: '🏆', title: 'Arena Veteran', desc: 'Master 50 questions' },
  { id: 'streak_3', icon: '🔥', title: 'On Fire', desc: 'Keep a 3-day streak' },
  { id: 'streak_7', icon: '🌟', title: 'Unstoppable', desc: 'Keep a 7-day streak' },
  { id: 'level_5', icon: '💎', title: 'Rising Star', desc: 'Reach level 5' },
];

interface GameState {
  xp: number;
  mastered: Record<string, boolean>;        // composite key `${arena}:${qid}` → true
  streak: { count: number; lastActive: string }; // lastActive = YYYY-MM-DD
  achievements: string[];                    // unlocked ids
}

const KEY = 'cr:game';

function emptyState(): GameState {
  return { xp: 0, mastered: {}, streak: { count: 0, lastActive: '' }, achievements: [] };
}

/** Stable short id for a question from its text (data files have no ids). */
export function questionId(question: string): string {
  let h = 0;
  for (let i = 0; i < question.length; i++) h = (h * 31 + question.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

@Injectable({ providedIn: 'root' })
export class GameService {
  private platformId = inject(PLATFORM_ID);
  private user = inject(UserService);

  private state = signal<GameState>(emptyState());

  /** Most-recently unlocked achievement (for a toast); cleared after display. */
  readonly justUnlocked = signal<Achievement | null>(null);
  /** Fires when the user's level increases — drives the level-up crate overlay. */
  readonly justLeveledUp = signal<LevelUpData | null>(null);
  /** Fires when a question is freshly mastered — lets pages detect module completion. */
  readonly justMastered = signal<{ arena: string; qid: string } | null>(null);

  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  // ── derived ────────────────────────────────────────────────
  readonly xp = computed(() => this.state().xp);
  readonly level = computed(() => Math.floor(Math.sqrt(this.state().xp / 50)) + 1);
  readonly streak = computed(() => this.state().streak.count);
  readonly masteredTotal = computed(() => Object.values(this.state().mastered).filter(Boolean).length);
  readonly unlocked = computed(() => this.state().achievements);

  /** Progress through the current level, 0..1, for the XP bar. */
  readonly levelProgress = computed(() => {
    const xp = this.state().xp;
    const L = this.level();
    const start = 50 * (L - 1) ** 2;
    const end = 50 * L ** 2;
    return Math.max(0, Math.min(1, (xp - start) / (end - start)));
  });

  readonly xpIntoLevel = computed(() => this.state().xp - 50 * (this.level() - 1) ** 2);
  readonly xpForLevel = computed(() => 50 * this.level() ** 2 - 50 * (this.level() - 1) ** 2);

  constructor() {
    this.hydrate();
    if (isPlatformBrowser(this.platformId)) {
      this.loadFromKv();
      // Make sure pending XP reaches KV before the tab is backgrounded/closed.
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.flush();
      });
    }
  }

  // ── mastery ────────────────────────────────────────────────
  isMastered(arena: string, qid: string): boolean {
    return !!this.state().mastered[`${arena}:${qid}`];
  }

  /** How many of the given question ids are mastered (for module rings). */
  masteredIn(arena: string, qids: string[]): number {
    const m = this.state().mastered;
    return qids.reduce((n, id) => n + (m[`${arena}:${id}`] ? 1 : 0), 0);
  }

  toggleMastered(arena: string, qid: string, xpReward: number): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const key = `${arena}:${qid}`;
    const next = { ...this.state() };
    next.mastered = { ...next.mastered };
    if (next.mastered[key]) {
      delete next.mastered[key];
      next.xp = Math.max(0, next.xp - xpReward);
      this.commit(this.withStreak(next));
    } else {
      next.mastered[key] = true;
      next.xp += xpReward;
      this.commit(this.withStreak(next));
      this.justMastered.set({ arena, qid });
    }
    this.checkAchievements();
  }

  /** Award XP from elsewhere (e.g. a finished Test Me round). */
  awardXp(amount: number): void {
    if (!isPlatformBrowser(this.platformId) || amount <= 0) return;
    const next = this.withStreak({ ...this.state(), xp: this.state().xp + amount });
    this.commit(next);
    this.checkAchievements();
  }

  /** Spend XP (e.g. a paid Test Me hint). Floored at 0 — never goes negative. */
  spendXp(amount: number): void {
    if (!isPlatformBrowser(this.platformId) || amount <= 0) return;
    const next = { ...this.state(), xp: Math.max(0, this.state().xp - amount) };
    this.commit(next);
  }

  /** Call on any meaningful visit to keep the daily streak alive. */
  ping(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // Already counted today → nothing changed, so don't persist or sync (saves KV writes).
    if (this.state().streak.lastActive === this.today()) return;
    this.commit(this.withStreak({ ...this.state() }));
    this.checkAchievements();
  }

  dismissUnlock(): void {
    this.justUnlocked.set(null);
  }

  dismissLevelUp(): void {
    this.justLeveledUp.set(null);
  }

  /** Preview the level-up overlay on demand (QA/testing — earns no XP). */
  previewLevelUp(): void {
    const from = this.level();
    const to = from + 1;
    // mirror commit(): bar fills to 100% to celebrate the level just cleared
    const span = 50 * from ** 2 - 50 * (from - 1) ** 2;
    this.justLeveledUp.set({
      from,
      to,
      rankTitle: this.rankTitle(to),
      rankSub: 'New rank unlocked',
      xpLabel: `${span.toLocaleString()} / ${span.toLocaleString()}`,
      xpCurrent: span,
      xpMax: span,
      xpPct: 100,
      rewards: [
        { label: 'Bonus XP', value: `+${to * 25}` },
        { label: 'Streak', value: `×${Math.max(1, this.streak())}` },
      ],
    });
  }

  // ── internals ──────────────────────────────────────────────
  private withStreak(s: GameState): GameState {
    const today = this.today();
    if (s.streak.lastActive === today) return s;
    const yesterday = this.daysAgo(1);
    const count = s.streak.lastActive === yesterday ? s.streak.count + 1 : 1;
    return { ...s, streak: { count, lastActive: today } };
  }

  private checkAchievements(): void {
    const s = this.state();
    const have = new Set(s.achievements);
    const add: string[] = [];
    const mastered = Object.values(s.mastered).filter(Boolean).length;
    const level = Math.floor(Math.sqrt(s.xp / 50)) + 1;

    const unlock = (id: string, cond: boolean) => {
      if (cond && !have.has(id)) add.push(id);
    };
    unlock('first_blood', mastered >= 1);
    unlock('ten', mastered >= 10);
    unlock('fifty', mastered >= 50);
    unlock('streak_3', s.streak.count >= 3);
    unlock('streak_7', s.streak.count >= 7);
    unlock('level_5', level >= 5);

    if (add.length) {
      this.commit({ ...s, achievements: [...s.achievements, ...add] });
      const first = ACHIEVEMENTS.find(a => a.id === add[0]);
      if (first) this.justUnlocked.set(first);
    }
  }

  /** A user-driven change: persist, watch for a level-up, and queue a KV push. */
  private commit(s: GameState): void {
    const prevLevel = this.level();
    this.state.set(s);
    this.persistLocal(s);
    this.scheduleSync();

    const newLevel = this.level();
    if (newLevel > prevLevel) {
      // Celebrate COMPLETING the level just cleared: the bar sweeps to 100%.
      // (The tiny remainder into the new level reads as a broken/empty bar.)
      const cleared = newLevel - 1;
      const span = 50 * cleared ** 2 - 50 * (cleared - 1) ** 2;

      this.justLeveledUp.set({
        from: prevLevel,
        to: newLevel,
        rankTitle: this.rankTitle(newLevel),
        rankSub: 'New rank unlocked',
        xpLabel: `${span.toLocaleString()} / ${span.toLocaleString()}`,
        xpCurrent: span,
        xpMax: span,
        xpPct: 100,
        rewards: [
          { label: 'Bonus XP', value: `+${newLevel * 25}` },
          { label: 'Streak', value: `×${Math.max(1, s.streak.count)}` },
        ],
      });
    }
  }

  /** Wipe cached game state (used on sign-in/recover so the next identity starts clean). */
  clearLocal(): void {
    if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = null; }
    this.state.set(emptyState());
    if (isPlatformBrowser(this.platformId)) {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    }
  }

  /** Re-pull game state from KV for the current identity (after recover/adopt). */
  reload(): void {
    if (isPlatformBrowser(this.platformId)) this.loadFromKv();
  }

  private persistLocal(s: GameState): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage disabled — keep in-memory */
    }
  }

  private hydrate(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.state.set({ ...emptyState(), ...JSON.parse(raw) });
    } catch {
      /* ignore corrupt state */
    }
  }

  // ── KV sync (batched — KV free tier allows only ~1k writes/day) ──────
  private scheduleSync(): void {
    if (!isPlatformBrowser(this.platformId) || !this.user.userId()) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.pushToKv(false), 6000);
  }

  private flush(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.pushToKv(true);
  }

  private pushToKv(keepalive: boolean): void {
    const userId = this.user.userId();
    if (!isPlatformBrowser(this.platformId) || !userId) return;
    this.syncTimer = null;
    fetch(`${WORKER_BASE}/api/game/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.user.authHeader() },
      body: JSON.stringify({ userId, game: this.state() }),
      keepalive,
    }).catch(() => {/* offline — localStorage still holds it */ });
  }

  /** Pull KV state and merge it with local (union mastery, max XP) on app start. */
  private loadFromKv(): void {
    const userId = this.user.userId();
    if (!userId) return;
    fetch(`${WORKER_BASE}/api/game/load?userId=${encodeURIComponent(userId)}`, { headers: this.user.authHeader() })
      .then(r => (r.ok ? r.json() : null))
      .then(res => {
        const remote = res?.game as GameState | undefined | null;
        if (!remote) return;
        const merged = this.mergeStates(this.state(), remote);
        this.state.set(merged);
        this.persistLocal(merged);
      })
      .catch(() => {/* offline — keep local */ });
  }

  private mergeStates(a: GameState, b: GameState): GameState {
    return {
      xp: Math.max(a.xp || 0, b.xp || 0),
      mastered: { ...(a.mastered || {}), ...(b.mastered || {}) },
      streak: (a.streak?.lastActive || '') >= (b.streak?.lastActive || '') ? a.streak : b.streak,
      achievements: [...new Set([...(a.achievements || []), ...(b.achievements || [])])],
    };
  }

  // Local calendar day (not UTC) so streaks line up with the user's actual day.
  private today(): string {
    return this.localDate(new Date());
  }

  private daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return this.localDate(d);
  }

  private localDate(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

private rankTitle(level: number): string {
  const tiers: [number, string][] = [
    [20, 'Diamond'], [15, 'Platinum'], [10, 'Gold'], [5, 'Silver'],
  ];
  const tier = tiers.find(([min]) => level >= min)?.[1] ?? 'Bronze';
  const base = tiers.find(([min]) => level >= min)?.[0] ?? 1;
  const sub = Math.min(level - base, 4);
  const numerals = ['I', 'II', 'III', 'IV', 'V'];
  return `${tier} ${numerals[sub]}`;
}
}
