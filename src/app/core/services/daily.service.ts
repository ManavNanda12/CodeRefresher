import { inject, Injectable } from '@angular/core';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { DataService } from './data.service';
import { RefresherData } from '../models/refresher-item.model';

/** The one question shown to everyone on a given calendar day. */
export interface DailyQuestion {
  question: string;
  answer: string;
  codeExample?: string;
  simpleExample?: string;
  module: string;
  icon: string;
  arena: string;
  arenaName: string;
  accent: string;
}

/** Fixed arena order + display meta — keeps the pooled order identical for every client. */
const ARENAS: { id: string; name: string; accent: string }[] = [
  { id: 'angular', name: 'Angular', accent: '#ff4857' },
  { id: 'dotnet', name: '.NET', accent: '#9333ea' },
  { id: 'sql', name: 'SQL', accent: '#0ea5e9' },
  { id: 'react', name: 'React', accent: '#61dafb' },
  { id: 'nextjs', name: 'Next.js', accent: '#6b7280' },
  { id: 'nestjs', name: 'NestJS', accent: '#e0234e' },
];

@Injectable({ providedIn: 'root' })
export class DailyService {
  private data = inject(DataService);

  /** Local calendar day as YYYY-MM-DD (matches GameService's streak day). */
  todayKey(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /**
   * The deterministic "question of the day". Loads every arena, flattens them into a
   * stable-ordered pool, and indexes into it by a hash of today's date — so the choice is
   * identical across all users and devices, with no server round-trip.
   */
  getDailyQuestion(): Observable<DailyQuestion | null> {
    return forkJoin(ARENAS.map(a => this.data.loadData(a.id))).pipe(
      map(datasets => {
        const pool = this.buildPool(datasets);
        if (!pool.length) return null;
        const idx = hashStr(this.todayKey()) % pool.length;
        return pool[idx];
      }),
      catchError(() => of(null)),
    );
  }

  /** Flatten all arenas → one ordered list. Order is deterministic (fixed arena order,
   *  then object key / array order from the JSON), so every client builds the same pool. */
  private buildPool(datasets: RefresherData[]): DailyQuestion[] {
    const pool: DailyQuestion[] = [];
    datasets.forEach((data, i) => {
      const meta = ARENAS[i];
      for (const cat of Object.values(data.categories)) {
        for (const [module, mod] of Object.entries(cat.modules)) {
          for (const q of mod.questions) {
            pool.push({
              question: q.question,
              answer: q.answer,
              codeExample: q.codeExample,
              simpleExample: q.simpleExample,
              module,
              icon: mod.icon,
              arena: meta.id,
              arenaName: meta.name,
              accent: meta.accent,
            });
          }
        }
      }
    });
    return pool;
  }
}

/** Tiny stable string hash (same family as questionId) → non-negative int. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
