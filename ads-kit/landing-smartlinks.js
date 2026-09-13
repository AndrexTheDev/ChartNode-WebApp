// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * LANDINGPAGE – Adsterra-Smartlink-Kit (Native Placement, transparent)
 * =====================================================================
 * Vanilla ES6+, 0 Dependencies. Architektur-Prinzipien:
 *
 *  A) Echte <a href target="_blank" rel="sponsored noopener">-Anker für alle
 *     Smartlink-CTAs. Anker-Klicks sind User-Geste + echte Navigation und
 *     werden von Popup-Blockern praktisch NIE blockiert – das ist die
 *     robusteste legale Auslieferung (kein window.open nötig).
 *  B) window.open nur dort, wo kein Anker möglich ist (Buttons) – mit
 *     sauberem Fallback: sichtbares, dismissbares Modal mit Direkt-Link.
 *  C) Jedes Smartlink-Element trägt ein sichtbares Disclosure-Badge
 *     („Sponsored“/„Anzeige“). Native OPTIK ja – Tarnung als Funktion nein
 *     (Schleichwerbung ist in der EU/DE/US verboten, Adsterra sperrt
 *     Accounts bei Invalid Traffic, Safe-Browsing straft ganze Domains ab).
 *  D) Frequency-Cap: max. MAX_TRIGGERS_PER_HOUR Opportunistic-Trigger
 *     (Toasts/dynamische Opens) pro Stunde. Primäre, gelabelte CTAs bleiben
 *     immer funktionsfähig (das ist ihr deklarierter Zweck).
 *
 * Einbindung:  <link rel="stylesheet" href="smartlinks.css">
 *              <script src="landing-smartlinks.js" defer></script>
 *
 * HTML-Markup (Auto-Enhancement via data-Attributen):
 *   <a class="nc-sl-cta" href="..." data-smartlink>🎁 Claim Bonus</a>
 *   <button class="nc-sl-cta" data-smartlink>🏦 Partner Exchanges</button>
 *   <div class="nc-sl-card" data-smartlink-card>Teaser …</div>          → öffnet Smartlink (Badge)
 *   <div class="nc-sl-card" data-smartlink-card="toast" data-href="#faq"> → echte Aktion + Offer-Toast
 */
(function () {
  'use strict';

  /* ============================== KONFIGURATION ============================= */
  const SMARTLINK_MAIN_URL =
    'https://globalimmaturelunatic.com/ufhc3mt24s?key=11473c6a64af7fbf2fcabca038d21036';

  const CONFIG = {
    /** Opportunistic-Trigger (Toasts, Button-Opens) pro Stunde. */
    MAX_TRIGGERS_PER_HOUR: 3,
    /** Mindestabstand zwischen zwei Offer-Toasts (Minuten). */
    MIN_TOAST_INTERVAL_MINUTES: 10,
    /** Disclosure-Text (DE: 'Anzeige', EN: 'Sponsored', ES: 'Patrocinado'). */
    LABEL: 'Sponsored',
    STORAGE_KEY: 'nc_sl_fire_log',
    TOAST_KEY: 'nc_sl_last_toast',
    /* Fallback-Modal (Popup-Blocker) */
    FALLBACK_TITLE: 'Partner-Angebot',
    FALLBACK_TEXT: 'Dein Browser hat das neue Fenster blockiert. Öffne das Angebot direkt:',
    FALLBACK_CTA: 'Angebot öffnen',
    FALLBACK_CLOSE: 'Schließen',
    /* Offer-Toast */
    TOAST_TEXT: '🎁 Bonus sichern – Partner-Angebot',
    TOAST_CTA: 'Ansehen',
    RESPECT_DNT: true,
    SKIP_BOTS: true, // navigator.webdriver → aus (eigene QA/CI bleibt sauber)
    DEBUG: false,
  };
  /* ========================================================================== */

  const HOUR = 3600 * 1000;
  const MIN = 60 * 1000;
  const mem = {};
  const log = (...a) => CONFIG.DEBUG && console.info('[smartlink:landing]', ...a);

  /* ------------------------- Storage (try/catch-safe) ---------------------- */
  function lsGet(key) {
    try {
      return window.localStorage.getItem(key) ?? mem[key] ?? null;
    } catch {
      return mem[key] ?? null;
    }
  }
  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* Private Mode */
    }
    mem[key] = value;
  }

  /* ------------------------------ Frequency-Cap ---------------------------- */
  function recentFires(now = Date.now()) {
    let arr = [];
    try {
      arr = JSON.parse(lsGet(CONFIG.STORAGE_KEY) || '[]');
    } catch {
      arr = [];
    }
    return Array.isArray(arr) ? arr.filter((t) => now - t < HOUR) : [];
  }
  function registerFire() {
    const arr = recentFires();
    arr.push(Date.now());
    lsSet(CONFIG.STORAGE_KEY, JSON.stringify(arr));
  }
  function capReached() {
    return recentFires().length >= CONFIG.MAX_TRIGGERS_PER_HOUR;
  }
  function toastCooldownOk(now = Date.now()) {
    const last = Number(lsGet(CONFIG.TOAST_KEY) ?? 0);
    return now - last >= CONFIG.MIN_TOAST_INTERVAL_MINUTES * MIN;
  }
  function suppressed() {
    if (CONFIG.RESPECT_DNT && navigator.doNotTrack === '1') return true;
    if (CONFIG.SKIP_BOTS && navigator.webdriver) return true;
    return false;
  }
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /* --------------------------- openSmartlink + UI -------------------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /**
   * Öffnet den Smartlink in einem neuen Tab. Bei Popup-Blockade:
   * unaufdringliches Fallback-Modal mit Direkt-Anker (immer klickbar).
   * @returns {boolean} true = neues Fenster geöffnet
   */
  function openSmartlink(url = SMARTLINK_MAIN_URL, source = 'manual') {
    if (suppressed()) {
      log('unterdrückt (DNT/Bot) –', source);
      return false;
    }
    if (capReached()) {
      log('Cap erreicht –', source);
      emit('sl:capped', { source });
      return false;
    }
    let win = null;
    try {
      win = window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      log('window.open-Fehler –', err && err.message);
    }
    if (!win) {
      log('Popup blockiert → Fallback-Modal –', source);
      showFallbackModal(url);
      emit('sl:blocked', { source });
      return false;
    }
    registerFire();
    emit('sl:opened', { source });
    return true;
  }

  function badgeHTML() {
    return `<span class="nc-sl-badge">${esc(CONFIG.LABEL)}</span>`;
  }

  function showFallbackModal(url) {
    if (document.querySelector('.nc-sl-modal-backdrop')) return; // Singleton
    const backdrop = document.createElement('div');
    backdrop.className = 'nc-sl-modal-backdrop';
    backdrop.innerHTML = `
      <div class="nc-sl-modal" role="dialog" aria-modal="true" aria-label="${esc(CONFIG.FALLBACK_TITLE)}">
        ${badgeHTML()}
        <h3>${esc(CONFIG.FALLBACK_TITLE)}</h3>
        <p>${esc(CONFIG.FALLBACK_TEXT)}</p>
        <a class="nc-sl-btn-primary" href="${esc(url)}" target="_blank" rel="sponsored noopener">${esc(CONFIG.FALLBACK_CTA)}</a>
        <button type="button" class="nc-sl-btn-ghost" data-close>${esc(CONFIG.FALLBACK_CLOSE)}</button>
      </div>`;
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-close]')) close();
    });
    // Direkt-Anker im Modal = echte Navigation → zählt als Trigger
    backdrop.querySelector('a').addEventListener('click', () => {
      registerFire();
      emit('sl:opened', { source: 'fallback-modal' });
      setTimeout(close, 300);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
  }

  /** Unaufdringlicher Offer-Toast (transparent, user-initiiert, capped). */
  function showOfferToast(url = SMARTLINK_MAIN_URL, source = 'toast') {
    if (suppressed() || capReached() || !toastCooldownOk()) return false;
    document.querySelector('.nc-sl-toast')?.remove(); // Singleton
    lsSet(CONFIG.TOAST_KEY, String(Date.now()));
    const toast = document.createElement('div');
    toast.className = 'nc-sl-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      ${badgeHTML()}
      <p>${esc(CONFIG.TOAST_TEXT)}</p>
      <a class="nc-sl-toast-cta" href="${esc(url)}" target="_blank" rel="sponsored noopener">${esc(CONFIG.TOAST_CTA)}</a>
      <button type="button" class="nc-sl-toast-close" aria-label="${esc(CONFIG.FALLBACK_CLOSE)}">×</button>`;
    toast.querySelector('a').addEventListener('click', () => {
      registerFire();
      emit('sl:opened', { source });
      setTimeout(() => toast.remove(), 300);
    });
    toast.querySelector('button').addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 9000); // Auto-Dismiss
    emit('sl:toast', { source });
    return true;
  }

  /* --------------------------- Auto-Enhancement ---------------------------- */
  /** Sichtbares Badge injizieren, falls noch nicht vorhanden. */
  function ensureBadge(el) {
    if (!el.querySelector(':scope > .nc-sl-badge')) {
      el.insertAdjacentHTML('beforeend', badgeHTML());
    }
  }

  /** [data-smartlink]: CTAs/Buttons – Anker nativ, Buttons via openSmartlink. */
  function enhanceCtas(root = document) {
    root.querySelectorAll('[data-smartlink]').forEach((el) => {
      if (el.dataset.slReady) return;
      el.dataset.slReady = '1';
      el.classList.add('nc-sl-cta');
      ensureBadge(el);
      if (el.tagName === 'A') {
        // Echter Anker: native Navigation = blocker-immun. Kein preventDefault!
        if (!el.getAttribute('href') || el.getAttribute('href') === '#') {
          el.setAttribute('href', el.dataset.url || SMARTLINK_MAIN_URL);
        }
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'sponsored noopener');
        el.addEventListener('click', () => {
          if (suppressed()) return;
          registerFire(); // Anker-Opens zählen gegen das Cap (Tracking)
          emit('sl:opened', { source: 'cta-anchor' });
        });
      } else {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openSmartlink(el.dataset.url || SMARTLINK_MAIN_URL, 'cta-button');
        });
      }
    });
  }

  /**
   * [data-smartlink-card]: Teaser-Cards.
   *  - default:  Card IST das Angebot → öffnet Smartlink (mit Badge).
   *  - "toast":  Card führt echte Aktion aus (data-href/Scroll) und zeigt
   *              zusätzlich den transparenten Offer-Toast – KEIN versteckter Tab.
   */
  function enhanceCards(root = document) {
    root.querySelectorAll('[data-smartlink-card]').forEach((el) => {
      if (el.dataset.slReady) return;
      el.dataset.slReady = '1';
      el.classList.add('nc-sl-card');
      const mode = el.dataset.smartlinkCard || 'primary';
      if (mode === 'toast') {
        el.addEventListener('click', () => {
          const href = el.dataset.href;
          if (href) {
            if (href.startsWith('#')) {
              document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
            } else {
              window.location.assign(href);
            }
          }
          showOfferToast(SMARTLINK_MAIN_URL, 'card-toast');
        });
      } else {
        ensureBadge(el);
        el.setAttribute('role', 'link');
        el.setAttribute('tabindex', '0');
        const open = () => openSmartlink(el.dataset.url || SMARTLINK_MAIN_URL, 'card');
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && open());
      }
    });
  }

  function init() {
    enhanceCtas();
    enhanceCards();
    log('bereit, Cap =', CONFIG.MAX_TRIGGERS_PER_HOUR, '/h');
  }

  window.SmartlinksLanding = {
    config: CONFIG,
    open: (url, source) => openSmartlink(url, source),
    toast: (url, source) => showOfferToast(url, source),
    refresh: () => { enhanceCtas(); enhanceCards(); }, // nach dynamischem DOM
    remaining: () => Math.max(0, CONFIG.MAX_TRIGGERS_PER_HOUR - recentFires().length),
    events: ['sl:opened', 'sl:blocked', 'sl:capped', 'sl:toast'],
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
