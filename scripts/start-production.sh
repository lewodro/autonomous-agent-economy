#!/bin/sh
set -eu
mkdir -p "$MATCHES_DIR"
chown node:node "$MATCHES_DIR"
exec runuser -u node -- node server.js
