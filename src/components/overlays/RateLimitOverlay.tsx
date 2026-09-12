// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { COOLDOWN_MS, endCooldown } from '@/api/rateLimit';
import { useRateLimitStore } from '@/store/useRateLimitStore';

/**
 * Global 429 response.
 *
 * When any upstream answers HTTP 429 the fetch layer starts a cooldown; this
 * overlay renders the cyberpunk glitch ("RATE LIMIT EXCEEDED – BYPASSING…")
 * with a live 5 s countdown and a depleting progress bar. At zero it calls
 * `endCooldown()`, which releases the awaited promise in `api/http.ts` and the
 * original request retries automatically.
 */
export function RateLimitOverlay() {
  const t = useTranslations('ratelimit');
  const active = useRateLimitStore((s) => s.active);
  const source = useRateLimitStore((s) => s.source);
  const deadline = useRateLimitStore((s) => s.deadline);
  const hits = useRateLimitStore((s) => s.hits);

  const [remainingMs, setRemainingMs] = useState(COOLDOWN_MS);

  useEffect(() => {
    if (!active) return;

    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      setRemainingMs(left);
      if (left <= 0) endCooldown();
    };

    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [active, deadline]);

  if (!active) return null;

  const progress = Math.min(1, Math.max(0, remainingMs / COOLDOWN_MS));
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={t('aria')}
      className="fixed inset-0 z-toast flex items-center justify-center px-4"
    >
      {/* backdrop with CRT scanlines */}
      <div aria-hidden className="nc-scanlines absolute inset-0 bg-bg/90 backdrop-blur-sm" />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--nc-danger)/0.14)_0%,transparent_60%)]"
      />

      <div className="nc-clip-lg relative w-full max-w-md animate-fade-up border border-danger/60 bg-elevated/95 p-8 text-center shadow-[0_0_60px_-10px_hsl(var(--nc-danger)/0.6)]">
        {/* corner brackets */}
        <span aria-hidden className="absolute left-2 top-2 size-4 border-l-2 border-t-2 border-danger" />
        <span aria-hidden className="absolute right-2 top-2 size-4 border-r-2 border-t-2 border-danger" />
        <span aria-hidden className="absolute bottom-2 left-2 size-4 border-b-2 border-l-2 border-danger" />
        <span aria-hidden className="absolute bottom-2 right-2 size-4 border-b-2 border-r-2 border-danger" />

        <TriangleAlert
          className="mx-auto size-8 animate-pulse-glow text-danger"
          aria-hidden
          style={{ color: 'hsl(var(--nc-danger))' }}
        />

        <h2
          className="nc-glitch mt-4 font-display text-2xl font-black uppercase tracking-cyber text-danger"
          data-text={t('title')}
        >
          {t('title')}
        </h2>

        <p className="mt-2 font-mono text-xs uppercase tracking-mega text-warning animate-flicker">
          {t('body')}
        </p>

        {source && (
          <p className="mt-4 font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('source', { source })}
            {hits > 1 ? ` · ×${hits}` : ''}
          </p>
        )}

        {/* countdown */}
        <p className="mt-6 font-display text-6xl font-black tabular-nums text-fg neon-text">
          {seconds}
        </p>
        <p className="mt-1 font-mono text-2xs uppercase tracking-cyber text-muted">
          {t('countdown', { seconds })}
        </p>

        {/* depleting bar */}
        <div className="mt-5 h-1.5 w-full border border-danger/40 bg-bg/60">
          <div
            className="h-full bg-gradient-to-r from-danger via-warning to-danger transition-[width] duration-100 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <p className="mt-4 flex items-center justify-center gap-2 font-mono text-2xs uppercase tracking-cyber text-faint">
          <RefreshCw className="size-3 animate-spin" aria-hidden />
          {t('retrying')}
        </p>
      </div>
    </div>
  );
}
