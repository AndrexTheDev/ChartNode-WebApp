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
