# Spiele

Punktezähler für Spieleabende, optimiert fürs Handy. Enthalten sind:

- **UNO** – auf 300, wer am wenigsten Punkte hat, gewinnt
- **10'000erlen** – Würfelspiel mit 6 Würfeln, wer zuerst 10'000 hat, gewinnt
- **Sterbslen** – Würfelspiel mit 6 Würfeln rund um die 30, wer übrig bleibt, gewinnt

Läuft komplett im Browser: Alle Daten liegen im `localStorage`, es gibt kein Backend
und keine Datenbank. Jedes Spiel hat seinen eigenen Spielstand. Die Spieler werden
zwischen den Spielen übernommen.

## Starten

```sh
docker compose up -d --build
```

Danach im Browser `http://<rechner-ip>:8080` öffnen und am besten über
„Zum Home-Bildschirm hinzufügen“ als App speichern.

## In der App

- Die Spielerliste ist die Sitzordnung **gegen den Uhrzeigersinn**. Mit 🃏 bzw. 🎲 wird festgelegt,
  wer mischt oder beginnt.
- Zu jedem Spiel gibt es eine **Anleitung**: auf der Startseite und im Menü des Spiels.
- Jedes Spiel hat einen Verlauf, kann den letzten Zug bzw. die letzte Runde zurücknehmen und erlaubt Korrekturen.
- Bei den Würfelspielen wird nur ein Protokoll der Züge gespeichert. Der Stand wird daraus
  nachgerechnet, damit Änderungen an früheren Zügen automatisch auf alles Spätere wirken.
- Hinweis: Die Daten gehören zu diesem Browser auf diesem Gerät.

## Aufbau

```
public/
  index.html, style.css, sw.js, manifest.webmanifest, icon.svg
  js/main.js          Einstieg, meldet die Spiele an
  js/core.js          Speicher, UI-Bausteine, Modale, Startseite, Anleitungen, Events
  js/uno.js           UNO
  js/zehntausend.js   10'000erlen
  js/sterbslen.js     Sterbslen
```
