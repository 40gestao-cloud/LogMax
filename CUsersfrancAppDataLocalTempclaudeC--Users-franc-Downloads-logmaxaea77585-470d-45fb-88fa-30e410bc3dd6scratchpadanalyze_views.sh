#!/bin/bash

# Encontra todas as views com FilialSelector
mapfile -t views < <(grep -l "FilialSelector" src/views/*.tsx | sort)

echo "=== ANÁLISE DE FILIAL EM VIEWS ==="
echo "Total de views com FilialSelector: ${#views[@]}"
echo ""

# Para cada view, verifica:
# 1. Se tem useState com filial
# 2. Se useFetchData recebe filial como extraFilter

correct_filter=()
missing_filter=()
no_state=()

for view in "${views[@]}"; do
    viewname=$(basename "$view" .tsx)
    
    # Verifica se tem useState com filial
    has_filial_state=$(grep -c "useState.*filial" "$view")
    
    # Verifica se useFetchData tem extraFilter com filial
    # Padrões a procurar: extraFilter.*filial ou filial.*extraFilter
    has_filter=$(grep -c "useFetchData.*filial\|extraFilter.*filial" "$view")
    
    if [ "$has_filial_state" -gt 0 ]; then
        if [ "$has_filter" -gt 0 ]; then
            correct_filter+=("$viewname")
        else
            missing_filter+=("$viewname")
        fi
    else
        no_state+=("$viewname")
    fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ FILTRAM CORRETAMENTE (${#correct_filter[@]}):"
printf '%s\n' "${correct_filter[@]}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✗ TÊM ESTADO MAS NÃO FILTRAM (${#missing_filter[@]}):"
printf '%s\n' "${missing_filter[@]}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "? SEM ESTADO FILIAL (${#no_state[@]}):"
printf '%s\n' "${no_state[@]}"
