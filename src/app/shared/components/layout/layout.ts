import { Component, HostListener, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { OnboardingModalComponent } from '../onboarding-modal/onboarding-modal';
import { GameEventsComponent } from '../game-events/game-events';
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
  imports: [RouterLink, RouterLinkActive, OnboardingModalComponent, GameEventsComponent],
  templateUrl: './layout.html',
  styleUrl: './layout.css'
})
export class LayoutComponent {
  private platformId = inject(PLATFORM_ID);
  readonly game = inject(GameService);
  readonly theme = inject(ThemeService);

  sidebarOpen = signal(false);

  navItems: NavItem[] = [
    { path: '/',        label: 'Home',    icon: '🏠', exact: true },
    { path: '/angular', label: 'Angular', icon: '⚡' },
    { path: '/dotnet',  label: '.NET',    icon: '🔷' },
    { path: '/sql',     label: 'SQL',     icon: '🗄️' },
    { path: '/test-me',   label: 'Test Me',   icon: '🧪' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊', badge: 'NEW' },
  ];

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
