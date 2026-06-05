import { Component, inject, input, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RefresherItem } from '../../../core/models/refresher-item.model';

@Component({
  selector: 'app-card',
  templateUrl: './card.html',
  styleUrl: './card.css'
})
export class CardComponent {
  private platformId = inject(PLATFORM_ID);

  item  = input.required<RefresherItem>();
  index = input<number>(1);

  expanded = signal(false);
  copied   = signal(false);

  toggle(): void {
    this.expanded.update(v => !v);
  }

  copyCode(event: Event): void {
    event.stopPropagation();
    if (!isPlatformBrowser(this.platformId)) return;
    navigator.clipboard.writeText(this.item().codeExample).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
