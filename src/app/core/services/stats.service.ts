import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Base URL of the Cloudflare Worker (matches WORKER_BASE elsewhere). */
const WORKER_BASE = 'https://coderefresherworker.manavnanda2404.workers.dev';

/**
 * Homepage social-proof counters. A "verdict" is counted when a results screen
 * is actually shown to the user — regardless of whether grading ran on the
 * server, was skipped (all questions skipped), or fell back locally. That's why
 * this is a client event and not a side effect of /api/interview-grade.
 */
@Injectable({ providedIn: 'root' })
export class StatsService {
  private platformId = inject(PLATFORM_ID);

  /** Fire-and-forget: record that one verdict was delivered. Never throws. */
  recordVerdict(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // keepalive lets the request survive a navigation right after the verdict.
    fetch(`${WORKER_BASE}/api/stats/verdict`, { method: 'POST', keepalive: true })
      .catch(() => { /* a missed count must never disrupt the results screen */ });
  }
}
