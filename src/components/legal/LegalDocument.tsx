// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/constants';
import { NeonPanel } from '@/components/ui/NeonPanel';
import { StatusLed } from '@/components/ui/StatusLed';

interface LegalSection {
  heading: string;
  body: string;
}

interface LegalDocumentProps {
  eyebrow: string;
  title: string;
  intro: string;
  updatedLabel: string;
  sections: LegalSection[];
  contactBlock: ReactNode;
  backLabel: string;
  icon?: ReactNode;
}

/**
 * Shared shell for AGB / Disclaimer / Privacy.
 * Rendered on the server so the full legal text is crawlable HTML.
 */
export function LegalDocument({
  eyebrow,
  title,
  intro,
  updatedLabel,
  sections,
  contactBlock,
  backLabel,
  icon,
}: LegalDocumentProps) {
  return (
    <div className="container max-w-4xl py-14 lg:py-20">
      <Link
        href={ROUTES.home}
        className="nc-clip-sm mb-8 inline-flex items-center gap-2 border border-line bg-surface/60 px-3 py-2 font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:border-primary/60 hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {backLabel}
      </Link>

      <header className="mb-10 flex flex-col gap-4">
        <span className="nc-eyebrow">
          {icon}
          {eyebrow}
        </span>
        <h1 className="text-4xl font-black leading-tight sm:text-5xl">{title}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted">{intro}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="nc-chip">
            <StatusLed tone="ok" />
            {updatedLabel}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <NeonPanel key={section.heading} as="section" glow="sm" className="p-6 sm:p-7">
            <h2 className="text-lg font-bold text-primary">{section.heading}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[0.9375rem]">
              {section.body}
            </p>
          </NeonPanel>
        ))}
      </div>

      <footer className="mt-10">{contactBlock}</footer>
    </div>
  );
}
