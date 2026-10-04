// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext → Cloudflare adapter config.
 * Locale landing/help/legal pages are prerendered, while the terminal and
 * narrow API handlers are bundled into a Worker. The current setup needs no
 * KV/D1 binding, but Worker requests and upstream APIs still have plan limits
 * and may incur costs; check current Cloudflare terms and quotas.
 *
 * If on-demand ISR is added later, configure an appropriate incremental cache
 * and tag cache here (for example, Workers KV) after reviewing current limits.
 */
export default defineCloudflareConfig({
  // incrementalCache: { type: 'memory-limit' },
});
