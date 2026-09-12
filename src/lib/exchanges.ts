// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { ExchangeId } from '@/websockets/types';

export interface ExchangeMeta {
  id: ExchangeId;
  /** Display name. */
  name: string;
  /** 2–4 char badge used in compact UI. */
  short: string;
  /** Primary data host shown in the picker (transparency about where data comes from). */
  dataHost: string;
  /**
   * ISO-3166 alpha-2 countries where the exchange is *known* to refuse service
   * or to geo-block its public API. Used only to pre-rank the exchange list and
   * to show a hint – the live reachability probe always wins, because these
   * lists change without notice and this is not legal advice.
   */
  restricted: string[];
  /** Free-form note rendered in the picker tooltip. */
  note?: string;
}

/**
 * Every venue NodeChart can stream from. All twelve are public and key-less:
 * no account, no API key, no paid tier, no backend.
 */
export const EXCHANGE_META: Record<ExchangeId, ExchangeMeta> = {
  binance: {
    id: 'binance',
    name: 'Binance',
    short: 'BNB',
    dataHost: 'data-stream.binance.vision',
    restricted: ['US', 'UM', 'GU', 'PR', 'VI'],
    note: 'Public market-data mirror – reachable even where binance.com is geo-blocked.',
  },
  okx: {
    id: 'okx',
    name: 'OKX',
    short: 'OKX',
    dataHost: 'ws.okx.com:8443',
    restricted: ['US'],
    note: 'Candles and trades arrive on two different endpoints (business / public).',
  },
  bybit: {
    id: 'bybit',
    name: 'Bybit',
    short: 'BYB',
    dataHost: 'stream.bybit.com',
    restricted: ['US', 'GB'],
    note: 'REST history can be geo-blocked while the socket still works.',
  },
  coinbase: {
    id: 'coinbase',
    name: 'Coinbase Exchange',
    short: 'CB',
    dataHost: 'ws-feed.exchange.coinbase.com',
    restricted: [],
    note: 'No candle channel – candles are derived from the match stream.',
  },
  kraken: {
    id: 'kraken',
    name: 'Kraken',
    short: 'KRK',
    dataHost: 'ws.kraken.com',
    restricted: [],
    note: 'Spells Bitcoin XBT and Dogecoin XDG.',
  },
  gate: {
    id: 'gate',
    name: 'Gate',
    short: 'GATE',
    dataHost: 'api.gateio.ws',
    restricted: ['US', 'GB', 'CA'],
  },
  bitget: {
    id: 'bitget',
    name: 'Bitget',
    short: 'BGT',
    dataHost: 'ws.bitget.com',
    restricted: ['US'],
  },
  kucoin: {
    id: 'kucoin',
    name: 'KuCoin',
    short: 'KCS',
    dataHost: 'ws-api-spot.kucoin.com',
    restricted: ['US', 'GB'],
    note: 'Fetches a free public token first; candles derived from trades.',
  },
  bitfinex: {
    id: 'bitfinex',
    name: 'Bitfinex',
    short: 'BFX',
    dataHost: 'api-pub.bitfinex.com',
    restricted: ['US'],
    note: 'No 4h candle bucket.',
  },
  cryptocom: {
    id: 'cryptocom',
    name: 'Crypto.com',
    short: 'CDC',
    dataHost: 'stream.crypto.com',
    restricted: [],
    note: 'The subscribe snapshot already contains candle history.',
  },
  htx: {
    id: 'htx',
    name: 'HTX',
    short: 'HTX',
    dataHost: 'api.huobi.pro',
    restricted: ['US', 'JP'],
    note: 'Gzip-compressed frames; decoded with the browser DecompressionStream.',
  },
  coinex: {
    id: 'coinex',
    name: 'CoinEx',
    short: 'CEX',
    dataHost: 'socket.coinex.com',
    restricted: ['US'],
    note: 'Candles derived from the deal stream.',
  },
};

export const EXCHANGE_LIST: ExchangeMeta[] = Object.values(EXCHANGE_META);

export function exchangeName(id: ExchangeId): string {
  return EXCHANGE_META[id]?.name ?? id;
}
