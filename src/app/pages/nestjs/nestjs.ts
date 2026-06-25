import { Component, inject } from '@angular/core';
import { TechPageComponent } from '../../shared/components/tech-page/tech-page';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-nestjs',
  imports: [TechPageComponent],
  template: `<app-tech-page tech="nestjs" title="NestJS" />`
})
export class NestjsComponent {
  constructor() {
    inject(SeoService).update({
      title: 'NestJS Interview Questions',
      description: 'Practice gamified NestJS interview questions on controllers, providers, modules, dependency injection, pipes, guards, interceptors, exception filters, microservices, and testing.',
      keywords: 'CodeRefresher, gamified nestjs interview questions, nestjs interview questions, nest dependency injection, nest guards interceptors, nest microservices, nodejs backend'
    });
  }
}
