#!/usr/bin/env bash
# dump-baseline.sh
# Gera o baseline consolidado do schema atual do LogMax a partir do projeto
# de referencia (logmax-erp). Ver docs/setup-nova-turma.md.
#
# Requisitos:
#   - pg_dump 15+ no PATH
#   - PGPASSWORD exportado, ou senha embutida na URL
#   - connection string do Supabase de referencia
#
# Uso:
#   export PGPASSWORD="sua-senha-do-postgres"
#   ./scripts/dump-baseline.sh "postgresql://postgres.<ref>:...@aws-...supabase.com:6543/postgres"
#
# Output:
#   supabase/baseline_YYYYMMDD.sql

set -euo pipefail

DB_URL="${1:-}"
OUT_DIR="${OUT_DIR:-supabase}"

if [[ -z "$DB_URL" ]]; then
  echo "Uso: $0 <db_url>" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump nao encontrado no PATH. Instale Postgres client tools 15+." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

DATE=$(date +%Y%m%d)
OUT_FILE="$OUT_DIR/baseline_${DATE}.sql"

echo "Gerando baseline em $OUT_FILE ..."

# --schema=public: pula auth/storage/realtime (Supabase provisiona).
# --no-owner + --no-privileges: baseline portavel entre projetos.
pg_dump \
  --schema=public \
  --schema-only \
  --no-owner \
  --no-privileges \
  --no-comments \
  --file="$OUT_FILE" \
  "$DB_URL"

echo ""
echo "Baseline gerado: $OUT_FILE"
echo ""
echo "Proximos passos:"
echo "  1. Rode $OUT_FILE no SQL Editor do novo projeto Supabase"
echo "  2. Rode scripts/setup-buckets.sql para criar os storage buckets"
echo "  3. Edite e rode supabase/migrations/20260516_seed_admin_master.sql"
echo "  4. Detalhes: docs/setup-nova-turma.md"
