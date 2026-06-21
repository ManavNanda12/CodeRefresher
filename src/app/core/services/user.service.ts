import { Injectable, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

/** Base URL of the Cloudflare Worker that also hosts /api/evaluate. */
export const WORKER_BASE = 'https://coderefresherworker.manavnanda2404.workers.dev';

const COOKIE_UID = 'cr_uid';
const COOKIE_EMAIL = 'cr_email';
const COOKIE_NAME = 'cr_name';
const COOKIE_ONBOARDED = 'cr_onboarded';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Progress blob mirrored into localStorage after auth (matches DashboardPayload shape). */
export interface AuthProgress {
  arenas: Record<string, unknown>;
  recentRounds: unknown[];
}

export interface RegisterResponse {
  success: boolean;
  recoveryCode: string;
  /** True when the email already had an account and we adopted it (no duplicate). */
  adopted?: boolean;
  /** The canonical account id — differs from ours when adopted. */
  userId?: string;
  name?: string;
  /** The adopted account's progress, to mirror into localStorage. */
  progress?: AuthProgress;
}

export interface RecoverResponse {
  success: boolean;
  userId: string;
  email: string;
  name?: string;
  /** Full progress blob the client mirrors into localStorage. */
  progress?: unknown;
}

/**
 * Owns the user's identity. The opaque UUID + email live in a first-party cookie
 * (small, < 4KB) — the bulky progress data is cached in localStorage by ProgressService,
 * with Cloudflare KV as the source of truth. Email is also persisted server-side in KV
 * so we can reach users later; the cookie copy is only a convenience for the UI.
 */
@Injectable({ providedIn: 'root' })
export class UserService {
  private platformId = inject(PLATFORM_ID);
  private doc = inject<Document>(DOCUMENT);
  private http = inject(HttpClient);

  readonly userId = signal<string | null>(null);
  readonly email = signal<string | null>(null);
  readonly name = signal<string | null>(null);
  readonly onboarded = signal(false);

  /** Short, shareable secret derived from the UUID — used to restore on another device. */
  readonly recoveryCode = computed(() => {
    const id = this.userId();
    return id ? recoveryCodeFor(id) : '';
  });

  constructor() {
    this.hydrate();
  }

  /** True once the user has given an email and we hold an id. */
  isKnown(): boolean {
    return !!this.userId() && this.onboarded();
  }

  /**
   * First-time onboarding: mint an id, persist identity to the cookie, and register
   * the profile in KV. Resolves to the recovery code even if the network call fails
   * (identity is still usable locally and will sync on the next round).
   */
  register(email: string, name?: string): Observable<RegisterResponse> {
    const id = this.userId() ?? generateUuid();
    const clean = email.trim();
    const cleanName = (name ?? this.name() ?? '').trim().slice(0, 24);

    this.userId.set(id);
    this.email.set(clean);
    if (cleanName) this.name.set(cleanName);
    this.onboarded.set(true);
    this.writeCookies(id, clean, this.name());

    const code = recoveryCodeFor(id);
    const body: Record<string, string> = { userId: id, email: clean };
    if (this.name()) body['name'] = this.name() as string;
    return this.http
      .post<RegisterResponse>(`${WORKER_BASE}/api/user/register`, body)
      .pipe(
        map(res => {
          // The email already had an account — switch our identity to it so we don't
          // run as a duplicate. localStorage is reconciled by the caller (onboarding).
          if (res?.userId && res.userId !== this.userId()) {
            this.userId.set(res.userId);
            if (res.name) this.name.set(res.name);
            this.writeCookies(res.userId, this.email() ?? clean, this.name());
          }
          return res;
        }),
        catchError(() => of({ success: false, recoveryCode: code })),
      );
  }

  /** Update the email on the existing profile (reuses register's upsert by userId). */
  changeEmail(email: string): Observable<RegisterResponse> {
    return this.register(email);
  }

  /** Set/update the public display name (used on the leaderboard). */
  setName(name: string): Observable<RegisterResponse> {
    return this.register(this.email() ?? '', name);
  }

  /**
   * Permanently delete the server-side profile (KV) and clear local identity.
   * Clears cookies regardless of the network result so the device is always logged out.
   */
  deleteAccount(): Observable<boolean> {
    const userId = this.userId();
    if (!userId) {
      this.signOut();
      return of(true);
    }
    const recoveryCode = recoveryCodeFor(userId);
    return this.http
      .post(`${WORKER_BASE}/api/user/delete`, { userId, recoveryCode })
      .pipe(
        map(() => {
          this.signOut();
          return true;
        }),
        catchError(() => {
          this.signOut();
          return of(true);
        }),
      );
  }

  /** Restore an existing profile from a recovery code on a new device. */
  recover(recoveryCode: string): Observable<RecoverResponse | null> {
    const code = recoveryCode.trim();
    return this.http
      .post<RecoverResponse>(`${WORKER_BASE}/api/user/recover`, { recoveryCode: code })
      .pipe(
        map(res => {
          if (res?.success && res.userId) {
            this.userId.set(res.userId);
            this.email.set(res.email ?? null);
            this.name.set(res.name ?? null);
            this.onboarded.set(true);
            this.writeCookies(res.userId, res.email ?? '', res.name ?? null);
          }
          return res;
        }),
        catchError(() => of(null)),
      );
  }

  /** Wipe local identity (cookies). Does not touch KV. */
  signOut(): void {
    this.userId.set(null);
    this.email.set(null);
    this.name.set(null);
    this.onboarded.set(false);
    this.deleteCookie(COOKIE_UID);
    this.deleteCookie(COOKIE_EMAIL);
    this.deleteCookie(COOKIE_NAME);
    this.deleteCookie(COOKIE_ONBOARDED);
  }

  // ── cookie plumbing (SSR-safe) ─────────────────────────────
  private hydrate(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const uid = this.readCookie(COOKIE_UID);
    if (uid) this.userId.set(uid);
    const email = this.readCookie(COOKIE_EMAIL);
    if (email) this.email.set(decodeURIComponent(email));
    const name = this.readCookie(COOKIE_NAME);
    if (name) this.name.set(decodeURIComponent(name));
    this.onboarded.set(this.readCookie(COOKIE_ONBOARDED) === 'true');
  }

  private writeCookies(uid: string, email: string, name?: string | null): void {
    this.setCookie(COOKIE_UID, uid);
    this.setCookie(COOKIE_EMAIL, encodeURIComponent(email));
    if (name) this.setCookie(COOKIE_NAME, encodeURIComponent(name));
    this.setCookie(COOKIE_ONBOARDED, 'true');
  }

  private setCookie(name: string, value: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const secure = this.doc.location.protocol === 'https:' ? '; Secure' : '';
    this.doc.cookie = `${name}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  }

  private deleteCookie(name: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.doc.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }

  private readCookie(name: string): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const match = this.doc.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? match[1] : null;
  }
}

/** `cr_` + first 8 hex of the UUID — short enough to share, used as the KV recovery key. */
export function recoveryCodeFor(uuid: string): string {
  return 'cr_' + uuid.replace(/-/g, '').slice(0, 8);
}

/** crypto.randomUUID with a tiny fallback for ancient browsers. */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Basic but practical email validation. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
