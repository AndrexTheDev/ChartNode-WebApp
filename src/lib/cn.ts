// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className combiner. Use this everywhere instead of `clsx`. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
