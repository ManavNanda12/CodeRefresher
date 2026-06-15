import { Injectable, signal } from '@angular/core';

/** A queued focus-round request, optionally narrowed to a single module. */
export interface FocusRequest {
  arena: string;
  module?: string;
}

/**
 * One-shot handoff for launching an adaptive "Focus Round" from the Dashboard
 * or a module-cleared challenge. The source stashes a target here and navigates
 * to /test-me; the freshly-created TestMeComponent consumes it on init, then
 * clears it so a plain visit to /test-me never accidentally starts a focus round.
 */
@Injectable({ providedIn: 'root' })
export class FocusRoundService {
  private pending = signal<FocusRequest | null>(null);

  /** Queue a focus round for an arena, optionally targeting one module. */
  request(arena: string, module?: string): void {
    this.pending.set({ arena, module });
  }

  /** Read-and-clear the pending request, or null if none queued. */
  consume(): FocusRequest | null {
    const req = this.pending();
    this.pending.set(null);
    return req;
  }
}
