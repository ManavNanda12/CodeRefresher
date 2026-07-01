import { Injectable } from '@angular/core';

export interface MemeResult {
  url: string;
  alt: string;
}

/**
 * Pass/fail meme generator — pure URL, ZERO API calls / tokens. Uses memegen.link,
 * which renders a meme entirely from the path: /images/<template>/<top>/<bottom>.png.
 * We pick a random template + a phrase keyed to the score band and just build the URL.
 * The component renders it in an <img> with an (error) fallback, so a bad template
 * never breaks the results screen.
 */
@Injectable({ providedIn: 'root' })
export class MemeService {
  private base = 'https://api.memegen.link/images';

  // Curated, widely-available memegen templates that read as celebratory vs. rough.
  private readonly PASS = ['success', 'drake', 'rollsafe', 'yodawg', 'oprah', 'buzz'];
  private readonly FAIL = ['fine', 'disastergirl', 'grumpycat', 'aliens', 'mordor', 'doge'];

  /** Phrase banks by score band → [top, bottom]. */
  private readonly PHRASES: Record<string, [string, string][]> = {
    legend: [['interview', 'absolutely flawless'], ['they said', 'youre hired on the spot'], ['certified', 'interview legend']],
    strong: [['that interview', 'got crushed'], ['nailed it', 'like a senior dev'], ['interviewer', 'was impressed']],
    pass:   [['not bad', 'you passed'], ['solid run', 'youre through'], ['good enough', 'ship it']],
    close:  [['so close', 'almost had it'], ['plot twist', 'you needed one more'], ['brave attempt', 'try again champ']],
    fail:   [['the interview', 'did not go well'], ['well', 'that happened'], ['it be', 'like that sometimes']],
  };

  /** Build a meme for the given overall score (0-10). */
  forScore(score: number): MemeResult {
    const band = this.band(score);
    const passed = score >= 6;
    const templates = passed ? this.PASS : this.FAIL;
    const template = this.pick(templates);
    const [top, bottom] = this.pick(this.PHRASES[band]);
    const url = `${this.base}/${template}/${this.slug(top)}/${this.slug(bottom)}.png?width=600`;
    return { url, alt: `${top} — ${bottom}` };
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
