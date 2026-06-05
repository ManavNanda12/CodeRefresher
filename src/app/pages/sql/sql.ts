import { Component, inject } from '@angular/core';
import { TechPageComponent } from '../../shared/components/tech-page/tech-page';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-sql',
  imports: [TechPageComponent],
  template: `<app-tech-page tech="sql" title="SQL" />`
})
export class SqlComponent {
  constructor() {
    inject(SeoService).update({
      title: 'SQL Interview Questions',
      description: 'Practice SQL interview questions on JOINs, window functions, CTEs, indexing strategies, ACID transactions, query optimization, stored procedures, and views.',
      keywords: 'sql interview questions, sql joins interview, window functions sql, cte sql, sql indexing, acid transactions, sql query optimization, database interview questions'
    });
  }
}
