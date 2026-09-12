// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export interface Crumb {
  href: string;
  label: string;
}

/**
 * Tiny visual breadcrumb trail – internal linking + orientation, and the
 * markup twin of the BreadcrumbList schema emitted next to it.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" className="container max-w-5xl pt-8">
      <ol className="flex flex-wrap items-center gap-1.5 font-mono text-2xs uppercase tracking-cyber text-faint">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.href} className="flex items-center gap-1.5">
              {last ? (
                <span aria-current="page" className="text-primary">
                  {item.label}
                </span>
              ) : (
                <>
                  <Link href={item.href} className="transition-colors hover:text-fg">
                    {item.label}
                  </Link>
                  <ChevronRight className="size-3" aria-hidden />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
