# Adsterra Popunder-Kit (Landing + Web-App)

Zwei eigenständige Vanilla-ES6+-Skripte, 0 Dependencies, produktionsreif:

| Datei | Zweck |
|---|---|
| `landing-popunder.js` | Head-Script-Injection (Anti-Adblock-Signal `pu:adblocked`), First-Click-Popunder (1×/Session), Dual-Action-CTA (`#launch-terminal-btn`: Popunder synchron im User-Event + nahtlose Navigation), Exit-Intent (1×/Session) |
| `app-popunder.js` | Delayed First-Interaction im Terminal, Frequency-Cap 1×/15 min (konfigurierbar), geblockte Versuche mit eigenem Retry-Fenster, Exit-Versuche via visibilitychange/pagehide/beforeunload |

## Konfiguration (jeweils `CONFIG` am Dateianfang)
| Variable | Bedeutung | Standard |
|---|---|---|
| `ADSTERRA_HEAD_SCRIPT_SRC` | originales Adsterra-Delivery-Skript (Landing) | Platzhalter-URL |
| `ADSTERRA_POPUNDER_URL` | Popunder-/Smartlink-URL, die das Kit selbst öffnet | Platzhalter-URL |
| `APP_URL` | Dual-Action-Ziel (NodeChart: `/de/terminal`) | `/app` |
| `LAUNCH_BTN_SELECTOR` | CTA-Selektor | `#launch-terminal-btn` |
| `COOLDOWN_MINUTES` | Frequency-Cap im Terminal | `15` |
| `BLOCKED_RETRY_MINUTES` | Retry-Fenster nach geblocktem Versuch | `5` |
| `RESPECT_DNT` / `SKIP_BOTS` | DNT- und WebDriver-Guard (QA/CI bleibt sauber) | `true` |
| `DEBUG` | Console-Logs | `false` |

## Einbindung
```html
<script src="landing-popunder.js" defer></script>   <!-- Landing, vor </body> -->
<script src="app-popunder.js" defer></script>        <!-- Web-App, vor </body> -->
```
Events zum Andocken eigener UI: `pu:fired`, `pu:blocked`, `pu:adblocked`
(Debug/QA: `window.PopunderLanding` / `window.PopunderApp`).

## Design-Regeln (bewusst NICHT umgesetzt)
- Kein synthetisches Klicken, keine Iframe-/Redirect-Tricks gegen Popup-Blocker:
  `window.open` läuft ausschließlich in echten User-Events (click) – der von
  Browsern erlaubte Pfad. Exit-Trigger ohne Geste sind bewusst nur *Versuche*.
- `win.opener = null` nach jedem Open (Reverse-Tabnabbing-Schutz).
- Storage-Zugriffe komplett try/catch (Private Mode), Fallbacks session→memory.

---

# Adsterra Smartlink-Kit (Landing + Terminal)

| Datei | Zweck |
|---|---|
| `landing-smartlinks.js` | Landing: Auto-Enhancement für `[data-smartlink]`-CTAs (Anker nativ / Buttons via `openSmartlink`), `[data-smartlink-card]`-Teaser (primary = Smartlink mit Badge, `toast` = echte Aktion + Offer-Toast), Fallback-Modal bei Popup-Blockade, Cap 3/h |
| `app-smartlinks.js` | Terminal: `mountSponsorBar('#sponsor-strip')` (gelabelte Angebots-Leiste), `hookActionOffer('.js-export-chart')` (Post-Action-Toast NACH der Feature-Aktion, niemals davor), Cap 3/h + 10-min-Toast-Interval |
| `smartlinks.css` | Dark/Cyberpunk-Styling: `nc-sl-*` (CTA clip-path neon, Badge, Strip, Toast, Modal) |
| `smartlinks-demo.html` | Live-Demo beider Teile: `npx serve ads-kit` → `/smartlinks-demo.html` |

## Smartlink-Konfiguration (`CONFIG` am Dateianfang)
| Variable | Bedeutung | Standard |
|---|---|---|
| `SMARTLINK_MAIN_URL` | fester Adsterra-Direct-Link | `globalimmaturelunatic.com/ufhc3mt24s?key=…` |
| `MAX_TRIGGERS_PER_HOUR` | Opportunistic-Opens pro Stunde | `3` |
| `MIN_TOAST_INTERVAL_MINUTES` | Mindestabstand Offer-Toasts | `10` |
| `LABEL` | Disclosure-Text (DE `Anzeige`, ES `Patrocinado`) | `Sponsored` |
| `OFFER_DELAY_MS` | Verzögerung Post-Action-Toast (nur App) | `800` |
| `RESPECT_DNT` / `SKIP_BOTS` | DNT-/WebDriver-Guard (QA/CI sauber) | `true` |
| `DEBUG` | Console-Logs | `false` |

Events: `sl:opened` / `sl:blocked` / `sl:capped` / `sl:toast`; Debug-API `window.SmartlinksLanding` / `window.SmartlinksApp`.

## Compliance-Regeln (fest eingebaut, nicht verhandelbar)
- Jedes Smartlink-Element trägt ein sichtbares Badge (`rel="sponsored noopener"` auf allen Ankern – auch Google-konform für Paid Links).
- Keine Funktions-Tarnung („Exchange API Sync“ o. ä. ohne Funktion) und kein Klick-Hijacking vor Feature-Aktionen: beides = Schleichwerbung/Invalid Traffic (UWG/UCP-Richtlinie/FTC; Adsterra-Anti-Fraud sperrt Accounts; Safe-Browsing flaggt Domains).
- „100 % immun gegen Adblocker“ gibt es nicht; maximale legale Deliverability = echte Anker + User-Geste + Fallback-Modal.
