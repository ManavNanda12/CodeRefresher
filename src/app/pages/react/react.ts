import { Component, inject } from '@angular/core';
import { TechPageComponent } from '../../shared/components/tech-page/tech-page';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-react',
  imports: [TechPageComponent],
  template: `<app-tech-page tech="react" title="React" />`
})
export class ReactComponent {
  constructor() {
    inject(SeoService).update({
      title: 'React Interview Questions',
      description: 'Practice gamified React interview questions on JSX, components, props, state, hooks, context, performance optimization, custom hooks, Suspense, and design patterns.',
      keywords: 'CodeRefresher, gamified react interview questions, react interview questions, react hooks, useState, useEffect, react context, react performance'
    });
  }
}
