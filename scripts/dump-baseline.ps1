# dump-baseline.ps1
# Gera o baseline consolidado do schema atual do LogMax a partir do projeto
# de referencia (logmax-erp). Rodar quando quiser fixar um novo ponto zero
# para as proximas turmas. Ver docs/setup-nova-turma.md.
#
# Requisitos:
#   - pg_dump 15+ (Postgres client tools) no PATH
#   - variavel PGPASSWORD setada, ou uso interativo
#   - connection string do projeto Supabase de referencia
#
# Uso:
#   $env:PGPASSWORD = "sua-senha-do-postgres"
#   .\scripts\dump-baseline.ps1 -DbUrl "postgresql://postgres.<ref>:...@aws-...supabase.com:6543/postgres"
#
# Output:
#   supabase/baseline_YYYYMMDD.sql

param(
  [Parameter(Mandatory=$true)]
  [string]$DbUrl,

  [string]$OutDir = "supabase"
)

$ErrorActionPreference = "Stop"

$date = Get-Date -Format "yyyyMMdd"
$outFile = Join-Path $OutDir "baseline_$date.sql"

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  Write-Error "pg_dump nao encontrado no PATH. Instale Postgres client tools 15+."
  exit 1
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

Write-Host "Gerando baseline em $outFile ..."

# --schema=public: pula schemas auth/storage/realtime (Supabase provisiona).
# --no-owner + --no-privileges: baseline portavel entre projetos.
# --if-exists + --clean: DROP antes de CREATE. Comente se quiser append em vez de reset.
& pg_dump `
  --schema=public `
  --schema-only `
  --no-owner `
  --no-privileges `
  --no-comments `
  --file=$outFile `
  $DbUrl

if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump falhou com exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Baseline gerado: $outFile" -ForegroundColor Green
Write-Host ""
Write-Host "Proximos passos:"
Write-Host "  1. Rode $outFile no SQL Editor do novo projeto Supabase"
Write-Host "  2. Rode scripts/setup-buckets.sql para criar os storage buckets"
Write-Host "  3. Edite e rode supabase/migrations/20260516_seed_admin_master.sql"
Write-Host "  4. Detalhes: docs/setup-nova-turma.md"
