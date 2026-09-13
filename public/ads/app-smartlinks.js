// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * WEB-APP / CHARTING-TERMINAL – Adsterra-Smartlink-Kit (Native Placement)
 * ========================================================================
 * Vanilla ES6+, 0 Dependencies. Drei Bausteine:
 *
 *  1. mountSponsorBar(): injectiert eine gelabelte „Sponsored“-Leiste
 *     (Cyberpunk-Optik via smartlinks.css) in einen Container – z. B. im
 *     Chart-Header oder als Rail. Klick = neuer Tab, Terminal läuft weiter.
 *     Kein preventDefault auf App-Logik, keine Unterbrechung.
 *
 *  2. hookActionOffer(selector): Post-Action-Offer. Nach Klick auf echte
 *     Features („Export Chart“, „Share Analysis“) erscheint VERZÖGERT ein
 *     transparenter Offer-Toast – die Feature-Aktion selbst läuft immer
 *     ungestört. (Klick-Entführung vor der Aktion wäre Invalid Traffic:
 *     Adsterra-Anti-Fraud kann Auszahlungen streichen / Accounts sperren,
 *     und Safe-Browsing markiert die ganze Domain.)
 *
 *  3. Frequency-Cap: max. MAX_TRIGGERS_PER_HOUR (Default 3) Smartlink-Opens
 *     pro Stunde + Mindestabstand zwischen Toasts, via localStorage
 *     (Fallbacks: sessionStorage → Memory für Private Mode).
 *
 * Einbindung:  <link rel="stylesheet" href="smartlinks.css">
 *              <div id="sponsor-strip"></div>   <!-- z. B. im Chart-Header -->
 *              <script src="app-smartlinks.js" defer></script>
 */
(function () {
  'use strict';

  /* ============================== KONFIGURATION ============================= */
  const SMARTLINK_MAIN_URL =
    'https://globalimmaturelunatic.com/ufhc3mt24s?key=11473c6a64af7fbf2fcabca038d21036';

  const CONFIG = {
    /** Runtime-Override der Smartlink-URL (z. B. via <script data-config='{"URL":…}'>). */
    URL: '',
    /** Hart-Aus-Schalter (z. B. Donation-Grace in der NodeChart-App). */
    DISABLED: false,
    MAX_TRIGGERS_PER_HOUR: 3,
    MIN_TOAST_INTERVAL_MINUTES: 10,
    LABEL: 'Sponsored', // DE: 'Anzeige'
    STORAGE_KEY: 'nc_sl_app_fire_log',
    TOAST_KEY: 'nc_sl_app_last_toast',
    MOUNT_SELECTOR: '#sponsor-strip',
    /** Verzögerung nach Feature-Klick, bevor der Offer-Toast erscheint (ms). */
    OFFER_DELAY_MS: 800,
    /* Default-Items der Sponsored-Leiste – erkennbar als Angebote, keine
       Funktions-Tarnung. Eigene Items via SmartlinksApp.mount(...) möglich. */
    DEFAULT_ITEMS: [
      { icon: '🎁', label: 'Bonus Offer' },
      { icon: '⚡', label: 'Partner Deal' },
      { icon: '🏆', label: 'Trading Contest' },
    ],
    FALLBACK_TITLE: 'Partner-Angebot',
    FALLBACK_TEXT: 'Dein Browser hat das neue Fenster blockiert. Öffne das Angebot direkt:',
    FALLBACK_CTA: 'Angebot öffnen',
    FALLBACK_CLOSE: 'Schließen',
    TOAST_TEXT: '🎁 Bonus sichern – Partner-Angebot',
    TOAST_CTA: 'Ansehen',
    RESPECT_DNT: true,
    SKIP_BOTS: true,
    DEBUG: false,
  };
  /* ========================================================================== */

  /* Host-Override: <script src=… data-config='{"URL":…,"LABEL":"Anzeige",…}'>
     (document.currentScript ist während der synchronen IIFE-Ausführung gesetzt,
     auch bei dynamisch injizierten klassischen Skripten.) */
  try {
    const cs = typeof document !== 'undefined' ? document.currentScript : null;
    const raw = cs && cs.dataset ? cs.dataset.config : null;
    if (raw) Object.assign(CONFIG, JSON.parse(raw));
  } catch {
    /* defekte Config ignoriert – Defaults bleiben aktiv */
  }
  /** Wirksame Smartlink-URL (Override schlägt feste Konstante). */
  const smartUrl = () => CONFIG.URL || SMARTLINK_MAIN_URL;

  const HOUR = 3600 * 1000;
  const MIN = 60 * 1000;
  const mem = {};
  const log = (...a) => CONFIG.DEBUG && console.info('[smartlink:app]', ...a);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /* ------------------------- Storage (try/catch-safe) ---------------------- */
  function lsGet(key) {
    try {
      return window.localStorage.getItem(key) ?? mem[key] ?? null;
    } catch {
      try {
        return window.sessionStorage.getItem(key) ?? mem[key] ?? null;
      } catch {
        return mem[key] ?? null;
      }
    }
  }
  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        /* letzte Instanz */
      }
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

  /* ------------------------ openSmartlink + Fallbacks ---------------------- */
  function openSmartlink(url = smartUrl(), source = 'manual') {
    if (suppressed()) return false;
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
      showFallbackModal(url); // sichtbarer Direkt-Link statt stiller Blockade
      emit('sl:blocked', { source });
      return false;
    }
    try {
      win.opener = null;
    } catch {
      /* noopener via Features bereits gesetzt */
    }
    registerFire();
    emit('sl:opened', { source });
    log('geöffnet –', source);
    return true;
  }

  function badgeHTML() {
    return `<span class="nc-sl-badge">${esc(CONFIG.LABEL)}</span>`;
  }

  function showFallbackModal(url) {
    if (document.querySelector('.nc-sl-modal-backdrop')) return;
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
    backdrop.querySelector('a').addEventListener('click', () => {
      registerFire();
      emit('sl:opened', { source: 'fallback-modal' });
      setTimeout(close, 300);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
  }

  function showOfferToast(url = smartUrl(), source = 'toast') {
    if (suppressed() || capReached() || !toastCooldownOk()) return false;
    if (document.visibilityState !== 'visible') return false;
    document.querySelector('.nc-sl-toast')?.remove();
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
    setTimeout(() => toast.remove(), 9000);
    emit('sl:toast', { source });
    return true;
  }

  /* -------------------- 1) Sponsored-Leiste (Native Optic) ------------------ */
  function mountSponsorBar(containerOrSelector = CONFIG.MOUNT_SELECTOR, items = CONFIG.DEFAULT_ITEMS) {
    const host =
      typeof containerOrSelector === 'string'
        ? document.querySelector(containerOrSelector)
        : containerOrSelector;
    if (!host) {
      log('Mount-Container nicht gefunden:', containerOrSelector);
      return null;
    }
    host.innerHTML = '';
    host.classList.add('nc-sl-strip');
    items.forEach((item) => {
      // Echter Anker statt Button: native Navigation, blocker-resistent.
      const a = document.createElement('a');
      a.className = 'nc-sl-strip-btn';
      a.href = item.url || smartUrl();
      a.target = '_blank';
      a.rel = 'sponsored noopener';
      a.innerHTML = `<span class="nc-sl-strip-icon">${esc(item.icon || '🎁')}</span>` +
        `<span>${esc(item.label)}</span>` + badgeHTML();
      a.addEventListener('click', () => {
        if (suppressed()) return;
        if (capReached()) {
          emit('sl:capped', { source: 'strip' });
          return; // Anker navigiert trotzdem – Cap drosselt nur das Tracking
        }
        registerFire();
        emit('sl:opened', { source: 'strip' });
      });
      host.appendChild(a);
    });
    log('Sponsored-Leiste gemountet:', items.length, 'Items');
    return host;
  }

  /* ------------------- 2) Post-Action-Offer (kein Hijacking) ---------------- */
  /**
   * Hängt sich an echte Feature-Buttons (z. B. '.js-export-chart').
   * Die Feature-Aktion läuft IMMER ungestört (kein preventDefault,
   * kein stopPropagation). Erst danach erscheint – gedeckelt durch Cap
   * und Toast-Interval – der transparente Offer-Toast.
   */
  function hookActionOffer(selector, opts = {}) {
    const url = opts.url || smartUrl();
    document.querySelectorAll(selector).forEach((el) => {
      if (el.dataset.slHooked) return;
      el.dataset.slHooked = '1';
      el.addEventListener(
        'click',
        () => {
          const delay = opts.delayMs ?? CONFIG.OFFER_DELAY_MS;
          setTimeout(() => {
            if (document.visibilityState !== 'visible') return; // Tab weg → kein Toast
            showOfferToast(url, `action:${selector}`);
          }, delay);
        },
        { passive: true }, // bubble-Phase, NIE capture → App-Logik zuerst
      );
    });
  }

  function init() {
    if (CONFIG.DISABLED) {
      log('deaktiviert via Config (z. B. Donation-Grace)');
      return;
    }
    mountSponsorBar();
    // Default-Hooks für typische Non-Critical-Actions:
    hookActionOffer('.js-export-chart');
    hookActionOffer('.js-share-analysis');
    log('bereit, Cap =', CONFIG.MAX_TRIGGERS_PER_HOUR, '/h');
  }

  window.SmartlinksApp = {
    config: CONFIG,
    mount: mountSponsorBar,
    hookActionOffer,
    open: (url, source) => openSmartlink(url, source),
    toast: (url, source) => showOfferToast(url, source),
    remaining: () => Math.max(0, CONFIG.MAX_TRIGGERS_PER_HOUR - recentFires().length),
    events: ['sl:opened', 'sl:blocked', 'sl:capped', 'sl:toast'],
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
