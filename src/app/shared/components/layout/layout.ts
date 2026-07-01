import { Component, HostListener, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';
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
  private router = inject(Router);
  readonly game = inject(GameService);
  readonly theme = inject(ThemeService);

  sidebarOpen = signal(false);
  topicsOpen = signal(false);

  /** Current URL, kept in sync so the "Topics" button can light up on a topic page */
  private currentUrl = signal(isPlatformBrowser(this.platformId) ? this.router.url : '');

  /* Theme-flip flash: a ripple that washes the screen from the toggle on switch */
  readonly flip = signal(false);
  readonly flipX = signal('92%');
  readonly flipY = signal('4%');

  /** Tech pages — collapsed into a single "Topics" dropdown on the desktop header */
  readonly topicItems: NavItem[] = [
    { path: '/angular', label: 'Angular', icon: '⚡' },
    { path: '/dotnet',  label: '.NET',    icon: '🔷' },
    { path: '/sql',     label: 'SQL',     icon: '🗄️' },
    { path: '/react',   label: 'React',   icon: '⚛️', badge: 'NEW' },
    { path: '/nextjs',  label: 'Next.js', icon: '🔼', badge: 'NEW' },
    { path: '/nestjs',  label: 'NestJS',  icon: '🐱', badge: 'NEW' },
  ];

  /** Top-level items shown directly on the desktop header, around the Topics dropdown */
  readonly homeItem: NavItem = { path: '/', label: 'Home', icon: '🏠', exact: true };
  readonly mainItems: NavItem[] = [
    { path: '/test-me',     label: 'Test Me',     icon: '🧪' },
    { path: '/dashboard',   label: 'Dashboard',   icon: '📊' },
    { path: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
    { path: '/ask-notes',   label: 'Ask My Notes', icon: '🧠', badge: 'NEW' },
  ];

  /** Full, flat list — used by the mobile sidebar drawer */
  readonly navItems: NavItem[] = [this.homeItem, ...this.topicItems, ...this.mainItems];

  /** True when the active route is one of the tech pages (highlights the Topics button) */
  readonly topicActive = computed(() =>
    this.topicItems.some(t => this.currentUrl().startsWith(t.path)));

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        this.currentUrl.set(e.urlAfterRedirects);
        this.topicsOpen.set(false);
      });
  }

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

  toggleTopics(e: MouseEvent): void {
    e.stopPropagation();
    this.topicsOpen.update(v => !v);
  }

  /** Close the Topics dropdown on any click outside of it */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.topicsOpen()) this.topicsOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.topicsOpen.set(false);
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
