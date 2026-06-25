import { Component, inject } from '@angular/core';
import { TechPageComponent } from '../../shared/components/tech-page/tech-page';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-nextjs',
  imports: [TechPageComponent],
  template: `<app-tech-page tech="nextjs" title="Next.js" />`
})
export class NextjsComponent {
  constructor() {
    inject(SeoService).update({
      title: 'Next.js Interview Questions',
      description: 'Practice gamified Next.js interview questions on the App Router, Server Components, SSR, SSG, ISR, data fetching, route handlers, server actions, caching, and deployment.',
      keywords: 'CodeRefresher, gamified nextjs interview questions, next.js interview questions, app router, server components, ssr ssg isr, server actions, next.js caching'
    });
  }
}
