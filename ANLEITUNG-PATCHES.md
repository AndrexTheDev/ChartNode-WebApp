# Anleitung: Die beiden Fixes ins Live-Projekt bringen

Diese Anleitung setzt **keine** Git-Kenntnisse voraus. Du brauchst nur ein
Terminal und etwa 15 Minuten.

**Was am Ende rauskommt:** Ein Pull Request in `ChartNode-WebApp2` (dem Repo,
aus dem `nodechart.cc` gebaut wird) mit zwei Fixes. Erst wenn du diesen PR
selbst mergst, geht etwas live — vorher passiert auf der echten Seite nichts.

---

## Vorher: Was du brauchst

| Was | Wie prüfen |
|---|---|
| Ein Terminal (Eingabeaufforderung) | Windows: „Git Bash" · Mac: „Terminal" · Linux: „Terminal" |
| Git installiert | `git --version` → muss eine Versionsnummer ausgeben |
| Node.js installiert | `node --version` → muss z. B. `v22.x` ausgeben |
| Zugriff auf `ChartNode-WebApp2` | Du bist eingeloggt und kannst das Repo im Browser öffnen |

Wenn `git --version` oder `node --version` einen Fehler bringt, installiere
zuerst [Git](https://git-scm.com/downloads) bzw. [Node.js](https://nodejs.org)
(Version 22 LTS), dann mach hier weiter.

---

## Schritt 1 — Die zwei Patch-Dateien herunterladen

Klicke diese beiden Links. Die Datei öffnet sich im Browser als Text. Oben
rechts ist ein **Download-Button** (Symbol mit Pfeil nach unten) — klicke ihn.
Beide Dateien landen in deinem **Download-Ordner**.

1. [chartnode-webapp2-venue-hysteresis.patch](https://github.com/AndrexTheDev/ChartNode-WebApp/raw/arena/ad00efde-chartnode-webapp/patches/chartnode-webapp2-venue-hysteresis.patch)
2. [chartnode-webapp2-live-robots-audit.patch](https://github.com/AndrexTheDev/ChartNode-WebApp/raw/arena/ad00efde-chartnode-webapp/patches/chartnode-webapp2-live-robots-audit.patch)

> **Falls der Download-Button fehlt:** Rechtsklick auf die Seite → „Seite
> speichern unter…" → Dateinamen **exakt** so lassen, wie er im Link steht
> (Endung `.patch` beachten). Wichtig: Der Browser darf nicht `.txt` an
> den Namen hängen.

**Kontrolle:** Beide Dateien sollten so aussehen:

```
chartnode-webapp2-venue-hysteresis.patch       ca. 10,5 KB
chartnode-webapp2-live-robots-audit.patch      ca. 5,5 KB
```

(Die genaue Größe ist nicht wichtig — nur, dass es zwei `.patch`-Dateien sind
und keine leer ist.)

---

## Schritt 2 — Terminal öffnen und in den Downloads-Ordner gehen

Kopiere die Zeile für dein System, füge sie ins Terminal ein (Rechtsklick →
„Paste" funktioniert in den meisten Terminals), und drücke Enter.

**Windows (Git Bash):**
```bash
cd ~/Downloads
```

**Mac:**
```bash
cd ~/Downloads
```

**Linux:**
```bash
cd ~/Downloads
```

**Kontrolle:** Tippe `ls *.patch` und drücke Enter. Es müssen genau die zwei
Dateien aus Schritt 1 erscheinen. Wenn stattdessen „No such file" kommt, bist
du im falschen Ordner — prüfe, ob dein Browser woanders hin speichert
(meist `~/Downloads`, manchmal `~/Desktop`).

---

## Schritt 3 — Das Live-Projekt herunterladen (klonen)

```bash
git clone https://github.com/AndrexTheDev/ChartNode-WebApp2.git
```

Das legt einen Ordner `ChartNode-WebApp2` im Downloads-Ordner an. Dauert je
nach Verbindung 10–60 Sekunden.

Dann hineinwechseln:

```bash
cd ChartNode-WebApp2
```

**Kontrolle:** `git log --oneline -1` muss etwas ausgeben, das mit
`78a999d` beginnt. Das ist der aktuelle Stand von Live.

---

## Schritt 4 — Git sagen, wer du bist

Einmalig nötig, sonst bricht Schritt 6 mit einer Fehlermeldung ab
(„empty ident name"). Ersetze Name und E-Mail durch deine.

```bash
git config user.name "AndrexTheDev"
git config user.email "320233229+AndrexTheDev@users.noreply.github.com"
```

> Das ist nur eine Beschriftung an den Commits — kein Passwort, keine
> Anmeldung. Der Push in Schritt 8 fragt separat nach deinen Zugangsdaten.

---

## Schritt 5 — Einen Arbeitszweig anlegen

```bash
git checkout -b fix/qa-haertung
```

Das ist wie ein neuer Arbeitsordner: `main` bleibt unberührt, bis du
ausdrücklich zusammenführst.

**Kontrolle:** Es erscheint `Switched to a new branch 'fix/qa-haertung'`.

---

## Schritt 6 — Die Patches anwenden

```bash
git am ../*.patch
```

**Erwartete Ausgabe:**

```
Applying: qa(check:live): prueft die Live-robots.txt auf verdeckte Aussperrung
Applying: fix(chart): venue flapping unmounted the chart mid-drag
```

**Kontrolle:** `git log --oneline -3` zeigt zwei neue Zeilen ganz oben,
darunter `78a999d`.

### Wenn es nicht klappt

**„No such file or directory"** → Du bist nicht im `ChartNode-WebApp2`-Ordner.
Führe `cd` allein aus, prüfe mit `ls`, und gehe in den richtigen Ordner.

**„Patch does not apply"** → Dieser Fehler tritt auf, wenn sich das Live-Projekt
seit dem 22.11. an denselben Stellen geändert hat. **Nicht** mit `--force`
weitermachen. Melde dich dann mit dieser Meldung — die Patches müssen auf den
neuen Stand angepasst werden.

**Du hast dich vertippt?** Zurück auf Anfang mit:
```bash
git am --abort
```

---

## Schritt 7 — Prüfen, dass nichts kaputt ist

```bash
npm ci
```

Lädt die Abhängigkeiten. Dauert 1–3 Minuten, einmalig. (Kein Tippfehler:
`npm ci`, nicht `npm install`.)

Dann die Prüfungen:

```bash
npx tsc --noEmit
npm run qa:venue
```

**Erwartete Ausgabe:**

- `npx tsc --noEmit` → gibt **nichts** aus (= alles gut)
- `npm run qa:venue` → endet mit `✔ Venue-Hysterese intakt`

Wenn `npm run qa:venue` mit `✖` endet, ist etwas beim Anwenden schiefgelaufen.
Dann nicht weitermachen.

---

## Schritt 8 — Zu GitHub hochladen

```bash
git push -u origin fix/qa-haertung
```

**Beim ersten Mal fragt Git nach Zugangsdaten.** Das ist der einzige Schritt,
bei dem du dich anmelden musst:

- **Username:** dein GitHub-Name (`AndrexTheDev`)
- **Password:** funktioniert bei GitHub **nicht** mit deinem normalen Passwort.
  Du brauchst ein „Personal Access Token" — siehe den Kasten unten.

<details>
<summary><strong>Token erstellen (einmalig, 2 Minuten)</strong></summary>

1. GitHub im Browser öffnen → rechts oben dein Profilbild → **Settings**
2. Ganz nach unten scrollen → **Developer settings**
3. **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
4. **Note:** irgendwas wie `patch-upload`
5. **Expiration:** 7 Tage reicht
6. Bei **Scopes** den Haken bei **`repo`** setzen (das ist der wichtige)
7. Ganz unten **Generate token**
8. Der Token erscheint **nur jetzt einmal** — kopiere ihn
9. Beim Passwort-Feld in Schritt 8 diesen Token einfügen

GitHub zeigt den Token später nie wieder an. Wenn du ihn verlierst, erstellst
du einfach einen neuen.
</details>

**Erwartete Ausgabe:** eine Zeile, die mit
`branch 'fix/qa-haertung' set up to track 'origin/fix/qa-haertung'` endet.

---

## Schritt 9 — Den Pull Request aufmachen

Nach dem Push zeigt GitHub im Terminal oft schon einen Link an. Sonst:

1. Öffne <https://github.com/AndrexTheDev/ChartNode-WebApp2>
2. Oben erscheint ein gelber Balken: **„fix/qa-haertung had recent pushes"**
   → klicke **Compare & pull request**
3. **Titel:**
   ```
   QA-Härtung: Venue-Hysterese + Live-robots-Audit
   ```
4. **Beschreibung** — kopiere das hier hinein:

   ```
   Zwei Fixes, vorbereitet und gegen die echte Funktion geprüft.

   ## 1. Venue-Flattern unmountet den Chart mitten in der Geste
   `pickExchange` nahm den besten Ranglisteneintrag. Die Reachability-Probes
   laufen parallel; sobald eine `error` meldet, ist die laufende Venue
   schlechter als alle noch ungeprüften und die Auswahl springt. Jeder Wechsel
   tauscht Feed-Subscription und chartId, React unmountet den Plot, die
   Pointer-Capture fällt weg — Drag-Gesten brechen ab.

   Fix: `stickTo()` hält die zuletzt gecharte Venue, solange sie Symbol und
   Timeframe bedienen kann und `unsupported` sie nicht widerlegt.
   Reihenfolge: Nutzerwahl > Hysterese > Rangliste.

   Belegt: `binance=error`/Rest `unknown` ergibt ohne Fix `okx` (Flatter), mit
   Fix `binance` (gehalten); bei Widerlegung durch `unsupported` wechselt es
   weiterhin; im Browser mit Fixtures 22 s beobachtet, Venue durchgehend
   Binance, 7/7 Canvases, 0 pageerrors.

   ## 2. check:live hätte eine Googlebot-Sperre nicht bemerkt
   `robots.txt` wurde nur auf `Allow: /` geprüft. Cloudflare stellt der
   ausgelieferten Datei einen verwalteten Block voran, der in keinem lokalen
   Build auftaucht. Eine Googlebot-Sperre wäre durchgerutscht.

   Fix: Zerlegung nach RFC 9309 in (agents, rules)-Gruppen; Prüfung auf
   `Disallow: /` für `*`, `googlebot`, `bingbot`, `googlebot-news`,
   `googlebot-image`. KI-Blöcke werden als Hinweis gelistet, nicht als Fehler.

   Gegengetestet mit drei Fixtures, inklusive „nur Googlebot gesperrt".

   ## Verifikation
   `tsc --noEmit` sauber, ESLint 0 Fehler, `next build` grün, `qa:venue` grün,
   `check:live` 45 PASS / 1 FAIL / 2 SKIP. Der eine Fail ist **vorbestehend**
   (gegen den ungepatchten Stand nachgestellt, 41/1/2, identisch) und nicht
   durch diesen PR verursacht.
   ```

5. **Create pull request** klicken

---

## Schritt 10 — Ergebnis der automatischen Prüfung abwarten

Im PR erscheint unten ein Bereich mit Prüfungen („Checks"). Warte, bis sie
durch sind:

- **Grün** → alles gut, du kannst mergen
- **Rot** → klicke auf „Details" neben der roten Prüfung und schick mir die
  Fehlermeldung

Erst wenn du oben rechts auf **Merge pull request** klickst, wird der Code
Teil von `main`. Je nach Cloudflare-Einrichtung wird danach automatisch
deployt — das ist dann die eigentliche Änderung auf `nodechart.cc`.

---

## Was danach zu prüfen ist

Nach dem Deploy (ein paar Minuten) öffne:

- <https://nodechart.cc/de/terminal> → Chart muss laden
- <https://nodechart.cc/robots.txt> → muss weiterhin `Sitemap:` enthalten

Wenn der Crawl-Check live laufen soll:

```bash
npm run check:live
```

---

## Der eine Punkt, den ich nicht entscheiden konnte

`check:live` meldet **einen** Fehler, der schon vorher da war:

```
FAIL  unbekannte Sprache endet im 404 — 307 → /en → 200
```

Aufruf `/xx` leitet auf `/en` weiter und liefert dort 200 statt 404. Das ist
**nicht** durch die Patches verursacht (nachgestellt: ungepatcht 41/1/2,
gepatcht 45/1/2 — identischer Fehler).

Die Ursache liegt in `src/proxy.ts`, das locale-förmige Präfixe bewusst auf
die Standardsprache umschreibt. **Das ist deine Produktentscheidung:**

- Soll `/xx` (keine gültige Sprache) wirklich eine 404-Seite zeigen?
  Dann ist der Code falsch.
- Oder ist die Weiterleitung auf `/en` gewollt?
  Dann ist der Check zu streng.

Ich habe hier nichts geändert, weil beides vertretbar ist und es eine bewusste
Entscheidung im Code zu geben scheint.

---

## Kurzfassung (wenn du geübt bist)

```bash
cd ~/Downloads
git clone https://github.com/AndrexTheDev/ChartNode-WebApp2.git
cd ChartNode-WebApp2
git config user.name "AndrexTheDev"
git config user.email "320233229+AndrexTheDev@users.noreply.github.com"
git checkout -b fix/qa-haertung
git am ../*.patch
npm ci && npx tsc --noEmit && npm run qa:venue
git push -u origin fix/qa-haertung
```

Dann PR auf GitHub aufmachen (Schritt 9).
