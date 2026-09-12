// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { cva, type VariantProps } from 'class-variance-authority';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * The single button style of NodeChart.
 * `nc-clip-sm` gives it the cut-corner silhouette, `shadow-neon*` the glow.
 */
export const neonButtonVariants = cva(
  [
    'group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'nc-clip-sm font-mono uppercase tracking-cyber',
    'transition-[background-color,color,box-shadow,filter,transform] duration-200 ease-cyber',
    'disabled:pointer-events-none disabled:opacity-40',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-fg shadow-neon hover:shadow-neon-lg hover:brightness-110 active:translate-y-px',
        secondary:
          'border border-secondary/55 bg-secondary/10 text-secondary hover:border-secondary hover:bg-secondary/20 hover:shadow-volt active:translate-y-px',
        outline:
          'border border-primary/45 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 hover:shadow-neon-sm active:translate-y-px',
        ghost: 'bg-transparent text-muted hover:bg-elevated hover:text-fg',
        danger: 'border border-danger/55 bg-danger/10 text-danger hover:bg-danger/20',
      },
      size: {
        sm: 'h-8 px-3 text-2xs',
        md: 'h-10 px-5 text-xs',
        lg: 'h-12 px-7 text-sm',
        xl: 'h-14 px-9 text-sm',
        icon: 'h-9 w-9 p-0',
      },
      /** Slow breathing glow – use for the one primary CTA per view. */
      pulse: { true: 'animate-pulse-glow', false: '' },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', pulse: false, full: false },
  },
);

type VariantProps_ = VariantProps<typeof neonButtonVariants>;

interface SharedProps extends VariantProps_ {
  children: ReactNode;
  className?: string;
  /** Rendered before / after the label (icons, kbd hints, …). */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Corner brackets that fade in on hover. */
  corners?: boolean;
}

type ButtonAsButton = SharedProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof SharedProps> & { href?: undefined };

type ButtonAsLink = SharedProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof SharedProps> & {
    href: string;
    /** `true` renders a plain <a> (mailto:, external). Default: locale-aware next-intl Link. */
    external?: boolean;
  };

export type NeonButtonProps = ButtonAsButton | ButtonAsLink;

function Corners() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/btn:opacity-100"
    >
      <span className="absolute -left-px -top-px size-2 border-l border-t border-fg/70" />
      <span className="absolute -right-px -top-px size-2 border-r border-t border-fg/70" />
      <span className="absolute -bottom-px -left-px size-2 border-b border-l border-fg/70" />
      <span className="absolute -bottom-px -right-px size-2 border-b border-r border-fg/70" />
    </span>
  );
}

export function NeonButton(props: NeonButtonProps) {
  const {
    variant,
    size,
    pulse,
    full,
    className,
    children,
    leading,
    trailing,
    corners = true,
    ...rest
  } = props;

  const classes = cn(neonButtonVariants({ variant, size, pulse, full }), className);

  const inner = (
    <>
      {corners && <Corners />}
      {leading}
      <span className="relative">{children}</span>
      {trailing}
    </>
  );

  if (typeof (rest as ButtonAsLink).href === 'string') {
    const { href, external, ...anchorRest } = rest as ButtonAsLink;
    return external ? (
      <a href={href} className={classes} {...anchorRest}>
        {inner}
      </a>
    ) : (
      <Link href={href} className={classes} {...(anchorRest as Record<string, unknown>)}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {inner}
    </button>
  );
}
