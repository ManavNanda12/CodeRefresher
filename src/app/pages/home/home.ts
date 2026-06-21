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

interface Feature {
  icon: string;
  title: string;
  desc: string;
  tag: string;
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
      title: 'CodeRefresher — Gamified Interview Practice',
      description:
        'CodeRefresher is a gamified, AI-powered interview prep app for Angular, .NET and SQL — AI-graded quizzes, hint lifelines, animated XP level-ups, and a progress dashboard to improve readiness.',
      keywords: 'CodeRefresher, gamified interview practice, angular interview questions, ai mock interview, angular interview game, coding interview prep',
    });

    // Runs only in the browser, after the first render — SSR-safe.
    afterNextRender(() => this.initInteractions());
  }

  // ── interactivity wiring ───────────────────────────────────
  private initInteractions(): void {
    const root = this.host.nativeElement as HTMLElement;

    // Scroll-reveal
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.14 },
    );
    root.querySelectorAll('.reveal').forEach(el => io.observe(el));

    // Count-up when the stats bar appears
    const stats = root.querySelector('.stats-bar');
    if (stats) {
      const so = new IntersectionObserver(
        entries => {
          if (entries[0].isIntersecting) {
            this.animate(this.statQuestions, 45, 1200);
            this.animate(this.statTech, 3, 900);
            this.animate(this.statLevels, 4, 1000);
            so.disconnect();
          }
        },
        { threshold: 0.5 },
      );
      so.observe(stats);
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

  readonly features: Feature[] = [
    { icon: '📚', title: 'Structured Q&A', desc: 'Curated questions for Angular, .NET & SQL, split by experience level — each with a code example and a plain-English analogy.', tag: 'Learn' },
    { icon: '🧪', title: 'AI Test Me', desc: 'Answer from memory and our AI grades every answer 0–10 against an expert response, with your strengths, gaps and a tip.', tag: 'Practice' },
    { icon: '📊', title: 'Smart Dashboard', desc: 'Readiness rings per technology, a module heatmap, your weak spots and recent rounds — progress at a glance.', tag: 'Track' },
    { icon: '🎯', title: 'Adaptive Focus Rounds', desc: 'One tap builds a quiz weighted toward your weakest and untested modules. Drill exactly what needs work.', tag: 'Improve' },
    { icon: '🏆', title: 'Leaderboard', desc: 'Earn XP, climb the arena and see how you rank against everyone else — by XP, tests taken and best score.', tag: 'Compete' },
    { icon: '📣', title: 'Share Scorecard', desc: 'Turn any result into a shareable card — rich social link previews, a downloadable image, and a head-to-head challenge daring friends to beat your score.', tag: 'Show off' },
    { icon: '📬', title: 'Weekly Recap Emails', desc: 'A Monday email with your progress, your softest spot and a nudge to keep the momentum going.', tag: 'Stay sharp' },
    { icon: '🔁', title: 'Cross-Device Sync', desc: 'Progress is saved to the cloud and restored on any device with a recovery code — no password required.', tag: 'Anywhere' },
  ];

  readonly techCards: TechCard[] = [
    {
      id: 'angular',
      icon: '⚡',
      name: 'Angular',
      description: 'Components, signals, DI, routing, RxJS, lifecycle hooks, lazy loading — everything you need to ace Angular interviews.',
      tag: 'Frontend Framework',
      count: '25+ Questions',
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
      count: '10+ Questions',
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
      count: '10+ Questions',
      gradient: 'linear-gradient(135deg, #0050a0 0%, #0ea5e9 100%)',
      path: '/sql',
      delay: '240ms',
    },
  ];
}
