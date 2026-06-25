import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { UserService, WORKER_BASE } from './user.service';

/** Result of asking a question against the user's saved notes (RAG). */
export interface RagAnswer {
  answer: string;
  /** The note texts the answer was grounded in (empty when nothing matched). */
  sources: string[];
  /** True when no saved note was close enough — the answer is the "not found" message. */
  noMatch?: boolean;
}

export interface RagIngestResult {
  ingested: number;
  ids: string[];
}

/**
 * Talks to the Cloudflare Worker's RAG endpoints (Vectorize + Llama 3.3).
 * Notes are scoped per user via `userId` (the worker uses it as a Vectorize
 * namespace), so a user only ever retrieves their own notes.
 */
@Injectable({ providedIn: 'root' })
export class RagService {
  private http = inject(HttpClient);
  private user = inject(UserService);

  /** Embed + store each note as a vector under the current user's namespace. */
  ingest(notes: string[]): Observable<RagIngestResult> {
    const body = { notes, userId: this.user.userId() };
    return this.http
      .post<RagIngestResult>(`${WORKER_BASE}/api/rag-ingest`, body, { headers: this.user.authHeader() })
      .pipe(catchError(() => of({ ingested: 0, ids: [] } as RagIngestResult)));
  }

  /** Retrieve the closest notes and have the LLM answer from them. */
  ask(question: string): Observable<RagAnswer> {
    const body = { question, userId: this.user.userId() };
    return this.http
      .post<RagAnswer>(`${WORKER_BASE}/api/rag-ask`, body, { headers: this.user.authHeader() })
      .pipe(
        catchError(() =>
          of({
            answer: 'Something went wrong reaching the assistant. Please try again.',
            sources: [],
            noMatch: true,
          } as RagAnswer),
        ),
      );
  }
}
