import { Routes } from '@angular/router';

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
    path: 'test-me',
    loadComponent: () => import('./pages/test-me/test-me').then(m => m.TestMeComponent)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardComponent)
  },
  {
    path: 'leaderboard',
    loadComponent: () => import('./pages/leaderboard/leaderboard').then(m => m.LeaderboardComponent)
  },
  { path: '**', redirectTo: '' }
];
