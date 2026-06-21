import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { ScoreCard } from './share.service';

const W = 1200;
const H = 630;

/**
 * Renders a Test Me scorecard to a PNG entirely on the client — no html2canvas,
 * no external fonts/images, so nothing taints the canvas and the output is
 * pixel-identical everywhere. One self-contained SVG drives both the downloadable
 * card (2× for retina) and the smaller og:image uploaded for link previews.
 */
@Injectable({ providedIn: 'root' })
export class ScorecardImageService {
  private platformId = inject(PLATFORM_ID);

  /** Trigger a browser download of the card as a crisp 2× PNG. */
  async download(card: ScoreCard): Promise<boolean> {
    const blob = await this.toPngBlob(card, 2);
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coderefresher-${card.arena || 'score'}-${card.score}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  /** Rasterize the SVG card to a PNG blob. `scale` 1 = og:image, 2 = retina download. */
  async toPngBlob(card: ScoreCard, scale = 1): Promise<Blob | null> {
    if (!isPlatformBrowser(this.platformId)) return null;
    const svg = this.buildSvg(card);
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = await this.loadImage(svgUrl);
      const canvas = document.createElement('canvas');
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, W * scale, H * scale);
      return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ── SVG template (self-contained: system fonts, no external refs) ──
  private buildSvg(card: ScoreCard): string {
    const score = card.score.toFixed(1);
    const color = scoreColor(card.score);
    const accent = /^#[0-9a-fA-F]{3,8}$/.test(card.accent) ? card.accent : '#818cf8';
    const qCount = card.questions.length;
    const arenaLine = [card.arenaName, card.levelName, card.levelBadge]
      .filter(Boolean)
      .join('  ·  ')
      .toUpperCase();

    // score ring (r=92, circumference ≈ 578.1)
    const r = 92;
    const circ = 2 * Math.PI * r;
    const offset = circ - (Math.max(0, Math.min(10, card.score)) / 10) * circ;
    const ringCx = 175;
    const ringCy = 340;

    const bars = this.buildBars(card.questions);

    const font = `font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bgGlow" cx="0%" cy="0%" r="80%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.20"/>
      <stop offset="55%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ringGlow" cx="0%" cy="0%" r="80%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.45"/>
      <stop offset="65%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#0f172a"/>
  <rect width="${W}" height="${H}" fill="url(#bgGlow)"/>
  <circle cx="120" cy="180" r="320" fill="url(#ringGlow)"/>

  <!-- header -->
  <text x="56" y="68" ${font} font-size="26" font-weight="700" fill="#cbd5e1">&lt;/&gt; <tspan fill="${accent}">CodeRefresher</tspan></text>
  <text x="${W - 56}" y="66" ${font} font-size="20" fill="#64748b" text-anchor="end">coderefresher.pages.dev</text>
  <line x1="56" y1="98" x2="${W - 56}" y2="98" stroke="#1e293b" stroke-width="2"/>

  <!-- arena -->
  <text x="56" y="150" ${font} font-size="22" font-weight="700" letter-spacing="3" fill="${accent}">${esc(card.arenaIcon)}  ${esc(arenaLine)}</text>

  <!-- score ring -->
  <circle cx="${ringCx}" cy="${ringCy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="14"/>
  <circle cx="${ringCx}" cy="${ringCy}" r="${r}" fill="none" stroke="${color}" stroke-width="14"
          stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
          transform="rotate(-90 ${ringCx} ${ringCy})"/>
  <text x="${ringCx}" y="${ringCy + 8}" ${font} font-size="74" font-weight="800" fill="${color}" text-anchor="middle">${score}</text>
  <text x="${ringCx}" y="${ringCy + 48}" ${font} font-size="24" font-weight="600" fill="#64748b" text-anchor="middle">/ 10</text>

  <!-- user block -->
  <text x="320" y="300" ${font} font-size="50" font-weight="800" fill="#f8fafc">${esc(card.username)}</text>
  <text x="320" y="345" ${font} font-size="26" fill="#94a3b8">${qCount} questions answered${card.timeLabel ? ` in ${esc(card.timeLabel)}` : ''}</text>
  <text x="320" y="390" ${font} font-size="24" fill="#cbd5e1">🔥 ${card.streak} day streak    ·    ⚡ Lv ${card.userLevel}</text>

  <!-- per-question bars -->
  ${bars}

  <!-- footer -->
  <line x1="56" y1="556" x2="${W - 56}" y2="556" stroke="#1e293b" stroke-width="2"/>
  <text x="56" y="598" ${font} font-size="24" font-weight="600" fill="${accent}">Think you can beat this? Try free → coderefresher.pages.dev</text>
</svg>`;
  }

  /** A horizontal row of mini score bars (Q1…QN), evenly spread across the width. */
  private buildBars(questions: { module: string; score: number }[]): string {
    const n = Math.max(1, questions.length);
    const left = 56;
    const right = W - 56;
    const slot = (right - left) / n;
    const barW = Math.min(150, slot - 40);
    const y = 470;
    const font = `font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"`;

    return questions
      .map((q, i) => {
        const x = left + i * slot;
        const col = scoreColor(q.score);
        const fillW = (barW * Math.max(0, Math.min(10, q.score))) / 10;
        return `<g>
    <text x="${x}" y="${y - 14}" ${font} font-size="20" font-weight="600" fill="#64748b">Q${i + 1}</text>
    <rect x="${x}" y="${y}" width="${barW}" height="12" rx="6" fill="rgba(255,255,255,0.08)"/>
    <rect x="${x}" y="${y}" width="${fillW.toFixed(1)}" height="12" rx="6" fill="${col}"/>
    <text x="${x + barW + 14}" y="${y + 12}" ${font} font-size="22" font-weight="700" fill="${col}">${q.score}</text>
  </g>`;
      })
      .join('\n  ');
  }
}

function scoreColor(score: number): string {
  if (score >= 8) return '#34d399';
  if (score >= 6) return '#fbbf24';
  if (score >= 4) return '#fb923c';
  return '#f87171';
}

/** XML-escape text that lands inside SVG <text> nodes. */
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}
