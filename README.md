# Locker

Locker bringt Speicherkarten sicher auf deine Platte. Steck die Karte ein, und Locker öffnet sich, zeigt, welche Clips noch nirgends gesichert sind, kopiert genau diese in den richtigen Shoot-Ordner und prüft jede Datei per Prüfsumme. Erst wenn alles stimmt, heißt es „Sicher zum Formatieren“.

Gebaut mit Tauri 2: Kern in Rust, Oberfläche in React + Tailwind. Läuft auf macOS und Windows.

## Starten

Einmalig installieren (siehe [Tauri-Voraussetzungen](https://tauri.app/start/prerequisites/)):

- **Mac:** Xcode Command Line Tools (`xcode-select --install`), Rust (`curl https://sh.rustup.rs -sSf | sh`), Node.js 20+
- **Windows:** Visual Studio Build Tools (C++), Rust (rustup), Node.js 20+

Dann im Projektordner:

```bash
npm install
npm run tauri dev      # App im Entwicklungsmodus starten
npm run tauri build    # installierbare App bauen (.dmg / .msi)
```

Nur die Oberfläche im Browser ansehen (Demo-Modus mit simulierter Karte, gut für Bildschirmaufnahmen):

```bash
npm run dev            # dann http://localhost:1420 öffnen
                       # ?card überspringt das Onboarding, ?card&fast kopiert schneller
```

Tests des Kopier-Kerns:

```bash
npm run test:core
```

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `core/` | Rust-Kern ohne UI: Karten erkennen, Clips scannen, Abgleich mit der Platte, Kopieren + Prüfen (xxHash3). Mit Tests. |
| `src-tauri/` | Die Tauri-App: Befehle für die Oberfläche, Karten-Wächter (alle 2 s), Tray-Icon, Auswerfen |
| `src/` | Oberfläche (React): `App.tsx` mit allen Screens, `api.ts` Brücke zu Rust plus Demo-Modus |

## Sicherheitsregeln im Code

- Die Karte wird nur gelesen, nie beschrieben.
- Am Ziel wird nie eine Datei überschrieben. Bei gleichem Namen und anderem Inhalt wird `_1`, `_2` … angehängt.
- Kopiert wird erst in eine `.locker-part`-Datei, die nach dem vollständigen Schreiben umbenannt wird.
- Nach dem Kopieren wird jede Datei neu gelesen und mit der Prüfsumme der Karte verglichen. Stimmt sie nicht, wird die kaputte Kopie gelöscht und als Fehler gemeldet.

## Nächste Runden

- Freien Speicherplatz vor dem Start prüfen
- Zweites Ziel (Backup-Platte) gleichzeitig
- Bericht als PDF/CSV
- Signierte Builds per GitHub Actions für Mac und Windows
