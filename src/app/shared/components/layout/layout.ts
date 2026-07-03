import { Component, HostListener, inject, signal, PLATFORM_ID } from '@angular/core';
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
  /** One-line description shown in rich dropdown menus. */
  desc?: string;
}

/** A header dropdown: rich items on top, optional compact topic links below. */
interface NavGroup {
  id: string;
  label: string;
  icon: string;
  badge?: string;
  /** Flagship groups get the accent-pill trigger (the business lives here). */
  flagship?: boolean;
  items: NavItem[];
  topics?: NavItem[];
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
  /** Which header dropdown is open (group id), or null. */
  openMenu = signal<string | null>(null);

  /** Current URL, kept in sync so the "Topics" button can light up on a topic page */
  private currentUrl = signal(isPlatformBrowser(this.platformId) ? this.router.url : '');

  /* Theme-flip flash: a ripple that washes the screen from the toggle on switch */
  readonly flip = signal(false);
  readonly flipX = signal('92%');
  readonly flipY = signal('4%');

  /** Tech pages — nested under Practice ▾ on desktop, flat in the mobile drawer */
  readonly topicItems: NavItem[] = [
    { path: '/angular', label: 'Angular', icon: '⚡' },
    { path: '/dotnet',  label: '.NET',    icon: '🔷' },
    { path: '/sql',     label: 'SQL',     icon: '🗄️' },
    { path: '/react',   label: 'React',   icon: '⚛️' },
    { path: '/nextjs',  label: 'Next.js', icon: '🔼' },
    { path: '/nestjs',  label: 'NestJS',  icon: '🐱' },
  ];

  /**
   * Grouped header nav — the business leads. Interview (flagship, résumé-first),
   * then Practice; Dashboard/Leaderboard stay top-level; Home is the brand.
   */
  readonly navGroups: NavGroup[] = [
    {
      id: 'interview',
      label: 'AI Interview',
      icon: '🎤',
      badge: 'NEW',
      flagship: true,
      items: [
        { path: '/resume-interview', label: 'Résumé Interview', icon: '📄', badge: 'NEW',
          desc: 'Upload your résumé — defend what it claims' },
        { path: '/interview', label: 'Mock Interview', icon: '🎙️',
          desc: 'Pick your stacks, get grilled at your level' },
      ],
    },
    {
      id: 'practice',
      label: 'Practice',
      icon: '📚',
      items: [
        { path: '/test-me', label: 'Test Me', icon: '🧪',
          desc: '5 AI-graded questions by tech & level' },
        { path: '/ask-notes', label: 'Ask My Notes', icon: '🧠',
          desc: 'Chat with your own study notes' },
      ],
      topics: this.topicItems,
    },
  ];

  /** Top-level links after the dropdowns */
  readonly mainItems: NavItem[] = [
    { path: '/dashboard',   label: 'Dashboard',   icon: '📊' },
    { path: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  ];

  readonly homeItem: NavItem = { path: '/', label: 'Home', icon: '🏠', exact: true };

  /** Full, flat list — used by the mobile sidebar drawer (business-first order) */
  readonly navItems: NavItem[] = [
    this.homeItem,
    ...this.navGroups.flatMap(g => g.items),
    ...this.topicItems,
    ...this.mainItems,
  ];

  /** True when the active route lives inside the given dropdown group. */
  groupActive(g: NavGroup): boolean {
    const url = this.currentUrl();
    return [...g.items, ...(g.topics ?? [])].some(t => url.startsWith(t.path));
  }

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        this.currentUrl.set(e.urlAfterRedirects);
        this.openMenu.set(null);
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

  toggleMenu(id: string, e: MouseEvent): void {
    e.stopPropagation();
    this.openMenu.update(open => (open === id ? null : id));
  }

  /** Close any open dropdown on a click outside of it */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openMenu()) this.openMenu.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openMenu.set(null);
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
