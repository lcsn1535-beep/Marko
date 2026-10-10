# MARKO — PRO MASAX ULTRA ✦

Ein futuristischer, deutschsprachiger KI-Assistent als statische Website. Das Frontend läuft auf GitHub Pages ohne Build-Schritt. Der Demo-Modus funktioniert sofort. Für echte Modellantworten kannst du optional den Cloudflare-Worker im Ordner `backend/` bereitstellen.

## Was ist drin?

- Responsive, dunkles Neon-Interface
- Chat mit lokal gespeichertem Verlauf
- Werkzeug-Bereich für Ideen, Texte, Programmieren, Lernen, Planung und Analyse
- Persönliches Notiz-Archiv im Browser
- Anhänge für TXT, Markdown, CSV, JSON und Quellcode (bis 300 KB; Textausschnitt bis 18.000 Zeichen)
- Kleine lokale Rechenhilfe
- Optionales Backend für echte KI-Antworten
- API-Schlüssel bleibt als Secret im Backend und gehört niemals ins öffentliche Frontend

> **Wichtige Grenze:** Keine KI kann buchstäblich alles. Ohne Backend ist Marko im Demo-Modus und hat kein leistungsfähiges Sprachmodell. Das optionale Backend verbindet Marko mit der OpenAI API; deren Nutzung kann Kosten verursachen. Außerdem ist der Worker eine API, kein eigener trainierter KI-Modellserver.

## 1. Website auf GitHub Pages veröffentlichen

1. Entpacke den Projektordner `MARKO-PRO-MASAX-ULTRA`.
2. Erstelle auf GitHub ein neues Repository, zum Beispiel `marko`.
3. Lade **den Inhalt dieses Ordners** in das Repository hoch. `index.html` muss im veröffentlichten Ordner direkt oben liegen.
4. Öffne im Repository **Settings → Pages**.
5. Wähle bei **Build and deployment** die Bereitstellung von einem Branch, normalerweise `main` und `/ (root)`, und speichere.
6. Warte auf den GitHub-Pages-Build. Die Website-URL wird dort angezeigt.

Danach funktioniert Marko schon im **Demo-Modus**. Du musst keine Pakete installieren und keinen Build durchführen.

## 2. Echte KI-Antworten aktivieren (optional)

GitHub Pages ist ein statischer Hoster. Ein geheimes API-Token darf deshalb nicht in `app.js`, `config.js`, HTML oder einem öffentlichen Repository liegen. Nutze einen Server-/Worker-Endpunkt für API-Aufrufe.

### Cloudflare Worker einrichten

1. Erstelle ein kostenloses Cloudflare-Konto und öffne **Workers & Pages**.
2. Installiere Node.js auf deinem Computer, falls noch nicht vorhanden.
3. Öffne ein Terminal in `MARKO-PRO-MASAX-ULTRA/backend/`.
4. Ändere in `wrangler.toml` `ALLOWED_ORIGIN` zu deiner Website-Origin. Für GitHub Pages sieht sie z. B. so aus: `https://DEINNAME.github.io` — **ohne** `/projektname/` und ohne abschließenden Slash. Bei einer eigenen Domain trägst du deren Origin ein.
5. Melde dich an und veröffentliche den Worker:

   ```bash
   npx wrangler login
   npx wrangler deploy
   ```

6. Lege den API-Key als **Secret** an (nicht in die TOML-Datei schreiben):

   ```bash
   npx wrangler secret put OPENAI_API_KEY
   ```

   Füge den Wert ein, wenn du dazu aufgefordert wirst. API-Zugang und Abrechnung müssen bei deinem API-Anbieter aktiv sein.

7. Optional kannst du das gewünschte Modell als nicht geheime Variable `OPENAI_MODEL` in `backend/wrangler.toml` setzen. Der Standard ist `gpt-4.1-mini`; prüfe in deinem API-Konto, welche Modelle für dich verfügbar sind.
8. Teste im Browser die Worker-Adresse. Sie sollte ein JSON mit `ok: true` zurückgeben. Der Chat-Endpunkt lautet `https://DEIN-WORKER.workers.dev/chat`.
9. Öffne Marko → **Einstellungen & Setup** → trage `https://DEIN-WORKER.workers.dev/chat` bei **KI-Backend-URL** ein → **Verbindung testen** → **Einstellungen speichern**.
10. Sende eine Testnachricht im Chat. Bei Erfolg steht oben **KI verbunden** bzw. **Backend konfiguriert**.

### Vor dem öffentlichen Einsatz wichtig

- Die Website-Origin/CORS-Einstellung ist keine Benutzer-Authentifizierung. Sie verhindert nicht, dass ein Skript außerhalb des Browsers den Worker anfragt.
- Bevor du die Website öffentlich bewirbst, richte bei Cloudflare zusätzlich Rate Limiting, Missbrauchsschutz und ggf. Anmeldung ein. Sonst könnten Fremde den öffentlichen Endpunkt aufrufen und über dein API-Konto Kosten verursachen.
- Nutze Nutzungsbudgets und Limits beim API-Anbieter. Teile deinen API-Key niemals.
- Datei- und Chat-Inhalte werden bei aktivierter KI an den eingestellten Backend-/API-Anbieter gesendet. Schicke keine Passwörter, Zugangsdaten oder sensiblen privaten Daten mit.
- Chat-Verlauf, Notizen und Einstellungen liegen standardmäßig lokal im Browser dieses Geräts. Sie werden nicht automatisch zwischen Geräten synchronisiert.

## 3. Backend-URL auch direkt konfigurieren

Du kannst die URL entweder über das Einstellungsfenster speichern oder im `config.js` beim Feld `apiEndpoint` eintragen. In beiden Fällen nur die öffentliche Worker-URL eintragen — **keinen API-Key**.

## 4. Dateien

```text
MARKO-PRO-MASAX-ULTRA/
├── index.html           # Website-Struktur
├── styles.css           # Design und Responsive Layout
├── app.js               # Chat, Demo-Modus, Werkzeuge und lokale Speicherung
├── config.js            # Öffentliche Frontend-Konfiguration ohne Geheimnisse
├── assets/
│   └── marko-icon.svg   # Marko-App-Icon
├── backend/
│   ├── worker.js        # Optionales KI-Backend
│   └── wrangler.toml    # Worker-Konfiguration
├── .gitignore
└── README.md
```

## Technologie

Vanilla HTML, CSS und JavaScript für das Frontend; Cloudflare Workers und OpenAI Responses API optional für echte KI-Antworten. Es sind keine Frontend-Pakete nötig.
