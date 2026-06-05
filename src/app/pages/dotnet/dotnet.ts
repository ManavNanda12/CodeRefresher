import { Component } from '@angular/core';
import { TechPageComponent } from '../../shared/components/tech-page/tech-page';

@Component({
  selector: 'app-dotnet',
  imports: [TechPageComponent],
  template: `<app-tech-page tech="dotnet" title=".NET / ASP.NET Core" />`
})
export class DotnetComponent {}
