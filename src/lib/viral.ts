/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Viral-loop helpers – pure functions so the smoke harness can pin them.
 */

/** `BTC/USDT` → `BTC`, `SOL` → `SOL`. The cashtag used in share texts. */
export function baseSymbol(symbol: string): string {
  return (symbol.split('/')[0] ?? symbol).toUpperCase();
}

/**
 * The pre-fabricated post text (English brand voice in every locale – the
 * template lives in i18n so communities can localise it later):
 *
 *   "Found an insane setup for $SOL on NodeChart. Zero fees, real-time
 *    on-chain data. #Crypto #Trading"
 */
export function buildShareText(template: string, symbol: string): string {
  return template.replace('{ticker}', `$${baseSymbol(symbol)}`);
}

export interface ShareLinks {
  x: string;
  telegram: string;
}

/**
 * Intent URLs. X carries the link inside the text (as specified), Telegram
 * gets it as its own `url` parameter so the preview card renders.
 */
export function buildShareLinks(text: string, url: string): ShareLinks {
  const textWithUrl = `${text} ${url}`;
  return {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(textWithUrl)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  };
}

/** Share destination includes ticker + price so the OG edge can render them. */
export function buildShareUrl(origin: string, locale: string, symbol: string, price: number | null): string {
  const params = new URLSearchParams({ ticker: baseSymbol(symbol) });
  if (price !== null && Number.isFinite(price) && price > 0) {
    params.set('price', price.toPrecision(6));
  }
  return `${origin}/${locale}/terminal?${params.toString()}`;
}
