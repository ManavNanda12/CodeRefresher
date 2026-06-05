import { Component, inject } from '@angular/core';
import { TechPageComponent } from '../../shared/components/tech-page/tech-page';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-dotnet',
  imports: [TechPageComponent],
  template: `<app-tech-page tech="dotnet" title=".NET / ASP.NET Core" />`
})
export class DotnetComponent {
  constructor() {
    inject(SeoService).update({
      title: '.NET / ASP.NET Core Interview Questions',
      description: 'Practice .NET and ASP.NET Core interview questions on async/await, LINQ, Entity Framework, DI lifetimes, middleware pipeline, SOLID principles, and design patterns.',
      keywords: '.net interview questions, asp.net core interview, entity framework interview, linq interview, csharp interview, dependency injection .net, solid principles interview'
    });
  }
}
