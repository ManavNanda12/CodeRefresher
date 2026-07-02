import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface MemeResult {
  url: string;
  alt: string;
}

/** A meme template: either a memegen built-in (`id`) or a custom background image (`bg`). */
interface Tmpl {
  id: string;
  /** When set, we render text over this external image via memegen's /custom endpoint. */
  bg?: string;
}

/**
 * Pass/fail meme generator — pure URL, ZERO API calls / tokens. Uses memegen.link,
 * which renders a meme entirely from the path: /images/<template>/<top>/<bottom>.png
 * (and /images/custom/... ?background=<url> to paint text over ANY image).
 *
 * HYBRID pool for max variety:
 *   • memegen built-in templates (100% reliable, no external fetch), and
 *   • curated pop-culture backgrounds hosted on i.imgflip.com's permanent CDN
 *     (Leo cheers, The Rock, Sad Pablo, Megamind, Bernie, Pikachu…) for a
 *     Hollywood/Netflix look, layered with Bollywood/filmy/desi/dev caption packs.
 *
 * Anti-repeat: we remember the last N template+caption combos (persisted in
 * localStorage) and avoid replaying them, so consecutive verdicts feel fresh.
 *
 * The component renders the result in an <img> with an (error) fallback, so a
 * template or a rotted background URL never breaks the results screen.
 */
@Injectable({ providedIn: 'root' })
export class MemeService {
  private base = 'https://api.memegen.link/images';
  private platformId = inject(PLATFORM_ID);

  /** Stable imgflip CDN image ids → full URL. These are permanent template images. */
  private bg(id: string): Tmpl {
    return { id: 'custom', bg: `https://i.imgflip.com/${id}` };
  }

  // Celebratory-leaning pool (score >= 6). Built-ins + Hollywood/hype backgrounds.
  private readonly PASS: Tmpl[] = [
    { id: 'success' }, { id: 'drake' }, { id: 'rollsafe' }, { id: 'gru' },
    { id: 'oprah' }, { id: 'buzz' }, { id: 'stonks' }, { id: 'money' },
    { id: 'sparta' }, { id: 'gb' },
    this.bg('39t1o.jpg'),   // Leonardo DiCaprio Cheers  (Hollywood)
    this.bg('grr.jpg'),     // The Rock Driving
    this.bg('3oevdk.jpg'),  // Bernie "once again asking"
    this.bg('43a45p.png'),  // Buff Doge vs Cheems  (Netflix/gym energy)
  ];

  // Rough-leaning pool (score < 6). Built-ins + "it went badly" backgrounds.
  private readonly FAIL: Tmpl[] = [
    { id: 'fine' }, { id: 'disastergirl' }, { id: 'grumpycat' }, { id: 'aag' },
    { id: 'doge' }, { id: 'mordor' }, { id: 'harold' }, { id: 'blb' },
    { id: 'morpheus' }, { id: 'spongebob' }, { id: 'woman-cat' }, { id: 'cmm' },
    this.bg('2kbn1e.jpg'),  // Surprised Pikachu
    this.bg('1c1uej.jpg'),  // Sad Pablo Escobar (Netflix — Narcos)
    this.bg('2fm6x.jpg'),   // Waiting Skeleton
    this.bg('2gnnjh.jpg'),  // Monkey Puppet (awkward)
    this.bg('65939r.jpg'),  // Megamind "no bitches?"
    this.bg('3qqcim.png'),  // Panik / Kalm
  ];

  /**
   * Caption banks by score band → [top, bottom]. Deliberately mixes flavors:
   * classic memes, Bollywood/filmy one-liners (romanized), Netflix/binge, and dev humor.
   * ASCII only — memegen slugs romanized Hindi fine.
   */
  private readonly CAPTIONS: Record<string, [string, string][]> = {
    legend: [
      ['interview', 'absolutely flawless'],
      ['certified', 'interview legend'],
      ['they said', 'youre hired on the spot'],
      ['mogambo', 'khush hua'],                        // Bollywood — Mr. India
      ['ekdum', 'jhakaas interview'],                  // Bollywood — Anil Kapoor
      ['picture abhi baaki hai', 'aur tumne jeet li'],
      ['boss level', 'cleared without cheat codes'],
      ['you are', 'the main character of this stack'], // Netflix
      ['deploy to prod', 'zero rollbacks'],            // dev
      ['interviewer', 'took notes from YOU'],
    ],
    strong: [
      ['that interview', 'got crushed'],
      ['nailed it', 'like a senior dev'],
      ['interviewer', 'was impressed'],
      ['sasta nahi', 'ekdum premium performance'],     // desi
      ['thoda aur', 'aur tum CEO ban jaate'],          // desi
      ['binge worthy', 'they renewed you for season 2'], // Netflix
      ['code review', 'approved with no comments'],    // dev
      ['strong', 'like Baahubali lifting the linga'],  // Bollywood
    ],
    pass: [
      ['not bad', 'you passed'],
      ['solid run', 'youre through'],
      ['good enough', 'ship it'],
      ['pass ho gaye', 'tension nahi lene ka'],        // desi — Munnabhai
      ['chalega', 'bhai chalega'],                     // desi
      ['it aint much', 'but its honest work'],
      ['works on my machine', 'and in the interview too'], // dev
      ['barely', 'but Netflix still renewed you'],     // Netflix
    ],
    close: [
      ['so close', 'almost had it'],
      ['plot twist', 'you needed one more'],
      ['brave attempt', 'try again champ'],
      ['picture abhi baaki hai', 'mere dost'],         // Bollywood — the line
      ['thoda padh lete', 'toh nikal jaate'],          // desi
      ['babu bhaiya', 'yeh galti kaise kar di'],       // Bollywood — Hera Pheri
      ['one does not simply', 'wing a system design round'],
      ['stack overflow', 'was RIGHT there bro'],       // dev
    ],
    fail: [
      ['the interview', 'did not go well'],
      ['well', 'that happened'],
      ['it be', 'like that sometimes'],
      ['rishtey mein', 'hum interviewer ke junior lagte hai'], // Bollywood riff
      ['aisi kaisi', 'preparation thi bhai'],          // desi
      ['404', 'confidence not found'],                 // dev
      ['cancelled', 'after one episode'],              // Netflix
      ['git blame', 'points straight at you'],         // dev
      ['sad', 'Escobar is still waiting for your comeback'],
    ],
  };

  // ── Anti-repeat memory ──────────────────────────────────────────
  private readonly STORE_KEY = 'crf_meme_recent';
  private readonly MAX_RECENT = 18;
  private recent: string[] = this.loadRecent();

  /** Build a meme for the given overall score (0-10). */
  forScore(score: number): MemeResult {
    const band = this.band(score);
    const passed = score >= 6;
    const templates = passed ? this.PASS : this.FAIL;
    const captions = this.CAPTIONS[band];

    // Try a handful of times to find a template+caption combo we haven't shown lately.
    let tmpl = this.pick(templates);
    let [top, bottom] = this.pick(captions);
    for (let i = 0; i < 12; i++) {
      if (!this.recent.includes(this.key(tmpl, top, bottom))) break;
      tmpl = this.pick(templates);
      [top, bottom] = this.pick(captions);
    }
    this.remember(this.key(tmpl, top, bottom));

    return { url: this.buildUrl(tmpl, top, bottom), alt: `${top} — ${bottom}` };
  }

  // ── URL building ────────────────────────────────────────────────
  private buildUrl(t: Tmpl, top: string, bottom: string): string {
    const path = `${this.base}/${t.bg ? 'custom' : t.id}/${this.slug(top)}/${this.slug(bottom)}.png`;
    return t.bg ? `${path}?background=${t.bg}&width=600` : `${path}?width=600`;
  }

  private key(t: Tmpl, top: string, bottom: string): string {
    return `${t.bg ?? t.id}|${top}|${bottom}`;
  }

  private band(s: number): string {
    if (s >= 9) return 'legend';
    if (s >= 7.5) return 'strong';
    if (s >= 6) return 'pass';
    if (s >= 4) return 'close';
    return 'fail';
  }

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ── Recent-combo persistence (SSR-safe) ─────────────────────────
  private remember(k: string): void {
    this.recent.push(k);
    if (this.recent.length > this.MAX_RECENT) this.recent = this.recent.slice(-this.MAX_RECENT);
    if (!isPlatformBrowser(this.platformId)) return;
    try { localStorage.setItem(this.STORE_KEY, JSON.stringify(this.recent)); } catch { /* ignore */ }
  }

  private loadRecent(): string[] {
    if (!isPlatformBrowser(this.platformId)) return [];
    try {
      const raw = localStorage.getItem(this.STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(-this.MAX_RECENT) : [];
    } catch { return []; }
  }

  /** memegen path encoding (spaces → _, and the special-char escapes). */
  private slug(text: string): string {
    const out = text
      .trim()
      .replace(/_/g, '__')
      .replace(/-/g, '--')
      .replace(/ /g, '_')
      .replace(/\?/g, '~q')
      .replace(/%/g, '~p')
      .replace(/#/g, '~h')
      .replace(/\//g, '~s')
      .replace(/"/g, "''");
    return out || '_';
  }
}
