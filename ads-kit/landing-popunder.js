// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * TEIL 1 – LANDINGPAGE: Adsterra-Popunder-Kit (Vanilla ES6+, 0 Dependencies)
 *
 * Features:
 *  1. Anti-Adblock-Integration: originales Adsterra-Head-Script wird injiziert,
 *     Blockade (onerror) wird als Event `pu:adblocked` exponiert (z. B. für ein
 *     eigenes AdBlock-Modal).
 *  2. First-Click-Popunder: feuert beim ersten echten Nutzer-Klick, einmalig
 *     pro Session (sessionStorage-Flag).
 *  3. Dual-Action-CTA (#launch-terminal-btn): öffnet den Popunder SYNCHRON im
 *     User-Event (einziger blocker-konformer Weg) und navigiert danach nahtlos
 *     zur Web-App.
 *  4. Exit-Intent: Mausbewegung aus dem Fenster oben → ein Exit-Popunder pro
 *     Session.
 *
 * Einbindung:  <script src="landing-popunder.js" defer></script>  vor </body>.
 * Wichtig:     window.open passiert ausschließlich innerhalb echter User-Events
 *              (click) – das ist kein "Blocker-Hack", sondern der von Browsern
 *              erlaubte Pfad. Kein synthetisches Klicken, keine Iframe-Tricks.
 */
(function () {
  'use strict';

  /* ============================== KONFIGURATION ============================= */
  const CONFIG = {
    /** Originales Adsterra Popunder-Delivery-Skript für nodechart.cc
     *  (Dashboard-Code, gehört vor </head>; wird hier in den Head injiziert).
     *  '' = nur dieses Kit feuert, kein Delivery-Skript. */
    ADSTERRA_HEAD_SCRIPT_SRC: 'https://globalimmaturelunatic.com/00/ca/4a/00ca4a13867dc6964d9b2366466a0448.js',

    /** Popunder-/Smartlink-URL, die dieses Kit selbst öffnet (Window-Fallback). */
    ADSTERRA_POPUNDER_URL: 'https://globalimmaturelunatic.com/ufhc3mt24s?key=11473c6a64af7fbf2fcabca038d21036',

    /** Ziel der Dual-Action (Web-App). NodeChart-Beispiel: '/de/terminal' */
    APP_URL: '/app',

    /** CTA-Selektor für die Dual-Action (Popup + Navigation). */
    LAUNCH_BTN_SELECTOR: '#launch-terminal-btn',

    /** Session-Flags (sessionStorage, Fallback Speicher bei Private-Mode). */
    FIRST_CLICK_KEY: 'nc_pu_landing_first_click',
    EXIT_INTENT_KEY: 'nc_pu_landing_exit_intent',

    /** Schutzschalter – bewusst Standard ON: echte Nutzer & QA schützen. */
    RESPECT_DNT: true, // navigator.doNotTrack === '1' ⇒ kein Popunder
    SKIP_BOTS: true, // navigator.webdriver ⇒ aus (eigene QA/CI bleibt sauber)
    DEBUG: false, // Console-Logs
  };
  /* ========================================================================== */

  const mem = {}; // Private-Mode-Fallback, wenn Storage wirft
  const log = (...a) => CONFIG.DEBUG && console.info('[popunder:landing]', ...a);

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
      /* Private Mode – Memory-Fallback genügt für die Session */
    }
    mem[key] = value;
  }

  /** DNT/Bot-Guard: liefert true, wenn gar nicht erst gefeuert werden darf. */
  function suppressed() {
    if (CONFIG.RESPECT_DNT && navigator.doNotTrack === '1') return true;
    if (CONFIG.SKIP_BOTS && navigator.webdriver) return true;
    return false;
  }

  /**
   * Popunder öffnen – NUR aus User-Events aufrufen.
   * @returns {boolean} true = Fenster geöffnet, false = geblockt/Fehler
   */
  function openPopunder(source) {
    if (suppressed()) {
      log('unterdrückt (DNT/Bot) –', source);
      return false;
    }
    let win = null;
    try {
      win = window.open(CONFIG.ADSTERRA_POPUNDER_URL, '_blank');
      if (!win) {
        log('Popup-Blocker greift –', source);
        document.dispatchEvent(new CustomEvent('pu:blocked', { detail: { source } }));
        return false;
      }
      // Reverse-Tabnabbing kappen, dann Popunder-Verhalten (Fenster nach hinten)
      try {
        win.opener = null;
      } catch {
        /* cross-origin ggf. nicht setzbar – unkritisch */
      }
      try {
        win.blur();
        window.focus();
      } catch {
        /* Fokus-Handling ist Best-Effort */
      }
      log('gefeuert –', source);
      document.dispatchEvent(new CustomEvent('pu:fired', { detail: { source } }));
      return true;
    } catch (err) {
      log('window.open-Fehler –', source, err && err.message);
      if (win) {
        try {
          win.close();
        } catch {
          /* ignorieren */
        }
      }
      return false;
    }
  }

  /* 1) Adsterra-Head-Script + Adblock-Signal -------------------------------- */
  function injectHeadScript() {
    if (!CONFIG.ADSTERRA_HEAD_SCRIPT_SRC) return;
    const script = document.createElement('script');
    script.src = CONFIG.ADSTERRA_HEAD_SCRIPT_SRC;
    script.async = true;
    script.id = 'adsterra-popunder-head';
    script.onerror = () => {
      log('Head-Script geblockt (Adblock?)');
      document.dispatchEvent(new CustomEvent('pu:adblocked'));
    };
    (document.head || document.documentElement).appendChild(script);
  }

  /* 2) First-Click-Popunder (einmal pro Session) ---------------------------- */
  function firstClick() {
    const handler = (event) => {
      // Der CTA regelt sich selbst (Dual-Action) – nicht doppelt feuern
      if (event.target.closest && event.target.closest(CONFIG.LAUNCH_BTN_SELECTOR)) return;
      if (sGet(CONFIG.FIRST_CLICK_KEY)) return;
      sSet(CONFIG.FIRST_CLICK_KEY, '1');
      const ok = openPopunder('first-click');
      if (ok) document.removeEventListener('click', handler, true);
    };
    document.addEventListener('click', handler, true);
  }

  /* 3) Dual-Action-CTA: Popup im User-Event, dann nahtlose Navigation ------- */
  function dualAction() {
    const btn = document.querySelector(CONFIG.LAUNCH_BTN_SELECTOR);
    if (!btn) {
      log('CTA nicht gefunden:', CONFIG.LAUNCH_BTN_SELECTOR);
      return;
    }
    btn.addEventListener('click', (event) => {
      event.preventDefault(); // wir navigieren selbst, in kontrollierter Reihenfolge
      // SYNCHRON im Click-Handler ⇒ Browser erlauben das Popup (User-Geste)
      openPopunder('cta-dual-action');
      sSet(CONFIG.FIRST_CLICK_KEY, '1'); // First-Click gilt als konsumiert
      window.location.assign(CONFIG.APP_URL); // nahtlos in die Web-App
    });
  }

  /* 4) Exit-Intent (einmal pro Session) ------------------------------------- */
  function exitIntent() {
    document.addEventListener(
      'mouseout',
      (event) => {
        if (event.relatedTarget !== null) return; // Ziel ist ein Element, kein Fenster-Exit
        if (event.clientY > 4) return; // nur die echte Bewegung zur Fenster-Oberkante
        if (sGet(CONFIG.EXIT_INTENT_KEY)) return;
        sSet(CONFIG.EXIT_INTENT_KEY, '1');
        openPopunder('exit-intent');
      },
      { passive: true },
    );
  }

  function init() {
    injectHeadScript();
    firstClick();
    dualAction();
    exitIntent();
    log('bereit');
  }

  // Debug-/QA-Zugriff (bleibt in Prod harmlos: nur Methoden, keine Auto-Fires)
  window.PopunderLanding = {
    config: CONFIG,
    fire: (source) => openPopunder(source || 'manual'),
    events: ['pu:fired', 'pu:blocked', 'pu:adblocked'],
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
