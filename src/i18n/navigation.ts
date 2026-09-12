// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation primitives.
 * ALWAYS import these instead of `next/link` / `next/navigation` inside the
 * app – they inject the active locale automatically and keep `href`s stable
 * when the user switches language.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
