import { Component, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../core/services/seo.service';
import { LeaderboardService, LeaderboardData, LeaderEntry } from '../../core/services/leaderboard.service';

type Board = 'xp' | 'rounds' | 'best';

interface BoardMeta {
  key: Board;
  label: string;
  icon: string;
  unit: string;
}

const BOARDS: BoardMeta[] = [
  { key: 'xp', label: 'Top Rank', icon: '⚡', unit: 'XP' },
  { key: 'rounds', label: 'Most Tests', icon: '🎯', unit: 'rounds' },
  { key: 'best', label: 'Best Score', icon: '🏅', unit: '/10' },
];

@Component({
  selector: 'app-leaderboard',
  imports: [RouterLink],
  templateUrl: './leaderboard.html',
  styleUrl: './leaderboard.css',
})
export class LeaderboardComponent {
  private platformId = inject(PLATFORM_ID);
  private lb = inject(LeaderboardService);

  readonly boards = BOARDS;
  activeBoard = signal<Board>('xp');
  loading = signal(true);
  data = signal<LeaderboardData | null>(null);

  private readonly myId = this.lb.myId();

  readonly currentMeta = computed(() => BOARDS.find(b => b.key === this.activeBoard())!);
  readonly entries = computed<LeaderEntry[]>(() => this.data()?.[this.activeBoard()] ?? []);
  readonly podium = computed(() => this.entries().slice(0, 3));
  readonly rest = computed(() => this.entries().slice(3));
  readonly maxValue = computed(() => this.entries()[0]?.value || 1);
  readonly myRank = computed(() => {
    const i = this.entries().findIndex(e => e.id === this.myId);
    return i === -1 ? null : i + 1;
  });

  constructor() {
    inject(SeoService).update({
      title: 'Leaderboard — Top of the Arena',
      description: 'See who tops the CodeRefresher arena — by XP rank, tests taken, and best score.',
      keywords: 'developer leaderboard, interview prep ranking, coding arena leaderboard',
      noindex: true,
    });
    if (isPlatformBrowser(this.platformId)) {
      this.lb.load().subscribe(d => {
        this.data.set(d);
        this.loading.set(false);
      });
    }
  }

  setBoard(b: Board): void {
    this.activeBoard.set(b);
  }

  isMe(e: LeaderEntry): boolean {
    return e.id === this.myId;
  }

  barPct(value: number): number {
    return Math.max(6, Math.round((value / this.maxValue()) * 100));
  }

  fmt(value: number): string {
    const u = this.currentMeta().unit;
    return u === '/10' ? `${value}/10` : `${value} ${u}`;
  }
}
