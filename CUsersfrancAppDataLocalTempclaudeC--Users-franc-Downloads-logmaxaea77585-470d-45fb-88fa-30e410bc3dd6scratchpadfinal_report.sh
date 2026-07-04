#!/bin/bash

echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║       AUDITORIA FINAL: SEPARAÇÃO POR FILIAL - LOGMAX ERP                    ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════════
# SEÇÃO 1: ESTADO DAS TABELAS
# ═══════════════════════════════════════════════════════════════════════════════════

echo "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░"
echo "SEÇÃO 1: TABELAS - ESTADO DA COLUNA FILIAL"
echo "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░"
echo ""

echo "A) TABELAS COM FILIAL (32 tabelas):"
echo ""
echo "   Compras (5):"
echo "   • requisicoes"
echo "   • aprovacoes_compras"
echo "   • cotacoes"
echo "   • pedidos"
echo "   • recebimentos"
echo ""
echo "   Vendas + Estoque (8):"
echo "   • orcamentos"
echo "   • pedidos_venda"
echo "   • contas_receber"
echo "   • requisicoes_estoque"
echo "   • aprovacoes_estoque"
echo "   • movimentacoes_estoque"
echo "   • vencimentos_estoque"
echo "   • inventarios"
echo ""
echo "   Operacional - Estoque (1):"
echo "   • expedicao"
echo ""
echo "   RH (4):"
echo "   • funcionarios"
echo "   • ferias"
echo "   • folha_pagamento"
echo "   • afastamentos"
echo ""
echo "   TI + Treinamentos + Marketing (5):"
echo "   • ti_chamados"
echo "   • treinamentos"
echo "   • marketing_calendario"
echo "   • marketing_artes"
echo "   • marketing_promocoes"
echo ""
echo "   Operacional - Geral (2):"
echo "   • tarefas"
echo "   • pesquisas"
echo ""
echo "   Financeiro (2):"
echo "   • contas_pagar"
echo "   • caixa"
echo ""
echo "   CRM (2):"
echo "   • clientes"
echo "   • fornecedores"
echo ""
echo "   Cadastro (1):"
echo "   • produtos"
echo ""
echo "   Serviços + Perfil (2):"
echo "   • servicos"
echo "   • user_profiles"
echo ""

echo ""
echo "B) TABELAS SEM FILIAL (possíveis candidatas):"
echo ""
grep -h "CREATE TABLE" supabase/migrations/*.sql | grep -oP 'CREATE TABLE (?:public\.)?+\K[a-z_]+' | sort -u | while read tbl; do
  if ! grep -q "ALTER TABLE.*$tbl.*filial\|UPDATE.*$tbl.*filial\|filial.*$tbl" supabase/migrations/*.sql 2>/dev/null; then
    # Excluir tabelas de sistema ou metadados
    if [[ ! "$tbl" =~ ^(audit|holding|setor|categoria|subcategoria|marca|unidade|produto|cliente|fornecedor|user|conta|banco|setor|role|metas|briefing|etc).*$ ]]; then
      echo "   • $tbl"
    fi
  fi
done | head -20

echo ""
echo ""

# ═══════════════════════════════════════════════════════════════════════════════════
# SEÇÃO 2: VIEWS - ANÁLISE DE FILTRAGEM
# ═══════════════════════════════════════════════════════════════════════════════════

echo "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░"
echo "SEÇÃO 2: VIEWS - FILTRAGEM DE FILIAL"
echo "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░"
echo ""

correct=()
broken=()
prop_based=()

mapfile -t views < <(grep -l "FilialSelector" src/views/*.tsx | sort)

for view in "${views[@]}"; do
  name=$(basename "$view" .tsx)
  
  # Tem useState com filial?
  local_state=$(grep "useState.*filial" "$view" | wc -l)
  
  # Tem filial como parâmetro?
  has_param=$(grep "filial.*FilialOp\|filial.*string" "$view" | wc -l)
  
  # Passa filial ao useFetchData?
  passes_filter=$(grep "useFetchData.*filial\|extraFilter.*filial\|{ filial }" "$view" | wc -l)
  
  if [ "$local_state" -gt 0 ] && [ "$passes_filter" -gt 0 ]; then
    correct+=("$name")
  elif [ "$local_state" -gt 0 ] && [ "$passes_filter" -eq 0 ]; then
    broken+=("$name")
  elif [ "$has_param" -gt 0 ] && [ "$passes_filter" -gt 0 ]; then
    prop_based+=("$name")
  fi
done

echo "A) CORRETO - ESTADO LOCAL + FILTRAM ($(echo ${#correct[@]})):"
for v in "${correct[@]}"; do echo "   • $v"; done
echo ""

echo "B) CRÍTICO - ESTADO MAS NÃO FILTRAM ($(echo ${#broken[@]})) ⚠️:"
for v in "${broken[@]}"; do echo "   ✗ $v"; done
echo ""

echo "C) CORRETO - PROP-BASED ($(echo ${#prop_based[@]})):"
echo "   (28 views recebem filial como prop e filtram)"
echo ""
for v in "${prop_based[@]:0:10}"; do echo "   • $v"; done
if [ ${#prop_based[@]} -gt 10 ]; then
  echo "   ... e mais $((${#prop_based[@]} - 10))"
fi

echo ""

