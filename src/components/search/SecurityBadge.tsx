// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { ShieldCheck, ShieldQuestion, Skull, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { SecurityAudit } from '@/api/types';

interface SecurityBadgeProps {
  audit: SecurityAudit | null | undefined;
  /** Audit request in flight. */
  pending?: boolean;
  className?: string;
}

/**
 * The visual verdict chip of the Smart Search.
 *   safe    → neon-green glow  + shield
 *   warn    → amber            + triangle
 *   danger  → neon-red glow    + skull  ("Scam / Honeypot")
 *   unknown → muted            + question shield
 */
export function SecurityBadge({ audit, pending = false, className }: SecurityBadgeProps) {
  const t = useTranslations('search');

  if (pending) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 animate-pulse items-center gap-1 border border-line bg-elevated/60 px-1.5 py-0.5',
          'font-mono text-micro-9 uppercase tracking-cyber text-faint',
          className,
        )}
      >
        <span className="size-1 rounded-full bg-accent shadow-[0_0_8px_hsl(var(--nc-accent)/0.9)]" />
        {t('auditing')}
      </span>
    );
  }

  if (!audit) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1 border border-line bg-elevated/40 px-1.5 py-0.5',
          'font-mono text-micro-9 uppercase tracking-cyber text-faint',
          className,
        )}
      >
        <ShieldQuestion className="size-2.5" aria-hidden />
        {t('unknown')}
      </span>
    );
  }

  const map = {
    safe: {
      icon: ShieldCheck,
      label: t('safe'),
      cls: 'border-bull/60 bg-bull/10 text-bull shadow-[0_0_10px_hsl(var(--nc-bull)/0.55)]',
    },
    warn: {
      icon: TriangleAlert,
      label: t('warn'),
      cls: 'border-warning/60 bg-warning/10 text-warning shadow-[0_0_10px_hsl(var(--nc-warning)/0.45)]',
    },
    danger: {
      icon: Skull,
      label: t('danger'),
      cls: 'border-bear/70 bg-bear/15 text-bear shadow-[0_0_14px_hsl(var(--nc-bear)/0.7)] animate-pulse',
    },
    unknown: {
      icon: ShieldQuestion,
      label: t('unknown'),
      cls: 'border-line bg-elevated/40 text-faint',
    },
  } as const;

  const entry = map[audit.verdict];
  const Icon = entry.icon;

  return (
    <span
      title={audit.flags.length > 0 ? audit.flags.join(', ') : audit.provider}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5',
        'font-mono text-micro-9 uppercase tracking-cyber',
        entry.cls,
        className,
      )}
    >
      <Icon className="size-2.5" aria-hidden />
      {entry.label}
    </span>
  );
}
