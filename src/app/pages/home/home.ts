import { Component, ElementRef, afterNextRender, inject, signal, WritableSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../core/services/seo.service';

interface TechCard {
  id: string;
  icon: string;
  name: string;
  description: string;
  tag: string;
  count: string;
  gradient: string;
  path: string;
  delay: string;
}

/** One card in the AI-toolbox grid — the practice tools beyond the flagship. */
interface Tool {
  icon: string;
  title: string;
  desc: string;
  tag: string;
  cta: string;
  path: string;
}

interface Spark {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  emoji: string;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent {
  private host = inject(ElementRef<HTMLElement>);

  // Count-up stats (animate when the stats bar scrolls into view)
  readonly statQuestions = signal(0);
  readonly statTech = signal(0);
  readonly statLevels = signal(0);

  // Click-burst particles
  readonly sparks = signal<Spark[]>([]);
  private sparkId = 0;
  private readonly sparkEmojis = ['✨', '⚡', '🚀', '💡', '🎯', '🔥', '💎', '⭐'];

  constructor() {
    inject(SeoService).update({
      title: 'CodeRefresher — AI Interviews You On Your Own Résumé',
      description:
        'Upload your résumé and get grilled on it, claim by claim — plus AI-graded practice rounds for Angular, React, Next.js, NestJS, .NET and SQL with XP, streaks, and a progress dashboard.',
      keywords: 'resume interview, ai mock interview, CodeRefresher, angular interview questions, react interview questions, next.js interview questions, nestjs interview questions, coding interview prep, daily coding challenge',
    });

    // Runs only in the browser, after the first render — SSR-safe.
    afterNextRender(() => this.initInteractions());
  }

  // ── interactivity wiring ───────────────────────────────────
  private initInteractions(): void {
    const root = this.host.nativeElement as HTMLElement;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // One observer releases paused entrance animations and kicks off the
    // count-up stats, the readiness-ring dials and the heatmap bars as each
    // scrolls into view.
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          io.unobserve(el);
          el.classList.add('in'); // release the paused entrance animation
          if (el.dataset['ring'] !== undefined) this.animateRing(el, reduce);
          if (el.dataset['bar'] !== undefined) el.style.width = `${el.dataset['bar']}%`;
          if (el.classList.contains('stats-bar')) this.startStats(reduce);
        }
      },
      { threshold: 0.15 },
    );
    root.querySelectorAll('.reveal, .stats-bar, [data-ring], [data-bar]').forEach(el => io.observe(el));
  }

  private startStats(reduce: boolean): void {
    if (reduce) {
      this.statQuestions.set(650);
      this.statTech.set(6);
      this.statLevels.set(4);
      return;
    }
    this.animate(this.statQuestions, 650, 1200);
    this.animate(this.statTech, 6, 900);
    this.animate(this.statLevels, 4, 1000);
  }

  /** Fill a readiness dial's conic-gradient and count its score up from 0. */
  private animateRing(el: HTMLElement, reduce: boolean): void {
    const target = parseFloat(el.dataset['ring'] ?? '0');
    const score = parseFloat(el.dataset['score'] ?? '0');
    const color = el.dataset['color'] ?? '#34d399';
    const span = el.querySelector('span');
    const paint = (p: number, s: number): void => {
      el.style.background = `conic-gradient(${color} ${p.toFixed(1)}%, rgba(255,255,255,0.08) 0)`;
      if (span) span.textContent = s.toFixed(1);
    };
    if (reduce) {
      paint(target, score);
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / 1300);
      const eased = 1 - Math.pow(1 - t, 3);
      paint(target * eased, score * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Once an entrance animation ends, drop it so hover/tilt transforms aren't
      pinned by the animation's fill-mode. */
  clearAnim(ev: AnimationEvent): void {
    const name = ev.animationName;
    if (name.startsWith('bounceIn') || name === 'popIn' || name === 'stampIn') {
      (ev.target as HTMLElement).style.animation = 'none';
    }
  }

  private animate(sig: WritableSignal<number>, target: number, duration: number): void {
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      sig.set(Math.round(eased * target));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Cursor spotlight — write CSS vars directly to avoid signal churn on mousemove. */
  onHeroMove(ev: MouseEvent): void {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${ev.clientX - r.left}px`);
    el.style.setProperty('--my', `${ev.clientY - r.top}px`);
  }

  /** A little burst of sparkles wherever the user clicks in the hero. */
  burst(ev: MouseEvent): void {
    const count = 14;
    const batch: Spark[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const dist = 55 + Math.random() * 95;
      batch.push({
        id: this.sparkId++,
        x: ev.clientX,
        y: ev.clientY,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        emoji: this.sparkEmojis[Math.floor(Math.random() * this.sparkEmojis.length)],
      });
    }
    this.sparks.update(s => [...s, ...batch]);
    const ids = new Set(batch.map(b => b.id));
    setTimeout(() => this.sparks.update(s => s.filter(p => !ids.has(p.id))), 900);
  }

  /** 3D tilt on hover for cards. */
  tilt(ev: MouseEvent): void {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width - 0.5;
    const py = (ev.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--rx', `${(-py * 7).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * 7).toFixed(2)}deg`);
  }

  resetTilt(ev: MouseEvent): void {
    const el = ev.currentTarget as HTMLElement;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }

  // ── content ────────────────────────────────────────────────
  readonly journey = [
    { icon: '📚', label: 'Refresh' },
    { icon: '🧪', label: 'Test' },
    { icon: '📊', label: 'Track' },
    { icon: '🎯', label: 'Improve' },
  ];

  /** The full loop, one card per job-to-be-done — related features share a box
   *  (Test Me + follow-ups, Q&A + daily, dashboard + focus, boards + sharing)
   *  so the grid stays scannable. The two résumé flagships live in their own
   *  peek sections above, not here. */
  readonly features: Tool[] = [
    { icon: '🗣️', title: 'Speak Mode', tag: 'New', path: '/speak', cta: 'Speak your answer',
      desc: 'Answer prompts out loud and get coached — grammar fixes, pace & filler-word stats, and stronger ways to say it.' },
    { icon: '🧪', title: 'AI Test Me', tag: 'Practice', path: '/test-me', cta: 'Start a test',
      desc: 'Answer 5 questions from memory — scored 0–10 with what you missed, hint lifelines, and interviewer-style follow-up probing.' },
    { icon: '🎤', title: 'AI Mock Interview', tag: 'Simulate', path: '/interview', cta: 'Get grilled',
      desc: 'Combine up to 3 stacks, rate your confidence, and face fresh AI questions at your level — code editor included, verdict as a meme.' },
    { icon: '📚', title: 'Q&A Arenas + Daily Challenge', tag: 'Learn', path: '/angular', cta: 'Start learning',
      desc: 'Curated questions by level with code examples and plain-English analogies — plus one shared question a day for bonus XP and streaks.' },
    { icon: '🧠', title: 'Ask My Notes', tag: 'AI', path: '/ask-notes', cta: 'Quiz your notes',
      desc: 'Chat with your own study notes — answers come only from what you saved, with the exact sources cited.' },
    { icon: '📊', title: 'Dashboard + Focus Rounds', tag: 'Track', path: '/dashboard', cta: 'See my readiness',
      desc: 'Readiness rings, a module heatmap and weak spots — with one-tap Focus Rounds that drill exactly what needs work. Synced across devices.' },
    { icon: '🏆', title: 'Leaderboard + Scorecards', tag: 'Compete', path: '/leaderboard', cta: 'Climb the boards',
      desc: 'Three ranked boards, XP and level-up crates — plus shareable scorecards to challenge a friend to beat your round.' },
  ];

  readonly techCards: TechCard[] = [
    {
      id: 'angular',
      icon: '⚡',
      name: 'Angular',
      description: 'Components, signals, DI, routing, RxJS, lifecycle hooks, lazy loading — everything you need to ace Angular interviews.',
      tag: 'Frontend Framework',
      count: '100+ Questions',
      gradient: 'linear-gradient(135deg, #c3002f 0%, #ff4857 100%)',
      path: '/angular',
      delay: '60ms',
    },
    {
      id: 'dotnet',
      icon: '🔷',
      name: '.NET / ASP.NET Core',
      description: 'Async patterns, LINQ, EF Core, DI lifetimes, middleware pipelines, SOLID — master backend fundamentals.',
      tag: 'Backend Platform',
      count: '100+ Questions',
      gradient: 'linear-gradient(135deg, #512bd4 0%, #9333ea 100%)',
      path: '/dotnet',
      delay: '150ms',
    },
    {
      id: 'sql',
      icon: '🗄️',
      name: 'SQL',
      description: 'JOINs, window functions, CTEs, indexing strategies, ACID transactions — from basics to advanced query optimization.',
      tag: 'Database Language',
      count: '100+ Questions',
      gradient: 'linear-gradient(135deg, #0050a0 0%, #0ea5e9 100%)',
      path: '/sql',
      delay: '240ms',
    },
    {
      id: 'react',
      icon: '⚛️',
      name: 'React',
      description: 'JSX, components, props, state, hooks, context, custom hooks, Suspense and performance — everything to ace React interviews.',
      tag: 'Frontend Library',
      count: '100+ Questions',
      gradient: 'linear-gradient(135deg, #087ea4 0%, #61dafb 100%)',
      path: '/react',
      delay: '330ms',
    },
    {
      id: 'nextjs',
      icon: '🔼',
      name: 'Next.js',
      description: 'App Router, Server Components, SSR/SSG/ISR, data fetching, route handlers, server actions, caching and deployment.',
      tag: 'Fullstack Framework',
      count: '100+ Questions',
      gradient: 'linear-gradient(135deg, #111827 0%, #4b5563 100%)',
      path: '/nextjs',
      delay: '420ms',
    },
    {
      id: 'nestjs',
      icon: '🐱',
      name: 'NestJS',
      description: 'Controllers, providers, modules, dependency injection, pipes, guards, interceptors, microservices and testing.',
      tag: 'Backend Framework',
      count: '100+ Questions',
      gradient: 'linear-gradient(135deg, #a1132e 0%, #e0234e 100%)',
      path: '/nestjs',
      delay: '510ms',
    },
  ];
}
