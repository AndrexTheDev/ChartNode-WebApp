// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Cloudflare Workers/Pages has no Next.js image-optimization server by default.
  // NodeChart renders charts on <canvas>/<svg> anyway, so we keep this off and stay $0.
  images: { unoptimized: true },
  // Every route is either statically prerendered (all 5 locales via generateStaticParams)
  // or edge-cached. No Node.js server process is required at runtime.
  // NOTE: Next.js 16 dropped the `eslint` config key (`next lint` is gone) –
  // run `npm run lint` directly instead.
  typescript: { ignoreBuildErrors: false },
  /**
   * Baseline security headers (free, edge-served). No frame-ancestors rule on
   * purpose: the sandboxed live preview embeds the app in an iframe.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
      // Crawl-/Share-Assets am Edge puffern: Suchmaschinen & Social-Bots
      // holen sie häufig, der Inhalt ändert sich selten.
      {
        source: '/sitemap.xml',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400' }],
      },
      {
        source: '/robots.txt',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400' }],
      },
      {
        source: '/og.png',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800' }],
      },
      {
        source: '/icon.svg',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800' }],
      },
      // HTML: Edge darf 5 min puffern, Browser immer validieren
      {
        source: '/((?!_next|api|sitemap\\.xml|robots\\.txt|og\\.png|icon\\.svg).*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400' }],
      },
    ];
  },
};

// Only boot the local Cloudflare runtime emulation when you actually need bindings
// (KV / D1 / R2). It is intentionally NOT enabled by default: it slows `next dev` down
// and Part 1 uses no bindings. Enable with: CF_LOCAL_BINDINGS=1 npm run dev
if (process.env.CF_LOCAL_BINDINGS === '1') {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare');
  initOpenNextCloudflareForDev();
}

export default withNextIntl(nextConfig);
