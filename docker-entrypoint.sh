#!/bin/sh
set -eu

data_dir="${WATCHSWEEPERR_DATA_DIR:-/app/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data_dir"
  chown -R node:node "$data_dir"
  exec su-exec node:node "$@"
fi

exec "$@"
