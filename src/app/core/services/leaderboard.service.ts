import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { UserService, WORKER_BASE } from './user.service';

export interface LeaderEntry {
  id: string;
  name: string;
  level: number;
  value: number;
}

export interface LeaderboardData {
  xp: LeaderEntry[];
  rounds: LeaderEntry[];
  best: LeaderEntry[];
  updatedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class LeaderboardService {
  private http = inject(HttpClient);
  private user = inject(UserService);

  load(): Observable<LeaderboardData | null> {
    return this.http
      .get<LeaderboardData>(`${WORKER_BASE}/api/leaderboard`)
      .pipe(catchError(() => of(null)));
  }

  /** This device's leaderboard id — matches the worker's shortId(userId) so we can mark "you". */
  myId(): string {
    const uid = this.user.userId();
    return uid ? uid.replace(/-/g, '').slice(0, 12) : '';
  }
}
