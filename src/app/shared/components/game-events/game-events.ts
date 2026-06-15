import { Component, effect, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GameService } from '../../../core/services/game.service';

/**
 * Global overlay for game "juice": a BGMI-style level-up crate and an
 * achievement-unlock toast. Mounted once in the layout; driven entirely by
 * GameService signals (justLeveledUp / justUnlocked).
 */
@Component({
  selector: 'app-game-events',
  imports: [],
  templateUrl: './game-events.html',
  styleUrl: './game-events.css',
})
export class GameEventsComponent {
  private platformId = inject(PLATFORM_ID);
  readonly game = inject(GameService);

  /** Drives the crate "open" state a beat after the modal appears. */
  readonly opened = signal(false);

  constructor() {
    // Sequence the crate: appear closed → shake → pop open.
    effect(() => {
      const lvl = this.game.justLeveledUp();
      if (lvl && isPlatformBrowser(this.platformId)) {
        this.opened.set(false);
        setTimeout(() => this.opened.set(true), 900);
      }
    });

    // Auto-dismiss the achievement toast.
    effect(() => {
      const a = this.game.justUnlocked();
      if (a && isPlatformBrowser(this.platformId)) {
        setTimeout(() => this.game.dismissUnlock(), 5000);
      }
    });
  }

  closeLevelUp(): void {
    this.opened.set(false);
    this.game.dismissLevelUp();
  }
}
