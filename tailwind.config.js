/** @type {import('tailwindcss').Config} */
/*
 * ---------------------------------------------------------------------------
 * NodeChart · Cyberpunk / Neon-Dark Design System
 * ---------------------------------------------------------------------------
 * Every *semantic* colour (bg, surface, border, foreground, primary, ...)
 * resolves to a CSS custom property defined in src/styles/globals.css.
 * Swapping `data-theme` on <html> therefore re-skins the whole app without a
 * single re-render of React state -> this is what powers `useAppStore.theme`.
 *
 * The fixed `neon.*` scale never changes with the theme; use it for accents
 * that must stay brand-identical (bull/bear candles, status LEDs, logos).
 * ---------------------------------------------------------------------------
 */
module.exports = {
  darkMode: ['class', '[data-theme="acid"]'],
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem' },
      screens: { '2xl': '1440px' },
    },
    extend: {
      colors: {
        /* ---- semantic, theme-driven ---- */
        bg: 'hsl(var(--nc-bg) / <alpha-value>)',
        surface: 'hsl(var(--nc-surface) / <alpha-value>)',
        elevated: 'hsl(var(--nc-elevated) / <alpha-value>)',
        line: 'hsl(var(--nc-line) / <alpha-value>)',
        fg: 'hsl(var(--nc-fg) / <alpha-value>)',
        muted: 'hsl(var(--nc-muted) / <alpha-value>)',
        faint: 'hsl(var(--nc-faint) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--nc-primary) / <alpha-value>)',
          fg: 'hsl(var(--nc-primary-fg) / <alpha-value>)',
          dim: 'hsl(var(--nc-primary-dim) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--nc-secondary) / <alpha-value>)',
          fg: 'hsl(var(--nc-secondary-fg) / <alpha-value>)',
        },
        accent: 'hsl(var(--nc-accent) / <alpha-value>)',
        danger: 'hsl(var(--nc-danger) / <alpha-value>)',
        warning: 'hsl(var(--nc-warning) / <alpha-value>)',

        /* Flat aliases of the fixed neon scale. The whole UI writes
           `text-bull` / `border-bear/50` – without these top-level entries
           every such class is dropped from the build. */
        bull: '#00ff9d',
        bear: '#ff2e63',

        /* ---- fixed neon brand scale (theme independent) ---- */
        neon: {
          acid: '#39ff14',
          acidDeep: '#16c400',
          volt: '#b026ff',
          voltDeep: '#7a00cc',
          cyan: '#00f0ff',
          magenta: '#ff2bd6',
          amber: '#ffb800',
          bull: '#00ff9d',
          bear: '#ff2e63',
          ink: '#050505',
          carbon: '#0a0a0a',
          steel: '#121216',
          graphite: '#1a1a21',
        },
      },

      fontFamily: {
        brand: ['var(--font-brand)', 'Orbitron', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      fontSize: {
        // Micro-Skala fuer Chart-Legenden, Chips und Dichte-Tabellen.
        // `px`-Strings (kein lineHeight-Block) sind Absicht: 9/10px-Text erbt
        // damit weiterhin die Zeilenhoehe des Elternelements, genau wie die
        // frueheren text-[9px]/text-[10px]-Utilities.
        'micro-8': '8px',
        'micro-9': '9px',
        'micro-10': '10px',
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em' }],
        display: ['clamp(2.5rem, 8vw, 5.5rem)', { lineHeight: '0.95', letterSpacing: '-0.03em' }],
      },

      letterSpacing: {
        mega: '0.28em',
        cyber: '0.14em',
      },

      /*
       * Tailwind only generates `bg-x/12` when 12 exists on the opacity scale.
       * The design uses fine-grained tints (/8, /12, /14, /16, /22 …) for
       * hover & pressed states – without these every such class is silently
       * dropped from the CSS and the state renders dead. Keep in sync with
       * `npm run audit:css` (scripts/tw-missing.mjs).
       */
      opacity: {
        2: '0.02',
        3: '0.03',
        4: '0.04',
        6: '0.06',
        8: '0.08',
        11: '0.11',
        12: '0.12',
        14: '0.14',
        16: '0.16',
        18: '0.18',
        30: '0.3',
        22: '0.22',
        28: '0.28',
        32: '0.32',
        45: '0.45',
        55: '0.55',
        65: '0.65',
        72: '0.72',
        85: '0.85',
        88: '0.88',
        92: '0.92',
        94: '0.94',
        96: '0.96',
        97: '0.97',
        98: '0.98',
      },

      borderRadius: {
        cyber: '2px',
        'cyber-lg': '4px',
      },

      borderWidth: {
        3: '3px',
      },

      spacing: {
        gutter: 'var(--nc-gutter)',
        header: 'var(--nc-header-h)',
      },

      boxShadow: {
        neon: '0 0 0 1px hsl(var(--nc-primary) / 0.45), 0 0 18px -2px hsl(var(--nc-primary) / 0.55), inset 0 0 18px -12px hsl(var(--nc-primary) / 0.8)',
        'neon-sm': '0 0 0 1px hsl(var(--nc-primary) / 0.35), 0 0 10px -3px hsl(var(--nc-primary) / 0.5)',
        'neon-lg':
          '0 0 0 1px hsl(var(--nc-primary) / 0.6), 0 0 40px -6px hsl(var(--nc-primary) / 0.75), 0 0 90px -30px hsl(var(--nc-primary) / 0.9), inset 0 0 30px -20px hsl(var(--nc-primary) / 0.9)',
        volt: '0 0 0 1px hsl(var(--nc-secondary) / 0.5), 0 0 24px -4px hsl(var(--nc-secondary) / 0.65)',
        panel: '0 24px 60px -30px rgb(0 0 0 / 0.9), inset 0 1px 0 0 hsl(var(--nc-fg) / 0.04)',
        inset: 'inset 0 0 24px -12px hsl(var(--nc-primary) / 0.35)',
      },

      backgroundImage: {
        'grid-cyber':
          'linear-gradient(to right, hsl(var(--nc-line) / 0.55) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--nc-line) / 0.55) 1px, transparent 1px)',
        'grid-fine':
          'linear-gradient(to right, hsl(var(--nc-line) / 0.3) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--nc-line) / 0.3) 1px, transparent 1px)',
        'hero-glow':
          'radial-gradient(60% 55% at 15% 0%, hsl(var(--nc-primary) / 0.16) 0%, transparent 60%), radial-gradient(50% 50% at 85% 10%, hsl(var(--nc-secondary) / 0.16) 0%, transparent 60%)',
        scanlines:
          'repeating-linear-gradient(to bottom, hsl(var(--nc-fg) / 0.035) 0px, hsl(var(--nc-fg) / 0.035) 1px, transparent 1px, transparent 3px)',
        'fade-b': 'linear-gradient(to bottom, transparent, hsl(var(--nc-bg)))',
        'text-shine': 'linear-gradient(100deg, hsl(var(--nc-primary)) 0%, hsl(var(--nc-secondary)) 50%, hsl(var(--nc-primary)) 100%)',
      },

      backgroundSize: {
        grid: '56px 56px',
        'grid-sm': '24px 24px',
      },

      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1', filter: 'drop-shadow(0 0 6px hsl(var(--nc-primary) / 0.7))' },
          '50%': { opacity: '0.72', filter: 'drop-shadow(0 0 18px hsl(var(--nc-primary) / 0.95))' },
        },
        flicker: {
          '0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%': { opacity: '1' },
          '20%, 24%, 55%': { opacity: '0.42' },
        },
        glitch: {
          '0%, 100%': { clipPath: 'inset(0 0 0 0)', transform: 'translate3d(0,0,0)' },
          '10%': { clipPath: 'inset(12% 0 68% 0)', transform: 'translate3d(-3px,0,0)' },
          '20%': { clipPath: 'inset(58% 0 22% 0)', transform: 'translate3d(3px,0,0)' },
          '30%': { clipPath: 'inset(34% 0 44% 0)', transform: 'translate3d(-2px,0,0)' },
          '40%': { clipPath: 'inset(0 0 0 0)', transform: 'translate3d(0,0,0)' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'grid-drift': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '56px 56px' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'candle-grow': {
          '0%': { transform: 'scaleY(0.05)', opacity: '0.2' },
          '100%': { transform: 'scaleY(1)', opacity: '1' },
        },
        blink: {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'whale-in': {
          '0%': { opacity: '0', transform: 'translateX(-16px) scale(0.94)' },
          '60%': { opacity: '1', transform: 'translateX(2px) scale(1.01)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
        'panel-in': {
          '0%': { opacity: '0', transform: 'translateX(28px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'toast-in': {
          '0%': { opacity: '0', transform: 'translate3d(-14px, 10px, 0) scale(0.96)' },
          '60%': { opacity: '1', transform: 'translate3d(2px, -1px, 0) scale(1.01)' },
          '100%': { opacity: '1', transform: 'translate3d(0, 0, 0) scale(1)' },
        },
      },

      animation: {
        'pulse-glow': 'pulse-glow 3.2s ease-in-out infinite',
        'fade-in': 'fade-in 180ms ease-out both',
        'toast-in': 'toast-in 260ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both',
        flicker: 'flicker 6s linear infinite',
        glitch: 'glitch 2.6s steps(2, end) infinite',
        scan: 'scan 6s linear infinite',
        marquee: 'marquee 42s linear infinite',
        'grid-drift': 'grid-drift 22s linear infinite',
        'fade-up': 'fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        'candle-grow': 'candle-grow 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        blink: 'blink 1.1s steps(1) infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        'whale-in': 'whale-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'panel-in': 'panel-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
      },

      transitionTimingFunction: {
        cyber: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },

      zIndex: {
        backdrop: '-1',
        header: '50',
        modal: '70',
        overlay: '90',
        palette: '100',
        toast: '110',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
