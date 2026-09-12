// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { cn } from '@/lib/cn';

interface GlitchTextProps {
  text: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
  /** Disable the RGB-split layers (also auto-disabled for reduced motion in CSS). */
  enabled?: boolean;
}

/**
 * Cyberpunk RGB-split glitch. The pseudo elements in globals.css read
 * `data-text`, so the markup stays a single accessible node.
 */
export function GlitchText({ text, className, as: Tag = 'span', enabled = true }: GlitchTextProps) {
  return (
    <Tag className={cn(enabled && 'nc-glitch', className)} data-text={enabled ? text : undefined}>
      {text}
    </Tag>
  );
}
