#!/usr/bin/env bash
# Ignored Build Step da Vercel (chamado por `ignoreCommand` no vercel.json).
#
# Convenção da Vercel, ao contrário do que o nome sugere:
#   exit 0 → IGNORA o build (não publica nada)
#   exit 1 → SEGUE com o build
#
# Por que existe: são QUATRO projetos Vercel apontando para este mesmo
# repositório (erp, aprendiz, contabilidade, adm). Cada push consome quatro
# deploys do teto diário do plano Hobby (~100/dia), o que dá ~25 pushes por dia
# para a conta inteira. Em 03/09/2026 o teto estourou e os quatro projetos
# passaram a responder "Deployment rate limited — retry in 24 hours".
#
# Nem todo commit muda o que a Vercel publica. Migração SQL vai para o banco
# pelo MCP, teste roda no GitHub Actions, documentação não é servida. Esses
# passam a não gastar deploy.
#
# O que NÃO entra na lista de exclusão, de propósito: `public/` (é servido),
# `api/` (são as functions), `package.json`, `vite.config.ts`, `index.html`.

set -u

ALVOS_IGNORADOS=(
  ':(exclude)supabase'      # migrações — aplicadas no banco, não no bundle
  ':(exclude)docs'
  ':(exclude)tests'         # rodam no CI, não no build
  ':(exclude).github'
  ':(exclude).claude'
  ':(exclude)*.md'
  ':(exclude)vitest.config.ts'
)

# Escotilha de emergência: o push vazio (`git commit --allow-empty`) é como se
# força um deploy quando a Vercel se perde. Sem esta saída, o filtro abaixo
# mataria justamente ele — commit vazio não muda arquivo nenhum. Qualquer
# mensagem contendo [deploy] ou "aciona build" passa direto.
MSG="$(git log -1 --pretty=%B || true)"
case "$MSG" in
  *'[deploy]'*|*'aciona build'*)
    echo "Commit pede build explicitamente — seguindo."
    exit 1
    ;;
esac

# Sem o commit anterior (clone raso, primeiro deploy do projeto) não dá para
# comparar: na dúvida, publica.
if ! git rev-parse --verify -q HEAD^ >/dev/null; then
  echo "Sem HEAD^ para comparar — seguindo com o build."
  exit 1
fi

if git diff --quiet HEAD^ HEAD -- "${ALVOS_IGNORADOS[@]}"; then
  echo "Nada fora de SQL/testes/docs mudou — build ignorado (economiza deploy)."
  exit 0
fi

echo "Mudou algo que a Vercel publica — seguindo com o build."
exit 1
