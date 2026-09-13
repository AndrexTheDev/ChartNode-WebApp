// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * TEIL 2 – WEB-APP / CHARTING-TERMINAL: Popunder-Kit (Vanilla ES6+, 0 Deps)
 *
 * Features:
 *  1. Delayed First-Interaction: gefeuert wird erst beim ERSTEN echten Klick
 *     im Tool (Chart, Menü, Button) – die App lädt initial komplett sauber.
 *  2. Frequency-Capping: max. 1 Popunder alle COOLDOWN_MINUTES (Standard 15),
 *     persistiert in localStorage (Private-Mode-Fallback: session + Memory).
 *     Geblockte Versuche konsumieren dasCooldown NICHT, bekommen aber ein
 *     eigenes Retry-Fenster, damit kein Click-Spam entsteht.
 *  3. Tab-Close/Exit: visibilitychange / beforeunload / pagehide versuchen
 *     einen letzten Trigger. Browser erlauben window.open ohne User-Geste
 *     meist NICHT – das ist bewusst ein sauber error-gehandelter VERSUCH,
 *     kein Blocker-Hack.
 *
 * Einbindung:  <script src="app-popunder.js" defer></script>  vor </body>
 *              (nach dem App-Boot; das Kit hängt sich nur an document/window).
 */
(function () {
  'use strict';

  /* ============================== KONFIGURATION ============================= */
  const CONFIG = {
    /** Popunder-/Smartlink-URL aus dem Adsterra-Dashboard. */
    ADSTERRA_POPUNDER_URL: 'https://www.effectivegatecpm.com/REPLACE_WITH_YOUR_POPUNDER_ID',

    /** Frequency-Cap: maximal 1 Popunder pro X Minuten im Terminal. */
    COOLDOWN_MINUTES: 15,

    /** Nach einem GEBLOCKTEN Versuch: frühestens nach X Minuten erneut probieren. */
    BLOCKED_RETRY_MINUTES: 5,

    /** Keys – bewusst namespaced, kollidiert nicht mit App-Storage. */
    LAST_FIRE_KEY: 'nc_pu_app_last_fire', // localStorage: sessionsübergreifend
    BLOCKED_KEY: 'nc_pu_app_last_blocked', // localStorage: Retry-Fenster
    EXIT_FIRED_KEY: 'nc_pu_app_exit_fired', // sessionStorage: 1 Exit-Versuch/Session

    ENABLE_EXIT_TRIGGER: true, // Tab-Close/Exit-Versuche an/aus
    RESPECT_DNT: true, // Do-Not-Track ⇒ kein Popunder
    SKIP_BOTS: true, // navigator.webdriver ⇒ aus (QA/CI bleibt sauber)
    DEBUG: false,
  };
  /* ========================================================================== */

  const mem = {};
  const log = (...a) => CONFIG.DEBUG && console.info('[popunder:app]', ...a);
  const MIN = 60 * 1000;

  function lGet(key) {
    try {
      return window.localStorage.getItem(key) ?? mem[key] ?? null;
    } catch {
      return mem[key] ?? null;
    }
  }
  function lSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* Private Mode */
    }
    mem[key] = value;
  }
  function sGet(key) {
    try {
      return window.sessionStorage.getItem(key) ?? mem[key] ?? null;
    } catch {
      return mem[key] ?? null;
    }
  }
  function sSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      /* Private Mode */
    }
    mem[key] = value;
  }

  function suppressed() {
    if (CONFIG.RESPECT_DNT && navigator.doNotTrack === '1') return true;
    if (CONFIG.SKIP_BOTS && navigator.webdriver) return true;
    return false;
  }

  /** Cooldown geprüft: letzter ERFOLGREICHER Fire liegt lange genug zurück. */
  function cooldownOk(now) {
    const last = Number(lGet(CONFIG.LAST_FIRE_KEY) ?? 0);
    return now - last >= CONFIG.COOLDOWN_MINUTES * MIN;
  }
  /** Nach Blockade: Retry-Fenster respektieren (kein Click-Spam). */
  function blockedRetryOk(now) {
    const last = Number(lGet(CONFIG.BLOCKED_KEY) ?? 0);
    return now - last >= CONFIG.BLOCKED_RETRY_MINUTES * MIN;
  }

  /**
   * Popunder öffnen. Nur erfolgreiche Fires konsumieren das Cooldown;
   * Blockaden setzen ein eigenes, kürzeres Retry-Fenster.
   * @returns {boolean} Erfolg
   */
  function fire(source) {
    if (suppressed()) {
      log('unterdrückt (DNT/Bot) –', source);
      return false;
    }
    const now = Date.now();
    let win = null;
    try {
      win = window.open(CONFIG.ADSTERRA_POPUNDER_URL, '_blank');
    } catch (err) {
      log('window.open-Fehler –', source, err && err.message);
      lSet(CONFIG.BLOCKED_KEY, String(now));
      return false;
    }
    if (!win) {
      log('Popup-Blocker greift –', source);
      lSet(CONFIG.BLOCKED_KEY, String(now));
      document.dispatchEvent(new CustomEvent('pu:blocked', { detail: { source } }));
      return false;
    }
    try {
      win.opener = null; // Reverse-Tabnabbing kappen
    } catch {
      /* unkritisch */
    }
    try {
      win.blur();
      window.focus(); // Popunder-Verhalten: Fenster hinter die App
    } catch {
      /* Best-Effort */
    }
    lSet(CONFIG.LAST_FIRE_KEY, String(now));
    log('gefeuert –', source);
    document.dispatchEvent(new CustomEvent('pu:fired', { detail: { source } }));
    return true;
  }

  /* 1+2) Delayed First-Interaction MIT Frequency-Capping ------------------- */
  function interactionCapped() {
    document.addEventListener(
      'click',
      () => {
        const now = Date.now();
        if (!cooldownOk(now) || !blockedRetryOk(now)) return;
        fire('first-interaction/cap');
        // Kein removeEventListener nötig: das Cooldown deckelt alle weiteren
        // Klicks – der Trader hat nach dem ersten Fire 15 min Ruhe.
      },
      { capture: true, passive: true },
    );
  }

  /* 3) Tab-Close / Exit-Versuche (Best-Effort, ohne User-Geste) ------------- */
  function exitTriggers() {
    if (!CONFIG.ENABLE_EXIT_TRIGGER) return;
    const attempt = (source) => {
      if (sGet(CONFIG.EXIT_FIRED_KEY)) return; // max. 1 Exit-Versuch pro Session
      sSet(CONFIG.EXIT_FIRED_KEY, '1');
      const now = Date.now();
      if (!cooldownOk(now)) {
        log('Exit-Versuch übersprungen (Cooldown) –', source);
        return;
      }
      fire(source); // Browser blocken hier meist ⇒ bewusst nur ein Versuch
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') attempt('visibilitychange');
    });
    window.addEventListener('pagehide', () => attempt('pagehide'));
    window.addEventListener('beforeunload', () => attempt('beforeunload'));
  }

  function init() {
    interactionCapped();
    exitTriggers();
    log('bereit, Cooldown =', CONFIG.COOLDOWN_MINUTES, 'min');
  }

  window.PopunderApp = {
    config: CONFIG,
    fire: (source) => fire(source || 'manual'),
    cooldownRemainingMs: () => {
      const last = Number(lGet(CONFIG.LAST_FIRE_KEY) ?? 0);
      return Math.max(0, last + CONFIG.COOLDOWN_MINUTES * MIN - Date.now());
    },
    events: ['pu:fired', 'pu:blocked'],
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
