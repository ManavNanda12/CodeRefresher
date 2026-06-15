import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DOCUMENT } from '@angular/common';

export type Theme = 'dark' | 'light';

const KEY = 'cr:theme';

/**
 * Light/dark theme toggle. Default is the signature dark "arena"; light is opt-in.
 * Sets `data-theme="light"` on <html> (dark = no attribute), which flips the
 * `--arena-*` tokens and `:host-context` overrides. SSR-safe; an inline script in
 * index.html applies the saved theme before paint to avoid a flash.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private platformId = inject(PLATFORM_ID);
  private doc = inject<Document>(DOCUMENT);

  readonly theme = signal<Theme>('dark');

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* storage disabled */
    }
    this.apply(saved === 'light' ? 'light' : 'dark');
  }

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this.apply(theme);
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(KEY, theme);
      } catch {
        /* ignore */
      }
    }
  }

  private apply(theme: Theme): void {
    this.theme.set(theme);
    if (!isPlatformBrowser(this.platformId)) return;
    const root = this.doc.documentElement;
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }
}
