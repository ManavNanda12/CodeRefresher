import { Component, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { UserService, isValidEmail } from '../../../core/services/user.service';

type Mode = 'email' | 'recover';

/** Routes that gate behind onboarding (need a known user to be useful). */
const GATED = ['/test-me', '/dashboard'];

/**
 * One-time email capture overlay. Pops the first time the user lands on a gated
 * route without an identity. Also offers recovery-code restore for returning users
 * on a new device. Email is stored in a cookie + KV (never re-derivable as a secret).
 */
@Component({
  selector: 'app-onboarding-modal',
  imports: [],
  templateUrl: './onboarding-modal.html',
  styleUrl: './onboarding-modal.css',
})
export class OnboardingModalComponent {
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  readonly user = inject(UserService);

  open = signal(false);
  mode = signal<Mode>('email');
  nameInput = signal('');
  emailInput = signal('');
  codeInput = signal('');
  error = signal('');
  submitting = signal(false);
  private dismissed = false;

  constructor() {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(e => this.maybeOpen((e as NavigationEnd).urlAfterRedirects));
    // also evaluate the initial URL
    this.maybeOpen(this.router.url);
  }

  private maybeOpen(url: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.dismissed || this.user.isKnown()) return;
    if (GATED.some(g => url === g || url.startsWith(g + '?') || url.startsWith(g + '/'))) {
      this.open.set(true);
    }
  }

  onEmailChange(value: string): void {
    this.emailInput.set(value);
    if (this.error()) this.error.set('');
  }

  onCodeChange(value: string): void {
    this.codeInput.set(value);
    if (this.error()) this.error.set('');
  }

  switchMode(mode: Mode): void {
    this.mode.set(mode);
    this.error.set('');
  }

  submitEmail(): void {
    const email = this.emailInput().trim();
    if (!isValidEmail(email)) {
      this.error.set('Enter a valid email address.');
      return;
    }
    this.submitting.set(true);
    this.user.register(email, this.nameInput().trim()).subscribe(() => {
      this.submitting.set(false);
      this.close();
    });
  }

  submitRecover(): void {
    const code = this.codeInput().trim();
    if (!/^cr_[a-z0-9]{4,}$/i.test(code)) {
      this.error.set('Recovery codes look like cr_1a2b3c4d.');
      return;
    }
    this.submitting.set(true);
    this.user.recover(code).subscribe(res => {
      this.submitting.set(false);
      if (res?.success) {
        this.close();
      } else {
        this.error.set("We couldn't find that recovery code.");
      }
    });
  }

  dismiss(): void {
    this.dismissed = true; // don't nag again this session
    this.close();
  }

  private close(): void {
    this.open.set(false);
  }
}
