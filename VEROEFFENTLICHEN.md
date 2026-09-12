# 🚀 NodeChart veröffentlichen — Schritt-für-Schritt (idiotensicher)

**Ziel:** Dieses fertige, release-geprüfte Projekt liegt auf GitHub und läuft
kostenlos ($0) auf deinem Cloudflare-Account unter `nodechart.cc`.
**Dauer:** ~15 Minuten. **Vorkenntnisse:** keine nötig — einfach abtippen/anklicken.

> Der Code ist bereits **fertig gebaut, getestet und committet**. Du lädst ihn
> nur noch hoch und verbindest ihn mit Cloudflare. Nichts am Code ändern!

---

## 0. Checkliste (2 Minuten)

| Brauchst du | Woher | Haken |
| --- | --- | --- |
| GitHub-Konto | github.com (kostenlos) | ☐ |
| Cloudflare-Konto | dash.cloudflare.com (kostenlos) | ☐ |
| Git installiert | Terminal: `git --version` → sonst git-scm.com | ☐ |
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

## 3. Cloudflare: kostenlos hosten (5 Minuten)

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
6. Fertig! Deine App liegt jetzt auf einer kostenlosen Worker-URL:
   `nodechart.DEIN-SUB.workers.dev` → anklicken und testen (siehe Teil 5).

> 💡 Optional Werbeeinnahmen aktivieren (Adsterra-Placements von deinem
> Adsterra-Dashboard eintragen, sonst bleiben die Slots lautlos leer):
> `NEXT_PUBLIC_ADSTERRA_NATIVE_DESKTOP`, `NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE`,
> `NEXT_PUBLIC_ADSTERRA_SOCIALBAR_DESKTOP`, `NEXT_PUBLIC_ADSTERRA_SOCIALBAR_MOBILE`,
> `NEXT_PUBLIC_ADSTERRA_POPUNDER_DESKTOP`, `NEXT_PUBLIC_ADSTERRA_POPUNDER_MOBILE`.
> Nach dem Eintragen: **Deployments → Retry deployment** (Build-Env wirkt erst beim nächsten Build).

## 4. Eigene Domain `nodechart.cc` verbinden (2 Minuten)

*Nur nötig, wenn die Domain noch nicht live auf der App liegt:*

1. Cloudflare → **Workers & Pages** → Projekt `nodechart` → Tab **Settings** →
   **Domains & Routes** → **Add custom domain**.
2. `nodechart.cc` (und optional `www.nodechart.cc`) eintragen → **Add domain**.
   Cloudflare setzt den DNS-Eintrag **und** das SSL-Zertifikat automatisch
   (Dauer: Sekunden bis wenige Minuten). Voraussetzung: die Domain liegt in
   deinem Cloudflare-Account (ist sie das nicht: Domain zuerst unter
   **Websites → Add a site** hinzufügen).
3. Danach gilt: `https://nodechart.cc` = deine App. Jeder neue `git push`
   aktualisiert sie automatisch in ~4 Minuten. **Das war's — du bist live.** 🎉

## 5. Live-Checkliste nach dem Deploy (1 Minute)

| Test | Erwartung |
| --- | --- |
| `https://nodechart.cc/de/terminal` | Chart mit Live-Candles, Wasserzeichen `www.NodeChart.cc` |
| Sprache oben rechts wechseln (5×) | de/en/es/ru/zh vollständig übersetzt |
| `…/de/terminal?adwall=1` | Spenden-Wall erscheint (Beweis: Monetization lebt) |
| `https://nodechart.cc/sitemap.xml` | 36+ URLs, 5 Sprachen |
| Browser-Konsole (F12) | 0 Fehler, 0 Warnungen |

## 6. Troubleshooting (falls etwas zickt)

| Symptom | Lösung |
| --- | --- |
| Build-Fehler mit „Node … unsupported“ | Env-Var `NODE_VERSION=22` fehlt (Teil 3, Schritt 4) |
| Deploy hängt/fehlt nach Push | Workers & Pages → Projekt → **Deployments** → „Retry“; Build-Log lesen |
| Seite zeigt alten Stand | Cloudflare-Cache: Projekt → Deployments → neuer Push löst automatisch neuen Deploy aus; sonst **Purge cache** unter Caching |
| Ad-Slots leer | **Normal** ohne Adsterra-Env-Vars (Fail-open-Design) |
| `git push` fragt ständig Passwort | Teil 2, Token-Hinweis; oder einmalig `git config --global credential.helper manager` |
| Lokales Ausprobieren vor dem Push | `npm ci && npm run build && npm start` → http://localhost:3000 |

## 7. Kosten & Recht

* **Kosten: 0,00 €** — Cloudflare Workers Free Tier (100 000 Requests/Tag,
  statische Assets unbegrenzt frei); GitHub Public Repo kostenlos.
* **Lizenz:** All Rights Reserved (`LICENSE.md`) — der Code ist öffentlich
  *einsehbar*, aber jede Nutzung/Kopie/eigene Instanz ohne schriftliche
  Genehmigung untersagt. Eingebaute Fremdbibliotheken bleiben unter ihren
  Original-Lizenzen. Nichts im Repo ändert daran etwas — **LICENSE.md und die
  Copyright-Header niemals löschen**.

---

**Reihenfolge merken:** ① Repo leer anlegen → ② `git push` → ③ Cloudflare
connect + Build-Settings → ④ Domain → ⑤ Checkliste. Mehr ist es nicht. Viel
Erfolg, Andrex. 🖤💚
