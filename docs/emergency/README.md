# Scripts de Emergência

Scripts SQL destrutivos que **nunca** devem ser rodados no fluxo normal de migrations.
Ficam aqui (fora de `supabase/migrations/`) pra evitar aplicação acidental.

## Índice

- **`011_20260516_rls_rollback.sql.EMERGENCY_ONLY`**
  Rollback do hardening RLS. Abre `USING(true) WITH CHECK(true)` em ~100 tabelas.
  **Só rodar** se um deploy quebrar fluxos críticos em produção e você precisar
  desabilitar RLS enquanto investiga. Depois, reaplicar o hardening + auditoria
  em `pg_policies WHERE qual='true'` pra confirmar retorno.

## Como aplicar

Não aplicar via `supabase db push`. Copiar o conteúdo, entender o que faz,
rodar no SQL Editor manualmente com o time avisado.
