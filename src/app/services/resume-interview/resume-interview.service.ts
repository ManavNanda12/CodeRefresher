import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { GradeItem, QuestionKind, Verdict } from '../interview-service/interview.service';
import { VoiceStats } from '../../core/services/speech.service';

// Re-exported from the shared SpeechService so existing import sites keep working.
export type { VoiceStats };

export type ClaimType = 'quantified' | 'tech' | 'project' | 'responsibility';

/** One probe-worthy claim extracted from the résumé. */
export interface ResumeClaim {
  id: string;
  text: string;
  type: ClaimType;
  tech: string[];
  probeAngle: string | null;
  probeWorthy: boolean;
}

export interface ResumeExtract {
  name: string;
  /** Email pulled from the résumé, if present — pre-fills the save-account field. */
  email: string;
  headline: string;
  /** Technologies the résumé declares expertise in (skills section + bullets). */
  skills: string[];
  /** Total professional experience in years, when stated/inferable. */
  years: number | null;
  claims: ResumeClaim[];
}

/** A skill the user self-rated before the interview. */
export interface RatedSkill {
  name: string;
  rating: number; // 1-10
}

/** A generated question targeting either a résumé claim or a self-rated skill. */
export interface ResumeQuestion {
  question: string;
  expected: string;
  topic: string;
  kind: QuestionKind;
  claimId?: string;
  skill?: string;
}

/** Did the answer actually back up what the résumé says? */
export type Substantiation = 'backed' | 'shaky' | 'busted';

export interface ResumeGradeItem extends GradeItem {
  sub: Substantiation;
  subNote: string;
  /** One-line delivery feedback — only for answers given by voice. */
  deliveryNote?: string;
}

/** One answer sent for grading, carrying the claim it defends. */
export interface ResumeGradeInput {
  question: string;
  expected: string;
  answer: string;
  claim: string;
  voice?: VoiceStats;
}

/**
 * Résumé-driven interview — the AI reads the résumé, extracts probe-worthy
 * claims, generates questions that attack them, and grades whether answers
 * SUBSTANTIATE the claims. Extraction is cached server-side (KV, keyed on a
 * hash of the text) so the same résumé never pays twice; grading reuses the
 * one-call-per-round /api/interview-grade endpoint.
 */
@Injectable({ providedIn: 'root' })
export class ResumeInterviewService {
  private base = 'https://coderefresherworker.manavnanda2404.workers.dev';
  private http = inject(HttpClient);

  /** Résumé text → structured claims (+ candidate name/headline). Errors propagate. */
  extract(resumeText: string): Observable<ResumeExtract> {
    return this.http
      .post<ResumeExtract & { error?: string }>(`${this.base}/api/resume-extract`, { resumeText })
      .pipe(
        map(r => {
          const claims = Array.isArray(r?.claims) ? r.claims : [];
          if (!claims.length) throw new Error(r?.error || 'No claims found');
          return {
            name: r.name ?? '',
            email: r.email ?? '',
            headline: r.headline ?? '',
            skills: Array.isArray(r.skills) ? r.skills : [],
            years: typeof r.years === 'number' ? r.years : null,
            claims: claims.map((c, i) => ({
              id: c.id || `c${i + 1}`,
              text: c.text ?? '',
              type: c.type ?? 'project',
              tech: Array.isArray(c.tech) ? c.tech : [],
              probeAngle: c.probeAngle ?? null,
              probeWorthy: c.probeWorthy !== false,
            })),
          };
        }),
        catchError(err => throwError(() => new Error(
          err?.error?.error || err?.message || 'Extraction failed'))),
      );
  }

  /** Claims + rated skills → targeted interview questions. Empty array on failure (caller shows error). */
  generateQuestions(
    claims: ResumeClaim[],
    count: number,
    skills: RatedSkill[] = [],
    years: number | null = null,
  ): Observable<ResumeQuestion[]> {
    return this.http
      .post<{ questions: ResumeQuestion[] }>(`${this.base}/api/resume-interview-questions`, {
        claims: claims.map(c => ({
          id: c.id, text: c.text, type: c.type, tech: c.tech, probeAngle: c.probeAngle,
        })),
        skills,
        years,
        count,
      })
      .pipe(
        map(r => Array.isArray(r?.questions) ? r.questions.filter(q => q?.question) : []),
        catchError(() => of([])),
      );
  }

  /** One nudge toward the answer without revealing it — same lifeline endpoint as Test Me. */
  getHint(question: string, expected: string): Observable<string> {
    const fallback = 'Think about the core concept this question is really testing.';
    return this.http
      .post<{ hint: string }>(`${this.base}/api/hint`, { question, correctAnswer: expected })
      .pipe(
        map(r => (r?.hint ?? '').trim() || fallback),
        catchError(() => of(fallback)),
      );
  }

  /** Grade the whole round in ONE call — with the claim-substantiation dimension. */
  gradeBatch(items: ResumeGradeInput[]): Observable<ResumeGradeItem[]> {
    if (!items.length) return of([]);
    return this.http
      .post<{ results: ResumeGradeItem[] }>(`${this.base}/api/interview-grade`, { tech: 'resume', items })
      .pipe(
        map(r => Array.isArray(r?.results)
          ? r.results.map(x => this.clean(x))
          : items.map(() => this.failed())),
        catchError(() => of(items.map(() => this.failed()))),
      );
  }

  private clean(x: ResumeGradeItem): ResumeGradeItem {
    const score = Math.max(1, Math.min(10, Math.round(Number(x?.score) || 5)));
    return {
      score,
      verdict: x?.verdict ?? this.verdictFromScore(score),
      note: (x?.note ?? '').trim() || 'Graded.',
      sub: x?.sub === 'backed' || x?.sub === 'shaky' || x?.sub === 'busted'
        ? x.sub
        : score >= 7 ? 'backed' : score >= 5 ? 'shaky' : 'busted',
      subNote: (x?.subNote ?? '').trim(),
      deliveryNote: (x?.deliveryNote ?? '').trim() || undefined,
    };
  }

  private verdictFromScore(s: number): Verdict {
    if (s >= 9) return 'nailed_it';
    if (s >= 7) return 'good';
    if (s >= 5) return 'partial';
    if (s >= 3) return 'needs_work';
    return 'missed';
  }

  private failed(): ResumeGradeItem {
    return {
      score: 0,
      verdict: 'needs_work',
      note: "We couldn't reach the interviewer for this one — network hiccup.",
      sub: 'shaky',
      subNote: 'Could not be verified this round.',
    };
  }
}
