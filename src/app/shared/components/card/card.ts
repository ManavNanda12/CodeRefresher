import { Component, input, signal } from '@angular/core';
import { RefresherItem } from '../../../core/models/refresher-item.model';

@Component({
  selector: 'app-card',
  templateUrl: './card.html',
  styleUrl: './card.css'
})
export class CardComponent {
  item  = input.required<RefresherItem>();
  index = input<number>(1);

  expanded = signal(false);
  copied   = signal(false);

  toggle(): void {
    this.expanded.update(v => !v);
  }

  copyCode(event: Event): void {
    event.stopPropagation();
    navigator.clipboard.writeText(this.item().codeExample).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
