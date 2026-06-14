import { inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';

export interface SeoConfig {
  title: string;
  description: string;
  keywords?: string;
  /** Personalized/utility pages (e.g. dashboard) set this so crawlers skip them. */
  noindex?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SeoService {
  private titleSvc = inject(Title);
  private meta     = inject(Meta);
  private router   = inject(Router);
  private doc      = inject(DOCUMENT);

  private readonly SITE_NAME = 'Developer Refresher';
  private readonly BASE_URL  = 'https://coderefresher.pages.dev';
  private readonly OG_IMAGE  = `${this.BASE_URL}/og-image.png`;

  update(config: SeoConfig): void {
    const fullTitle = `${config.title} | ${this.SITE_NAME}`;
    const url       = `${this.BASE_URL}${this.router.url}`;

    this.titleSvc.setTitle(fullTitle);

    this.meta.updateTag({ name: 'description',  content: config.description });
    if (config.keywords) {
      this.meta.updateTag({ name: 'keywords', content: config.keywords });
    }
    this.meta.updateTag({
      name: 'robots',
      content: config.noindex ? 'noindex, follow' : 'index, follow',
    });

    // Open Graph
    this.meta.updateTag({ property: 'og:title',       content: fullTitle });
    this.meta.updateTag({ property: 'og:description', content: config.description });
    this.meta.updateTag({ property: 'og:url',         content: url });
    this.meta.updateTag({ property: 'og:image',       content: this.OG_IMAGE });
    this.meta.updateTag({ property: 'og:type',        content: 'website' });
    this.meta.updateTag({ property: 'og:site_name',   content: this.SITE_NAME });

    // Twitter Card
    this.meta.updateTag({ name: 'twitter:card',        content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title',       content: fullTitle });
    this.meta.updateTag({ name: 'twitter:description', content: config.description });
    this.meta.updateTag({ name: 'twitter:image',       content: this.OG_IMAGE });

    this.setCanonical(url);
  }

  private setCanonical(url: string): void {
    let link = this.doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (link) {
      link.href = url;
    } else {
      link = this.doc.createElement('link');
      link.rel  = 'canonical';
      link.href = url;
      this.doc.head.appendChild(link);
    }
  }
}
