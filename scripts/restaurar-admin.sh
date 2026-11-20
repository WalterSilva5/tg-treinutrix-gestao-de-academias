#!/usr/bin/env bash
# Restaura o administrador padrão (API local ou SQLite direto).
set -e
cd "$(dirname "$0")/.."
exec node scripts/restaurar-admin.js "$@"
