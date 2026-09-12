// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { cn } from '@/lib/cn';

/** Monospace keyboard hint, styled like a physical keycap. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center border border-line bg-elevated px-1.5',
        'font-mono text-2xs text-muted shadow-[inset_0_-2px_0_0_hsl(var(--nc-line)/0.6)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
