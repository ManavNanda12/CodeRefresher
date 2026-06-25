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

  private readonly SITE_NAME = 'CodeRefresher';
  private readonly BASE_URL  = 'https://coderefresher.pages.dev';
  private readonly OG_IMAGE  = `${this.BASE_URL}/og-image.png`;

  update(config: SeoConfig): void {
    // Append the brand once. If a page already includes it in its title
    // (e.g. the homepage leads with "CodeRefresher — …"), don't double it.
    const fullTitle = config.title.includes(this.SITE_NAME)
      ? config.title
      : `${config.title} | ${this.SITE_NAME}`;
    const url       = `${this.BASE_URL}${this.canonicalPath()}`;

    // Drop any page-specific structured data from the previous route.
    this.clearDynamicJsonLd();

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

  /** Absolute URL for a path on the canonical domain. */
  siteUrl(path = ''): string {
    return `${this.BASE_URL}${path}`;
  }

  /**
   * Canonical path for the current route: lowercased, with query string and
   * fragment dropped. Prevents `/Angular`, `/angular?x=1` or `/angular#top`
   * from emitting a different canonical than the one indexed (`/angular`).
   */
  private canonicalPath(): string {
    const path = this.router.url.split(/[?#]/)[0];
    return path === '/' ? '/' : path.toLowerCase().replace(/\/+$/, '');
  }

  /**
   * Add/replace a page-specific JSON-LD block (e.g. FAQPage, BreadcrumbList).
   * Tagged with `data-seo` so it's cleared on the next navigation.
   */
  setJsonLd(id: string, data: unknown): void {
    const selector = `script[data-seo="${id}"]`;
    let el = this.doc.querySelector<HTMLScriptElement>(selector);
    if (!el) {
      el = this.doc.createElement('script');
      el.type = 'application/ld+json';
      el.setAttribute('data-seo', id);
      this.doc.head.appendChild(el);
    }
    // Escape "<" so an answer containing "</script>" can't break out of the tag.
    el.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  }

  private clearDynamicJsonLd(): void {
    this.doc.querySelectorAll('script[data-seo]').forEach(el => el.remove());
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
