import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { WORKER_BASE } from '../../core/services/user.service';

export type SpeakPromptType = 'concept' | 'behavioral' | 'workplace';

/** One speaking prompt from the static bank (public/data/speak.json). */
export interface SpeakPrompt {
  id: string;
  type: SpeakPromptType;
  prompt: string;
  targetSeconds: number;
  tag: string;
  tips: string[];
}

export interface GrammarFix {
  before: string;
  after: string;
  why: string;
}

export interface SpeakScores {
  clarity: number;
  structure: number;
  grammar: number;
  overall: number;
}

export interface SpeakGrade {
  scores: SpeakScores;
  grammarFixes: GrammarFix[];
  structureNote: string;
  concisenessNote: string;
  confidenceNote: string;
  rewrites: string[];
  /** True when the coach couldn't be reached — local delivery stats still render, 0 XP. */
  failed?: boolean;
}

export interface SpeakGradeInput {
  transcript: string;
  prompt: string;
  promptType: SpeakPromptType;
  seconds: number;
  words: number;
  fillers: number;
  typed: boolean;
}

/**
 * Speak Mode (Communication Coach) — loads the static prompt bank and sends
 * ONE transcript per rep to /api/speak-grade for grammar/structure coaching.
 * Audio never leaves the browser; the server only ever sees the transcript.
 */
@Injectable({ providedIn: 'root' })
export class SpeakService {
  private http = inject(HttpClient);

  loadPrompts(): Observable<SpeakPrompt[]> {
    return this.http.get<{ prompts: SpeakPrompt[] }>('data/speak.json').pipe(
      map(r => (Array.isArray(r?.prompts) ? r.prompts.filter(p => p?.prompt) : [])),
      catchError(() => of([])),
    );
  }

  grade(input: SpeakGradeInput): Observable<SpeakGrade> {
    return this.http
      .post<Partial<SpeakGrade>>(`${WORKER_BASE}/api/speak-grade`, input)
      .pipe(
        map(r => this.validate(r)),
        catchError(() => of(this.failedGrade())),
      );
  }

  /** Mirror the worker's normalization so a mangled payload can't break the page. */
  private validate(r: Partial<SpeakGrade>): SpeakGrade {
    const clampScore = (v: unknown) => Math.max(1, Math.min(10, Math.round(Number(v) || 5)));
    const s = r?.scores ?? ({} as SpeakScores);
    const scores: SpeakScores = {
      clarity: clampScore(s.clarity),
      structure: clampScore(s.structure),
      grammar: clampScore(s.grammar),
      overall: clampScore(s.overall),
    };
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return {
      scores,
      grammarFixes: (Array.isArray(r?.grammarFixes) ? r.grammarFixes : [])
        .map(f => ({ before: str(f?.before), after: str(f?.after), why: str(f?.why) }))
        .filter(f => f.before && f.after)
        .slice(0, 5),
      structureNote: str(r?.structureNote),
      concisenessNote: str(r?.concisenessNote),
      confidenceNote: str(r?.confidenceNote),
      rewrites: (Array.isArray(r?.rewrites) ? r.rewrites : [])
        .map(x => str(x)).filter(Boolean).slice(0, 3),
    };
  }

  /** Local fallback so the results screen always renders (delivery stats stay real). */
  private failedGrade(): SpeakGrade {
    return {
      scores: { clarity: 0, structure: 0, grammar: 0, overall: 0 },
      grammarFixes: [],
      structureNote: '',
      concisenessNote: '',
      confidenceNote: "Couldn't reach the coach — network hiccup or busy models. Your delivery stats below are still real. Try again in a minute!",
      rewrites: [],
      failed: true,
    };
  }
}
