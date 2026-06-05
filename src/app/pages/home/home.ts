import { Component, inject } from '@angular/core';
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

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class HomeComponent {
  constructor() {
    inject(SeoService).update({
      title: 'Master Dev Interviews',
      description: 'Structured Q&A for Angular, .NET, SQL and more — organized by experience level, with code examples and simple analogies so concepts actually stick.',
      keywords: 'angular interview questions, dotnet interview prep, sql interview questions, developer refresher, coding interview'
    });
  }

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
      delay: '60ms'
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
      delay: '150ms'
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
      delay: '240ms'
    }
  ];
}
