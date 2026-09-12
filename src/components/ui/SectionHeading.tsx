// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
  id?: string;
  /** pages whose main headline is this heading pass `h1` (SEO hygiene) */
  titleAs?: 'h1' | 'h2';
}

/** Eyebrow + headline + lead. The `//` marker keeps the terminal aesthetic. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  className,
  id,
  titleAs = 'h2',
}: SectionHeadingProps) {
  const Heading = titleAs;
  return (
    <div
      className={cn(
        'flex max-w-3xl flex-col gap-4',
        align === 'center' && 'mx-auto items-center text-center',
        className,
      )}
    >
      {eyebrow && (
        <span className="nc-eyebrow">
          <span aria-hidden className="text-primary/60">
            {'//'}
          </span>
          {eyebrow}
        </span>
      )}
      <Heading id={id} className="text-3xl font-extrabold leading-[1.08] sm:text-4xl lg:text-[2.75rem]">
        {title}
      </Heading>
      {description && <p className="text-sm leading-relaxed text-muted sm:text-base">{description}</p>}
    </div>
  );
}
