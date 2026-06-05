import { Component } from '@angular/core';
import { TechPageComponent } from '../../shared/components/tech-page/tech-page';

@Component({
  selector: 'app-sql',
  imports: [TechPageComponent],
  template: `<app-tech-page tech="sql" title="SQL" />`
})
export class SqlComponent {}
