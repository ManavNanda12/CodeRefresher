import { Component, computed, inject, input, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RefresherItem } from '../../../core/models/refresher-item.model';
import { GameService, questionId } from '../../../core/services/game.service';

/** Difficulty tier shown on a challenge card (passed by the tech page per year tab). */
export interface Tier {
  label: string;
  xp: number;
  color: string;
}

@Component({
  selector: 'app-card',
  templateUrl: './card.html',
  styleUrl: './card.css',
})
export class CardComponent {
  private platformId = inject(PLATFORM_ID);
  private game = inject(GameService);

  item = input.required<RefresherItem>();
  index = input<number>(1);
  arena = input<string>('');
  tier = input<Tier | null>(null);

  expanded = signal(false);
  copied = signal(false);

  readonly qid = computed(() => questionId(this.item().question));
  readonly mastered = computed(() => this.game.isMastered(this.arena(), this.qid()));

  toggle(): void {
    this.expanded.update(v => !v);
  }

  toggleMaster(event: Event): void {
    event.stopPropagation();
    this.game.toggleMastered(this.arena(), this.qid(), this.tier()?.xp ?? 10);
  }

  copyCode(event: Event): void {
    event.stopPropagation();
    if (!isPlatformBrowser(this.platformId)) return;
    const code = this.item().codeExample;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
