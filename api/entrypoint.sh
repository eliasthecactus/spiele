#!/bin/sh
# Der Datenordner ist meist ein Bind-Mount, der root gehört: Rechte richten, dann ohne root starten.
# Lassen sich die Rechte nicht ändern (z.B. bei Netzlaufwerken), läuft der Server eben als root.
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$DATA_DIR"
  if chown -R node:node "$DATA_DIR" 2>/dev/null; then
    exec su-exec node "$@"
  fi
  echo "Hinweis: Rechte für $DATA_DIR liessen sich nicht ändern, Server läuft als root."
fi
exec "$@"
