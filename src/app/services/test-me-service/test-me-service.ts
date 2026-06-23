import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export type Verdict = 'nailed_it' | 'good' | 'partial' | 'needs_work' | 'missed';

export interface EvalResult {
  score: number;
  verdict: Verdict;
  strengths: string;
  missing: string;
  tip: string;
}

export interface VerdictStyle {
  label: string;
  emoji: string;
  ring: string;
  text: string;
  glow: string;
}

/** Display metadata for each verdict bucket (ported from the design reference). */
export const VERDICT_DISPLAY: Record<Verdict, VerdictStyle> = {
  nailed_it:  { label: 'Nailed It!',  emoji: '🎯', ring: '#34d399', text: '#34d399', glow: 'rgba(52,211,153,0.35)' },
  good:       { label: 'Good',        emoji: '✅', ring: '#60a5fa', text: '#60a5fa', glow: 'rgba(96,165,250,0.35)' },
  partial:    { label: 'Partial',     emoji: '⚠️', ring: '#fbbf24', text: '#fbbf24', glow: 'rgba(251,191,36,0.35)' },
  needs_work: { label: 'Needs Work',  emoji: '📝', ring: '#fb923c', text: '#fb923c', glow: 'rgba(251,146,60,0.35)' },
  missed:     { label: 'Missed',      emoji: '❌', ring: '#f87171', text: '#f87171', glow: 'rgba(248,113,113,0.35)' },
};

/** Score → ring colour (0–10 scale). */
export function scoreColor(s: number): string {
  if (s >= 9) return '#34d399';
  if (s >= 7) return '#60a5fa';
  if (s >= 5) return '#fbbf24';
  if (s >= 3) return '#fb923c';
  return '#f87171';
}

export interface Rank {
  title: string;
  emoji: string;
  blurb: string;
}

/** Overall average score → a fun rank shown on the results screen. */
export function rankFor(avg: number): Rank {
  if (avg >= 9) return { title: 'Interview Legend',   emoji: '🏆', blurb: 'Flawless. You could teach this topic.' };
  if (avg >= 7.5) return { title: 'Interview Ready',  emoji: '🚀', blurb: "You'd walk into the room with confidence." };
  if (avg >= 6) return { title: 'Almost There',       emoji: '💪', blurb: 'Solid foundation — polish the gaps and you’re set.' };
  if (avg >= 4) return { title: 'Warming Up',         emoji: '🔥', blurb: 'The basics are landing. Keep drilling.' };
  return { title: 'Fresh Start', emoji: '🌱', blurb: 'Everyone starts here. Review and run it back.' };
}

@Injectable({ providedIn: 'root' })
export class TestMeService {
  private base = 'https://coderefresherworker.manavnanda2404.workers.dev';
  private apiUrl = `${this.base}/api/evaluate`;
  private http = inject(HttpClient);

  /** Lifeline hint — a one-line nudge that doesn't reveal the answer. */
  getHint(question: string, correctAnswer: string): Observable<string> {
    return this.http
      .post<{ hint: string }>(`${this.base}/api/hint`, { question, correctAnswer })
      .pipe(
        map(r => r?.hint || 'Think about the core concept this question is testing.'),
        catchError(() => of('Think about the core concept this question is testing.')),
      );
  }

  /**
   * Interviewer follow-up probe. Returns the AI's follow-up question, or `null` when the AI
   * declines to probe (non-answer / off-topic) or the call fails. `null` always means
   * "just advance, don't show a probe" — we never invent a generic follow-up.
   */
  getFollowup(question: string, userAnswer: string, correctAnswer: string): Observable<string | null> {
    return this.http
      .post<{ followup: string | null }>(`${this.base}/api/followup`, { question, userAnswer, correctAnswer })
      .pipe(
        map(r => (r?.followup && r.followup.trim()) ? r.followup.trim() : null),
        catchError(() => of(null)),
      );
  }

  /** Evaluate a single answer against the ground-truth answer. */
  evaluate(questionData: any, userAnswer: string): Observable<EvalResult> {
    return this.http.post<EvalResult>(this.apiUrl, {
      question: questionData.question,
      userAnswer,
      correctAnswer: questionData.answer,
      codeExample: questionData.codeExample || null,
      simpleExample: questionData.simpleExample || null,
    });
  }

  /**
   * Evaluate a batch of answers in parallel. A failed/empty answer resolves to a
   * graceful fallback so one bad request never sinks the whole results screen.
   */
  evaluateBatch(questions: any[], answers: string[]): Observable<EvalResult[]> {
    return forkJoin(
      questions.map((q, i) => {
        const answer = (answers[i] ?? '').trim();
        if (!answer) return of(this.skipped());
        return this.evaluate(q, answer).pipe(catchError(() => of(this.failed())));
      })
    );
  }

  private skipped(): EvalResult {
    return {
      score: 0,
      verdict: 'missed',
      strengths: 'No answer submitted for this question.',
      missing: 'Give it a shot next time — even a partial answer earns points.',
      tip: 'Type what you remember; the AI rewards partial understanding.',
    };
  }

  private failed(): EvalResult {
    return {
      score: 0,
      verdict: 'needs_work',
      strengths: 'We couldn’t reach the evaluator for this one.',
      missing: 'Network or service hiccup — your answer was not graded.',
      tip: 'Check your connection and try the quiz again.',
    };
  }
}
