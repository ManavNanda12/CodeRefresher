import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Indexable, content pages — prerendered to real static HTML files so a
  // direct crawler hit returns 200 with the correct content + canonical.
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'angular', renderMode: RenderMode.Prerender },
  { path: 'dotnet', renderMode: RenderMode.Prerender },
  { path: 'sql', renderMode: RenderMode.Prerender },
  { path: 'react', renderMode: RenderMode.Prerender },
  { path: 'nextjs', renderMode: RenderMode.Prerender },
  { path: 'nestjs', renderMode: RenderMode.Prerender },
  { path: 'test-me', renderMode: RenderMode.Prerender },

  // Personalized / dynamic pages. They're noindex and depend on browser-only
  // state, so prerender an empty shell that hydrates client-side. This also
  // produces /dashboard/index.html & /leaderboard/index.html so a direct hit
  // or refresh on Cloudflare returns 200 instead of falling through to 404.
  { path: 'dashboard', renderMode: RenderMode.Prerender },
  { path: 'leaderboard', renderMode: RenderMode.Prerender },

  // Everything else: do NOT prerender (the old blanket '**' Prerender is what
  // generated ambiguous fallbacks). Unmatched URLs are served as a hard 404 by
  // the static /404.html that Cloudflare Pages returns for non-existent assets.
  { path: '**', renderMode: RenderMode.Client },
];
