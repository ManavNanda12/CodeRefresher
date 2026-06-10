import { Component, input, inject, signal, computed } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, tap } from 'rxjs';
import { DataService } from '../../../core/services/data.service';
import { RefresherItem, RefresherCategory } from '../../../core/models/refresher-item.model';
import { CardComponent } from '../card/card';

interface TechMeta {
  icon: string;
  tag: string;
  gradient: string;
}

const TECH_META: Record<string, TechMeta> = {
  angular: {
    icon: '⚡',
    tag: 'Frontend Framework',
    gradient: 'linear-gradient(135deg, #c3002f 0%, #ff4857 100%)',
  },
  dotnet: {
    icon: '🔷',
    tag: 'Backend Platform',
    gradient: 'linear-gradient(135deg, #512bd4 0%, #9333ea 100%)',
  },
  sql: {
    icon: '🗄️',
    tag: 'Database Language',
    gradient: 'linear-gradient(135deg, #0050a0 0%, #0ea5e9 100%)',
  }
};

const DEFAULT_META: TechMeta = {
  icon: '📚',
  tag: 'Technology',
  gradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
};

const TAB_LABELS: Record<string, string> = {
  '0-1': '0–1 Year',
  '1-2': '1–2 Years',
  '2-3': '2–3 Years',
  '4+':  '4+ Years',
};

@Component({
  selector: 'app-tech-page',
  imports: [CardComponent],
  templateUrl: './tech-page.html',
  styleUrl: './tech-page.css'
})
export class TechPageComponent {
  tech  = input.required<string>();
  title = input.required<string>();

  private dataService = inject(DataService);

  activeTab    = signal<string>('0-1');
  activeModule = signal<string | null>(null);
  allData      = signal<Record<string, RefresherCategory>>({});
  loading      = signal(true);

  readonly techMeta = computed<TechMeta>(() => TECH_META[this.tech()] ?? DEFAULT_META);

  readonly tabs = computed(() =>
    Object.keys(this.allData()).map(key => ({
      key,
      label: TAB_LABELS[key] ?? key,
    }))
  );

  readonly currentCategory = computed<RefresherCategory | null>(() =>
    this.allData()[this.activeTab()] ?? null
  );

  readonly currentModules = computed(() =>
    Object.keys(this.currentCategory()?.modules ?? {})
  );

  readonly currentItems = computed<RefresherItem[]>(() => {
    const cat = this.currentCategory();
    if (!cat) return [];
    const mod = this.activeModule();
    return mod
      ? (cat.modules[mod]?.questions ?? [])
      : Object.values(cat.modules).flatMap(m => m.questions);
  });

  readonly totalCount = computed(() =>
    Object.values(this.allData()).reduce((s, cat) =>
      s + Object.values(cat.modules).reduce((ms, m) => ms + m.questions.length, 0), 0)
  );

  readonly tabCounts = computed<Record<string, number>>(() => {
    const result: Record<string, number> = {};
    for (const [key, cat] of Object.entries(this.allData())) {
      result[key] = Object.values(cat.modules).reduce((s, m) => s + m.questions.length, 0);
    }
    return result;
  });

  constructor() {
    toObservable(this.tech).pipe(
      tap(() => {
        this.activeTab.set('0-1');
        this.activeModule.set(null);
        this.loading.set(true);
        this.allData.set({});
      }),
      switchMap(tech => this.dataService.loadData(tech)),
      takeUntilDestroyed()
    ).subscribe({
      next: data => {
        const categories = data.categories as Record<string, RefresherCategory>;
        this.allData.set(categories);
        const firstTab = Object.keys(categories)[0];
        if (firstTab) this.activeTab.set(firstTab);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
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

  cardDelay(index: number): string {
    return `${Math.min(index * 50, 400)}ms`;
  }
}
