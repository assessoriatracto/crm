#!/usr/bin/env bash
# Gera uma migração com o schema completo (ele é idempotente). A integração do Supabase com o GitHub
# aplica as migrações novas no banco de produção a cada push na main.
set -euo pipefail
cd "$(dirname "$0")/.."
last="$(ls supabase/migrations/*.sql 2>/dev/null | tail -1 || true)"
if [ -n "$last" ] && cmp -s supabase/schema.sql "$last"; then echo "schema sem mudanças"; exit 0; fi
f="supabase/migrations/$(date -u +%Y%m%d%H%M%S)_tracto_schema.sql"
cp supabase/schema.sql "$f"
echo "migração criada: $f"
