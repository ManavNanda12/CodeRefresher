import { Component, input, inject, signal, computed, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, tap } from 'rxjs';
import { DataService } from '../../../core/services/data.service';
import { RefresherItem, RefresherCategory } from '../../../core/models/refresher-item.model';
import { GameService, questionId } from '../../../core/services/game.service';
import { FocusRoundService } from '../../../core/services/focus.service';
import { SeoService } from '../../../core/services/seo.service';
import { CardComponent, Tier } from '../card/card';

interface TechMeta {
  icon: string;
  tag: string;
  gradient: string;
  accent: string;
}

const TECH_META: Record<string, TechMeta> = {
  angular: { icon: '⚡', tag: 'Frontend Framework', gradient: 'linear-gradient(135deg, #c3002f 0%, #ff4857 100%)', accent: '#ff4857' },
  dotnet:  { icon: '🔷', tag: 'Backend Platform',   gradient: 'linear-gradient(135deg, #512bd4 0%, #9333ea 100%)', accent: '#9333ea' },
  sql:     { icon: '🗄️', tag: 'Database Language',  gradient: 'linear-gradient(135deg, #0050a0 0%, #0ea5e9 100%)', accent: '#0ea5e9' },
};

const DEFAULT_META: TechMeta = { icon: '📚', tag: 'Technology', gradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', accent: '#7c3aed' };

const TAB_LABELS: Record<string, string> = { '0-1': '0–1 Year', '1-2': '1–2 Years', '2-3': '2–3 Years', '4+': '4+ Years' };

/** Difficulty tier per experience tab — drives the card badge + XP reward. */
const TIERS: Record<string, Tier> = {
  '0-1': { label: 'Rookie',    xp: 10, color: '#34d399' },
  '1-2': { label: 'Builder',   xp: 15, color: '#60a5fa' },
  '2-3': { label: 'Senior',    xp: 20, color: '#c084fc' },
  '4+':  { label: 'Architect', xp: 25, color: '#fb923c' },
};
const DEFAULT_TIER: Tier = { label: 'Quest', xp: 10, color: '#a5b4fc' };

@Component({
  selector: 'app-tech-page',
  imports: [CardComponent],
  templateUrl: './tech-page.html',
  styleUrl: './tech-page.css',
})
export class TechPageComponent {
  tech  = input.required<string>();
  title = input.required<string>();

  private platformId = inject(PLATFORM_ID);
  private dataService = inject(DataService);
  private game = inject(GameService);
  private focusRound = inject(FocusRoundService);
  private seo = inject(SeoService);
  private router = inject(Router);

  activeTab    = signal<string>('0-1');
  activeModule = signal<string | null>(null);
  allData      = signal<Record<string, RefresherCategory>>({});
  loading      = signal(true);

  /** Module the user just fully mastered — drives the "test yourself" challenge. */
  challengeModule = signal<string | null>(null);

  readonly techMeta = computed<TechMeta>(() => TECH_META[this.tech()] ?? DEFAULT_META);
  readonly tierFor = computed<Tier>(() => TIERS[this.activeTab()] ?? DEFAULT_TIER);

  readonly tabs = computed(() =>
    Object.keys(this.allData()).map(key => ({ key, label: TAB_LABELS[key] ?? key })),
  );

  readonly currentCategory = computed<RefresherCategory | null>(() => this.allData()[this.activeTab()] ?? null);

  readonly currentModules = computed(() => Object.keys(this.currentCategory()?.modules ?? {}));

  readonly currentItems = computed<RefresherItem[]>(() => {
    const cat = this.currentCategory();
    if (!cat) return [];
    const mod = this.activeModule();
    return mod ? (cat.modules[mod]?.questions ?? []) : Object.values(cat.modules).flatMap(m => m.questions);
  });

  readonly totalCount = computed(() =>
    Object.values(this.allData()).reduce((s, cat) => s + Object.values(cat.modules).reduce((ms, m) => ms + m.questions.length, 0), 0),
  );

  readonly tabCounts = computed<Record<string, number>>(() => {
    const result: Record<string, number> = {};
    for (const [key, cat] of Object.entries(this.allData())) {
      result[key] = Object.values(cat.modules).reduce((s, m) => s + m.questions.length, 0);
    }
    return result;
  });

  /** Mastered count across the whole arena (all tabs) + the matching total. */
  readonly arenaMastered = computed(() => {
    this.game.masteredTotal(); // establish reactive dependency on mastery changes
    const ids: string[] = [];
    for (const cat of Object.values(this.allData())) {
      for (const m of Object.values(cat.modules)) {
        for (const q of m.questions) ids.push(questionId(q.question));
      }
    }
    return this.game.masteredIn(this.tech(), ids);
  });

  readonly arenaProgressPct = computed(() => {
    const total = this.totalCount();
    return total ? Math.round((this.arenaMastered() / total) * 100) : 0;
  });

  constructor() {
    this.challenged = new Set(this.loadChallenged());

    toObservable(this.tech).pipe(
      tap(() => {
        this.activeTab.set('0-1');
        this.activeModule.set(null);
        this.loading.set(true);
        this.allData.set({});
      }),
      switchMap(tech => this.dataService.loadData(tech)),
      takeUntilDestroyed(),
    ).subscribe({
      next: data => {
        const categories = data.categories as Record<string, RefresherCategory>;
        this.allData.set(categories);
        const firstTab = Object.keys(categories)[0];
        if (firstTab) this.activeTab.set(firstTab);
        this.loading.set(false);
        this.game.ping(); // browsing keeps the daily streak alive
        this.emitStructuredData();
      },
      error: () => this.loading.set(false),
    });

    // When a freshly-mastered question completes its whole module → challenge.
    // Deduped via a session-persistent set so it never re-fires on remount.
    effect(() => {
      const jm = this.game.justMastered();
      if (!jm || jm.arena !== this.tech()) return;

      const data = this.allData();
      for (const cat of Object.values(data)) {
        for (const name of Object.keys(cat.modules)) {
          const ids = cat.modules[name].questions.map(q => questionId(q.question));
          if (!ids.includes(jm.qid)) continue;
          // gather every question under this module name across all tabs
          const all: string[] = [];
          for (const c of Object.values(data)) {
            const m = c.modules[name];
            if (m) for (const q of m.questions) all.push(questionId(q.question));
          }
          const key = `${this.tech()}:${name}`;
          if (all.length > 0 && this.game.masteredIn(this.tech(), all) === all.length && !this.challenged.has(key)) {
            this.challenged.add(key);
            this.persistChallenged();
            this.challengeModule.set(name);
          }
          return;
        }
      }
    });
  }

  /** Modules already challenged this session — survives tech-page remounts (fixes re-fire). */
  private challenged = new Set<string>();

  private loadChallenged(): string[] {
    if (!isPlatformBrowser(this.platformId)) return [];
    try {
      return JSON.parse(sessionStorage.getItem('cr:challenged') || '[]');
    } catch {
      return [];
    }
  }

  private persistChallenged(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      sessionStorage.setItem('cr:challenged', JSON.stringify([...this.challenged]));
    } catch {
      /* ignore */
    }
  }

  acceptChallenge(): void {
    const module = this.challengeModule();
    if (!module) return;
    this.focusRound.request(this.tech(), module);
    this.challengeModule.set(null);
    this.router.navigate(['/test-me']);
  }

  dismissChallenge(): void {
    this.challengeModule.set(null);
  }

  setTab(key: string): void {
    if (this.activeTab() === key) return;
    this.activeTab.set(key);
    this.activeModule.set(null);
  }

  setModule(mod: string | null): void {
    this.activeModule.set(mod);
  }

  getModuleIcon(name: string): string {
    return this.currentCategory()?.modules[name]?.icon ?? '📦';
  }

  getModuleCount(name: string): number {
    return this.currentCategory()?.modules[name]?.questions.length ?? 0;
  }

  /** Mastered questions within a module of the current tab (for the pill ring). */
  moduleMastered(name: string): number {
    this.game.masteredTotal();
    const qs = this.currentCategory()?.modules[name]?.questions ?? [];
    return this.game.masteredIn(this.tech(), qs.map(q => questionId(q.question)));
  }

  /** Mastered across the whole current tab (for the "All Topics" pill). */
  tabMastered(): number {
    this.game.masteredTotal();
    const cat = this.currentCategory();
    if (!cat) return 0;
    const ids = Object.values(cat.modules).flatMap(m => m.questions.map(q => questionId(q.question)));
    return this.game.masteredIn(this.tech(), ids);
  }

  cardDelay(index: number): string {
    return `${Math.min(index * 50, 400)}ms`;
  }

  /** FAQPage + BreadcrumbList structured data so Google reads these as Q&A pages. */
  private emitStructuredData(): void {
    const qa: { q: string; a: string }[] = [];
    for (const cat of Object.values(this.allData())) {
      for (const mod of Object.values(cat.modules)) {
        for (const item of mod.questions) qa.push({ q: item.question, a: item.answer });
      }
    }
    if (qa.length) {
      this.seo.setJsonLd('faq', {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: qa.slice(0, 50).map(x => ({
          '@type': 'Question',
          name: x.q,
          acceptedAnswer: { '@type': 'Answer', text: x.a },
        })),
      });
    }
    this.seo.setJsonLd('breadcrumb', {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: this.seo.siteUrl('/') },
        { '@type': 'ListItem', position: 2, name: this.title(), item: this.seo.siteUrl('/' + this.tech()) },
      ],
    });
  }
}
