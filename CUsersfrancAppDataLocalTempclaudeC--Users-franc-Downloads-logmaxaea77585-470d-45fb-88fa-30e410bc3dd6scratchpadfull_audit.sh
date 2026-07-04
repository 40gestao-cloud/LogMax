#!/bin/bash

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         AUDITORIA COMPLETA DE FILIAL - LOGMAX ERP              ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# ─── PARTE 1: TABELAS COM COLUNA FILIAL ───────────────────────────────

echo "═══ PARTE 1: TABELAS COM COLUNA FILIAL ═══"
echo ""

declare -A tables_with_filial

# Procura em todas as migrações
while IFS= read -r line; do
  if [[ $line =~ ADD\ COLUMN.*filial|ALTER\ TABLE.*filial ]]; then
    # Extrai nome da tabela: ALTER TABLE public.TABLENAME ou ALTER TABLE TABLENAME
    table=$(echo "$line" | sed -E 's/.*ALTER TABLE +(public\.)?([^ ]+).*/\2/')
    tables_with_filial["$table"]=1
  fi
done < <(grep -h "ALTER TABLE.*ADD COLUMN.*filial\|ALTER TABLE.*filial" supabase/migrations/*.sql | sort -u)

# Também procura CREATE TABLE com filial
while IFS= read -r file; do
  # Extrai blocos CREATE TABLE ... (
  grep -oP 'CREATE TABLE \K[^ (]+' "$file" | while read -r tbl; do
    # Verifica se este arquivo contém filial para esta tabela
    if grep -q "^CREATE TABLE.*$tbl\|^ALTER TABLE.*$tbl" "$file" && grep "filial" "$file" | grep -q "$tbl"; then
      tables_with_filial["$tbl"]=1
    fi
  done
done < <(grep -l "filial" supabase/migrations/*.sql)

echo "Tabelas com coluna filial (${#tables_with_filial[@]} tabelas):"
for tbl in $(printf '%s\n' "${!tables_with_filial[@]}" | sort); do
  echo "  • $tbl"
done

echo ""
echo "═══ PARTE 2: VIEWS COM FILIALSELECTO ═══"
echo ""

# ─── PARTE 2: ANÁLISE POR CATEGORIA ───────────────────────────────────

correct_filter=()
missing_filter=()
prop_based=()

mapfile -t views < <(grep -l "FilialSelector" src/views/*.tsx | sort)

for view in "${views[@]}"; do
    viewname=$(basename "$view" .tsx)
    
    # Verifica useState com filial
    has_state=$(grep -c "useState.*filial" "$view")
    
    # Verifica se tem filial como parâmetro de função (prop)
    has_prop=$(grep -c "filial.*FilialOp\|filial:.*FilialOp\|filial.*string" "$view" | head -1)
    
    # Verifica se passam filial ao useFetchData via extraFilter ou direto
    has_filter=$(grep -c "useFetchData.*filial\|extraFilter.*filial\|\{ filial" "$view")
    
    if [ "$has_state" -gt 0 ] && [ "$has_filter" -gt 0 ]; then
        correct_filter+=("$viewname")
    elif [ "$has_state" -gt 0 ] && [ "$has_filter" -eq 0 ]; then
        missing_filter+=("$viewname")
    elif [ "$has_prop" -gt 0 ] && [ "$has_filter" -gt 0 ]; then
        prop_based+=("$viewname")
    fi
done

echo "A) FILTRAM CORRETAMENTE (${#correct_filter[@]}):"
echo "   Views com useState e passam filial ao useFetchData:"
if [ ${#correct_filter[@]} -gt 0 ]; then
  printf '   • %s\n' "${correct_filter[@]}"
else
  echo "   (nenhuma)"
fi

echo ""
echo "B) COM ESTADO MAS NÃO FILTRAM (${#missing_filter[@]}) - CRÍTICO:"
echo "   Views que criam filial state mas NOT passam ao useFetchData:"
if [ ${#missing_filter[@]} -gt 0 ]; then
  printf '   • %s\n' "${missing_filter[@]}"
else
  echo "   (nenhuma)"
fi

echo ""
echo "C) BASEADAS EM PROP (${#prop_based[@]}) - CORRETO:"
echo "   Views recebem filial como prop da wrapper e passam ao useFetchData:"
if [ ${#prop_based[@]} -gt 0 ]; then
  printf '   • %s\n' "${prop_based[@]}" | head -10
  if [ ${#prop_based[@]} -gt 10 ]; then
    echo "   ... e mais $((${#prop_based[@]} - 10))"
  fi
else
  echo "   (nenhuma)"
fi

echo ""
echo "═══ PARTE 3: TABELAS OPERACIONAIS SEM FILIAL ═══"
echo ""

# Lista de tabelas que DEVERIAM ter filial
operacional_tables=(
  "tarefas"
  "pesquisas"
  "avaliacoes"
  "ti_chamados"
  "treinamentos"
  "marketing_calendario"
  "marketing_artes"
  "marketing_promocoes"
  "marketing_campanhas"
  "marketing_cupons"
  "caixa"
  "ponto"
  "ponto_relogio"
)

echo "Verificando se tabelas operacionais têm filial:"
for tbl in "${operacional_tables[@]}"; do
  if grep -q "ADD COLUMN.*$tbl.*filial\|ALTER TABLE.*$tbl.*\sfilial" supabase/migrations/*.sql 2>/dev/null; then
    echo "  ✓ $tbl — tem filial"
  else
    # Verifica se tabela existe mas sem filial
    if grep -q "CREATE TABLE.*$tbl\|ALTER TABLE.*$tbl" supabase/migrations/*.sql 2>/dev/null; then
      echo "  ✗ $tbl — FALTA COLUNA FILIAL"
    fi
  fi
done

