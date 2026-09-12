// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { useToastStore } from '@/store/useToastStore';
import { donationGraceActive, useViralStore } from '@/store/useViralStore';
import { selectDivOn, selectReplayOn, selectSrOn, selectVpOn, useChartStore } from '@/store/useChartStore';

/**
 * The (polite) survival kit – honest nudges, zero dark patterns. Every ask
 * below shares ONE gate: `donationGraceActive()` – a declared donation buys
 * 48 h of silence (5 days above $5), and while that window runs nothing here
 * fires. The permanent supporter badge lives on regardless:
 *
 *   1. a rotating tip-jar toast every ~7 minutes of active terminal time
 *   2. a session-milestone card (3rd / 10th / 25th / 50th visit)
 *   3. a one-time ribbon when a feature lands that paid charting suites sell
 *
 * Everything is dismissible, everything is stored locally, nothing pretends
 * to be something it is not: one dev, ads + tips, no paywalls.
 */

const NUDGE_MS = 7 * 60_000;
const MILESTONES = [3, 10, 25, 50];

export function SupportNudge() {
  const t = useTranslations('support');
  const openSupport = useViralStore((s) => s.openSupport);

  /* 1 — rotating toast nudge */
  const push = useToastStore((s) => s.push);
  const nudgeIndex = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (donationGraceActive()) return;
      nudgeIndex.current += 1;
      const key = (`nudge${(nudgeIndex.current % 4) + 1}`) as 'nudge1' | 'nudge2' | 'nudge3' | 'nudge4';
      push(t(key), 'info', 9000);
    }, NUDGE_MS);
    return () => clearInterval(id);
  }, [push, t]);

  /* 2 — session milestone card */
  const [milestone, setMilestone] = useState<number | null>(null);
  useEffect(() => {
    try {
      const sessionKey = 'nc-visit-stamped';
      let visits = Number(localStorage.getItem('nc-visits') ?? '0');
      if (!sessionStorage.getItem(sessionKey)) {
        sessionStorage.setItem(sessionKey, '1');
        visits += 1;
        localStorage.setItem('nc-visits', String(visits));
      }
      const hit = MILESTONES.find((value) => value === visits);
      if (hit != null && !localStorage.getItem(`nc-milestone-${hit}`) && !donationGraceActive()) {
        // Delayed + non-stacking: if any other dialog owns the screen
        // (ad-wall, modal), this milestone waits for the next visit.
        const timer = setTimeout(() => {
          if (document.querySelector('[role="dialog"]')) return;
          localStorage.setItem(`nc-milestone-${hit}`, String(Date.now()));
          setMilestone(hit);
        }, 6000);
        return () => clearTimeout(timer);
      }
    } catch {
      /* storage blocked – stay quiet */
    }
  }, []);

  /* 4 — usage nudge: six opened tools mean a serious session */
  const sessionTools = useViralStore((s) => s.sessionTools);
  const [toolNudge, setToolNudge] = useState(false);
  useEffect(() => {
    if (sessionTools < 6) return undefined;
    if (useViralStore.getState().toolNudgeShown || donationGraceActive()) return undefined;
    const show = setTimeout(() => {
      useViralStore.setState({ toolNudgeShown: true });
      setToolNudge(true);
    }, 1500);
    return () => clearTimeout(show);
  }, [sessionTools]);
  useEffect(() => {
    if (!toolNudge) return undefined;
    const hide = setTimeout(() => setToolNudge(false), 16_000);
    return () => clearTimeout(hide);
  }, [toolNudge]);

  /* 3 — premium-celebration ribbon */
  const vpOn = useChartStore(selectVpOn);
  const srOn = useChartStore(selectSrOn);
  const divOn = useChartStore(selectDivOn);
  const replayOn = useChartStore(selectReplayOn);
  const celebrated = useViralStore((s) => s.celebrated);
  const celebrate = useViralStore((s) => s.celebrate);
  // Grace-Fenster sind Stunden-lang; ein 30-s-Tick hält die Unterdrückung
  // reaktiv ( Ribbon erscheint nach Ablauf wieder, falls das Feature noch an
  // und noch nicht gefeiert ist – er wird nicht weggeworfen, nur verschoben).
  const [graceActive, setGraceActive] = useState<boolean>(() => donationGraceActive());
  useEffect(() => {
    const id = setInterval(() => setGraceActive(donationGraceActive()), 30_000);
    return () => clearInterval(id);
  }, []);
  const ribbon = useMemo(() => {
    if (graceActive) return null;
    const live: [string, boolean][] = [
      ['vp', vpOn],
      ['sr', srOn],
      ['div', divOn],
      ['replay', replayOn],
    ];
    const hit = live.find(([feature, on]) => on && !celebrated.includes(feature));
    return hit?.[0] ?? null;
  }, [vpOn, srOn, divOn, replayOn, celebrated, graceActive]);
  useEffect(() => {
    if (!ribbon) return;
    const id = setTimeout(() => celebrate(ribbon), 14_000);
    return () => clearTimeout(id);
  }, [ribbon, celebrate]);

  return (
    <>
      {ribbon && (
        <div className="pointer-events-auto fixed left-1/2 top-16 z-40 w-[min(92vw,34rem)] -translate-x-1/2">
          <div className="nc-clip flex items-start gap-2 border border-secondary/60 bg-bg/97 px-3 py-2 shadow-volt backdrop-blur-xl">
            <Heart className="mt-0.5 size-3.5 shrink-0 fill-current text-secondary" aria-hidden />
            <p className="font-mono text-2xs leading-relaxed text-muted">{t('celebrate')}</p>
            <button
              type="button"
              onClick={() => {
                celebrate(ribbon);
                openSupport();
              }}
              className="nc-clip-sm ml-auto inline-flex h-7 shrink-0 items-center border border-secondary/60 bg-secondary/12 px-2 font-mono text-2xs uppercase tracking-cyber text-secondary transition-colors hover:bg-secondary/22"
            >
              {t('celebrateCta')}
            </button>
            <button
              type="button"
              aria-label="dismiss"
              onClick={() => celebrate(ribbon)}
              className="shrink-0 text-faint transition-colors hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {toolNudge && (
        <div className="pointer-events-auto fixed bottom-14 right-4 z-40 w-[min(92vw,26rem)]">
          <div className="nc-clip flex items-start gap-2 border border-secondary/60 bg-bg/97 px-3 py-2 shadow-volt backdrop-blur-xl">
            <Heart className="mt-0.5 size-3.5 shrink-0 fill-current text-secondary" aria-hidden />
            <p className="font-mono text-2xs leading-relaxed text-muted">{t('toolNudge.body')}</p>
            <button
              type="button"
              onClick={() => {
                setToolNudge(false);
                openSupport();
              }}
              className="nc-clip-sm ml-auto inline-flex h-7 shrink-0 items-center border border-secondary/60 bg-secondary/12 px-2 font-mono text-2xs uppercase tracking-cyber text-secondary transition-colors hover:bg-secondary/22"
            >
              {t('toolNudge.cta')}
            </button>
            <button
              type="button"
              aria-label="dismiss"
              onClick={() => setToolNudge(false)}
              className="shrink-0 text-faint transition-colors hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <Modal
        open={milestone != null}
        onClose={() => setMilestone(null)}
        widthClass="max-w-md"
        title={t('milestoneTitle')}
      >
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs leading-relaxed text-muted">{t('milestoneBody', { sessions: milestone ?? 0 })}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMilestone(null)}
              className="nc-clip-sm border border-line bg-surface/60 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:text-fg"
            >
              {t('milestoneLater')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMilestone(null);
                openSupport();
              }}
              className="nc-clip-sm inline-flex items-center gap-1.5 border border-secondary/60 bg-secondary/12 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-secondary transition-colors hover:bg-secondary/22"
            >
              <Heart className="size-3" aria-hidden />
              {t('milestoneCta')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
