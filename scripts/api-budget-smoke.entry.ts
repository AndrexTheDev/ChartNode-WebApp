/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/** Deterministic, offline smoke test for the best-effort provider request budget. */

(globalThis as unknown as { window: unknown }).window = globalThis;

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const { fetchJson, ProviderBudgetError } = await import('@/api/http');
const { geckoSearchPools } = await import('@/api/geckoterminal');
let upstreamCalls = 0;
const acceptedVersions: string[] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  upstreamCalls += 1;
  acceptedVersions.push(new Headers(init?.headers).get('accept') ?? '');
  return new Response('{"ok":true,"data":[]}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

let failures = 0;
function check(name: string, passed: boolean): void {
  console.log(`${passed ? '  PASS' : '  FAIL'}  ${name}`);
  if (!passed) failures += 1;
}

const adapterPools = await geckoSearchPools('fixture');
check('GeckoTerminal adapter parses the empty fixture', adapterPools.length === 0);
check('GeckoTerminal adapter pins the documented API version', acceptedVersions[0] === 'application/json;version=20230203');

const responses = await Promise.all(
  Array.from({ length: 7 }, (_, index) =>
    fetchJson<{ ok: boolean }>(`https://api.geckoterminal.com/fixture/${index}`, {
      source: 'geckoterminal',
      retries: 0,
    }),
  ),
);
check('the first eight GeckoTerminal requests pass', responses.length === 7 && responses.every((item) => item.ok) && adapterPools.length === 0);
check('all eight requests reached the stub upstream', upstreamCalls === 8);

let budgetRejected = false;
try {
  await fetchJson('https://api.geckoterminal.com/fixture/overflow', {
    source: 'geckoterminal',
    retries: 0,
  });
} catch (error) {
  budgetRejected = error instanceof ProviderBudgetError && error.retryAfterMs > 0;
}
check('the ninth request is rejected locally with a retry window', budgetRejected);
check('budget rejection does not call the upstream', upstreamCalls === 8);

const stored = [...storage.entries()].find(([key]) => key.includes('geckoterminal'))?.[1];
check('the same-origin coordination stamps are persisted', Boolean(stored && JSON.parse(stored).length === 8));

const other = await fetchJson<{ ok: boolean }>('https://example.test/other-source', {
  source: 'unbudgeted-test-source',
  retries: 0,
});
check('unconfigured sources remain unaffected', other.ok && upstreamCalls === 9);

console.log(failures === 0 ? '\n✔ API budget smoke OK\n' : `\n✖ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

export {};
