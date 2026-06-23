import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
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
const COOKIE_TOKEN = 'cr_tok'; // session secret proving ownership of the userId
const COOKIE_RC = 'cr_rc';     // current (server-issued) recovery code
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Progress blob mirrored into localStorage after auth (matches DashboardPayload shape). */
export interface AuthProgress {
  arenas: Record<string, unknown>;
  recentRounds: unknown[];
}

export interface RegisterResponse {
  success: boolean;
  recoveryCode?: string;
  /** Session token, returned once when freshly minted (first register / migration). */
  token?: string;
  /** True when the email already belongs to a different account — restore via recovery code. */
  emailInUse?: boolean;
  /** @deprecated email-adoption was removed; always false now. */
  adopted?: boolean;
  /** The canonical account id. */
  userId?: string;
  name?: string;
  /** @deprecated adoption removed — no progress is returned from register anymore. */
  progress?: AuthProgress;
}

export interface RecoverResponse {
  success: boolean;
  userId: string;
  email: string;
  name?: string;
  /** Rotated session token for this device. */
  token?: string;
  /** Current recovery code (may be upgraded from a legacy one). */
  recoveryCode?: string;
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

  /** Session secret proving ownership of the userId (sent on per-user API calls). */
  readonly token = signal<string | null>(null);

  /** Current recovery code — server-issued (random, high-entropy), persisted in a cookie. */
  readonly recoveryCode = signal('');

  constructor() {
    this.hydrate();
    // One-time migration: a returning user who has an identity but no session token yet
    // (created before tokens existed) silently re-registers to mint one + upgrade their
    // recovery code. register() preserves all server-side progress.
    if (isPlatformBrowser(this.platformId) && this.userId() && this.onboarded() && !this.token() && this.email()) {
      this.register(this.email() as string).subscribe();
    }
  }

  /** Authorization header for per-user API calls, or {} when we hold no token. */
  authHeader(): Record<string, string> {
    const t = this.token();
    return t ? { Authorization: `Bearer ${t}` } : {};
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
    const hadIdentity = !!this.userId();
    const id = this.userId() ?? generateUuid();
    const clean = email.trim();
    const cleanName = (name ?? this.name() ?? '').trim().slice(0, 24);

    this.userId.set(id);
    this.email.set(clean);
    if (cleanName) this.name.set(cleanName);
    this.onboarded.set(true);
    this.writeCookies(id, clean, this.name());

    const body: Record<string, string> = { userId: id, email: clean };
    if (this.name()) body['name'] = this.name() as string;
    return this.http
      .post<RegisterResponse>(`${WORKER_BASE}/api/user/register`, body, { headers: this.authHeader() })
      .pipe(
        map(res => {
          if (res?.token) this.setToken(res.token);
          if (res?.recoveryCode) this.setRecoveryCode(res.recoveryCode);
          if (res?.name) this.name.set(res.name);
          return res;
        }),
        catchError(err => {
          // 409 → the email belongs to a DIFFERENT account. Don't keep a fresh empty
          // identity; roll back so the user can restore it with their recovery code.
          if (err?.status === 409) {
            if (!hadIdentity) this.signOut();
            return of({ success: false, emailInUse: true } as RegisterResponse);
          }
          // Other failures (e.g. offline): keep the optimistic identity and sync later.
          return of({ success: false } as RegisterResponse);
        }),
      );
  }

  /** Persist the session token (signal + cookie). */
  private setToken(token: string): void {
    this.token.set(token);
    this.setCookie(COOKIE_TOKEN, token);
  }

  /** Persist the current recovery code (signal + cookie). */
  private setRecoveryCode(code: string): void {
    this.recoveryCode.set(code);
    this.setCookie(COOKIE_RC, encodeURIComponent(code));
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
    return this.http
      .post(`${WORKER_BASE}/api/user/delete`, { userId, recoveryCode: this.recoveryCode() }, { headers: this.authHeader() })
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
            if (res.token) this.setToken(res.token);
            if (res.recoveryCode) this.setRecoveryCode(res.recoveryCode);
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
    this.token.set(null);
    this.recoveryCode.set('');
    this.deleteCookie(COOKIE_UID);
    this.deleteCookie(COOKIE_EMAIL);
    this.deleteCookie(COOKIE_NAME);
    this.deleteCookie(COOKIE_ONBOARDED);
    this.deleteCookie(COOKIE_TOKEN);
    this.deleteCookie(COOKIE_RC);
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
    const tok = this.readCookie(COOKIE_TOKEN);
    if (tok) this.token.set(tok);
    const rc = this.readCookie(COOKIE_RC);
    if (rc) this.recoveryCode.set(decodeURIComponent(rc));
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
