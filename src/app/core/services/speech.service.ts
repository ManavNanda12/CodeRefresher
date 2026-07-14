import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Conservative filler-word set — avoids technical uses of "like". */
export const FILLER_RE = /\b(u+m+|u+h+|hmm+|erm+|you know|i mean|kind of|sort of|basically|actually)\b/gi;

/** Locally-computed stats for a spoken answer (Web Speech transcript). */
export interface VoiceStats {
  seconds: number;
  words: number;
  fillers: number;
}

/** Delivery stats for a transcript — undefined when it's too short to count. */
export function computeVoiceStats(text: string, seconds: number): VoiceStats | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const words = t.split(/\s+/).length;
  if (words < 5) return undefined; // a mumble isn't a spoken answer
  const fillers = (t.match(FILLER_RE) ?? []).length;
  return { seconds: Math.round(seconds), words, fillers };
}

export interface SpeechStartOpts {
  /** Called with each FINALIZED transcript chunk (already trimmed, non-empty). */
  onFinal?: (chunk: string) => void;
  /**
   * Called with the elapsed seconds whenever a recording segment ends —
   * including internal stops (mic revoked mid-segment), so callers that
   * attribute time to a question never lose a segment.
   */
  onSegment?: (seconds: number) => void;
}

/**
 * Browser speech-to-text via the Web Speech API — free, no audio ever leaves
 * for OUR server (the transcript text is all we use). Extracted from the
 * Résumé Interview so Speak Mode and any future voice feature share one
 * battle-tested recognizer wrapper (Chrome's silence auto-stop, mic-blocked
 * errors, segment timing).
 *
 * NOT provided in root: it holds a live recognizer + per-session transcript,
 * so each page provides its own instance (`providers: [SpeechService]`).
 */
@Injectable()
export class SpeechService {
  private platformId = inject(PLATFORM_ID);

  /** Web Speech available in this browser (false on Firefox / during SSR). */
  readonly supported = signal(false);
  readonly recording = signal(false);
  /** Live not-yet-final text while the user is mid-sentence. */
  readonly interim = signal('');
  /** Accumulated FINAL transcript since the last reset(). */
  readonly finalText = signal('');
  /** Accumulated speaking seconds since the last reset(). */
  readonly seconds = signal(0);
  /** User-facing mic error ('' when fine). */
  readonly error = signal('');

  // Web Speech types aren't in lib.dom — vendor-prefixed in Chrome.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recog: any = null;
  private segmentStart = 0;
  private opts: SpeechStartOpts = {};

  constructor() {
    this.supported.set(!!this.speechCtor());
  }

  private speechCtor(): (new () => unknown) | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const w = window as unknown as Record<string, unknown>;
    return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition']) as (new () => unknown) | null;
  }

  start(opts: SpeechStartOpts = {}): void {
    const Ctor = this.speechCtor();
    if (!Ctor || this.recording()) return;
    this.opts = opts;
    this.error.set('');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = new (Ctor as any)();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      let interim = '';
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const text = e.results[k][0]?.transcript ?? '';
        if (e.results[k].isFinal) this.acceptFinal(text);
        else interim += text;
      }
      this.interim.set(interim.trim());
    };
    r.onend = () => {
      // Chrome auto-stops after silence — restart while the mic is meant to be live.
      if (this.recording() && this.recog === r) {
        try { r.start(); } catch { this.stop(); }
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        this.stop();
        this.error.set('Mic blocked — allow microphone access and try again. Typing still works!');
      }
      // 'no-speech' etc. → onend fires and we restart; nothing to do.
    };

    try {
      r.start();
    } catch {
      this.error.set("Couldn't start the mic — typing still works!");
      return;
    }
    this.recog = r;
    this.recording.set(true);
    this.segmentStart = this.now();
  }

  stop(): void {
    if (!this.recording() && !this.recog) return;
    this.recording.set(false);
    this.interim.set('');
    if (this.segmentStart) {
      const seg = (this.now() - this.segmentStart) / 1000;
      this.segmentStart = 0;
      this.seconds.update(s => s + seg);
      this.opts.onSegment?.(seg);
    }
    try { this.recog?.stop(); } catch { /* already stopped */ }
    this.recog = null;
  }

  toggle(opts: SpeechStartOpts = {}): void {
    if (this.recording()) this.stop();
    else this.start(opts);
  }

  /** Clear the accumulated transcript/timing — call between prompts/questions. */
  reset(): void {
    this.stop();
    this.finalText.set('');
    this.seconds.set(0);
    this.interim.set('');
    this.error.set('');
  }

  /** Delivery stats for everything spoken since the last reset(). */
  stats(): VoiceStats | undefined {
    return computeVoiceStats(this.finalText(), this.seconds());
  }

  private acceptFinal(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.finalText.update(f => (f ? f + ' ' : '') + t);
    this.opts.onFinal?.(t);
  }

  private now(): number {
    return isPlatformBrowser(this.platformId) ? Date.now() : 0;
  }
}
