import { Component, HostListener, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { OnboardingModalComponent } from '../onboarding-modal/onboarding-modal';
import { GameEventsComponent } from '../game-events/game-events';
import { DailyChallengeComponent } from '../daily-challenge/daily-challenge';
import { GameService } from '../../../core/services/game.service';
import { ThemeService } from '../../../core/services/theme.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
  badge?: string;
}

@Component({
  selector: 'app-layout',
  imports: [RouterLink, RouterLinkActive, OnboardingModalComponent, GameEventsComponent, DailyChallengeComponent],
  templateUrl: './layout.html',
  styleUrl: './layout.css'
})
export class LayoutComponent {
  private platformId = inject(PLATFORM_ID);
  readonly game = inject(GameService);
  readonly theme = inject(ThemeService);

  sidebarOpen = signal(false);

  /* Theme-flip flash: a ripple that washes the screen from the toggle on switch */
  readonly flip = signal(false);
  readonly flipX = signal('92%');
  readonly flipY = signal('4%');

  navItems: NavItem[] = [
    { path: '/',        label: 'Home',    icon: '🏠', exact: true },
    { path: '/angular', label: 'Angular', icon: '⚡' },
    { path: '/dotnet',  label: '.NET',    icon: '🔷' },
    { path: '/sql',     label: 'SQL',     icon: '🗄️' },
    { path: '/test-me',     label: 'Test Me',     icon: '🧪' },
    { path: '/dashboard',   label: 'Dashboard',   icon: '📊' },
    { path: '/leaderboard', label: 'Leaderboard', icon: '🏆', badge: 'NEW' },
  ];

  onThemeToggle(e: MouseEvent): void {
    this.theme.toggle();
    if (!isPlatformBrowser(this.platformId)) return;
    if (e.clientX || e.clientY) {
      this.flipX.set(e.clientX + 'px');
      this.flipY.set(e.clientY + 'px');
    }
    this.flip.set(false);
    requestAnimationFrame(() => {
      this.flip.set(true);
      setTimeout(() => this.flip.set(false), 650);
    });
  }

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  @HostListener('window:resize')
  onResize(): void {
    if (isPlatformBrowser(this.platformId) && window.innerWidth >= 768) {
      this.sidebarOpen.set(false);
    }
  }

  returnCurrentYear(): number {
    return new Date().getFullYear();
  }

  scrollToTop(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}
