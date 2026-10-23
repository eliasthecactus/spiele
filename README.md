# Spiele

Punktezähler für Spieleabende, optimiert fürs Handy. Enthalten sind:

- **UNO** – auf 300, wer am wenigsten Punkte hat, gewinnt
- **10'000erlen** – Würfelspiel mit 6 Würfeln, wer zuerst 10'000 hat, gewinnt
- **Sterbslen** – Würfelspiel mit 6 Würfeln rund um die 30, wer übrig bleibt, gewinnt

Dazu eine **Statistik** über alle fertigen Spiele und ein freiwilliger **Online-Modus**.

## Starten

```sh
SECRET=$(openssl rand -hex 32) APP_URL=https://spiele.example.ch docker compose up -d --build
```

Ein Image, ein Container: Node liefert die App aus und beantwortet alles unter `/api`.

| Variable   | Bedeutung |
|------------|-----------|
| `APP_URL`  | Öffentliche Adresse der App. Passkeys gelten nur für diese Domain und brauchen https (ausser `localhost`). |
| `SECRET`   | Langer Zufallswert zum Signieren der Anmeldungen. Ändert er sich, sind alle abgemeldet. |
| `PORT`     | Port im Container, Standard `3000`. |
| `DATA_DIR` | Ordner für die Datenbank, im Container `/data`. |

Die Datenbank (`spiele.db`, SQLite) liegt in `/data`. In `docker-compose.yml` ist dafür
`./container/spiele/data` eingebunden, damit die Daten Neustarts und Updates überleben.

Ohne https funktioniert die App wie bisher, nur der Online-Modus ist dann nicht verfügbar.

## In der App

- Die Spielerliste ist die Sitzordnung **gegen den Uhrzeigersinn**. Mit 🃏 bzw. 🎲 wird festgelegt,
  wer mischt oder beginnt.
- Zu jedem Spiel gibt es eine **Anleitung**: auf der Startseite und im Menü des Spiels.
- Jedes Spiel hat einen Verlauf, kann den letzten Zug bzw. die letzte Runde zurücknehmen und erlaubt Korrekturen.
- Bei den Würfelspielen wird nur ein Protokoll der Züge gespeichert. Der Stand wird daraus
  nachgerechnet, damit Änderungen an früheren Zügen automatisch auf alles Spätere wirken.

### Statistik

Jedes fertige Spiel wird mit seiner Rangliste festgehalten (bei 10'000erlen, sobald jemand gewonnen hat).
Wird ein Spiel wieder geöffnet (Weiterspielen, ↶), wird der Eintrag nachgeführt bzw. herausgenommen.

- Rangliste mit Siegen, Quote und Ø Platz, filterbar nach Spiel und **Gruppe** (genau diese Mitspieler)
- pro Spieler: Auswertung je Spiel und **Duelle** gegen jeden anderen
- Rekorde je Spiel und eine Liste aller Spiele, einzelne lassen sich löschen

Spieler werden über ihren Namen erkannt (Gross-/Kleinschreibung egal).

### Online-Modus

Freiwillig. Ohne Anmeldung bleibt alles auf dem Gerät, genau wie bisher.

- Anmelden nur mit **Passkey**: kein Name, keine E-Mail, kein Passwort, kein sichtbares Profil.
- Mit Konto wird die Statistik mit dem Server abgeglichen und ist auf allen Geräten dieselbe.
  Spiele, die schon auf dem Gerät waren, kommen beim Anmelden mit ins Konto.
- Beim Abmelden verschwindet die Statistik vom Gerät und ist nach dem nächsten Anmelden wieder da.
- **Konto löschen** verlangt nochmals den Passkey und entfernt das Konto mit allen Daten.
- Laufende Spielstände bleiben immer auf dem Gerät.

## Entwickeln

```sh
cd api
npm install
npm run dev     # http://localhost:3000, liefert ../frontend aus
npm test        # Ende-zu-Ende-Test der Schnittstelle mit nachgebautem Passkey
```

## Aufbau

```
frontend/             die App (ohne Build-Schritt)
  index.html, style.css, sw.js, manifest.webmanifest, icon.svg
  js/main.js          Einstieg, meldet Spiele und Seiten an
  js/core.js          Speicher, UI-Bausteine, Modale, Startseite, Anleitungen, Events
  js/uno.js           UNO
  js/zehntausend.js   10'000erlen
  js/sterbslen.js     Sterbslen
  js/stats.js         Statistik: Spiele festhalten und auswerten
  js/account.js       Online-Modus: Passkey-Anmeldung und Abgleich
  js/webauthn.js      Passkeys im Browser
api/                  Server (Node, SQLite)
  src/server.js       liefert frontend/ aus, Schnittstelle unter /api
  src/auth.js         Passkeys und Sitzungen
  src/db.js           Datenbank
  test/               Tests
```
