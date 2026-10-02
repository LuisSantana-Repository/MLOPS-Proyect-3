#!/bin/sh
set -e

node docker/wait-for.mjs "${DB_HOST}" "${DB_PORT}"

if [ "${STORAGE_PROVIDER:-minio}" = "minio" ]; then
  node docker/wait-for.mjs "${MINIO_ENDPOINT}" "${MINIO_PORT}"
fi

echo "[entrypoint] Aplicando migraciones..."
npm run db:migrate:runtime

echo "[entrypoint] Sembrando datos de ejemplo..."
npm run db:seed

echo "[entrypoint] Arrancando servidor..."
exec node dist/ui/server.js
