import { Routes } from '@angular/router';
import { CanDeactivateGuard } from './core/guards/can-deactivate-guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then(m => m.HomeComponent)
  },
  {
    path: 'angular',
    loadComponent: () => import('./pages/angular/angular').then(m => m.AngularComponent)
  },
  {
    path: 'dotnet',
    loadComponent: () => import('./pages/dotnet/dotnet').then(m => m.DotnetComponent)
  },
  {
    path: 'sql',
    loadComponent: () => import('./pages/sql/sql').then(m => m.SqlComponent)
  },
  {
    path: 'react',
    loadComponent: () => import('./pages/react/react').then(m => m.ReactComponent)
  },
  {
    path: 'nextjs',
    loadComponent: () => import('./pages/nextjs/nextjs').then(m => m.NextjsComponent)
  },
  {
    path: 'nestjs',
    loadComponent: () => import('./pages/nestjs/nestjs').then(m => m.NestjsComponent)
  },
  {
    path: 'test-me',
    loadComponent: () => import('./pages/test-me/test-me').then(m => m.TestMeComponent),
    canDeactivate: [CanDeactivateGuard]
  },
  {
    path: 'interview',
    loadComponent: () => import('./pages/interview/interview').then(m => m.InterviewComponent)
  },
  {
    path: 'resume-interview',
    loadComponent: () => import('./pages/resume-interview/resume-interview').then(m => m.ResumeInterviewComponent),
    canDeactivate: [CanDeactivateGuard]
  },
  {
    path: 'jd-match',
    loadComponent: () => import('./pages/resume-jd-match/resume-jd-match').then(m => m.ResumeJdMatchComponent)
  },
  {
    path: 'speak',
    loadComponent: () => import('./pages/speak/speak').then(m => m.SpeakComponent),
    canDeactivate: [CanDeactivateGuard]
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardComponent)
  },
  {
    path: 'leaderboard',
    loadComponent: () => import('./pages/leaderboard/leaderboard').then(m => m.LeaderboardComponent)
  },
  {
    path: 'ask-notes',
    loadComponent: () => import('./pages/ask-notes/ask-notes').then(m => m.AskNotesComponent)
  },
  {
    path: 'contact',
    loadComponent: () => import('./pages/contact/contact').then(m => m.ContactComponent)
  },
  // No redirect-to-home: unknown URLs must resolve to a real "not found" page,
  // not a soft redirect (which Google reports as a redirect error). The hard
  // HTTP 404 status for crawlers comes from the static /404.html on Cloudflare.
  {
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found').then(m => m.NotFoundComponent)
  }
];
