import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { WORKER_BASE } from './user.service';
import { ScorecardImageService } from './scorecard-image.service';

/** The denormalized scorecard a finished round produces. Mirrors worker/share.js. */
export interface ScoreCard {
  arena: string;
  arenaName: string;
  arenaIcon: string;
  accent: string;
  level: string;
  levelName: string;
  levelBadge: string;
  username: string;
  score: number;
  timeLabel: string;
  streak: number;
  userLevel: number;
  questions: { module: string; score: number }[];
}

/** A ready-to-share round: the public URL plus pre-built social messages. */
export interface ShareLinks {
  shareId: string;
  url: string;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Turns a finished round into a shareable link. The shareId is minted client-side
 * so the share buttons work synchronously (no await before window.open → no popup
 * blocking, no latency). The KV entry is written by a background, fire-and-forget
 * POST that tolerates being offline — exactly like ProgressService.syncRound.
 */
@Injectable({ providedIn: 'root' })
export class ShareService {
  private platformId = inject(PLATFORM_ID);
  private scorecard = inject(ScorecardImageService);

  /**
   * Mint a share link for a card and kick off the background writes. Safe to call
   * once per round; returns null on the server (SSR) where there's nothing to share.
   */
  create(card: ScoreCard): ShareLinks | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const shareId = this.mintId();
    // The share PAGE is served by the Worker (Pages has no /share/ route), so the
    // public link must point at the Worker origin — not the pages.dev site.
    const url = `${WORKER_BASE}/share/${shareId}`;
    this.persist(shareId, card);        // share entry (JSON) → KV
    this.uploadOgImage(shareId, card);  // og:image (PNG) → KV, for rich link previews
    return { shareId, url };
  }

  // ── social intents (all take the already-built share url) ──────
  twitterUrl(card: ScoreCard, url: string): string {
    const text = `I scored ${card.score}/10 on ${card.arenaName} (${card.levelName}) 🏆\n\nThink you can beat this?`;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  }

  linkedInUrl(url: string): string {
    return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  }

  whatsAppUrl(card: ScoreCard, url: string): string {
    const text = `I scored ${card.score}/10 on ${card.arenaName} (${card.levelName}) 🏆 Think you can beat this? ${url}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  challengeText(card: ScoreCard, url: string): string {
    return `I scored ${card.score}/10 on ${card.arenaName} (${card.levelName}). Think you can beat me?\n${url}`;
  }

  /** Clipboard with a legacy fallback for non-secure contexts / old browsers. */
  async copy(text: string): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through to legacy path */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  // ── internals ──────────────────────────────────────────────────
  private persist(shareId: string, card: ScoreCard): void {
    // keepalive: the request still completes if the user navigates away to share.
    fetch(`${WORKER_BASE}/api/share/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId, card }),
      keepalive: true,
    }).catch(() => {/* offline — the 404 share page handles the rare miss */});
  }

  /**
   * Render the scorecard PNG and upload it so the share page's og:image shows the
   * visual card in social feeds. No keepalive — the blob can exceed the 64KB
   * keepalive cap, and the user stays on the results page while it uploads.
   */
  private uploadOgImage(shareId: string, card: ScoreCard): void {
    this.scorecard
      .toPngBlob(card, 1)
      .then(blob => {
        if (!blob) return;
        return fetch(`${WORKER_BASE}/api/share/image?id=${encodeURIComponent(shareId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: blob,
        });
      })
      .catch(() => {/* preview falls back to the text card if this never lands */});
  }

  /** `s_` + 10 url-safe chars. Must satisfy the worker's /^s_[A-Za-z0-9]{6,16}$/. */
  private mintId(): string {
    let out = 's_';
    const buf = new Uint8Array(10);
    crypto.getRandomValues(buf);
    for (const b of buf) out += ID_CHARS[b % ID_CHARS.length];
    return out;
  }
}
