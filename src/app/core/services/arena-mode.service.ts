import { Injectable, signal } from '@angular/core';

/**
 * Global "arena mode" switch. While a live round is running (résumé trial chat,
 * mock-interview quiz) the layout hides the footer and clamps the page to the
 * viewport, so the active stage owns its own scrolling — no footer peeking,
 * no scrolling past the composer. Pages flip it with their stage machine and
 * MUST exit on destroy so a mid-round navigation never leaves it stuck on.
 */
@Injectable({ providedIn: 'root' })
export class ArenaModeService {
  private _active = signal(false);
  readonly active = this._active.asReadonly();

  enter(): void { this._active.set(true); }
  exit(): void { this._active.set(false); }
}
