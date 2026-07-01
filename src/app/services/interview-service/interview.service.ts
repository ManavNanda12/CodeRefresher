import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export type Verdict = 'nailed_it' | 'good' | 'partial' | 'needs_work' | 'missed';

export interface GradeItem {
  score: number;
  verdict: Verdict;
  note: string;
}

/** One question sent for grading (expected = the curated ground-truth answer). */
export interface GradeInput {
  question: string;
  expected: string;
  answer: string;
}

export type QuestionKind = 'theory' | 'query' | 'code' | 'scenario';

/** A freshly generated interview question with its model answer + topic. */
export interface GenQuestion {
  question: string;
  expected: string;
  topic: string;
  kind?: QuestionKind;
}

/**
 * Interview grading — the whole round is scored in a SINGLE request to keep the
 * site free (one LLM call per interview, vs one-per-question). Empty answers are
 * scored locally by the caller and never sent, so we only pay for real answers.
 */
@Injectable({ providedIn: 'root' })
export class InterviewService {
  private base = 'https://coderefresherworker.manavnanda2404.workers.dev';
  private apiUrl = `${this.base}/api/interview-grade`;
  private http = inject(HttpClient);

  /**
   * Generate fresh, unique interview questions for a stack. On any failure returns
   * an empty array so the caller transparently falls back to the static bank.
   */
  generateQuestions(tech: string, level: string, count: number, topics: string[]): Observable<GenQuestion[]> {
    return this.http
      .post<{ questions: GenQuestion[] }>(`${this.base}/api/interview-questions`, { tech, level, count, topics })
      .pipe(
        map(r => Array.isArray(r?.questions) ? r.questions : []),
        catchError(() => of([])),
      );
  }

  gradeBatch(tech: string, items: GradeInput[]): Observable<GradeItem[]> {
    if (!items.length) return of([]);
    return this.http
      .post<{ results: GradeItem[] }>(this.apiUrl, { tech, items })
      .pipe(
        map(r => Array.isArray(r?.results) ? r.results.map(x => this.clean(x)) : items.map(() => this.failed())),
        catchError(() => of(items.map(() => this.failed()))),
      );
  }

  private clean(x: GradeItem): GradeItem {
    const score = Math.max(1, Math.min(10, Math.round(Number(x?.score) || 5)));
    return {
      score,
      verdict: x?.verdict ?? this.verdictFromScore(score),
      note: (x?.note ?? '').trim() || 'Graded.',
    };
  }

  private verdictFromScore(s: number): Verdict {
    if (s >= 9) return 'nailed_it';
    if (s >= 7) return 'good';
    if (s >= 5) return 'partial';
    if (s >= 3) return 'needs_work';
    return 'missed';
  }

  private failed(): GradeItem {
    return {
      score: 0,
      verdict: 'needs_work',
      note: "We couldn't reach the interviewer for this one — network hiccup.",
    };
  }
}
