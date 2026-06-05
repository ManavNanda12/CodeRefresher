import { Component } from '@angular/core';
import { TechPageComponent } from '../../shared/components/tech-page/tech-page';

@Component({
  selector: 'app-angular',
  imports: [TechPageComponent],
  template: `<app-tech-page tech="angular" title="Angular" />`
})
export class AngularComponent {}
