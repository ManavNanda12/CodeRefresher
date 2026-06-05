import { Component, input, inject, signal, computed } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, tap } from 'rxjs';
import { DataService } from '../../../core/services/data.service';
import { RefresherItem } from '../../../core/models/refresher-item.model';
import { CardComponent } from '../card/card';

type TabKey = '0-2' | '2-4';

interface TechMeta {
  icon: string;
  tag: string;
  gradient: string;
  iconBg: string;
}

const TECH_META: Record<string, TechMeta> = {
  angular: {
    icon: '⚡',
    tag: 'Frontend Framework',
    gradient: 'linear-gradient(135deg, #c3002f 0%, #ff4857 100%)',
    iconBg: 'rgba(255,255,255,0.15)'
  },
  dotnet: {
    icon: '🔷',
    tag: 'Backend Platform',
    gradient: 'linear-gradient(135deg, #512bd4 0%, #9333ea 100%)',
    iconBg: 'rgba(255,255,255,0.15)'
  },
  sql: {
    icon: '🗄️',
    tag: 'Database Language',
    gradient: 'linear-gradient(135deg, #0050a0 0%, #0ea5e9 100%)',
    iconBg: 'rgba(255,255,255,0.15)'
  }
};

const DEFAULT_META: TechMeta = {
  icon: '📚',
  tag: 'Technology',
  gradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
  iconBg: 'rgba(255,255,255,0.15)'
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

  activeTab = signal<TabKey>('0-2');
  allData   = signal<Record<string, RefresherItem[]>>({});
  loading   = signal(true);

  readonly tabs: { key: TabKey; label: string }[] = [
    { key: '0-2', label: '0–2 Years' },
    { key: '2-4', label: '2–4 Years' },
  ];

  readonly techMeta = computed<TechMeta>(() => TECH_META[this.tech()] ?? DEFAULT_META);

  readonly totalCount = computed(() =>
    Object.values(this.allData()).reduce((s, arr) => s + arr.length, 0)
  );

  constructor() {
    toObservable(this.tech).pipe(
      tap(() => {
        this.activeTab.set('0-2');
        this.loading.set(true);
        this.allData.set({});
      }),
      switchMap(tech => this.dataService.loadData(tech)),
      takeUntilDestroyed()
    ).subscribe({
      next: data => {
        this.allData.set(data.categories);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  currentItems(): RefresherItem[] {
    return this.allData()[this.activeTab()] ?? [];
  }

  setTab(tab: TabKey): void {
    this.activeTab.set(tab);
  }

  cardDelay(index: number): string {
    return `${Math.min(index * 55, 440)}ms`;
  }
}
