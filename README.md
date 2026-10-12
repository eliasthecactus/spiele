# UNO Punkte

Punktezähler für UNO auf 300, optimiert fürs Handy. Läuft komplett im Browser:
Alle Daten liegen im `localStorage`, es gibt kein Backend und keine Datenbank.

## Starten

```sh
docker compose up -d --build
```

Danach im Browser `http://<rechner-ip>:8080` öffnen und am besten über
„Zum Home-Bildschirm hinzufügen“ als App speichern.

## Regeln in der App

- 2–10 Spieler, Liste = Sitzordnung **gegen den Uhrzeigersinn**.
- Das Mischen wandert nach jeder Runde zur nächsten Person nach dem letzten Mischer.
- Wer am Schluss am wenigsten Punkte hat, gewinnt.
- Sobald jemand **über** dem Ziel ist (Standard 300), fragt die App: ausspielen oder fertig.
- Hinweis: Die Daten gehören zu diesem Browser auf diesem Gerät.
