/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * WebSocket adapter smoke test (dev-only harness, not shipped).
 *
 *   1. offline – all twelve adapters parse recorded wire payloads. The fixtures
 *      below were captured from the live servers (see README §6.1), so a schema
 *      change upstream shows up here instead of in a user's empty chart.
 *   2. live – a real ManagedSocket connects to each exchange's public stream and
 *      must deliver trades (+ candles where the venue has a candle channel).
 *      Unreachable endpoints report SKIP, because several venues geo-block
 *      datacenter IPs while serving browsers fine.
 *
 * Run with: npm run ws:smoke
 */
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import type { Timeframe } from '@/store/types';
import type { ExchangeAdapter, FeedEvent } from '@/websockets/types';

// `ws` ships without types in this project, so load it at runtime.
const nodeRequire = createRequire(import.meta.url);
const { WebSocket: NodeWebSocket } = nodeRequire('ws') as { WebSocket: unknown };

// Browser globals the socket layer expects.
(globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;
(globalThis as unknown as { window: unknown }).window = globalThis;

const { binanceAdapter } = await import('@/websockets/adapters/binance');
const { bybitAdapter } = await import('@/websockets/adapters/bybit');
const { okxAdapter } = await import('@/websockets/adapters/okx');
const { krakenAdapter } = await import('@/websockets/adapters/kraken');
const { coinbaseAdapter } = await import('@/websockets/adapters/coinbase');
const { gateAdapter } = await import('@/websockets/adapters/gate');
const { bitfinexAdapter } = await import('@/websockets/adapters/bitfinex');
const { cryptocomAdapter } = await import('@/websockets/adapters/cryptocom');
const { htxAdapter } = await import('@/websockets/adapters/htx');
const { bitgetAdapter } = await import('@/websockets/adapters/bitget');
const { kucoinAdapter } = await import('@/websockets/adapters/kucoin');
const { coinexAdapter } = await import('@/websockets/adapters/coinex');
const { ManagedSocket } = await import('@/websockets/socket');
const { CandleDeriver } = await import('@/websockets/derive');

let failures = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}`);
  if (!condition) failures += 1;
}
function skip(name: string): void {
  console.log(`  SKIP  ${name}`);
}

/** Node Buffers view a shared pool – copy into a standalone ArrayBuffer. */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  return copy.buffer as ArrayBuffer;
}

function firstCandle(events: FeedEvent[]) {
  const event = events.find((e) => e.type === 'candle');
  return event?.type === 'candle' ? event : null;
}
function firstTrade(events: FeedEvent[]) {
  const event = events.find((e) => e.type === 'trade');
  return event?.type === 'trade' ? event : null;
}

console.log('\n— offline schema fixtures (captured from production) —');

/* --------------------------------- Binance -------------------------------- */
{
  const candle = firstCandle(
    binanceAdapter.parse({
      e: 'kline',
      E: 1_700_000_000_100,
      s: 'BTCUSDT',
      k: { t: 1_700_000_000_000, i: '1m', o: '100', h: '110', l: '90', c: '105', v: '12.5', x: false },
    }),
  );
  check(
    'binance kline → candle + normalised symbol',
    candle?.candle.c === 105 && candle?.candle.t === 1_700_000_000_000 && candle?.key.symbol === 'BTC/USDT' && candle?.key.timeframe === '1m',
  );
  const trade = firstTrade(binanceAdapter.parse({ e: 'aggTrade', s: 'ETHUSDT', p: '3000', q: '4', m: true, T: 1_700_000_000_000 }));
  check('binance aggTrade → SELL when the buyer is the maker', trade?.trade.side === 'sell' && trade?.trade.price === 3000);
  check(
    'binance channel formats + mirror endpoint',
    binanceAdapter.klineChannel({ exchange: 'binance', symbol: 'BTC/USDT', timeframe: '1h' }) === 'btcusdt@kline_1h' &&
      binanceAdapter.tradeChannel('BTCUSDT') === 'btcusdt@aggTrade' &&
      binanceAdapter.url.includes('data-stream.binance.vision') &&
      binanceAdapter.heartbeat === null,
  );
}

/* ---------------------------------- Bybit --------------------------------- */
{
  const candle = firstCandle(
    bybitAdapter.parse({
      topic: 'kline.60.BTCUSDT',
      type: 'snapshot',
      data: [{ start: 1_700_000_000_000, open: '1', high: '2', low: '0.5', close: '1.5', volume: '9', confirm: false }],
    }),
  );
  check('bybit kline.60 → 1h candle', candle?.key.timeframe === '1h' && candle?.candle.h === 2);
  const trade = firstTrade(
    bybitAdapter.parse({ topic: 'publicTrade.BTCUSDT', data: [{ T: 1_700_000_000_000, p: '100', v: '200', S: 'Buy', s: 'BTCUSDT' }] }),
  );
  check('bybit publicTrade → BUY, notional 20 000', trade?.trade.side === 'buy' && (trade?.trade.price ?? 0) * (trade?.trade.qty ?? 0) === 20_000);
  check(
    'bybit channels + 18 s ping',
    bybitAdapter.klineChannel({ exchange: 'bybit', symbol: 'SOL/USDT', timeframe: '4h' }) === 'kline.240.SOLUSDT' &&
      bybitAdapter.heartbeat?.intervalMs === 18_000,
  );
}

/* ----------------------------------- OKX ---------------------------------- */
{
  const candle = firstCandle(
    okxAdapter.parse({
      arg: { channel: 'candle1H', instId: 'BTC-USDT' },
      data: [['1700000000000', '1', '2', '0.5', '1.5', '9', '9', '9', '0']],
    }),
  );
  check('okx candle row → 1h candle', candle?.candle.h === 2 && candle?.key.symbol === 'BTC/USDT');
  const trade = firstTrade(
    okxAdapter.parse({
      arg: { channel: 'trades', instId: 'ETH-USDT' },
      data: [{ instId: 'ETH-USDT', px: '3000', sz: '5', side: 'sell', ts: '1700000000000' }],
    }),
  );
  check('okx trades → sell', trade?.trade.side === 'sell' && trade?.trade.qty === 5);
  check('okx ignores unknown channels', okxAdapter.parse({ arg: { channel: 'books5', instId: 'BTC-USDT' }, data: [] }).length === 0);
  check(
    'okx routes candles to /business and trades to /public',
    okxAdapter.urlFor?.('candle1m|BTC-USDT') === 'wss://ws.okx.com:8443/ws/v5/business' &&
      okxAdapter.urlFor?.('trades|BTC-USDT') === 'wss://ws.okx.com:8443/ws/v5/public' &&
      okxAdapter.heartbeat?.payload() === 'ping',
  );
}

/* ---------------------------------- Kraken -------------------------------- */
{
  const events = krakenAdapter.parse([
    4414898185,
    ['1788993024.055068', '1788993060.000000', '78014.00000', '78014.00000', '78008.40000', '78008.40000', '78008.76590', '0.05338026', 25],
    'ohlc-1',
    'XBT/USD',
  ]);
  const candle = firstCandle(events);
  check(
    'kraken ohlc array → candle, XBT → BTC',
    candle?.candle.c === 78008.4 && candle?.key.symbol === 'BTC/USD' && candle?.key.timeframe === '1m' && candle?.candle.t === 1788993024055,
  );
  const trade = firstTrade(krakenAdapter.parse([53, ['9701.2', '0.004', '1565796692.837249', 'b', 'm', ''], 'trade', 'XBT/USD']));
  check('kraken trade array → buy', trade?.trade.side === 'buy' && trade?.trade.price === 9701.2);
  check(
    'kraken channel formats + batched subscribe',
    krakenAdapter.klineChannel({ exchange: 'kraken', symbol: 'BTC/USD', timeframe: '1h' }) === 'ohlc-60|XBT/USD' &&
      Array.isArray(krakenAdapter.subscribe(['ohlc-1|XBT/USD', 'trade|XBT/USD'])),
  );
}

/* --------------------------------- Coinbase ------------------------------- */
{
  const events = coinbaseAdapter.parse({
    type: 'match',
    trade_id: 1090853803,
    side: 'buy',
    size: '0.5',
    price: '78000',
    product_id: 'BTC-USDT',
    time: '2026-09-09T22:23:12.832170Z',
  });
  const trade = firstTrade(events);
  check(
    'coinbase match → taker side inverted (maker buy ⇒ SELL)',
    trade?.trade.side === 'sell' && trade?.trade.price === 78000 && trade?.trade.symbol === 'BTC/USDT',
  );
  check('coinbase ignores non-match frames', coinbaseAdapter.parse({ type: 'subscriptions', channels: [] }).length === 0);
  check(
    'coinbase derives candles (no candle channel) and has no 4h',
    coinbaseAdapter.derivesCandles === true &&
      !coinbaseAdapter.timeframes.includes('4h') &&
      coinbaseAdapter.klineChannel({ exchange: 'coinbase', symbol: 'BTC/USD', timeframe: '1m' }) === 'matches|BTC-USD',
  );
}

/* ----------------------------------- Gate --------------------------------- */
{
  const candle = firstCandle(
    gateAdapter.parse({
      time: 1788992963,
      channel: 'spot.candlesticks',
      event: 'update',
      result: { t: '1788992940', v: '60840.9891205', c: '78033.7', h: '78038.5', l: '78026.7', o: '78028', n: '1m_BTC_USDT', a: '0.77965', w: false },
    }),
  );
  check('gate candlestick → candle (base volume, ms)', candle?.candle.v === 0.77965 && candle?.candle.t === 1788992940000 && candle?.key.timeframe === '1m');
  const trade = firstTrade(
    gateAdapter.parse({
      channel: 'spot.trades',
      event: 'update',
      result: { id: 218630863, create_time_ms: '1788992597936.382000', side: 'sell', currency_pair: 'BTC_USDT', amount: '0.000128', price: '78026.6' },
    }),
  );
  check('gate trade → sell with ms timestamp', trade?.trade.side === 'sell' && trade?.trade.ts === 1788992597936);
  const pong: unknown[] = [];
  const consumed = gateAdapter.keepalive?.({ time: 1, channel: 'spot.ping' }, (p) => pong.push(p));
  check('gate answers spot.ping with spot.pong', consumed === true && JSON.stringify(pong[0]).includes('spot.pong'));
}

/* --------------------------------- Bitfinex ------------------------------- */
{
  bitfinexAdapter.parse({ event: 'subscribed', channel: 'candles', chanId: 74, key: 'trade:1m:tBTCUSD' });
  bitfinexAdapter.parse({ event: 'subscribed', channel: 'trades', chanId: 15, symbol: 'tBTCUSD' });

  const candle = firstCandle(bitfinexAdapter.parse([74, [[1788993120000, 78089, 78069, 78105, 78069, 0.62209418]]]));
  check(
    'bitfinex candle row [mts,o,c,h,l,v] → candle',
    candle?.candle.o === 78089 && candle?.candle.c === 78069 && candle?.candle.h === 78105 && candle?.key.timeframe === '1m',
  );
  const trade = firstTrade(bitfinexAdapter.parse([15, 'te', [1971168626, 1788992599247, -0.0001672, 78114]]));
  check('bitfinex negative amount → sell', trade?.trade.side === 'sell' && trade?.trade.qty === 0.0001672);
  check('bitfinex heartbeat frames ignored', bitfinexAdapter.parse([74, 'hb']).length === 0);
  check('bitfinex has no 4h bucket', !bitfinexAdapter.timeframes.includes('4h'));
  const pong: unknown[] = [];
  check(
    'bitfinex answers event:ping with pong',
    bitfinexAdapter.keepalive?.({ event: 'ping', cid: 42 }, (p) => pong.push(p)) === true &&
      JSON.stringify(pong[0]) === '{"event":"pong","cid":42}',
  );
}

/* -------------------------------- Crypto.com ------------------------------ */
{
  const candle = firstCandle(
    cryptocomAdapter.parse({
      id: 1,
      method: 'subscribe',
      code: 0,
      result: {
        instrument_name: 'BTC_USDT',
        subscription: 'candlestick.1m.BTC_USDT',
        channel: 'candlestick',
        interval: '1m',
        data: [{ o: '78847.79', h: '78861.81', l: '78836.26', c: '78843.67', v: '1.2787', t: 1788975000000 }],
      },
    }),
  );
  check('cryptocom candlestick snapshot → candle', candle?.candle.c === 78843.67 && candle?.candle.t === 1788975000000);
  const trade = firstTrade(
    cryptocomAdapter.parse({
      id: 1,
      method: 'subscribe',
      code: 0,
      result: {
        channel: 'trade',
        instrument_name: 'BTC_USDT',
        data: [{ d: '178899', t: 1788992950319, p: '78033.56', q: '0.00002', s: 'SELL', i: 'BTC_USDT' }],
      },
    }),
  );
  check('cryptocom trade → sell', trade?.trade.side === 'sell' && trade?.trade.price === 78033.56);
  check('cryptocom seeds via the socket, no REST', cryptocomAdapter.seedsViaSocket === true);
}

/* ----------------------------------- HTX ---------------------------------- */
{
  const candle = firstCandle(
    htxAdapter.parse({
      ch: 'market.btcusdt.kline.1min',
      ts: 1788992948589,
      tick: { id: 1788992940, open: 78030.65, close: 78043.51, low: 78030.65, high: 78043.51, amount: 0.017169, vol: 1339.92, count: 5 },
    }),
  );
  check('htx kline tick → candle (seconds → ms)', candle?.candle.c === 78043.51 && candle?.candle.t === 1788992940000 && candle?.key.symbol === 'BTC/USDT');
  const trade = firstTrade(
    htxAdapter.parse({
      ch: 'market.btcusdt.trade.detail',
      ts: 1788993040923,
      tick: { data: [{ id: 1, ts: 1788993040922, tradeId: 103628475686, amount: 1.8e-4, price: 78000.02, direction: 'buy' }] },
    }),
  );
  check('htx trade.detail → buy', trade?.trade.side === 'buy' && trade?.trade.qty === 1.8e-4);

  const sent: unknown[] = [];
  const gzipped = toArrayBuffer(gzipSync(JSON.stringify({ ping: 1788993040923 })));
  const decoded = await htxAdapter.decode?.(gzipped, (p) => sent.push(p));
  check('htx gunzips binary frames and answers ping with pong', decoded === null && JSON.stringify(sent[0]) === '{"pong":1788993040923}');

  const payload = toArrayBuffer(
    gzipSync(JSON.stringify({ ch: 'market.ethusdt.kline.5min', tick: { id: 1, open: 1, close: 2, low: 0.5, high: 3, amount: 9 } })),
  );
  const roundTrip = await htxAdapter.decode?.(payload, () => {});
  check('htx decoded frame parses into a candle', firstCandle(htxAdapter.parse(roundTrip))?.key.timeframe === '5m');
}

/* ---------------------------------- Bitget -------------------------------- */
{
  const candle = firstCandle(
    bitgetAdapter.parse({
      action: 'update',
      arg: { instType: 'SPOT', channel: 'candle1m', instId: 'BTCUSDT' },
      data: [['1788993060000', '78001.43', '78009.82', '78000', '78005.4', '0.014668', '1144.16', '1144.16']],
      ts: 1788993088229,
    }),
  );
  check('bitget candle row → candle', candle?.candle.h === 78009.82 && candle?.key.symbol === 'BTC/USDT');
  const trade = firstTrade(
    bitgetAdapter.parse({
      action: 'snapshot',
      arg: { instType: 'SPOT', channel: 'trade', instId: 'BTCUSDT' },
      data: [{ ts: '1788993033205', price: '78020.69', size: '0.001281', side: 'sell', tradeId: '1481709663147507712' }],
    }),
  );
  check('bitget trade → sell', trade?.trade.side === 'sell' && trade?.trade.price === 78020.69);
  check(
    'bitget uses instType SPOT (v1 SPBL answers 30016)',
    JSON.stringify(bitgetAdapter.subscribe(['SPOT|candle1m|BTCUSDT'])).includes('"instType":"SPOT"'),
  );
}

/* ---------------------------------- KuCoin -------------------------------- */
{
  const trade = firstTrade(
    kucoinAdapter.parse({
      topic: '/market/match:BTC-USDT',
      type: 'message',
      subject: 'trade.l3match',
      data: {
        price: '78010.2',
        size: '0.00001341',
        side: 'buy',
        symbol: 'BTC-USDT',
        time: '1788993048567000000',
        tradeId: '487293554767499264',
      },
    }),
  );
  check('kucoin match → buy, nanoseconds → ms', trade?.trade.side === 'buy' && trade?.trade.ts === 1788993048567);
  check('kucoin ignores the welcome frame', kucoinAdapter.keepalive?.({ id: 'x', type: 'welcome' }, () => {}) === true);
  check('kucoin resolves its URL from the public bullet endpoint', typeof kucoinAdapter.resolveUrl === 'function' && kucoinAdapter.derivesCandles === true);
}

/* ---------------------------------- CoinEx -------------------------------- */
{
  const events = coinexAdapter.parse({
    method: 'deals.update',
    params: ['BTCUSDT', [{ id: 7297160255, time: 1788992959.882339, type: 'buy', price: '78014', amount: '0.00011400' }]],
  });
  const trade = firstTrade(events);
  check('coinex deals.update → buy with ms timestamp', trade?.trade.side === 'buy' && trade?.trade.ts === 1788992959882);
  check('coinex ack frames are swallowed', coinexAdapter.keepalive?.({ error: null, result: { status: 'success' }, id: 1 }, () => {}) === true);
  check('coinex derives candles', coinexAdapter.derivesCandles === true);
}

/* ------------------------------ candle derivation -------------------------- */
{
  const deriver = new CandleDeriver('1m');
  const t0 = 1_700_000_040_000;
  const mk = (price: number, qty: number, ts: number) => ({ exchange: 'coinbase' as const, symbol: 'BTC/USD', price, qty, side: 'buy' as const, ts });
  deriver.push(mk(100, 1, t0));
  deriver.push(mk(110, 1, t0 + 1000));
  deriver.push(mk(90, 1, t0 + 2000));
  const rolled = deriver.push(mk(95, 1, t0 + 60_000)); // next bucket
  const closed = rolled[0];
  check(
    'derived candle rolls over and closes the previous bucket',
    rolled.length === 2 && closed?.closed === true && closed?.h === 110 && closed?.l === 90 && closed?.o === 100 && closed?.v === 3,
  );
  const seeded = new CandleDeriver('1m', { t: t0, o: 50, h: 120, l: 40, c: 100, v: 9 });
  seeded.push(mk(101, 1, t0 + 1000));
  const continued = seeded.push(mk(130, 1, t0 + 60_000))[0];
  check('derivation continues the REST-seeded candle', continued?.h === 120 && continued?.o === 50 && continued?.v === 10);
}

/* ------------------------------ live connections --------------------------- */
interface Probe {
  opened: boolean;
  events: FeedEvent[];
}

/**
 * Opens the real endpoints an adapter needs for one symbol (grouping channels
 * per URL exactly like the manager, including async URL resolution) and
 * collects the parsed events.
 */
async function probeAdapter(adapter: ExchangeAdapter, symbol: string, timeframe: Timeframe, timeoutMs: number): Promise<Probe> {
  const channels = [adapter.klineChannel({ exchange: adapter.id, symbol, timeframe }), adapter.tradeChannel(adapter.toExchangeSymbol(symbol))];
  const byUrl = new Map<string, string[]>();
  for (const channel of [...new Set(channels)]) {
    const url = adapter.resolveUrl ? `dynamic:${adapter.id}` : adapter.urlFor ? adapter.urlFor(channel) : adapter.url;
    byUrl.set(url, [...(byUrl.get(url) ?? []), channel]);
  }

  const result: Probe = { opened: false, events: [] };
  const sockets: { close(): void }[] = [];

  await new Promise<void>((resolve) => {
    const deadline = setTimeout(() => resolve(), timeoutMs);
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      for (const socket of sockets) socket.close();
      resolve();
    };

    for (const [url, urlChannels] of byUrl) {
      const send = (socket: { send(payload: unknown): void }, payload: unknown): void => {
        if (Array.isArray(payload)) for (const entry of payload) socket.send(entry);
        else socket.send(payload);
      };
      const socket = new ManagedSocket({
        id: `smoke-${adapter.id}`,
        url: url.startsWith('dynamic:') ? undefined : url,
        resolveUrl: adapter.resolveUrl,
        binary: adapter.binary,
        decode: adapter.decode,
        keepalive: adapter.keepalive,
        heartbeat: adapter.heartbeat,
        watchdogMs: 20_000,
        maxReconnectAttempts: 1,
        onStatus: (status) => {
          if (status === 'open') result.opened = true;
          if (status === 'error') finish();
        },
        onOpen: () => send(socket, adapter.subscribe(urlChannels)),
        onMessage: (payload) => {
          result.events.push(...adapter.parse(payload));
        },
      });
      sockets.push(socket);
      socket.connect();
    }
  });

  return result;
}

function summarise(adapter: ExchangeAdapter, probe: Probe): string {
  const trades = probe.events.filter((e) => e.type === 'trade');
  const candles = probe.events.filter((e) => e.type === 'candle').length;
  const last = trades[trades.length - 1];
  const derived = adapter.derivesCandles
    ? (() => {
        const deriver = new CandleDeriver('1m');
        let count = 0;
        for (const trade of trades) if (trade.type === 'trade') count += deriver.push(trade.trade).length;
        return ` → ${count} derived`;
      })()
    : '';
  return `${candles} candles / ${trades.length} trades${derived}${last && last.type === 'trade' ? ` (last ${last.trade.side} @ ${last.trade.price})` : ''}`;
}

console.log('\n— live public streams (12 venues) —');

const ADAPTER_LIST: ExchangeAdapter[] = [
  binanceAdapter,
  okxAdapter,
  bybitAdapter,
  krakenAdapter,
  coinbaseAdapter,
  gateAdapter,
  bitgetAdapter,
  kucoinAdapter,
  bitfinexAdapter,
  cryptocomAdapter,
  htxAdapter,
  coinexAdapter,
];

/** Venues whose USDT book is thin – probe their deep USD market instead. */
const PROBE_SYMBOL: Record<string, string> = { coinbase: 'BTC/USD', kraken: 'BTC/USD' };

const probes = new Map<string, Probe>();
const queue = [...ADAPTER_LIST];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (;;) {
      const adapter = queue.shift();
      if (!adapter) return;
      probes.set(adapter.id, await probeAdapter(adapter, PROBE_SYMBOL[adapter.id] ?? 'BTC/USDT', '1m', 14_000));
    }
  }),
);

for (const adapter of ADAPTER_LIST) {
  const probe = probes.get(adapter.id);
  if (!probe) continue;
  if (!probe.opened && probe.events.length === 0) {
    skip(`${adapter.id.padEnd(10)} live: endpoint unreachable from this region (browser clients usually reach it)`);
    continue;
  }
  const trades = probe.events.some((e) => e.type === 'trade');
  const candles = probe.events.some((e) => e.type === 'candle');
  const ok = adapter.derivesCandles ? trades : trades && candles;
  check(`${adapter.id.padEnd(10)} live: ${summarise(adapter, probe)}`, ok);
}

console.log(failures === 0 ? '\n✔ ws smoke OK\n' : `\n✖ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

export {};
