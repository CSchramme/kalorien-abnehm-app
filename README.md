# Leichter – Kalorientracker & Abnehm-App (PWA)

Eine installierbare Web-App (PWA) zum Abnehmen: Mahlzeiten und Nährwerte erfassen, Kalorienbilanz im Blick behalten, Gewicht verfolgen – mit eigenen **Benutzerkonten**, sodass jede Person ihre Daten geräteübergreifend nutzt.

## Funktionen

- **Konten:** Registrierung, Anmeldung, Abmelden (auch auf allen anderen Geräten), Name/E-Mail und Passwort ändern, Datenexport (JSON) und Konto löschen.
- **Persönliches Kalorienziel:** Grundumsatz (Mifflin-St Jeor) × Aktivität − Defizit für das gewählte Abnehmtempo (0,25–1 kg/Woche). Untergrenze 1.200 kcal (w) bzw. 1.500 kcal (m), Ziel optional manuell festlegen. Dazu Ziele für Eiweiß, Kohlenhydrate und Fett sowie Grenzwerte für Zucker, gesättigte Fettsäuren und Natrium.
- **Tagebuch:** Frühstück, Mittag, Abend, Snacks. Kalorienbilanz *Tagesziel − Gegessen + Sport = Übrig* mit Ring, Makro-Balken und allen Nährwerten. Einträge per Tipp ändern oder löschen, eine Mahlzeit „wie gestern“ übernehmen, durch die Tage blättern.
- **Lebensmittel & Rezepte:** eigene Datenbank mit allen Werten, wie sie auf Rezept-Seiten und Verpackungen stehen: Brennwert (kJ/kcal), Eiweiß, Kohlenhydrate, davon Zucker, Fett, gesättigte Fettsäuren, Ballaststoffe und Natrium (oder Salz). Mengen pro Portion oder pro 100 g/ml, Favoriten, Suche.
- **Nährwerte aus Text übernehmen:** Nährwert-Text aus einer Rezept-App oder von einer Verpackung kopieren und einfügen; die Werte werden automatisch erkannt. Auf dem iPhone geht das per *Live Text* direkt aus einem Screenshot (Text lange drücken → „Alles auswählen“ → „Kopieren“). Erkannt werden deutsche und englische Angaben, „1.326 mg“, „3,5 g“, „2.778 kJ / 664 kcal“, Salz → Natrium und Tabellen-Layouts.
- **Schnelleintrag** nur mit Kalorien, optional als Lebensmittel speichern.
- **Sport & Aktivität:** Verbrauch wird anhand von MET-Werten geschätzt und erhöht das Tagesbudget.
- **Gewicht:** Verlauf als Diagramm mit Ziellinie, Fortschritt Start → Ziel, BMI und voraussichtliches Zieldatum.
- **Statistik (7/30/90 Tage):** Kalorien pro Tag gegen das Ziel, Tage im Ziel, Kalorienbilanz und geschätzte Fettabnahme (7.700 kcal ≈ 1 kg), durchschnittliche Makroverteilung und eine Tabellenansicht.
- **PWA:** installierbar (iOS/Android/Desktop), App-Icons, Offline-Modus (App-Shell und zuletzt geladene Daten), Hell-/Dunkelmodus.

## Schnellstart

Voraussetzung: **Node.js ≥ 20**. Als Datenbank dient SQLite, und zwar auf einem von zwei Wegen:

- **Node 20 oder neuer:** `npm install` installiert [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3). Version 12.9.0 ist fest eingestellt, weil sie fertige Pakete für Node 20 mitbringt; man braucht also keinen Compiler.
- **Node ≥ 22.13:** Es geht auch ganz ohne Installation mit dem eingebauten `node:sqlite`.

Ist `better-sqlite3` installiert, wird es bevorzugt. Mit `DB_DRIVER=node:sqlite` bzw. `DB_DRIVER=better-sqlite3` lässt sich ein Treiber erzwingen.

```bash
npm install          # nur nötig für Node 20–22.12
npm start            # http://localhost:3000
npm run dev          # mit automatischem Neustart bei Änderungen
npm test             # API- und Berechnungstests
```

Die Datenbank liegt standardmäßig unter `./data/leichter.db`.

### Konfiguration (Umgebungsvariablen)

| Variable        | Standard              | Bedeutung |
|-----------------|-----------------------|-----------|
| `PORT`          | `3000`                | HTTP-Port |
| `HOST`          | `0.0.0.0`             | Bind-Adresse |
| `DB_PATH`       | `./data/leichter.db`  | Pfad der SQLite-Datenbank |
| `TRUST_PROXY`   | –                     | `1` hinter einem Reverse-Proxy (wertet `X-Forwarded-*` aus) |
| `COOKIE_SECURE` | automatisch           | `1` erzwingt das `Secure`-Cookie, `0` schaltet es ab |

## Betrieb auf einem Server

Damit sich die App auf dem Handy installieren lässt, muss sie über **HTTPS** erreichbar sein (Ausnahme: `localhost`).

```bash
docker compose up -d --build     # App auf 127.0.0.1:3000, Daten im Volume "leichter-data"
```

Beispiel für einen HTTPS-Reverse-Proxy mit [Caddy](https://caddyserver.com) (holt das Zertifikat automatisch):

```
kalorien.example.de {
    reverse_proxy 127.0.0.1:3000
}
```

**Backup:** Die gesamte Datenbank steckt in der Datei `leichter.db` (im Docker-Volume unter `/data`). Für ein konsistentes Backup im laufenden Betrieb z. B. `sqlite3 leichter.db ".backup backup.db"` verwenden.

### Plesk (Node.js-Erweiterung / Phusion Passenger)

1. **Node-Version:** In *Websites & Domains → Node.js* **Node.js 20.x** wählen (oder 22.x/24.x, falls angeboten). Node 18 und 21 werden nicht unterstützt.
2. **Code holen:** *Git* → Repository hinzufügen (`git@github.com:CSchramme/kalorien-abnehm-app.git`, Branch wählen), Bereitstellungspfad z. B. `httpdocs/leichter`. Bei einem privaten Repo den von Plesk angezeigten SSH-Schlüssel bei GitHub unter *Settings → Deploy keys* eintragen. Als zusätzliche Bereitstellungsaktion `mkdir -p tmp && touch tmp/restart.txt` eintragen; das startet die App nach jedem Update neu.
3. **Node.js aktivieren** mit diesen Werten:
   - Anwendungsstamm: `httpdocs/leichter`
   - Dokumentstamm: `httpdocs/leichter/public`
   - Anwendungsstartdatei: **`app.cjs`**
   - Anwendungsmodus: `production`
   - Umgebungsvariablen: `COOKIE_SECURE=1`, `TRUST_PROXY=1`
   - optional `DB_PATH=/var/www/vhosts/<domain>/leichter-data/leichter.db` (Ordner vorher im Dateimanager anlegen)

   Danach auf **NPM install** klicken. Das installiert `better-sqlite3` und muss nur beim ersten Mal und nach Änderungen an `package.json` wiederholt werden. Anschließend auf *App neu starten* klicken.
4. **HTTPS:** Unter *SSL/TLS-Zertifikate* ein kostenloses Let's-Encrypt-Zertifikat ausstellen und „HTTP auf HTTPS umleiten“ aktivieren.
5. **Testen:** `https://<domain>/api/health` muss `{"ok":true}` liefern.

Ohne `DB_PATH` liegt die Datenbank in `<Anwendungsstamm>/data/` und damit außerhalb des Dokumentstamms, also nicht aus dem Web abrufbar. Für das Backup ist die Datei `leichter.db` wichtig.

### Verwaltung

```bash
npm run admin -- users                          # Konten auflisten
npm run admin -- reset-password name@mail.de    # neues Zufallspasswort setzen
# im Container:
docker compose exec leichter node --disable-warning=ExperimentalWarning server/admin.js users
```

## Sicherheit & Datenschutz

- Passwörter werden mit **scrypt** und zufälligem Salt gehasht.
- Sessions laufen über ein `HttpOnly`/`SameSite=Lax`-Cookie (60 Tage, verlängert sich bei Nutzung). In der Datenbank steht nur ein SHA-256-Hash des Tokens.
- Gegen CSRF akzeptiert die API nur `application/json` vom selben Ursprung.
- Login, Registrierung und Passwortänderung sind gegen Durchprobieren begrenzt.
- Content-Security-Policy und weitere Sicherheits-Header sind gesetzt.
- Jede Abfrage ist auf das eigene Konto beschränkt (siehe Tests). Nach dem Abmelden wird auch der Offline-Cache auf dem Gerät geleert.
- Alle Daten bleiben auf deinem Server; es gibt keine externen Dienste, kein Tracking und keine CDN-Abhängigkeiten.

## Aufbau

```
server/
  index.js     HTTP-Server, statische Dateien, Sicherheits-Header
  api.js       REST-API (Konten, Profil, Lebensmittel, Tagebuch, Sport, Gewicht, Statistik)
  auth.js      Passwort-Hashing, Sessions
  db.js        SQLite-Schema & Migrationen
  admin.js     Verwaltungs-Werkzeug (Konsole)
public/
  index.html, manifest.webmanifest, sw.js (Service Worker), img/ (App-Icons; bewusst nicht "icons/", das belegt Apache)
  css/app.css
  js/app.js    Router, Tab-Leiste, Theme
  js/lib/      calc.js (Kalorienziel, Nährstoffe), parse.js (Nährwert-Erkennung), von Browser UND Server genutzt
  js/views/    Seiten: Tagebuch, Lebensmittel, Gewicht, Statistik, Profil, Einrichtung, Anmeldung
test/          node:test, API- und Berechnungstests
```

Die Oberfläche ist reines JavaScript (ES-Module) ohne Build-Schritt. Wenn du Dateien in `public/` änderst, erhöhe `VERSION` in `public/sw.js`, damit installierte Apps die neue Version laden. Neue Dateien gehören zusätzlich in die `SHELL`-Liste. Die PNG-Icons werden mit `npm run icons` (Playwright) aus `public/img/icon.svg` erzeugt.

## Ideen für später

- Passwort-Reset per E-Mail (braucht einen SMTP-Zugang)
- Barcode-Scanner mit Anbindung an Open Food Facts
- Einträge auch offline erfassen und später synchronisieren
- Rezepte aus mehreren Zutaten zusammensetzen

---

*Alle Berechnungen sind Schätzungen und ersetzen keine ärztliche oder ernährungswissenschaftliche Beratung.*
