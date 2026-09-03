# Seitendiff-Wächter

Automatischer Webseitenänderungs-Wächter, der per GitHub Actions läuft. Kein externer Dienst, keine bezahlte API, kein eigener Server.

## Was es tut

- Ruft regelmäßig (alle 6 Stunden, oder manuell) öffentliche Webseiten ab.
- Extrahiert nur den per CSS-Selektor bestimmten Ausschnitt.
- Normalisiert den Text (Kommentare und Whitespace) und vergleicht mit dem letzten Stand.
- Bei Änderung:
  - Neuer Eintrag im Atom-Feed `feed.xml` (mit Diff als Text).
  - GitHub-Issue wird angelegt. GitHub verschickt die Benachrichtigungs-Mail.
  - Neuer Zustand wird ins Repo committed.
- Bei Netz- oder HTTP-Fehler: **kein Alarm**, nur Fehlerprotokoll.

## Einrichtung

1. Dieses Verzeichnis als neues GitHub-Repository anlegen (öffentlich oder privat).
2. `watch.config.json` anpassen (siehe Struktur unten).
3. Das Label `seitendiff` in den Repo-Einstellungen unter Issues → Labels anlegen (optional, der Workflow fährt auch ohne fort).
4. Unter *Settings → Actions → General* sicherstellen, dass der Workflow Lese- und Schreibrechte hat (*Read and write permissions*).
5. Den Workflow unter *Actions → Seitendiff-Wächter → Run workflow* einmal manuell starten.

## watch.config.json

```json
[
  {
    "id":       "meine-seite",
    "url":      "https://example.com/news",
    "selector": "main",
    "ignore":   ["nav", ".werbung"],
    "label":    "Meine Seite – News"
  }
]
```

| Feld       | Pflicht | Bedeutung |
|------------|---------|-----------|
| `id`       | ja      | Eindeutiger Bezeichner (Dateiname-sicher, keine Leerzeichen) |
| `url`      | ja      | Öffentliche URL |
| `selector` | nein    | CSS-Selektor (vereinfacht, s. u.). Leer = ganzer Body |
| `ignore`   | nein    | Array von Selektoren, die vor dem Vergleich entfernt werden |
| `label`    | ja      | Menschenlesbare Beschreibung (erscheint im Issue-Titel) |

## Selektor-Unterstützung (Grenzen)

Der Wächter verwendet **keinen vollständigen HTML-Parser**. Unterstützt werden:

- Einfache Tag-Namen: `main`, `article`, `div`
- ID-Selektoren: `#inhalt`
- Klassen-Selektoren: `.news`
- Kombinationen: `div.news`, `section#haupt`

**Nicht unterstützt:** Descendant-Selektoren (`div > p`), Pseudoklassen (`:first-child`), Attribut-Selektoren (`[data-x]`). Bei nicht unterstützten Selektoren wird der gesamte Body verglichen und eine Warnung ausgegeben.

## Datei-Struktur

```
watch.config.json        Konfiguration
scripts/watch.mjs        Haupt-Skript
scripts/feed.mjs         Atom-Feed-Generator
.github/workflows/       GitHub Actions Workflow
state/<id>.txt           Letzter normalisierter Text je Wächter
state/<id>.json          SHA-256, Zeitstempel, HTTP-Status
out/<id>.diff            Letzter Diff je Wächter (max. 80 Zeilen)
feed.xml                 Atom-Feed (max. 50 Einträge)
test/                    Selbsttests (laufen ohne Netz)
```

## Lokaler Test

```bash
node test/rot-gruen.mjs
```

## Grenzen

- Seiten hinter Login oder CAPTCHA können nicht abgerufen werden.
- JavaScript-gerenderter Inhalt (Single-Page-Apps) wird nicht ausgeführt — nur das rohe HTML wird verglichen.
- Der Diff ist einfach (zeilenbasiert, kein LCS-Algorithmus) — bei großen Umformatierungen wirkt er unübersichtlich.
- Der Feed wächst bis 50 Einträge, ältere werden verworfen.
- GitHub Actions Cron-Jobs können bei inaktiven Repos nach 60 Tagen ohne Commit deaktiviert werden (manuell wieder aktivieren).
- Manche GitHub-gehostete Runner-IPs sind bei einigen Webseiten geblockt.
