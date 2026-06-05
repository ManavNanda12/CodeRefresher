import { Component, inject } from '@angular/core';
import { TechPageComponent } from '../../shared/components/tech-page/tech-page';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-angular',
  imports: [TechPageComponent],
  template: `<app-tech-page tech="angular" title="Angular" />`
})
export class AngularComponent {
  constructor() {
    inject(SeoService).update({
      title: 'Angular Interview Questions',
      description: 'Practice Angular interview questions on components, signals, dependency injection, routing, RxJS, lifecycle hooks, lazy loading, and change detection.',
      keywords: 'angular interview questions, angular signals, angular components, angular routing, rxjs interview, angular dependency injection, angular lifecycle hooks'
    });
  }
}
