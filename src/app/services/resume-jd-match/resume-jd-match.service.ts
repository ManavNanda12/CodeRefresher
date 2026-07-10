import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export type MatchVerdict = 'strong' | 'good' | 'partial' | 'weak';
export type GapImportance = 'must' | 'nice';

/** A JD requirement the résumé actually proves — with the proving line. */
export interface MatchedSkill {
  skill: string;
  evidence: string;
}

/** Adjacent/transferable experience that isn't the named requirement. */
export interface PartialSkill {
  skill: string;
  note: string;
}

/** A JD requirement the résumé is silent on. */
export interface MissingSkill {
  skill: string;
  importance: GapImportance;
  tip: string | null;
}

export interface JdMatchReport {
  /** Job title extracted from the JD ('' if unstated). */
  role: string;
  company: string;
  /** 0-100 — missing must-haves cost far more than nice-to-haves. */
  score: number;
  verdict: MatchVerdict;
  /** Recruiter's honest 2-3 sentence read: would this pass the screen? */
  summary: string;
  matched: MatchedSkill[];
  partial: PartialSkill[];
  missing: MissingSkill[];
  /** Résumé strengths the JD never asked for — differentiators. */
  extras: string[];
  /** Concrete tailoring edits for THIS application. */
  suggestions: string[];
}

/**
 * Résumé × JD Match — one call scores a résumé against a job description like
 * a screening recruiter + ATS scanner: every JD requirement lands in matched /
 * partial / missing, with evidence quotes and tailoring edits. The worker
 * caches results in KV on a hash of both texts, so re-running the same pair
 * (or tweaking then undoing) never pays twice.
 */
@Injectable({ providedIn: 'root' })
export class ResumeJdMatchService {
  private base = 'https://coderefresherworker.manavnanda2404.workers.dev';
  private http = inject(HttpClient);

  /** Résumé + JD text → full match report. Errors propagate (caller shows them). */
  match(resumeText: string, jdText: string): Observable<JdMatchReport> {
    return this.http
      .post<JdMatchReport & { error?: string }>(`${this.base}/api/resume-jd-match`, { resumeText, jdText })
      .pipe(
        map(r => {
          if (!Number.isFinite(r?.score)) throw new Error(r?.error || 'No match report returned');
          return {
            role: r.role ?? '',
            company: r.company ?? '',
            score: Math.max(0, Math.min(100, Math.round(r.score))),
            verdict: this.cleanVerdict(r.verdict, r.score),
            summary: r.summary ?? '',
            matched: Array.isArray(r.matched)
              ? r.matched.filter(x => x?.skill).map(x => ({ skill: x.skill, evidence: x.evidence ?? '' }))
              : [],
            partial: Array.isArray(r.partial)
              ? r.partial.filter(x => x?.skill).map(x => ({ skill: x.skill, note: x.note ?? '' }))
              : [],
            missing: Array.isArray(r.missing)
              ? r.missing.filter(x => x?.skill).map(x => ({
                  skill: x.skill,
                  importance: x.importance === 'nice' ? 'nice' as const : 'must' as const,
                  tip: x.tip ?? null,
                }))
              : [],
            extras: Array.isArray(r.extras) ? r.extras.filter(s => typeof s === 'string' && s) : [],
            suggestions: Array.isArray(r.suggestions) ? r.suggestions.filter(s => typeof s === 'string' && s) : [],
          };
        }),
        catchError(err => throwError(() => new Error(
          err?.error?.error || err?.message || 'Match analysis failed'))),
      );
  }

  private cleanVerdict(v: unknown, score: number): MatchVerdict {
    if (v === 'strong' || v === 'good' || v === 'partial' || v === 'weak') return v;
    return score >= 85 ? 'strong' : score >= 65 ? 'good' : score >= 40 ? 'partial' : 'weak';
  }
}
