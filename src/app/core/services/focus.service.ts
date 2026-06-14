import { Injectable, signal } from '@angular/core';

/**
 * One-shot handoff for launching an adaptive "Focus Round" from the Dashboard.
 * The dashboard stashes a target arena here and navigates to /test-me; the
 * freshly-created TestMeComponent consumes it on init, then clears it so a plain
 * visit to /test-me never accidentally starts a focus round.
 */
@Injectable({ providedIn: 'root' })
export class FocusRoundService {
  private pending = signal<string | null>(null);

  /** Queue a focus round for the given arena id (e.g. 'angular'). */
  request(arenaId: string): void {
    this.pending.set(arenaId);
  }

  /** Read-and-clear the pending arena id, or null if none queued. */
  consume(): string | null {
    const id = this.pending();
    this.pending.set(null);
    return id;
  }
}
