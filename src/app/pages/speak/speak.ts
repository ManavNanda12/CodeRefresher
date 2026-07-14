import { Component, HostListener, OnDestroy, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CanComponentDeactivate } from '../../core/guards/can-deactivate-guard';
import { SeoService } from '../../core/services/seo.service';
import { ArenaModeService } from '../../core/services/arena-mode.service';
import { GameService } from '../../core/services/game.service';
import { MemeService, MemeResult } from '../../core/services/meme.service';
import { ProgressService, RoundRecord } from '../../core/services/progress.service';
import { SpeechService, computeVoiceStats } from '../../core/services/speech.service';
import { ArenaEntryComponent } from '../../shared/components/arena-entry/arena-entry';
import {
  GrammarFix,
  SpeakGrade,
  SpeakPrompt,
  SpeakPromptType,
  SpeakService,
} from '../../services/speak/speak.service';

type Stage = 'pick' | 'ready' | 'recording' | 'review' | 'grading' | 'results';

const TYPE_META: Record<SpeakPromptType, { label: string; icon: string }> = {
  concept: { label: 'Explain a concept', icon: '💡' },
  behavioral: { label: 'Behavioral (STAR)', icon: '⭐' },
  workplace: { label: 'Workplace talk', icon: '💬' },
};

/** Rotating lines on the entry gate while the coach reads the transcript. */
const ENTRY_LINES = [
  'Listening back to your answer…',
  'Circling the grammar slips…',
  'Checking the structure…',
  'Drafting stronger phrasings…',
  'Finding what you did well…',
];

@Component({
  selector: 'app-speak',
  imports: [FormsModule, ArenaEntryComponent],
  templateUrl: './speak.html',
  styleUrl: './speak.css',
  providers: [SpeechService],
})
export class SpeakComponent implements OnDestroy, CanComponentDeactivate {
  private platformId = inject(PLATFORM_ID);
  private arena = inject(ArenaModeService);
  private svc = inject(SpeakService);
  private memeSvc = inject(MemeService);
  private progress = inject(ProgressService);
  readonly game = inject(GameService);
  readonly speech = inject(SpeechService);

  readonly TYPE_META = TYPE_META;
  readonly ENTRY_LINES = ENTRY_LINES;

  private timers: ReturnType<typeof setTimeout>[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // ── State machine ───────────────────────────────────────────
  stage = signal<Stage>('pick');

  // Pick
  prompts = signal<SpeakPrompt[]>([]);
  filter = signal<SpeakPromptType | 'all'>('all');
  current = signal<SpeakPrompt | null>(null);

  // Ready / recording
  countdown = signal(0);          // 3-2-1 before the mic opens (0 = not counting)
  elapsed = signal(0);            // live seconds while recording
  ttsSpeaking = signal(false);
  ttsSupported = signal(false);

  // Review — the editable transcript (also the typed-answer path).
  transcript = signal('');
  /** True when the user chose typing (no delivery stats, worker skips pace remarks). */
  typedMode = signal(false);

  // Grading gate
  entryVisible = signal(false);
  entryClosing = signal(false);
  private entryOpenedAt = 0;

  // Results
  grade = signal<SpeakGrade | null>(null);
  meme = signal<MemeResult | null>(null);
  memeFailed = signal(false);
  xpEarned = signal(0);

  constructor() {
    this.ttsSupported.set(isPlatformBrowser(this.platformId) && 'speechSynthesis' in window);
    // Arena mode while a rep is live — footer gone, the stage owns the screen.
    effect(() => {
      const s = this.stage();
      if (s === 'recording' || s === 'review' || s === 'grading') this.arena.enter();
      else this.arena.exit();
    });
    inject(SeoService).update({
      title: 'Speak Mode — Practice Answering Interview Questions Out Loud',
      description:
        'Answer interview prompts by voice and get coached: grammar fixes, structure feedback, filler-word and pace stats, and stronger ways to say it. Free, in your browser.',
      keywords: 'spoken english practice, interview speaking practice, communication skills developer, grammar feedback interview',
    });
    this.svc.loadPrompts().subscribe(ps => this.prompts.set(ps));
  }

  ngOnDestroy(): void {
    this.timers.forEach(t => clearTimeout(t));
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.speech.stop();
    this.stopTts();
    this.arena.exit();
  }

  // ── Pick ────────────────────────────────────────────────────
  readonly filtered = computed(() => {
    const f = this.filter();
    const all = this.prompts();
    return f === 'all' ? all : all.filter(p => p.type === f);
  });

  choose(p: SpeakPrompt): void {
    this.current.set(p);
    this.resetAttempt();
    this.stage.set('ready');
  }

  surpriseMe(): void {
    const pool = this.filtered();
    if (!pool.length) return;
    this.choose(pool[Math.floor(Math.random() * pool.length)]);
  }

  // ── Ready: TTS + countdown ──────────────────────────────────
  hearPrompt(): void {
    const p = this.current();
    if (!p || !this.ttsSupported()) return;
    this.stopTts();
    const u = new SpeechSynthesisUtterance(p.prompt);
    u.rate = 0.95;
    u.onend = () => this.ttsSpeaking.set(false);
    u.onerror = () => this.ttsSpeaking.set(false);
    this.ttsSpeaking.set(true);
    speechSynthesis.speak(u);
  }

  private stopTts(): void {
    if (this.ttsSupported()) speechSynthesis.cancel();
    this.ttsSpeaking.set(false);
  }

  /** 3-2-1 breath, then the mic opens. */
  startSpeaking(): void {
    if (!this.speech.supported()) { this.startTyping(); return; }
    this.stopTts();
    this.countdown.set(3);
    const step = () => {
      const n = this.countdown() - 1;
      this.countdown.set(n);
      if (n > 0) this.later(step, 800);
      else this.beginRecording();
    };
    this.later(step, 800);
  }

  startTyping(): void {
    this.stopTts();
    this.typedMode.set(true);
    this.transcript.set('');
    this.stage.set('review');
  }

  private beginRecording(): void {
    this.typedMode.set(false);
    this.speech.reset();
    this.elapsed.set(0);
    this.stage.set('recording');
    this.speech.start();
    if (isPlatformBrowser(this.platformId)) {
      this.tickTimer = setInterval(() => this.elapsed.update(s => s + 1), 1000);
    }
  }

  finishRecording(): void {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    this.speech.stop();
    this.transcript.set(this.speech.finalText());
    this.stage.set('review');
  }

  reRecord(): void {
    this.speech.reset();
    this.transcript.set('');
    this.stage.set('ready'); // the countdown renders on the ready stage
    this.startSpeaking();
  }

  /** Timer turns amber once the answer runs 1.5× past the target. */
  readonly overTime = computed(() => {
    const t = this.current()?.targetSeconds ?? 60;
    return this.elapsed() > t * 1.5;
  });

  // ── Review: local delivery metrics (free, client-side) ──────
  readonly wordCount = computed(() =>
    this.transcript().trim() ? this.transcript().trim().split(/\s+/).length : 0);

  readonly canGrade = computed(() => this.wordCount() >= 5);

  /** Stats from what was actually SPOKEN (pre-edit) — edits fix mis-hearings,
   *  they don't change how the answer was delivered. */
  private spokenStats() {
    return computeVoiceStats(this.speech.finalText(), this.speech.seconds());
  }

  readonly paceWpm = computed(() => {
    if (this.typedMode()) return null;
    const secs = this.speech.seconds();
    const words = this.spokenStats()?.words ?? 0;
    return secs >= 5 && words > 0 ? Math.round(words / (secs / 60)) : null;
  });

  readonly paceBand = computed(() => {
    const wpm = this.paceWpm();
    if (wpm === null) return null;
    if (wpm < 90) return { icon: '🐢', label: 'Too slow — sounds hesitant', ok: false };
    if (wpm < 110) return { icon: '🚶', label: 'Measured — fine, could add energy', ok: true };
    if (wpm <= 160) return { icon: '✅', label: 'Ideal interview pace', ok: true };
    if (wpm <= 180) return { icon: '🏃', label: 'Fast — breathe between points', ok: false };
    return { icon: '🌀', label: 'Racing — listeners will drop off', ok: false };
  });

  readonly fillerBand = computed(() => {
    if (this.typedMode()) return null;
    const s = this.spokenStats();
    if (!s) return null;
    const per100 = (s.fillers / s.words) * 100;
    if (per100 < 2) return { icon: '✅', label: `${s.fillers} filler words — clean`, ok: true };
    if (per100 <= 5) return { icon: '😬', label: `${s.fillers} filler words — noticeable`, ok: false };
    return { icon: '🚨', label: `${s.fillers} filler words — pause instead of "um"`, ok: false };
  });

  readonly durationBand = computed(() => {
    if (this.typedMode()) return null;
    const secs = Math.round(this.speech.seconds());
    if (secs < 3) return null;
    const target = this.current()?.targetSeconds ?? 60;
    if (secs < target * 0.75) return { icon: '⏱️', label: `${secs}s — too short, room to add an example`, ok: false };
    if (secs > target * 1.5) return { icon: '⏱️', label: `${secs}s — rambling, trim to the point`, ok: false };
    return { icon: '⏱️', label: `${secs}s — on time for ~${target}s`, ok: true };
  });

  // ── Grading ─────────────────────────────────────────────────
  getCoached(): void {
    const p = this.current();
    if (!p || !this.canGrade()) return;
    this.stage.set('grading');
    this.openEntry();
    const stats = this.typedMode() ? undefined : this.spokenStats();
    this.svc.grade({
      transcript: this.transcript().trim(),
      prompt: p.prompt,
      promptType: p.type,
      seconds: stats?.seconds ?? 0,
      words: stats?.words ?? this.wordCount(),
      fillers: stats?.fillers ?? 0,
      typed: this.typedMode() || !stats,
    }).subscribe(g => {
      this.closeEntry();
      this.grade.set(g);
      this.finalize(g);
    });
  }

  private finalize(g: SpeakGrade): void {
    const xp = g.failed ? 0 : this.computeXp(g);
    this.xpEarned.set(xp);
    if (xp > 0) this.game.awardXp(xp);
    if (!g.failed) {
      this.game.recordSpeakRep();
      this.recordRound(g);
      this.memeFailed.set(false);
      this.meme.set(this.memeSvc.forScore(g.scores.overall, this.current()?.tag));
    } else {
      this.meme.set(null);
    }
    this.later(() => this.stage.set('results'), 600);
  }

  /** Small per-rep XP: score + delivery bonuses (a rep ≈ one question, not a round). */
  private computeXp(g: SpeakGrade): number {
    let xp = g.scores.overall;
    if (this.paceBand()?.ok) xp += 2;
    if (this.fillerBand()?.ok) xp += 2;
    return xp;
  }

  private recordRound(g: SpeakGrade): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const p = this.current();
    if (!p) return;
    const round: RoundRecord = {
      id: 'sp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      date: new Date().toISOString(),
      arena: 'speak',
      level: p.type,
      levelName: `Speak: ${TYPE_META[p.type].label}`,
      score: g.scores.overall,
      time: Math.round(this.speech.seconds()),
      questions: [{ module: TYPE_META[p.type].label, question: p.prompt, score: g.scores.overall }],
    };
    this.progress.recordRound(round);
  }

  // ── Results ─────────────────────────────────────────────────
  scoreColor(score: number): string {
    if (score >= 9) return '#34d399';
    if (score >= 7) return '#60a5fa';
    if (score >= 5) return '#fbbf24';
    if (score >= 3) return '#fb923c';
    return '#f87171';
  }

  fixKey(i: number, f: GrammarFix): string { return i + f.before; }

  onMemeError(): void { this.memeFailed.set(true); }

  sameAgain(): void {
    this.resetAttempt();
    this.stage.set('ready');
  }

  newPrompt(): void {
    this.resetAttempt();
    this.current.set(null);
    this.stage.set('pick');
  }

  private resetAttempt(): void {
    this.speech.reset();
    this.transcript.set('');
    this.typedMode.set(false);
    this.elapsed.set(0);
    this.countdown.set(0);
    this.grade.set(null);
    this.meme.set(null);
    this.memeFailed.set(false);
    this.xpEarned.set(0);
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  // ── Entry gate (same choreography as the résumé trial) ──────
  private openEntry(): void {
    this.entryClosing.set(false);
    this.entryVisible.set(true);
    this.entryOpenedAt = this.now();
  }

  private closeEntry(): void {
    if (!this.entryVisible()) return;
    const wait = Math.max(0, 1900 - (this.now() - this.entryOpenedAt));
    this.later(() => {
      this.entryClosing.set(true);
      this.later(() => this.entryVisible.set(false), 420);
    }, wait);
  }

  // ── Leave guard ─────────────────────────────────────────────
  /** A rep is "live" once words are on the table — leaving loses them. */
  readonly repLive = computed(() =>
    this.stage() === 'recording' || this.stage() === 'grading' ||
    (this.stage() === 'review' && this.wordCount() > 0));

  showLeaveDialog = signal(false);
  private leaveResolver: ((proceed: boolean) => void) | null = null;

  canDeactivate(): boolean | Promise<boolean> {
    if (!this.repLive() || !isPlatformBrowser(this.platformId)) return true;
    this.showLeaveDialog.set(true);
    return new Promise<boolean>(resolve => (this.leaveResolver = resolve));
  }

  confirmLeave(): void {
    this.showLeaveDialog.set(false);
    this.leaveResolver?.(true);
    this.leaveResolver = null;
  }

  stayHere(): void {
    this.showLeaveDialog.set(false);
    this.leaveResolver?.(false);
    this.leaveResolver = null;
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnloadHandler(event: BeforeUnloadEvent): void {
    if (this.repLive() && isPlatformBrowser(this.platformId)) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  // ── utils ───────────────────────────────────────────────────
  private later(fn: () => void, ms: number): void {
    if (!isPlatformBrowser(this.platformId)) { fn(); return; }
    this.timers.push(setTimeout(fn, ms));
  }

  private now(): number {
    return isPlatformBrowser(this.platformId) ? Date.now() : 0;
  }
}
