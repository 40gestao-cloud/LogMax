#!/bin/bash
# Apaga deploys antigos dos projetos Vercel, preservando a producao.
#
# Por que existe: cada push deploya os 4 projetos LogMax, ~14 MB de dist
# cada um. Sao 56 MB por push, e em 2026-09-09 isso tinha acumulado 15,27 GB
# nos 4 projetos -- 99,2% da cota de 10 GB da conta, que ja estava estourada.
# Apagar deploy antigo e a unica saida, porque o tamanho do build nao muda.
#
# Uso:
#   bash scripts/vercel-purge-deploys.sh                 # todos os projetos
#   bash scripts/vercel-purge-deploys.sh logmax-erp ...  # so os listados
#
# Precisa do CLI da Vercel logado (`vercel whoami`). Nao usa token em arquivo.

set -u

PROJETOS_PADRAO=(
  logmax-erp logmax-adm logmax-aprendiz logmax-contabilidade
  maxid pontomax playmax portalmax portalmax-hub-senac
  maxaix maxescolar maxdecision catrivision
)

if [ $# -gt 0 ]; then
  PROJETOS=("$@")
else
  PROJETOS=("${PROJETOS_PADRAO[@]}")
fi

if ! vercel whoami --no-color > /dev/null 2>&1; then
  echo "ERRO: CLI da Vercel nao esta logado. Rode 'vercel login' e tente de novo."
  exit 1
fi

# --safe protege deploy com alias ativo. Deploy em Building/Queued AINDA NAO
# TEM alias -- se o purge rodar durante um build, ele apaga a producao que esta
# nascendo. Por isso todo projeto e checado antes, e pulado se houver build em
# andamento; na semana seguinte ele entra de novo.
tem_build_em_andamento() {
  vercel ls "$1" --no-color 2>&1 | grep -qE '● (Building|Queued|Initializing)'
}

purgar() {
  local p="$1" total=0 prev="" urls sig saida n

  if tem_build_em_andamento "$p"; then
    echo "$p: PULADO (build em andamento; deploy sem alias nao e protegido pelo --safe)"
    return 0
  fi

  while :; do
    urls=$(vercel ls "$p" --no-color 2>&1 \
      | grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)*-igor-s-projects3\.vercel\.app' \
      | sort -u)
    [ -z "$urls" ] && { echo "$p: nada a apagar"; return 0; }

    # A lista para de mudar quando so restam os protegidos por alias: e o fim.
    sig=$(echo "$urls" | md5sum)
    if [ "$sig" = "$prev" ]; then
      echo "$p: $total apagados (restam $(echo "$urls" | wc -l) com alias)"
      return 0
    fi
    prev="$sig"

    # O total conta o que o CLI diz ter removido, nao o que foi enviado: o
    # --safe recusa os que tem alias, e somar a lista enviada faria o log
    # anunciar como apagado justamente o deploy de producao que ele preservou.
    saida=$(vercel remove $urls --safe --yes --no-color 2>&1)
    n=$(echo "$saida" | grep -oE 'Removed ([0-9]+) deployment' | grep -oE '[0-9]+' | head -1)
    total=$((total + ${n:-0}))
  done
}

echo "== Limpeza de deploys Vercel -- $(date '+%Y-%m-%d %H:%M') =="
for p in "${PROJETOS[@]}"; do
  purgar "$p"
done
echo "== Fim =="
