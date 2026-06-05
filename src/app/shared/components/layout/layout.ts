import { Component, HostListener, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
}

@Component({
  selector: 'app-layout',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './layout.html',
  styleUrl: './layout.css'
})
export class LayoutComponent {
  sidebarOpen = signal(false);

  navItems: NavItem[] = [
    { path: '/',        label: 'Home',    icon: '🏠', exact: true },
    { path: '/angular', label: 'Angular', icon: '⚡' },
    { path: '/dotnet',  label: '.NET',    icon: '🔷' },
    { path: '/sql',     label: 'SQL',     icon: '🗄️' },
  ];

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  @HostListener('window:resize')
  onResize(): void {
    if (window.innerWidth >= 768) {
      this.sidebarOpen.set(false);
    }
  }

  returnCurrentYear(): number {
    return new Date().getFullYear();
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
