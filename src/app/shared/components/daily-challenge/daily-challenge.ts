import { Component, computed, inject, signal, PLATFORM_ID, afterNextRender } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { UserService } from '../../../core/services/user.service';
import { GameService } from '../../../core/services/game.service';
import { DailyService, DailyQuestion } from '../../../core/services/daily.service';
import { TestMeService, EvalResult, scoreColor } from '../../../services/test-me-service/test-me-service';

type Stage = 'loading' | 'question' | 'grading' | 'result' | 'done' | 'error';

@Component({
  selector: 'app-daily-challenge',
  imports: [],
  templateUrl: './daily-challenge.html',
  styleUrl: './daily-challenge.css',
})
export class DailyChallengeComponent {
  private platformId = inject(PLATFORM_ID);
  private user = inject(UserService);
  readonly game = inject(GameService);
  private daily = inject(DailyService);
  private testMe = inject(TestMeService);

  open = signal(false);
  stage = signal<Stage>('loading');
  question = signal<DailyQuestion | null>(null);
  answer = signal('');
  result = signal<EvalResult | null>(null);
  xpEarned = signal(0);

  /** True only for an onboarded user — the daily is a logged-in feature. */
  readonly isKnown = computed(() => !!this.user.userId() && this.user.onboarded());
  readonly doneToday = computed(() => this.game.dailyDoneToday());
  /** Show the floating launcher when eligible and the modal is closed. */
  readonly showLauncher = computed(() => this.isKnown() && !this.open());

  private dismissed = false;

  constructor() {
    // After first render (browser only), gently bounce the modal in for an eligible user.
    afterNextRender(() => {
      if (this.isKnown() && !this.doneToday()) {
        setTimeout(() => { if (!this.dismissed) this.launch(); }, 900);
      }
    });
  }

  /** Open the modal: either today's question, or the "come back tomorrow" state. */
  launch(): void {
    if (!isPlatformBrowser(this.platformId) || !this.isKnown()) return;
    this.open.set(true);
    this.result.set(null);
    this.answer.set('');
    if (this.doneToday()) { this.stage.set('done'); return; }
    this.stage.set('loading');
    this.daily.getDailyQuestion().subscribe(q => {
      this.question.set(q);
      this.stage.set(q ? 'question' : 'error');
    });
  }

  updateAnswer(v: string): void {
    this.answer.set(v);
  }

  readonly canSubmit = computed(() => this.answer().trim().length > 0 && this.stage() === 'question');

  submit(): void {
    const q = this.question();
    if (!q || !this.canSubmit()) return;
    this.stage.set('grading');
    this.testMe.evaluate(q, this.answer().trim()).subscribe({
      next: res => this.reveal(res),
      // A graceful fallback so a network hiccup never strands the user mid-challenge.
      error: () => this.reveal({
        score: 0, verdict: 'needs_work',
        strengths: 'We couldn’t reach the grader.',
        missing: 'Your answer wasn’t scored — try again later.',
        tip: 'Check your connection.',
      }),
    });
  }

  private reveal(res: EvalResult): void {
    this.result.set(res);
    this.xpEarned.set(this.game.completeDaily(res.score)); // records the day + awards XP + streak
    this.stage.set('result');
  }

  close(): void {
    this.dismissed = true;
    this.open.set(false);
  }

  // ── display helpers ────────────────────────────────────────
  ringColor(score: number): string {
    return scoreColor(score);
  }

  /** A short, warm line of praise scaled to the score. */
  praise(score: number): string {
    if (score >= 9) return '🏆 Flawless — you owned today’s challenge!';
    if (score >= 7) return '🔥 Brilliant! That was a strong answer.';
    if (score >= 5) return '💪 Nice work — solid understanding.';
    if (score >= 3) return '👍 Good effort — you’re getting there.';
    return '🌱 Every attempt counts. Back at it tomorrow!';
  }
}
