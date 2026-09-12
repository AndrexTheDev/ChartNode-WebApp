// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { ChevronDown, Mail, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations, useMessages } from 'next-intl';
import { Kbd } from '@/components/ui/Kbd';
import { NeonPanel } from '@/components/ui/NeonPanel';
import { CONTACT } from '@/lib/constants';
import { cn } from '@/lib/cn';

interface HelpTopic {
  id: string;
  category: CategoryId;
  question: string;
  answer: string;
}

const CATEGORIES = [
  'all',
  'gettingStarted',
  'charts',
  'data',
  'troubleshooting',
  'indicators',
  'metrics',
  'scripts',
  'edge',
] as const;
type CategoryId = (typeof CATEGORIES)[number];

interface IndicatorDoc {
  name: string;
  short: string;
  hint: string;
}

interface MetricDoc {
  name: string;
  body: string;
}

interface Shortcut {
  keys: string[];
  labelKey: 'palette' | 'layout1' | 'layout2' | 'layout3' | 'help' | 'escape';
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['⌘', 'K'], labelKey: 'palette' },
  { keys: ['Ctrl', 'K'], labelKey: 'palette' },
  { keys: ['1'], labelKey: 'layout1' },
  { keys: ['2'], labelKey: 'layout2' },
  { keys: ['3'], labelKey: 'layout3' },
  { keys: ['?'], labelKey: 'help' },
  { keys: ['Esc'], labelKey: 'escape' },
];

/**
 * The interactive part of the help center:
 * full-text search over question + answer, category filtering and an
 * accessible accordion. Everything is client state – the content itself is
 * prerendered into the HTML, so it stays fully crawlable.
 */
export function HelpExplorer() {
  const t = useTranslations('help');
  const ts = useTranslations('shortcuts');
  const messages = useMessages();

  // Static FAQ topics + generated docs for EVERY indicator, EVERY market
  // metric and the Script Lab — all translated in all five locales, so the
  // help center covers the full product surface without hard-coded copy.
  const indicatorDocs = useMemo(
    () =>
      ((messages as { chart?: { indicators?: Record<string, IndicatorDoc> } }).chart
        ?.indicators ?? {}) as Record<string, IndicatorDoc>,
    [messages],
  );
  const topics = useMemo<HelpTopic[]>(() => {
    const base = t.raw('topics') as HelpTopic[];
    const indicatorTopics: HelpTopic[] = Object.entries(indicatorDocs).map(([kind, doc]) => ({
      id: `ind-${kind}`,
      category: 'indicators',
      question: `${doc.name} — ${doc.short}`,
      answer: doc.hint,
    }));
    const metricDocs = t.raw('metrics') as Record<string, MetricDoc>;
    const metricTopics: HelpTopic[] = Object.entries(metricDocs).map(([key, doc]) => ({
      id: `met-${key}`,
      category: 'metrics',
      question: doc.name,
      answer: doc.body,
    }));
    const scriptTopics = t.raw('scriptTopics') as HelpTopic[];
    const edgeTopics = (t.raw('edgeTopics') ?? []) as HelpTopic[];
    return [...base, ...indicatorTopics, ...metricTopics, ...scriptTopics, ...edgeTopics];
  }, [t, indicatorDocs]);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId>('all');
  const [open, setOpen] = useState<string[]>([topics[0]?.id ?? '']);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search field from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const normalised = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return topics.filter((topic) => {
      if (category !== 'all' && topic.category !== category) return false;
      if (!normalised) return true;
      return (
        topic.question.toLowerCase().includes(normalised) ||
        topic.answer.toLowerCase().includes(normalised) ||
        topic.category.toLowerCase().includes(normalised)
      );
    });
  }, [topics, category, normalised]);

  function toggle(id: string) {
    setOpen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="flex flex-col gap-10">
      {/* ------------------------------ search ----------------------------- */}
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-primary"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="nc-clip h-14 w-full border border-line bg-surface/70 pl-11 pr-24 font-mono text-sm text-fg placeholder:text-faint transition-colors focus:border-primary/70 focus:shadow-neon-sm focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('clearSearch')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-faint transition-colors hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : (
            <span className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 sm:block">
              <Kbd>/</Kbd>
            </span>
          )}
        </div>

        {/* category filter */}
        <div role="group" aria-label={t('title')} className="flex flex-wrap gap-2">
          {CATEGORIES.map((id) => {
            const active = category === id;
            const count =
              id === 'all' ? topics.length : topics.filter((topic) => topic.category === id).length;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(id)}
                className={cn(
                  'nc-clip-sm inline-flex items-center gap-2 border px-3 py-2 font-mono text-2xs uppercase tracking-cyber transition-all duration-200',
                  active
                    ? 'border-primary bg-primary/12 text-primary shadow-neon-sm'
                    : 'border-line bg-surface/50 text-muted hover:border-primary/40 hover:text-fg',
                )}
              >
                {t(`categories.${id}`)}
                <span className={cn('text-micro-9', active ? 'text-primary/70' : 'text-faint')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <p aria-live="polite" className="font-mono text-2xs uppercase tracking-cyber text-faint">
          {t('results', { count: filtered.length })}
        </p>
      </div>

      {/* ------------------------------ topics ----------------------------- */}
      {filtered.length === 0 ? (
        <NeonPanel className="p-10 text-center">
          <p className="font-display text-lg font-bold text-fg">
            {t('noResults', { query })}
          </p>
          <p className="mt-2 text-sm text-muted">{t('noResultsHint')}</p>
          <a
            href={CONTACT.mailto}
            className="mt-5 inline-flex items-center gap-2 font-mono text-2xs uppercase tracking-cyber text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            <Mail className="size-3.5" aria-hidden />
            {CONTACT.email}
          </a>
        </NeonPanel>
      ) : (
        <ul className="flex flex-col gap-px border border-line/70 bg-line/40">
          {filtered.map((topic) => {
            const isOpen = open.includes(topic.id);
            return (
              <li key={topic.id} className="bg-bg/85">
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`panel-${topic.id}`}
                    id={`trigger-${topic.id}`}
                    onClick={() => toggle(topic.id)}
                    className={cn(
                      'group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-200',
                      isOpen ? 'bg-primary/8' : 'hover:bg-elevated/50',
                    )}
                  >
                    <span
                      className={cn(
                        'size-6 shrink-0 border text-center font-mono text-2xs leading-[1.45rem] transition-colors',
                        isOpen
                          ? 'border-primary/60 bg-primary/15 text-primary'
                          : 'border-line text-faint group-hover:border-primary/40 group-hover:text-primary',
                      )}
                      aria-hidden
                    >
                      {isOpen ? '–' : '+'}
                    </span>
                    <span
                      className={cn(
                        'flex-1 text-sm font-semibold transition-colors sm:text-base',
                        isOpen ? 'text-primary' : 'text-fg',
                      )}
                    >
                      {topic.question}
                    </span>
                    <span className="hidden shrink-0 font-mono text-2xs uppercase tracking-cyber text-faint sm:block">
                      {t(`categories.${topic.category}`)}
                    </span>
                    <ChevronDown
                      className={cn(
                        'size-4 shrink-0 text-faint transition-transform duration-300',
                        isOpen && 'rotate-180 text-primary',
                      )}
                      aria-hidden
                    />
                  </button>
                </h3>

                <div
                  id={`panel-${topic.id}`}
                  role="region"
                  aria-labelledby={`trigger-${topic.id}`}
                  hidden={!isOpen}
                  className="px-5 pb-5 pl-[3.75rem]"
                >
                  <p className="border-l border-primary/30 pl-4 text-sm leading-relaxed text-muted">
                    {topic.answer}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ----------------------------- shortcuts --------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <NeonPanel title={t('shortcutsTitle')} glow="sm" bodyClassName="p-5">
          <p className="mb-4 text-xs text-muted">{t('shortcutsSubtitle')}</p>
          <ul className="flex flex-col gap-2">
            {SHORTCUTS.map((shortcut, index) => (
              <li
                key={`${shortcut.labelKey}-${index}`}
                className="flex items-center justify-between gap-4 border-b border-line/40 pb-2 last:border-0 last:pb-0"
              >
                <span className="text-xs text-muted">{ts(shortcut.labelKey)}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {shortcut.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </NeonPanel>

        <NeonPanel title={t('contactTitle')} glow="lg" scan bodyClassName="p-5">
          <p className="text-sm leading-relaxed text-muted">{t('contactBody')}</p>
          <a
            href={CONTACT.mailto}
            className={cn(
              'nc-clip-sm mt-5 inline-flex h-11 items-center gap-2.5 border border-primary/45 bg-primary/8 px-5',
              'font-mono text-2xs uppercase tracking-cyber text-primary transition-all duration-200',
              'hover:border-primary hover:bg-primary/15 hover:shadow-neon-sm',
            )}
          >
            <Mail className="size-4" aria-hidden />
            {t('contactCta', { handle: CONTACT.handle })}
          </a>
          <p className="mt-4 font-mono text-2xs uppercase tracking-cyber text-faint">
            {t('feedbackNote')}
          </p>
        </NeonPanel>
      </div>
    </div>
  );
}
