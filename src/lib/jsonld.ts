// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Locale } from '@/i18n/routing';
import { absoluteUrl } from './seo';
import { APP_VERSION, CONTACT, SITE_NAME, SITE_URL, TAGLINE } from './constants';

/**
 * schema.org builders – every object is pure data so pages can compose them
 * inside a single <script type="application/ld+json"> block.
 */

export function organizationLd() {
  return {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    description: TAGLINE,
    email: CONTACT.email,
    founder: { '@type': 'Person', name: CONTACT.handle },
    sameAs: [CONTACT.mailto],
  };
}

export function websiteLd(locale: Locale) {
  return {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: absoluteUrl(locale),
    description: TAGLINE,
    inLanguage: locale,
    publisher: { '@id': `${SITE_URL}/#organization` },
    // Sitelinks-Searchbox: die Terminal-Suche versteht Ticker-Symbole
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/${locale}/terminal?ticker={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function softwareApplicationLd(locale: Locale, features: string[]) {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#app`,
    name: SITE_NAME,
    url: absoluteUrl(locale, '/terminal'),
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript',
    description: TAGLINE,
    inLanguage: locale,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    softwareVersion: APP_VERSION,
    screenshot: `${SITE_URL}/og.png`,
    featureList: features,
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

export function faqPageLd(items: { question: string; answer: string }[]) {
  return {
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/#faq`,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function definedTermSetLd(name: string, terms: { term: string; description: string }[]) {
  return {
    '@type': 'DefinedTermSet',
    name,
    url: `${SITE_URL}/#glossary`,
    hasDefinedTerm: terms.map((entry) => ({
      '@type': 'DefinedTerm',
      name: entry.term,
      description: entry.description,
    })),
  };
}

export function breadcrumbLd(locale: Locale, crumbs: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(locale, crumb.path),
    })),
  };
}
