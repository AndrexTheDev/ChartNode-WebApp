// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Code2, Download, Play, Plus, Save, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { importScriptSource, loadScripts, runScript, saveScripts, type StoredScript } from '@/lib/scripts';
import { useChartStore } from '@/store/useChartStore';
import { useViralStore } from '@/store/useViralStore';
import type { Candle } from '@/websockets/types';

interface ScriptLabModalProps {
  candles: Candle[];
  open: boolean;
  onClose: () => void;
}

const input =
  'mt-1 w-full border border-line bg-surface/60 px-2 py-1.5 font-mono text-xs text-fg outline-none transition-[border-color,box-shadow] duration-200 focus:border-secondary/70 focus:shadow-neon-sm';

/**
 * Wave-5 Script Lab: write a per-bar formula, test it on the live buffer,
 * import sources (GitHub blob/raw, gists, any https raw file) and lay the
 * result on the chart as a CUSTOM indicator. All local, all free.
 */
export function ScriptLabModal({ candles, open, onClose }: ScriptLabModalProps) {
  const t = useTranslations('tools');
  const [scripts, setScripts] = useState<StoredScript[]>(() => loadScripts());
  const [name, setName] = useState('');
  const [source, setSource] = useState('ema(21) - ema(55)');
  const [overlay, setOverlay] = useState(false);
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const importController = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ last?: number; min?: number; max?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    importController.current?.abort();
    onClose();
  };

  useEffect(() => {
    if (!open) importController.current?.abort();
    return () => importController.current?.abort();
  }, [open]);

  const commit = (next: StoredScript[]) => {
    setScripts(next);
    saveScripts(next);
  };

  const test = () => {
    const run = runScript(source, candles);
    if (run.error) {
      setError(t(`scripts.err.${run.error === 'too-long' ? 'too-long' : run.error === 'empty' ? 'empty' : run.error === 'runtime' ? 'runtime' : 'compile'}`));
      setResult(null);
      return;
    }
    setError(null);
    const defined = run.values.filter((v): v is number => v != null);
    setResult(
      defined.length
        ? { last: defined[defined.length - 1], min: Math.min(...defined), max: Math.max(...defined) }
        : { last: undefined, min: undefined, max: undefined },
    );
  };

  const apply = () => {
    useChartStore.getState().addIndicator('pane-1', 'CUSTOM', { overlay: overlay ? 1 : 0 }, source);
    useViralStore.getState().bumpTool();
    handleClose();
  };

  const save = () => {
    const entry: StoredScript = {
      id: `s-${Date.now()}`,
      name: name.trim() || source.slice(0, 24),
      source,
      overlay,
      updatedAt: Date.now(),
    };
    commit([entry, ...scripts].slice(0, 50));
    setName('');
  };

  const doImport = async () => {
    if (importController.current) return;
    const controller = new AbortController();
    importController.current = controller;
    setImporting(true);
    setError(null);
    try {
      const text = await importScriptSource(url, controller.signal);
      if (!controller.signal.aborted) setSource(text.slice(0, 4000));
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'network';
      if (message.startsWith('http-')) {
        setError(t('scripts.errHttp', { code: message.slice(5) }));
      } else {
        const key = message === 'https-only' || message === 'too-large' || message === 'timeout'
          ? message
          : 'network';
        setError(t(`scripts.err.${key}`));
      }
    } finally {
      if (importController.current === controller) {
        importController.current = null;
        setImporting(false);
      }
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={t('scripts.title')} subtitle={t('scripts.sub')} widthClass="max-w-3xl">
      <div className="flex flex-col gap-3">
        <p role="note" className="border border-danger/60 bg-danger/5 px-3 py-2 font-mono text-2xs leading-relaxed text-danger">
          {t('scripts.securityWarning')}
        </p>
        <p className="border border-line/60 bg-surface/30 px-3 py-2 font-mono text-2xs leading-relaxed text-muted">
          {t('scripts.guide')}
        </p>

        <label className="font-mono text-2xs uppercase tracking-cyber text-faint">
          {t('scripts.source')}
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            rows={4}
            spellCheck={false}
            className={cn(input, 'resize-y leading-relaxed')}
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 font-mono text-2xs uppercase tracking-cyber text-muted">
          <input type="checkbox" checked={overlay} onChange={() => setOverlay((value) => !value)} className="accent-bull" />
          {t('scripts.overlay')}
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={test}
            className="flex items-center gap-1 border border-line px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-muted hover:text-fg"
          >
            <Play size={12} /> {t('scripts.test')}
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex items-center gap-1 border border-bull/50 bg-bull/10 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-bull hover:bg-bull/20"
          >
            <Code2 size={12} /> {t('scripts.apply')}
          </button>
          <button
            type="button"
            onClick={save}
            className="flex items-center gap-1 border border-line px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-muted hover:text-fg"
          >
            <Save size={12} /> {t('scripts.save')}
          </button>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('scripts.name')}
            aria-label={t('scripts.name')}
            className="min-w-32 flex-1 border border-line bg-surface/60 px-2 py-1.5 font-mono text-xs text-fg outline-none transition-[border-color,box-shadow] duration-200 focus:border-secondary/70 focus:shadow-neon-sm"
          />
        </div>

        {error && <p className="font-mono text-2xs text-bear">{error}</p>}
        {result && (
          <p className="font-mono text-2xs text-muted">
            {t('scripts.last')}: <span className="text-fg">{result.last?.toFixed(6) ?? '—'}</span> · {t('scripts.min')}:{' '}
            <span className="text-bear">{result.min?.toFixed(6) ?? '—'}</span> · {t('scripts.max')}:{' '}
            <span className="text-bull">{result.max?.toFixed(6) ?? '—'}</span>
          </p>
        )}

        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t('scripts.importPh')}
            aria-label={t('scripts.import')}
            className="min-w-0 flex-1 border border-line bg-surface/60 px-2 py-1.5 font-mono text-xs text-fg outline-none transition-[border-color,box-shadow] duration-200 focus:border-secondary/70 focus:shadow-neon-sm"
          />
          <button
            type="button"
            onClick={() => void doImport()}
            disabled={importing}
            aria-busy={importing}
            className="flex items-center gap-1 border border-secondary/50 bg-secondary/10 px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-secondary hover:bg-secondary/20 disabled:cursor-wait disabled:opacity-50"
          >
            <Download size={12} /> {t('scripts.importGo')}
          </button>
        </div>

        {scripts.length > 0 && (
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {scripts.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 border border-line/60 bg-surface/30 px-2 py-1.5 font-mono text-2xs">
                <button
                  type="button"
                  className="truncate text-fg hover:text-secondary"
                  onClick={() => {
                    setSource(entry.source);
                    setOverlay(entry.overlay);
                    setName(entry.name);
                  }}
                >
                  {entry.name}
                </button>
                <span className="truncate text-faint">{entry.source.slice(0, 40)}</span>
                <button
                  type="button"
                  aria-label={t('scripts.del')}
                  onClick={() => commit(scripts.filter((item) => item.id !== entry.id))}
                  className="ml-auto text-faint hover:text-bear"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setSource('');
              setName('');
              setResult(null);
              setError(null);
            }}
            className="flex items-center gap-1 border border-line px-3 py-1.5 font-mono text-2xs uppercase tracking-cyber text-muted hover:text-fg"
          >
            <Plus size={12} /> {t('scripts.new')}
          </button>
          <button
            type="button"
            onClick={() => useViralStore.getState().openSupport()}
            className="font-mono text-2xs text-secondary underline decoration-dotted underline-offset-4 hover:text-fg"
          >
            {t('scripts.foot')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
