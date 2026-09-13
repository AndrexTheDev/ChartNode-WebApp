// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '404 · NodeChart',
  robots: { index: false, follow: false },
};

/**
 * Root-level 404 for routes that never enter the [locale] subtree (e.g.
 * `/de/does-not-exist`). There is no root layout, hence no global CSS –
 * everything is inlined so the error page still wears the neon skin.
 */
export default function RootNotFound() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        textAlign: 'center',
        padding: 24,
        background: '#050705',
        color: '#d7fad7',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 'clamp(4rem, 14vw, 9rem)',
          fontWeight: 900,
          lineHeight: 1,
          color: '#39ff6a',
          textShadow: '0 0 18px rgb(57 255 106 / 0.55), 0 0 60px rgb(57 255 106 / 0.25)',
          letterSpacing: '0.04em',
        }}
      >
        404
      </p>
      <h1 style={{ margin: 0, fontSize: 'clamp(1.1rem, 3vw, 1.6rem)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
        Signal verloren · Signal lost
      </h1>
      <p style={{ margin: 0, maxWidth: 460, fontSize: 13, lineHeight: 1.7, color: '#8fae8f' }}>
        Diese Route existiert auf NodeChart nicht. · This route does not exist on NodeChart.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/"
          style={{
            padding: '10px 18px',
            border: '1px solid rgb(57 255 106 / 0.6)',
            background: 'rgb(57 255 106 / 0.12)',
            color: '#39ff6a',
            textDecoration: 'none',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
          }}
        >
          Zurück zur Basis · Home
        </Link>
        <Link
          href="/help"
          style={{
            padding: '10px 18px',
            border: '1px solid rgb(215 250 215 / 0.25)',
            color: '#d7fad7',
            textDecoration: 'none',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
          }}
        >
          Hilfe-Center · Help
        </Link>
      </div>
    </main>
  );
}
