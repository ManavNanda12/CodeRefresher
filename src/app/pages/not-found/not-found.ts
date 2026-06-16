import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  templateUrl: './not-found.html',
  styleUrl: './not-found.css',
})
export class NotFoundComponent {
  constructor() {
    // Tell crawlers this is not a real page. The hard HTTP 404 status is
    // delivered by the static /404.html that Cloudflare Pages serves for
    // unmatched routes — this component only handles in-app navigations.
    inject(SeoService).update({
      title: 'Page Not Found',
      description: 'The page you are looking for does not exist.',
      noindex: true,
    });
  }
}
