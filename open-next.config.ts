// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext → Cloudflare adapter config.
 * Part 1 needs no bindings, no incremental cache and no revalidation queue:
 * every page is prerendered at build time for all 5 locales and served as a
 * static asset from Cloudflare's edge. That keeps the runtime cost at $0.
 *
 * When Part 2+ adds API routes / on-demand ISR, enable `incrementalCache`
 * (Workers KV) and `tagCache` here – nothing else in the app has to change.
 */
export default defineCloudflareConfig({
  // incrementalCache: { type: 'memory-limit' },
});
