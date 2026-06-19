import { Component, HostListener, effect, inject, signal, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GameService } from '../../../core/services/game.service';

@Component({
  selector: 'app-game-events',
  imports: [],
  templateUrl: './game-events.html',
  styleUrl: './game-events.css',
  encapsulation: ViewEncapsulation.None,
})
export class GameEventsComponent {
  private platformId = inject(PLATFORM_ID);
  readonly game = inject(GameService);

  /** Bumped on every level-up so the keyed @for remounts and the CSS
      timeline replays from frame 0 — the standalone's `key={runId}` trick. */
  readonly replayKey = signal(0);

  particles = this.generateParticles();

  constructor() {
    effect(() => {
      const lvl = this.game.justLeveledUp();
      if (lvl && isPlatformBrowser(this.platformId)) {
        this.particles = this.generateParticles();
      }
    });

    effect(() => {
      const a = this.game.justUnlocked();
      if (a && isPlatformBrowser(this.platformId)) {
        setTimeout(() => this.game.dismissUnlock(), 5000);
      }
    });
  }

  closeLevelUp(): void {
    this.game.dismissLevelUp();
  }

  /** Preview the level-up overlay anytime: Ctrl/Cmd + Shift + L. (QA helper.) */
  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      this.game.previewLevelUp();
    }
  }

  private generateParticles(): { x: string; y: string; delay: string }[] {
    // burst clustered around the number-land (~1040ms) so it reads as the
    // level "1 → 2" exploding outward, not a stray sparkle during the pop
    return Array.from({ length: 24 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.4;
      const dist = 160 + Math.random() * 130;
      return {
        x: Math.cos(angle) * dist + 'px',
        y: Math.sin(angle) * dist + 'px',
        delay: (1000 + Math.random() * 150).toFixed(0) + 'ms',
      };
    });
  }
}
