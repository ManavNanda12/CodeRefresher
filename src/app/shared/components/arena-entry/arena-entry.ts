import { Component, OnDestroy, OnInit, PLATFORM_ID, inject, input, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Full-screen "entering the arena" overlay, shown while a round is being
 * prepared. It doubles as the loading screen: the parent keeps it up until
 * its questions are ready (with a minimum display time so it never flashes),
 * then sets `closing` for the fade-out before removing it.
 */
@Component({
  selector: 'app-arena-entry',
  templateUrl: './arena-entry.html',
  styleUrl: './arena-entry.css',
})
export class ArenaEntryComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);

  icon = input('🎤');
  /** Named `heading`, not `title` — a static `title="…"` attribute would also
   *  land on the host element and render as a native browser tooltip. */
  heading = input('');
  /** Rotating status lines under the title — the round's flavor text. */
  lines = input<string[]>([]);
  /** Set by the parent ~400ms before removal to play the fade-out. */
  closing = input(false);

  line = signal('');
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    const lines = this.lines();
    this.line.set(lines[0] ?? '');
    if (!isPlatformBrowser(this.platformId) || lines.length < 2) return;
    let i = 0;
    this.timer = setInterval(() => {
      i = (i + 1) % lines.length;
      this.line.set(lines[i]);
    }, 1500);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
