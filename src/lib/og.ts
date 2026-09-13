/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Open-Graph card renderer – dependency-free SVG (1200×630).
 *
 * Runs on the edge (`/api/og`), so it must stay pure string building: no DOM,
 * no wasm, no fonts to fetch. Every dynamic value is XML-escaped because the
 * ticker/price arrive from query parameters.
 *
 * Upgrade path (roadmap): swap the SVG body for Satori/`@vercel/og` PNG once
 * platforms that ignore SVG og:image (X, Facebook) matter – the route and the
 * meta wiring stay identical.
 */

export interface OgInput {
  ticker: string;
  price: string | null;
  changePct: number | null;
  locale: string;
}

/** Card-Copy je Locale – Social-Karten sprechen die Sprache des Links. */
const OG_STRINGS: Record<string, { tagline: string; footer: string }> = {
  en: { tagline: 'real-time · zero fees · on-chain', footer: 'CEX + DEX terminal · no account · no keys · nodechart' },
  de: { tagline: 'Echtzeit · keine Gebühren · On-Chain', footer: 'CEX + DEX Terminal · kein Account · keine Keys · nodechart' },
  es: { tagline: 'tiempo real · sin comisiones · on-chain', footer: 'Terminal CEX + DEX · sin cuenta · sin claves · nodechart' },
  ru: { tagline: 'реальное время · без комиссий · on-chain', footer: 'CEX + DEX терминал · без аккаунта · без ключей · nodechart' },
  zh: { tagline: '实时 · 零费用 · 链上', footer: 'CEX + DEX 终端 · 无需账户 · 无需密钥 · nodechart' },
};

/** Whitelist-Fallback: unbekannte/?constructor-Locales landen auf EN. */
export function ogLocale(raw: string | null): string {
  return raw && Object.prototype.hasOwnProperty.call(OG_STRINGS, raw) ? raw : 'en';
}

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Sanitises a `?ticker=` query value – cashtags only, never markup. */
export function sanitizeTicker(raw: string | null): string {
  const clean = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return clean || 'BTC';
}

export function sanitizePrice(raw: string | null): string | null {
  const n = Number.parseFloat(raw ?? '');
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

export function buildOgSvg(input: OgInput): string {
  const ticker = escapeXml(sanitizeTicker(input.ticker));
  const price = input.price ? escapeXml(input.price) : null;
  const up = (input.changePct ?? 0) >= 0;
  const change =
    input.changePct === null ? null : `${up ? '+' : ''}${input.changePct.toFixed(2)}%`;
  const changeColor = up ? '#00ff9d' : '#ff2e63';
  const copy = OG_STRINGS[ogLocale(input.locale)] ?? OG_STRINGS.en ?? { tagline: '', footer: '' };

  const grid = Array.from({ length: 11 }, (_, i) => {
    const x = 60 + i * 108;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${OG_HEIGHT}" stroke="#123018" stroke-width="1"/>`;
  }).join('');
  const gridH = Array.from({ length: 5 }, (_, i) => {
    const y = 70 + i * 110;
    return `<line x1="0" y1="${y}" x2="${OG_WIDTH}" y2="${y}" stroke="#123018" stroke-width="1"/>`;
  }).join('');

  // A decorative candle strip – the product IS charts.
  const candles = Array.from({ length: 26 }, (_, i) => {
    const x = 70 + i * 42;
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const frac = seed - Math.floor(seed);
    const h = 60 + frac * 120;
    const y = 470 - h;
    const green = frac > 0.45;
    const color = green ? '#00ff9d' : '#ff2e63';
    return (
      `<line x1="${x}" y1="${y - 22}" x2="${x}" y2="${y + h + 22}" stroke="${color}" stroke-width="2"/>` +
      `<rect x="${x - 8}" y="${y}" width="16" height="${h}" fill="${color}" opacity="0.85"/>`
    );
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#050807"/>
      <stop offset="1" stop-color="#0a1410"/>
    </linearGradient>
    <linearGradient id="neon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#39ff14"/>
      <stop offset="1" stop-color="#00f0ff"/>
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>
  <g opacity="0.5">${grid}${gridH}</g>
  <g opacity="0.55">${candles}</g>
  <rect x="0" y="0" width="${OG_WIDTH}" height="6" fill="url(#neon)"/>
  <g transform="translate(64,64)">
    <path d="M28 0 L56 16 L56 48 L28 64 L0 48 L0 16 Z" fill="none" stroke="url(#neon)" stroke-width="4"/>
    <rect x="14" y="20" width="6" height="24" fill="#39ff14"/>
    <rect x="25" y="14" width="6" height="36" fill="#00f0ff"/>
    <rect x="36" y="24" width="6" height="20" fill="#b026ff"/>
    <text x="76" y="44" font-family="monospace" font-size="40" font-weight="700" fill="#e8ffe8" letter-spacing="6">NODE<tspan fill="#39ff14">CHART</tspan></text>
  </g>
  <text x="64" y="250" font-family="monospace" font-size="110" font-weight="800" fill="#f2fff2">$${ticker}</text>
  ${
    price
      ? `<text x="64" y="330" font-family="monospace" font-size="56" fill="#39ff14">$${price}</text>`
      : `<text x="64" y="330" font-family="monospace" font-size="40" fill="#7d9c7d">${copy.tagline}</text>`
  }
  ${
    change
      ? `<text x="${price ? 64 + price.length * 34 + 40 : 64}" y="330" font-family="monospace" font-size="44" fill="${changeColor}">${change}</text>`
      : ''
  }
  <text x="64" y="580" font-family="monospace" font-size="28" fill="#7d9c7d">${copy.footer}</text>
  <text x="${OG_WIDTH - 40}" y="580" text-anchor="end" font-family="monospace" font-size="28" fill="#39ff14" opacity="0.8">$${ticker}</text>
</svg>`;
}
