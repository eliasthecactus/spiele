#!/bin/sh
# Der Datenordner ist meist ein Bind-Mount, der root gehört: Rechte richten, dann ohne root starten.
set -e
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node "$@"
fi
exec "$@"
