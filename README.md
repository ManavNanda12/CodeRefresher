# Developer Refresher

A personal knowledge base and interview prep app built with **Angular 22**. Browse structured Q&A for Angular, .NET, and SQL — organized by experience level, with code examples and simple analogies so concepts actually stick.

> AI Interview Coach coming soon — once you've refreshed the topics, practice live Q&A with an AI that adapts to your level.

---

## Features

- **Homepage** — animated hero, tech overview cards, stats, and AI coach teaser
- **Angular / .NET / SQL pages** — questions split by 0–2 years and 2–4 years experience
- **Expandable cards** — smooth CSS grid-trick animation, syntax-highlighted code blocks, copy-to-clipboard
- **Responsive layout** — desktop topbar with nav links; mobile hamburger → slide-in sidebar
- **Staggered entrance animations** — cards fly in with cascading delay via CSS custom properties
- **View Transitions API** — smooth fade+slide between pages
- **Skeleton loading** — shimmer placeholders while JSON data loads
- **Footer** — roadmap (AWS, React, Python, Docker) and AI coach teaser

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Angular 22 (standalone components, no NgModule) |
| Reactivity | Signals (`signal`, `computed`, `input.required`) |
| Data loading | `HttpClient` + `toObservable` + `switchMap` + `takeUntilDestroyed` |
| Routing | Angular Router with lazy-loaded routes + `withViewTransitions()` |
| Styling | Plain CSS (custom properties, CSS grid, `@keyframes`) |
| UI library | Bootstrap 5 (CSS utilities only) |
| Fonts | Inter (UI) + Fira Code (code blocks) via Google Fonts |
| Build | Angular CLI 22 / esbuild |
| Testing | Vitest |

---

## Project Structure

```
src/
├── app/
│   ├── core/
│   │   ├── models/
│   │   │   └── refresher-item.model.ts   # RefresherItem + RefresherData interfaces
│   │   └── services/
│   │       └── data.service.ts           # HttpClient JSON loader
│   ├── pages/
│   │   ├── home/                         # Landing page
│   │   ├── angular/                      # Angular Q&A page
│   │   ├── dotnet/                       # .NET Q&A page
│   │   └── sql/                          # SQL Q&A page
│   ├── shared/
│   │   └── components/
│   │       ├── card/                     # Expandable question card
│   │       ├── layout/                   # Header + sidebar + footer shell
│   │       └── tech-page/               # Reusable topic page (hero + tabs + cards)
│   ├── app.routes.ts
│   ├── app.config.ts
│   ├── app.ts
│   └── app.html
├── styles.css                            # Global styles + view-transition animations
└── index.html                            # Google Fonts loaded here

public/
└── data/
    ├── angular.json                      # Angular Q&A data
    ├── dotnet.json                       # .NET Q&A data
    └── sql.json                          # SQL Q&A data
```

---

## Adding a New Technology

To add a new topic (e.g. AWS):

1. **Add data** — create `public/data/aws.json` following the same shape:
   ```json
   {
     "categories": {
       "0-2": [ { "question": "...", "answer": "...", "codeExample": "...", "simpleExample": "..." } ],
       "2-4": [ ... ]
     }
   }
   ```

2. **Add a page** — create `src/app/pages/aws/aws.ts`:
   ```typescript
   @Component({ imports: [TechPageComponent], template: `<app-tech-page tech="aws" title="AWS" />` })
   export class AwsComponent {}
   ```

3. **Add a route** in `app.routes.ts`:
   ```typescript
   { path: 'aws', loadComponent: () => import('./pages/aws/aws').then(m => m.AwsComponent) }
   ```

4. **Add nav item** in `layout.ts`:
   ```typescript
   { path: '/aws', label: 'AWS', icon: '☁️' }
   ```

5. **Add tech metadata** in `tech-page.ts` (`TECH_META` record) for the hero gradient and icon.

That's it — no other changes needed.

---

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm start
# → http://localhost:4200

# Production build
npm run build
```

---

## Data Format

Each JSON file in `public/data/` must follow this shape:

```typescript
interface RefresherData {
  categories: {
    "0-2": RefresherItem[];
    "2-4": RefresherItem[];
  }
}

interface RefresherItem {
  question: string;      // The interview question
  answer: string;        // Detailed explanation
  codeExample: string;   // Code snippet (shown in dark theme block)
  simpleExample: string; // Plain-English analogy
}
```

---

## Roadmap

- [ ] AWS / Cloud page
- [ ] React page
- [ ] Python page
- [ ] Docker / Kubernetes page
- [ ] AI Interview Coach (live Q&A with adaptive difficulty)
- [ ] Progress tracking (mark questions as reviewed)
- [ ] Search across all topics
