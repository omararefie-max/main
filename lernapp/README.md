# Lernapp – Prüfungsvorbereitung (PWA, 100 % lokal)

Karteikarten-Quiz (Spaced Repetition), auditives Lernen (Freihändig + Hörmodus) und mündliche Prüfungssimulation.
Keine Cloud, kein Account. Alle Daten liegen in IndexedDB auf deinem Handy. Die App sperrt per Content-Security-Policy alle fremden Verbindungen.

## 1. Architekturentscheidung: PWA (für Android/Chrome ausreichend)
- Reines HTML/CSS/JS (ES-Module), kein Build, kein Framework → du kannst alles direkt bearbeiten.
- Service Worker = offline; IndexedDB = lokale Daten; Web Speech API = Sprachausgabe/-erkennung.
- **Grenzen einer PWA (ehrlich):**
  - Chrome/Android schickt die Spracherkennung standardmäßig an Google. Offline nur mit installiertem deutschen Sprachpaket (Einstellungen → „Nur lokale Erkennung“). Falls das auf deinem Gerät nicht geht: Texteingabe in der Prüfung, Hörmodus funktioniert ohne Erkennung.
  - Bei gesperrtem Bildschirm pausiert Android Web-Apps oft. Wake-Lock + Medien-Sitzung helfen teilweise. Tipp: Bildschirm nur dimmen/Display-Timeout lang stellen.
  - **Zuverlässige Alternative:** dieselbe App mit Capacitor als Android-App verpacken (Hintergrund-Audio, Offline-Spracherkennung per Plugin). Der Code bleibt weitgehend unverändert.

## 2. Datenmodelle
- **Karte:** `id, subject, topic, chapter, question, answers[5], correct[0-based], explanation, difficulty, tags`
- **Prüfungsfrage:** `id, subject, topic, chapter, question, modelAnswer, keyPoints[{text, keywords[], min, weight}], followUps[], tags`
- **Lernfortschritt (je Karte, getrennt gespeichert):** `cardId, ease, interval, reps, lapses, due, seen, correct, lastCorrect`
- Dokumentiert in `data/schema.json`; Beispiele in `data/beispiel-inhalte.json` (3 Karten + 3 Prüfungsfragen, Medizin/Pflege – **fachlich nicht geprüft**, nur Formatdemo).
- Re-Import: gleiche `id` → Karte wird aktualisiert, Fortschritt bleibt. **IDs nie ändern.**
- Inhalte mit KI erstellen: `data/ki-prompt.txt` an eine KI geben, Material einfügen, JSON-Ergebnis in der App importieren.

## 3. Installation auf dem Android-Handy (kein Cloud-Speicher deiner Daten)
Nur der **App-Code** (ohne deine Inhalte) muss einmal über HTTPS ausgeliefert werden, weil PWAs HTTPS brauchen. Deine Lerndaten verlassen das Handy nie.

**Variante A – GitHub Pages (empfohlen, kostenlos)**
1. Auf github.com ein neues **öffentliches** Repository anlegen (enthält nur den App-Code, keine Lerninhalte).
2. Den Inhalt dieses Ordners hochladen („Add file → Upload files“).
3. Settings → Pages → Branch `main`, Ordner `/ (root)` → Speichern.
4. Nach ca. 1 Minute: `https://<name>.github.io/<repo>/` am Handy in Chrome öffnen.
5. Chrome-Menü (⋮) → **„App installieren“ / „Zum Startbildschirm“**.
6. Einmal online öffnen, danach funktioniert alles offline.
(Alternativen: Netlify Drop, Cloudflare Pages – Ordner hochladen genügt.)

**Variante B – nur im Heimnetz:** `python3 -m http.server 8000` am PC; am Handy `http://<PC-IP>:8000` – PWA-Installation/Service Worker gehen aber nur über HTTPS oder localhost, daher nur zum Ausprobieren.

**Updates:** Dateien ändern, in `sw.js` `CACHE_VERSION` erhöhen, neu hochladen. Die App lädt die neue Version beim nächsten Start.

## 4. Benutzung
1. **Inhalte → Beispieldaten laden** oder eigene JSON/CSV importieren (Datei oder Text einfügen).
2. **Lernen:** Modus wählen (Alle/Schwache/Neue/Prüfungsmodus), Fach/Thema/Kapitel filtern.
3. **Hören:** *Freihändig* – sag „A“, „Antwort C“, „B und D“, „wiederholen“, „weiter“, „stopp“. *Hörmodus* – Frage, Denkpause, Lösung + Erklärung am Stück.
4. **Prüfung:** Anzahl Fragen/Dauer einstellen, sprechen, danach „Antwort beenden“ tippen. Bei Lücken folgt eine Nachfrage. Protokoll wird gespeichert (Statistik → Verlauf).
5. **Backup:** Inhalte → „Alles sichern“ regelmäßig ausführen (Browserdaten können gelöscht werden!).

## 5. Bewertung der mündlichen Antworten
Lokal über Pflichtpunkte: ein Punkt zählt als genannt, wenn mindestens `min` seiner Schlüsselbegriffe vorkommen (tolerant bei Groß/Klein, Umlauten, Wortstämmen, kleinen Erkennungsfehlern). Note nach Skala 90/80/65/50 %. Das kann Synonyme übersehen – Schlüsselbegriffe großzügig mit Synonymen anlegen.
Optionale KI-Anbindung: `js/ai-hook.js` (standardmäßig aus; dann CSP in `index.html` erweitern).

## 6. Code-Struktur
`js/db.js` IndexedDB · `js/store.js` Zustand/Backup · `js/srs.js` Spaced Repetition (SM-2) · `js/importer.js` JSON/CSV ·
`js/score.js` Bewertung · `js/speech.js` TTS/STT/Wake-Lock · `js/views/*` Bildschirme · `sw.js` Offline · `css/app.css` Design.
