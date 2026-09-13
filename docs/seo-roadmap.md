# NodeChart SEO-Roadmap (systematisch, Modul für Modul)

Stand: 2026-09-13 · Reihenfolge fest, jedes Modul wird einzeln implementiert UND getestet (`scripts/seo-check.mjs` wächst mit).

| # | Modul | Inhalt | Status |
|---|-------|--------|--------|
| M1 | Routen-Metadaten & Crawl-Direktiven | Title/Description/Canonical/Hreflang/OG/Twitter/Robots konsistent über 5 Locales × 6 Routen; Robots.txt vs. Meta-Robots vs. Sitemap widerspruchsfrei; Social-Bots dürfen Terminal für Cards crawlen; seo-check v1 | ✔ done `76db671` |
| M2 | Strukturierte Daten (JSON-LD) | **@context/@graph-Fix**, WebSite+SearchAction, Organization überall, BreadcrumbList (help/legal), FAQPage (16 Fragen), DefinedTermSet-Glossar, SoftwareApplication-Refresh | ✔ done `99b75bb` |
| M3 | Sitemap & Crawl-Budget | gepflegte lastmod-Quelle `lib/sitemap-meta.ts`, Priority-Review (help 0.8, legal 0.2), Edge-Cache-Header (sitemap/robots 1h, og/icon 7d, HTML s-maxage 300), Duplikat-Checks (Parameter/Case/Slash) | ✔ done |
| M4 | Landing-Semantik & Content-SEO | H1-Keyword-Cluster ×5 Locales, Heading-Hierarchie ohne Skip (NeonPanel-titleTag), interne Links/Anker verifiziert, img-Alt/Size-Guard, Font-Preload-Check | ✔ done |
| M5 | Help-Center-SEO | Kategorien-Sektionen mit h2 + Anker-ids (`#sec-indicators` …), H3-Akkordeon (ARIA), server-gerenderte TOC mit Zählern, Deep-Links (`#ind-RSI` öffnet + scrollt), Hash-Sharing, FAQ-LD mit Anker-URLs | ✔ done |
| M6 | Core Web Vitals | Fonts subset/preload, Script-Strategien, Bildformate, Cloudflare-Cache-Regeln (_headers/opennext) | offen |
| M7 | Social Cards & Sharing | OG pro Locale-Text, Twitter-Card-Validator-Check, Telegram/WhatsApp-Preview, /api/og-Parameter härten | offen |
| M8 | Technische Hygiene | 404/Redirect-Matrix, Trailing-Slash/Case-Duplikate, www-vs-apex Canonical, Locale-Detect vs. Crawler | offen |
| M9 | SEO-Regressionssuite | seo-check final (alle Module asserten), in CI-artigen Ablauf neben fit-check/browser-check | offen |

## M1-Details (implementiert)
- `src/lib/seo.ts`: `buildTwitter()` + `metaDescription()` (kappt auf ≤160 Zeichen an Satzgrenze) neu; Seiten nutzen gemeinsame Helper → kein Drift.
- Terminal: `robots: index:false, follow:true` (Meta statt Robots.txt-Block!) + Twitter-Card mit `/api/og`.
- `robots.txt`: Terminal-Disallow ENTFERNT (sonst sieht Googlebot das noindex-Meta nie + Social-Bots kämen nicht an die Card); explizite Allow-Regel für Twitterbot/facebookexternalhit/TelegramBot/LinkedInBot/Discordbot/WhatsApp/Slackbot.
- help/legal: Twitter-Card + Robots-Default bzw. Description-Kappung.
- `scripts/seo-check.mjs`: 5 Locales × 6 Routen asserten Title-Länge/Einzigartigkeit, Description-Länge, Canonical exakt, 6 Hreflang-Links, OG-Set, Twitter-Card, Robots-Meta je Route, `html[lang]`, H1 genau 1x auf Landing/Help, JSON-LD parse-bar.
