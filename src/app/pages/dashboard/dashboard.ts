import { Component, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { SeoService } from '../../core/services/seo.service';
import { UserService, isValidEmail } from '../../core/services/user.service';
import { FocusRoundService } from '../../core/services/focus.service';
import {
  ProgressService,
  ArenaProgress,
  RoundRecord,
} from '../../core/services/progress.service';

interface ArenaMeta {
  id: string;
  name: string;
  icon: string;
  accent: string;
  gradient: string;
}

const ARENA_META: ArenaMeta[] = [
  { id: 'angular', name: 'Angular', icon: '⚡', accent: '#ff4857', gradient: 'linear-gradient(135deg, #c3002f 0%, #ff4857 100%)' },
  { id: 'dotnet',  name: '.NET',    icon: '🔷', accent: '#9333ea', gradient: 'linear-gradient(135deg, #512bd4 0%, #9333ea 100%)' },
  { id: 'sql',     name: 'SQL',     icon: '🗄️', accent: '#0ea5e9', gradient: 'linear-gradient(135deg, #0050a0 0%, #0ea5e9 100%)' },
];

const LEVEL_NAME: Record<string, string> = {
  '0-1': 'Rookie', '1-2': 'Builder', '2-3': 'Senior', '4+': 'Architect',
};

interface OverviewCard {
  meta: ArenaMeta;
  rounds: number;
  avg: number | null;
  totalQs: number;
}

interface WeakSpot {
  arena: ArenaMeta;
  module: string;
  avg: number;
  tested: number;
}

interface ModuleRow {
  name: string;
  icon: string;
  avg: number | null;
  tested: number;
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent {
  private platformId = inject(PLATFORM_ID);
  private data = inject(DataService);
  private router = inject(Router);
  private focusRound = inject(FocusRoundService);
  readonly user = inject(UserService);
  readonly progress = inject(ProgressService);

  readonly arenaMetas = ARENA_META;

  view = signal<'overview' | 'arena'>('overview');
  selectedId = signal<string | null>(null);
  refreshing = signal(false);
  copied = signal(false);

  // ── settings panel ─────────────────────────────────────────
  settingsOpen = signal(false);
  emailDraft = signal('');
  emailError = signal('');
  savingEmail = signal(false);
  emailSaved = signal(false);
  confirmingDelete = signal(false);
  deleting = signal(false);

  /** Module name → icon, loaded from the arena's data file for the detail view. */
  private moduleIcons = signal<Record<string, string>>({});
  private allModuleNames = signal<string[]>([]);

  constructor() {
    inject(SeoService).update({
      title: 'Dashboard — Your Prep Progress',
      description:
        'Track every Test Me round, see your readiness per technology, and spot the modules that need work.',
      keywords: 'developer progress dashboard, interview prep tracker, angular dotnet sql readiness',
    });
    // Pull the source-of-truth from KV and reconcile into the local cache.
    if (isPlatformBrowser(this.platformId) && this.user.isKnown()) {
      this.refreshing.set(true);
      this.progress.loadDashboard().subscribe(() => this.refreshing.set(false));
    }
  }

  // ── overview ───────────────────────────────────────────────
  readonly cards = computed<OverviewCard[]>(() => {
    this.progress.revision();
    return ARENA_META.map(meta => {
      const p = this.progress.getArenaProgress(meta.id);
      return {
        meta,
        rounds: p?.overall.rounds ?? 0,
        avg: p && p.overall.rounds > 0 ? p.overall.avgScore : null,
        totalQs: p?.overall.totalQsTested ?? 0,
      };
    });
  });

  readonly hasAnyData = computed(() => this.cards().some(c => c.rounds > 0));

  readonly weakSpots = computed<WeakSpot[]>(() => {
    this.progress.revision();
    const spots: WeakSpot[] = [];
    for (const meta of ARENA_META) {
      const p = this.progress.getArenaProgress(meta.id);
      if (!p) continue;
      for (const [module, stat] of Object.entries(p.modules)) {
        if (stat.tested >= 2 && stat.avg !== null) {
          spots.push({ arena: meta, module, avg: stat.avg, tested: stat.tested });
        }
      }
    }
    return spots.sort((a, b) => a.avg - b.avg).slice(0, 3);
  });

  readonly recent = computed<RoundRecord[]>(() => {
    this.progress.revision();
    return this.progress.getHistory().slice(0, 8);
  });

  // ── arena detail ───────────────────────────────────────────
  readonly selectedMeta = computed<ArenaMeta | null>(
    () => ARENA_META.find(m => m.id === this.selectedId()) ?? null,
  );

  readonly selectedProgress = computed<ArenaProgress | null>(() => {
    this.progress.revision();
    const id = this.selectedId();
    return id ? this.progress.getArenaProgress(id) : null;
  });

  /** All modules for the arena (tested + untested), sorted strongest → weakest, untested last. */
  readonly moduleRows = computed<ModuleRow[]>(() => {
    this.progress.revision();
    const prog = this.selectedProgress();
    const icons = this.moduleIcons();
    const names = new Set<string>(this.allModuleNames());
    if (prog) Object.keys(prog.modules).forEach(n => names.add(n));

    const rows: ModuleRow[] = [...names].map(name => {
      const stat = prog?.modules[name];
      return {
        name,
        icon: icons[name] ?? '📦',
        avg: stat && stat.tested > 0 ? stat.avg : null,
        tested: stat?.tested ?? 0,
      };
    });

    return rows.sort((a, b) => {
      if (a.avg === null && b.avg === null) return a.name.localeCompare(b.name);
      if (a.avg === null) return 1;
      if (b.avg === null) return -1;
      return b.avg - a.avg;
    });
  });

  readonly strengths = computed(() => this.moduleRows().filter(r => r.avg !== null && r.avg >= 7).slice(0, 4));
  readonly focusAreas = computed(() => this.moduleRows().filter(r => r.avg !== null && r.avg < 5));
  readonly untestedCount = computed(() => this.moduleRows().filter(r => r.avg === null).length);

  openArena(id: string): void {
    this.selectedId.set(id);
    this.view.set('arena');
    this.moduleIcons.set({});
    this.allModuleNames.set([]);
    this.scrollTop();
    this.data.loadData(id).subscribe({
      next: data => {
        const icons: Record<string, string> = {};
        const names: string[] = [];
        for (const cat of Object.values(data.categories)) {
          for (const [name, mod] of Object.entries(cat.modules)) {
            icons[name] = mod.icon;
            if (!names.includes(name)) names.push(name);
          }
        }
        this.moduleIcons.set(icons);
        this.allModuleNames.set(names);
      },
      error: () => {/* keep whatever progress modules we already have */},
    });
  }

  backToOverview(): void {
    this.view.set('overview');
    this.selectedId.set(null);
    this.scrollTop();
  }

  // ── launch rounds ──────────────────────────────────────────
  /** Queue an adaptive focus round for an arena and jump into Test Me. */
  startFocus(arenaId: string): void {
    this.focusRound.request(arenaId);
    this.router.navigate(['/test-me']);
  }

  /** Overview CTA: focus the arena that owns the worst weak spot. */
  startFocusTopWeak(): void {
    const top = this.weakSpots()[0];
    if (top) this.startFocus(top.arena.id);
  }

  // ── recovery code ──────────────────────────────────────────
  copyRecovery(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const code = this.user.recoveryCode();
    navigator.clipboard?.writeText(code).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    });
  }

  // ── settings panel ─────────────────────────────────────────
  openSettings(): void {
    this.emailDraft.set(this.user.email() ?? '');
    this.emailError.set('');
    this.emailSaved.set(false);
    this.confirmingDelete.set(false);
    this.settingsOpen.set(true);
  }

  closeSettings(): void {
    this.settingsOpen.set(false);
  }

  onEmailDraft(value: string): void {
    this.emailDraft.set(value);
    if (this.emailError()) this.emailError.set('');
    if (this.emailSaved()) this.emailSaved.set(false);
  }

  saveEmail(): void {
    const email = this.emailDraft().trim();
    if (!isValidEmail(email)) {
      this.emailError.set('Enter a valid email address.');
      return;
    }
    if (email === this.user.email()) {
      this.emailSaved.set(true);
      return;
    }
    this.savingEmail.set(true);
    this.user.changeEmail(email).subscribe(() => {
      this.savingEmail.set(false);
      this.emailSaved.set(true);
    });
  }

  signOut(): void {
    this.user.signOut();
    this.progress.clearLocal();
    this.settingsOpen.set(false);
    this.backToOverview();
  }

  deleteAccount(): void {
    this.deleting.set(true);
    this.user.deleteAccount().subscribe(() => {
      this.progress.clearLocal();
      this.deleting.set(false);
      this.settingsOpen.set(false);
      this.confirmingDelete.set(false);
      this.backToOverview();
    });
  }

  // ── display helpers ────────────────────────────────────────
  /** 0–10 score → heat colour band. */
  band(avg: number | null): string {
    if (avg === null) return '#475569';
    if (avg >= 7) return '#34d399';
    if (avg >= 4) return '#fbbf24';
    return '#f87171';
  }

  barPct(avg: number | null): number {
    return avg === null ? 0 : Math.round((Math.max(0, Math.min(10, avg)) / 10) * 100);
  }

  /** stroke-dashoffset for a 0–10 readiness ring (r=34, circ ≈ 213.6). */
  readonly RING_CIRC = 2 * Math.PI * 34;
  ringOffset(avg: number | null): number {
    const v = avg ?? 0;
    return this.RING_CIRC - (Math.max(0, Math.min(10, v)) / 10) * this.RING_CIRC;
  }

  levelName(round: RoundRecord): string {
    return round.levelName || LEVEL_NAME[round.level] || round.level;
  }

  arenaMeta(id: string): ArenaMeta {
    return ARENA_META.find(m => m.id === id) ?? ARENA_META[0];
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  formatDate(iso: string): string {
    if (!isPlatformBrowser(this.platformId)) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return 'Today';
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  private scrollTop(): void {
    if (isPlatformBrowser(this.platformId)) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
