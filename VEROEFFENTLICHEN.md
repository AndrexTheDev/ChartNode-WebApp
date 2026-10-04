# 🚀 NodeChart veröffentlichen — Schritt-für-Schritt (idiotensicher)

**Ziel:** Dieses Projekt liegt auf GitHub und wird über Cloudflare unter
`nodechart.cc` bereitgestellt. Ob Nutzung und Traffic im aktuellen Free-Plan
bleiben, hängt von Cloudflare-Limits, Funktionen, Bedingungen und tatsächlichem
Traffic ab; diese Anleitung verspricht keine dauerhaft kostenfreie Bereitstellung.
**Dauer:** ~15 Minuten. **Vorkenntnisse:** keine nötig — einfach abtippen/anklicken.

> Diese Anleitung beschreibt den Deployment-Ablauf, nicht einen dauerhaft
> geprüften Releasezustand. Vor jedem Deploy den konkreten Commit bauen und
> testen (`npm ci`, `npm run build`, `npm run cf:build` sowie passende Smoke-/E2E-Checks).
> Alte Release-Audit-Zählstände gelten nach Code- oder Dependency-Änderungen nicht automatisch.

---

## 0. Checkliste (2 Minuten)

| Brauchst du | Woher | Haken |
| --- | --- | --- |
| GitHub-Konto | github.com (Plan-/Repo-Bedingungen prüfen) | ☐ |
| Cloudflare-Konto | dash.cloudflare.com (Worker-Plan, Limits und Preise prüfen) | ☐ |
| Git installiert | Terminal: `git --version` → sonst git-scm.com | ☐ |
| Build-/Smoke-Checks | Im Projekt: `npm ci`, `npm run build`, `npm run cf:build` und die für den Release relevanten `npm run`-Checks ausführen | ☐ |
| Release-Audit | Im Projekt: `npm run qa:full`; Ergebnisse für genau diesen Commit prüfen. Keine feste PASS-Zahl voraussetzen. | ☐ |
| Dieser Ordner (`nodechart/`) auf deinem Rechner | z. B. als Download/Workspace-Kopie | ☐ |

Ein Terminal öffnen und **in den Projektordner wechseln** (alle Befehle unten
gelten nur dort):

```bash
cd pfad/zum/ordner/nodechart
```

---

## 1. GitHub: leeres Repository anlegen (3 Minuten)

1. Auf github.com einloggen → oben rechts **+** → **New repository**.
2. Ausfüllen, **sonst NICHTS**:
   * Repository name: `nodechart`
   * **Public** (Sichtbarkeit; die Lizenz `LICENSE.md` verbietet trotzdem jede Nutzung)
   * **KEIN** Häkchen bei „Add a README“, **KEINE** License, **KEINE** .gitignore
     (alles liegt bereits im Projekt — ein zweites Mal würde den Push blockieren!)
3. **Create repository**. Die Seite zeigt jetzt leere Anweisungen — genau richtig.
4. Merk dir deine Adresszeile: `https://github.com/DEIN-NAME/nodechart`

## 2. Code hochladen (2 Minuten)

Im Terminal (immer noch im Projektordner):

```bash
git remote add origin https://github.com/DEIN-NAME/nodechart.git
git push -u origin main
```

* Ersetze `DEIN-NAME` durch deinen GitHub-Nutzernamen.
* **Login-Fenster/Passwort gefragt?**
  * Öffnet sich ein Browser-Fenster (Git Credential Manager) → einfach einloggen, fertig.
  * Wird im Terminal ein *Passwort* verlangt: GitHub-Passwörter gehen nicht mehr.
    Stattdessen **Personal Access Token** nutzen:
    github.com → oben rechts Avatar → **Settings** → ganz unten **Developer settings** →
    **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)** →
    Häkchen nur bei `repo` → **Generate** → den Token (`ghp_…`) kopieren und als
    Passwort einfügen (beim Einfügen erscheint nichts — normal!).
* **Erfolg:** Im Terminal steht `main -> main`, und auf github.com erscheinen
  ~230 Dateien (README.md, LICENSE.md, src/, …).

> ❌ Fehler `remote origin already exists`? → `git remote set-url origin https://github.com/DEIN-NAME/nodechart.git`
> ❌ Fehler `rejected … non-fast-forward`? → Das Repo war doch nicht leer (README-Häkchen?).
>    Auf GitHub das Repo löschen (**Settings → ganz unten → Delete this repository**) und Schritt 1 wiederholen.

## 3. Cloudflare Worker bereitstellen (5 Minuten)

1. dash.cloudflare.com einloggen → links **Workers & Pages** → **Create** (blauer Button).
2. Tab/Option **Import a Git repository** / **Connect to Git** → GitHub autorisieren
   (einmalig) → Repository `nodechart` auswählen → **Begin setup**.
3. Build-Einstellungen **exakt** so setzen:

   | Feld | Wert |
   | --- | --- |
   | Framework preset | **None** |
   | Build command | `npm run cf:build` |
   | Deploy command | `npx wrangler deploy` |
   | Production branch | `main` |

4. Unter **Environment variables** hinzufügen (Button „Add variable“):

   | Variable | Wert |
   | --- | --- |
   | `NODE_VERSION` | `22` |
   | `NEXT_PUBLIC_SITE_URL` | `https://nodechart.cc` |

5. **Save and Deploy** klicken. Der erste Build läuft ~3–6 Minuten
   (Fortschritt live sichtbar). Cloudflare authentifiziert `wrangler` in seiner
   eigenen CI automatisch — **kein Token nötig**.
6. Fertig! Falls für Account und Deployment verfügbar, erreichst du deine App
   unter einer Worker-URL wie `nodechart.DEIN-SUB.workers.dev` → anklicken und testen
   (siehe Teil 5). Verfügbarkeit, Quotas und mögliche Kosten hängen von Cloudflares
   aktuellem Plan, den Bedingungen und deinem Traffic ab.

> 💡 **Adsterra-Defaults und Consent:** Die Konfiguration enthält Publisher-URLs als Defaults bzw. Overrides in `src/lib/ads/config.ts`. Automatische Drittanbieter-Werbeskripte werden erst nach ausdrücklicher Zustimmung geladen; eine Ablehnung lässt Markt-/Chartfunktionen verfügbar. Lokale Smartlink-Dateien und deutlich gekennzeichnete, nutzerinitiierte Partnerlinks sind ein separater Pfad.
> **Release-Blocker:** Die CMP/TCF-Kompatibilität dieser konkreten Publisher-Integration und das tatsächliche Cookie-/Netzwerkverhalten sind noch nicht verifiziert. Die App-seitige Einwilligungsabfrage allein ist keine Compliance-Bestätigung. Vor Produktionsfreigabe Anbieter-Signal und Browser-Netzwerkverhalten prüfen; bei Env-Änderungen anschließend **Deployments → Retry deployment** (Build-Env wirkt erst beim nächsten Build).

## 3b. Variante B (empfohlen): Auto-Deploy per GitHub Actions

Die Dashboard-Variante (§3) baut in Cloudflares CI. Noch einfacher und
nachvollziehbarer ist der mitgelieferte Workflow `.github/workflows/deploy.yml`:
**jeder `git push` auf `main` läuft lokal-grün geprüft (verify-Suite) und deployt
sich selbst** — ohne Cloudflare-Build-Konfiguration im Dashboard.

1. Cloudflare → oben rechts **My Profile → API Tokens → Create Token** →
   Template **„Edit Cloudflare Workers"** → **Continue → Create Token**.
   Token einmal anzeigen und kopieren.
2. Cloudflare → beliebige Seite der **Workers & Pages**-Overview: rechts steht die
   **Account ID** (32 Zeichen) — kopieren.
3. GitHub → dein Repository → **Settings → Secrets and variables → Actions →
   New repository secret**, zweimal:
   | Name | Wert |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | Token aus Schritt 1 |
   | `CLOUDFLARE_ACCOUNT_ID` | ID aus Schritt 2 |
4. Fertig: ab jetzt deployt jeder Push auf `main` automatisch (Tab **Actions**
   beobachten, ~6–8 min). Fehlt ein Secret, failt der Job sichtbar — keine
   halben Deploys.

> Beide Varianten schließen sich nicht aus; wer §3 gebaut hat, kann §3b trotzdem
> aktivieren — gewonnen hat immer der letzte erfolgreiche Deploy.

## 4. Eigene Domain `nodechart.cc` verbinden (2 Minuten)

*Nur nötig, wenn die Domain noch nicht live auf der App liegt:*

1. Cloudflare → **Workers & Pages** → Projekt `nodechart` → Tab **Settings** →
   **Domains & Routes** → **Add custom domain**.
2. `nodechart.cc` (und optional `www.nodechart.cc`) eintragen → **Add domain**.
   Cloudflare setzt den DNS-Eintrag **und** das SSL-Zertifikat automatisch
   (Dauer: Sekunden bis wenige Minuten). Voraussetzung: die Domain liegt in
   deinem Cloudflare-Account (ist sie das nicht: Domain zuerst unter
   **Websites → Add a site** hinzufügen).
3. **SEO-Edge-Regeln (einmalig, 2 Minuten):** Cloudflare → Domain `nodechart.cc`
   → links im Menü:
   | Regel | Wo | Einstellung |
   | --- | --- | --- |
   | www → apex | **Rules → Redirect Rules**: `http.host eq "www.nodechart.cc"` → 301 auf `https://nodechart.cc/…` | verhindert Canonical-Split |
   | HTTPS erzwingen | **SSL/TLS → Edge Certificates → Always Use HTTPS** | an |
   | Early Hints | **Speed → Optimization → Early Hints** | an (nutzt unsere Preload-Header) |
   | Brotli | **Speed → Optimization → Content Optimization → Brotli** | an |
   | Hotlink-Protection | **Scrapes/Hotlinks** | für `/og.png` AUS (Social-Cards!) |
4. Danach gilt: `https://nodechart.cc` = deine App. Jeder neue `git push`
   aktualisiert sie automatisch in ~4 Minuten. **Das war's — du bist live.** 🎉

## 5. Live-Checkliste nach dem Deploy (1 Minute)

| Test | Erwartung |
| --- | --- |
| `https://nodechart.cc/de/terminal` | Chart mit Live-Candles, Wasserzeichen `www.NodeChart.cc` |
| Sprache oben rechts wechseln (5×) | de/en/es/ru/zh vollständig übersetzt |
| Erster Besuch auf `/de` | Einwilligungsbanner mit gleichwertigem Erlauben/Ablehnen; vor der Wahl keine Adsterra-Requests |
| `https://nodechart.cc/sitemap.xml` | 30 URLs (6 Routen × 5 Sprachen), `Cache-Control` mit `s-maxage=3600` |
| Nach ausdrücklicher Werbe-Zustimmung: Desktop (≥1280 px) auf `/de/terminal` | Sidebar-Rail darf das konfigurierte 160×600-Banner laden; vor Zustimmung/bei Ablehnung kein Adsterra-Request |
| `?adwall=1` nach Werbe-Zustimmung | QA-/Demo-Wall erscheint; ohne Zustimmung bleibt sie geschlossen |
| `https://nodechart.cc/de/terminal?ticker=SOL` | Social-Card-Vorschau (Telegram/Web) zeigt `$SOL`-Karte in Link-Sprache |
| `https://nodechart.cc/xx` und `/de/legal/nope` | 404 (keine Soft-404s) |
| Browser-Konsole (F12) | 0 Fehler, 0 Warnungen |

## 6. Troubleshooting (falls etwas zickt)

| Symptom | Lösung |
| --- | --- |
| Build-Fehler mit „Node … unsupported“ | Env-Var `NODE_VERSION=22` fehlt (Teil 3, Schritt 4) |
| Deploy hängt/fehlt nach Push | Workers & Pages → Projekt → **Deployments** → „Retry“; Build-Log lesen |
| Seite zeigt alten Stand | Cloudflare-Cache: Projekt → Deployments → neuer Push löst automatisch neuen Deploy aus; sonst **Purge cache** unter Caching |
| Ad-Slots leer | Vor Zustimmung oder nach Ablehnung erwartet; nach Zustimmung können fehlende Env-Overrides, Blocker, Provider-Ausfall oder No-Fill die Slots leer lassen |
| `git push` fragt ständig Passwort | Teil 2, Token-Hinweis; oder einmalig `git config --global credential.helper manager` |
| Lokales Ausprobieren vor dem Push | `npm ci && npm run build && npm start` → http://localhost:3000 |
| `npm run qa:full` meldet FAILs | **Nicht pushen.** `RELEASE-AUDIT.md` öffnet die Fail-Liste pro Modul; Modul einzeln erneut: `node scripts/release-audit/run.mjs M3` |

## 7. Kosten & Recht

* **Kosten & Limits:** Es gibt keine garantierte Preis- oder Quota-Zusage für
  dieses Setup. Cloudflare-Plan, Worker-Aufrufe, Features und Traffic bestimmen,
  ob Gebühren anfallen; Limits und Bedingungen können sich ändern. Vor Deploy
  Cloudflares aktuelle Preis-/Planangaben prüfen und Nutzung beobachten. Gleiches
  gilt für GitHub-Angebote und Repository-Bedingungen.
* **Lizenz:** All Rights Reserved (`LICENSE.md`) — der Code ist öffentlich
  *einsehbar*, aber jede Nutzung/Kopie/eigene Instanz ohne schriftliche
  Genehmigung untersagt. Eingebaute Fremdbibliotheken bleiben unter ihren
  Original-Lizenzen. Nichts im Repo ändert daran etwas — **LICENSE.md und die
  Copyright-Header niemals löschen**.

---

**Reihenfolge merken:** ① Repo leer anlegen → ② `git push` → ③ Cloudflare
connect + Build-Settings (oder Secrets für §3b) → ④ Domain → ⑤ Checkliste.
Mehr ist es nicht. Release-Stand: Tag `v1.0.0` = auditierter Zustand
(398/0 Release-Audit, verify grün). Viel Erfolg, Andrex. 🖤💚
