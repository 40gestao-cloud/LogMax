-- =================================================================
-- LogMax — Modo Aula passa a liberar SETOR, não só o menu
-- =================================================================
-- Bug relatado em 2026-07-31: professor ativa o Modo Aula, escolhe os
-- módulos da aula, e "vários alunos só veem Início".
--
-- Causa: o Modo Aula era uma INTERSEÇÃO com o RBAC por setor. A sidebar
-- fazia `modulos_do_setor ∩ modulos_ativos`, então um aluno de vendas
-- numa aula de Cadastros/Compras/Estoque ficava com conjunto vazio. Só
-- quem era de logística (ou gerente, que enxerga tudo) via a aula.
--
-- Consertar só o frontend não resolveria: o menu apareceria e a RLS
-- barraria a leitura (`auth_in_setor(...)`, ~520 usos nas policies) —
-- telas vazias e erro ao gravar. Por isso a trava sai dos dois lados.
--
-- Como funciona: enquanto `aula_config.ativo` e o role do usuário está
-- em `roles_afetados`, ele ganha TEMPORARIAMENTE os setores dos módulos
-- liberados. Nada é gravado em user_profiles — a concessão é calculada
-- na hora, então desligar a aula devolve o acesso normal na mesma
-- requisição, sem script de rollback.
--
-- Ponto único de mudança: `auth_user_setores()`, de onde `auth_in_setor`
-- (e `auth_in_setor_ou_gerente`) derivam. Preserva o filtro de
-- `desligado_em` da migr. 307 — desligado não volta a ter acesso por
-- causa de aula.
--
-- Filial NÃO é afetada: `auth_pode_filial` continua confinando o aluno
-- à unidade dele. A aula abre o setor, não a filial.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1. Mapa módulo (sidebar) → setores (RLS)
-- ─────────────────────────────────────────────────────────────────
-- Espelha `SETOR_MODULES` de src/lib/sectorAccess.ts na direção
-- inversa. Módulos abertos a todos os setores (empresa, requisicoes)
-- e views que não têm setor próprio (dashboard, metas, catálogo,
-- avaliações, feedback-org, usuarios, max-show) não concedem nada:
-- já são acessíveis sem setor específico.
CREATE OR REPLACE FUNCTION public.aula_setores_do_modulo(p_modulo text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE p_modulo
    WHEN 'cadastros'  THEN ARRAY['logistica', 'compras']
    WHEN 'compras'    THEN ARRAY['compras', 'logistica']
    WHEN 'estoque'    THEN ARRAY['logistica', 'estoque']
    WHEN 'financeiro' THEN ARRAY['financeiro']
    WHEN 'rh'         THEN ARRAY['rh']
    WHEN 'vendas'     THEN ARRAY['vendas']
    WHEN 'marketing'  THEN ARRAY['marketing']
    WHEN 'ti'         THEN ARRAY['ti']
    ELSE ARRAY[]::text[]
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.aula_setores_do_modulo(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. Setores concedidos pela aula ao usuário corrente
-- ─────────────────────────────────────────────────────────────────
-- Vazio quando a aula está desligada, quando o role não está no alvo,
-- quando o usuário é admin (isento — já passa por auth_is_admin) ou
-- quando ele está desligado.
CREATE OR REPLACE FUNCTION public.auth_aula_setores()
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT ARRAY(
        SELECT DISTINCT s
          FROM public.aula_config c
          CROSS JOIN LATERAL unnest(c.modulos_ativos) AS m(modulo)
          CROSS JOIN LATERAL unnest(public.aula_setores_do_modulo(m.modulo)) AS x(s)
         WHERE c.id = 1
           AND c.ativo
           AND EXISTS (
             SELECT 1 FROM public.user_profiles u
              WHERE u.id = auth.uid()
                AND u.desligado_em IS NULL
                AND u.role <> 'admin'
                AND u.role = ANY(COALESCE(c.roles_afetados, ARRAY[]::text[]))
           )
      )
    ),
    ARRAY[]::text[]
  );
$function$;

GRANT EXECUTE ON FUNCTION public.auth_aula_setores() TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. auth_user_setores() soma os setores da aula
-- ─────────────────────────────────────────────────────────────────
-- Base idêntica à da migr. 307 (inclusive `desligado_em IS NULL`);
-- a única diferença é o `|| auth_aula_setores()`.
CREATE OR REPLACE FUNCTION public.auth_user_setores()
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT ARRAY[u.setor]
             || COALESCE(u.setores_extras, ARRAY[]::text[])
             || public.auth_aula_setores()
        FROM public.user_profiles u
       WHERE u.id = auth.uid() AND u.desligado_em IS NULL
    ),
    ARRAY[]::text[]
  );
$function$;

GRANT EXECUTE ON FUNCTION public.auth_user_setores() TO authenticated;

COMMIT;

-- PostgREST precisa recarregar o cache de schema depois de mexer em função.
NOTIFY pgrst, 'reload schema';
