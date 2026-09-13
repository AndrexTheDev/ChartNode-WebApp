// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { MetadataRoute } from 'next';

/**
 * Pflege-Quelle für die Sitemap: echte Inhalts-Stände statt Build-Zeitstempel.
 * `lastmod` wird aktualisiert, wenn sich der sichtbare Inhalt einer Route
 * ändert – ein Build-Zeitstempel auf jeder URL wäre Crawl-Budget-Noise und
 * würde Suchmaschinen bei jedem Deploy sinnlose Re-Crawls signalisieren.
 */
export interface RouteSeo {
  path: string;
  priority: number;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
  /** ISO-Datum des letzten sichtbaren Inhaltsstandes (gepflegt). */
  lastmod: string;
}

export const ROUTE_SEO: RouteSeo[] = [
  // Landing: UI-/SEO-Runde (Dropdown-Fit, Venue-Klartext, SEO M1/M2)
  { path: '', priority: 1, changeFrequency: 'weekly', lastmod: '2026-09-14' },
  // Help: Indikator-/Metrik-Glossar + FAQ (SEO-M2-Graph)
  { path: '/help', priority: 0.8, changeFrequency: 'monthly', lastmod: '2026-09-13' },
  // Legal: Lizenz-/Compliance-Stand (Wave ad0009f), ändert sich selten
  { path: '/legal/terms', priority: 0.2, changeFrequency: 'yearly', lastmod: '2026-08-01' },
  { path: '/legal/privacy', priority: 0.2, changeFrequency: 'yearly', lastmod: '2026-08-01' },
  { path: '/legal/disclaimer', priority: 0.2, changeFrequency: 'yearly', lastmod: '2026-08-01' },
];
