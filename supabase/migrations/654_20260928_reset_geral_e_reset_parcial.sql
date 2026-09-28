-- 654_20260928_reset_geral_e_reset_parcial.sql
--
-- O APAGAR TUDO virou dois botões (pedido do usuário, 28/09):
--
--   • RESET PARCIAL — recomeço da MESMA turma. É o que o APAGAR TUDO já fazia,
--     sem carimbar corte: nada vira "Turma anterior". Porta existente:
--     `resetar_dados_operacionais_admin(false)` (638). Nada muda no banco.
--
--   • RESET GERAL — turma nova. Apaga TUDO: funcionários, usuários, ponto,
--     folha, competição, histórico de operações, financeiro, cadastros… e os
--     arquivos enviados (a tela apaga pelo Storage API com a lista que esta
--     função devolve). Não deixa corte nem histórico.
--
--     Decisões do usuário: fica só a conta de quem tem role 'admin' (o
--     professor, senão ninguém entra depois); fica a ESTRUTURA que o app
--     precisa para funcionar (lista `v_manter` abaixo); arquivos saem.
--
-- Por que ao contrário da régua antiga (lista do que apaga): aqui a lista é do
-- que FICA. Tabela criada no futuro entra no reset geral sozinha — o furo de
-- "migração que cria tabela nova não passa pela régua" (393) não se repete.
-- Quem criar tabela de ESTRUTURA precisa acrescentá-la em `v_manter`.
--
-- Mecânica:
--   1. TRUNCATE (sem CASCADE) de toda tabela de `public` fora de `v_manter`,
--      menos `funcionarios`. Sem CASCADE de propósito: CASCADE ignora a regra
--      ON DELETE e levaria junto tabela mantida que aponte para uma apagada
--      (ex.: user_profiles → funcionarios). Se um dia isso acontecer, o
--      TRUNCATE falha inteiro em vez de apagar estrutura em silêncio.
--   2. `funcionarios` sai por DELETE, depois de soltar `user_profiles.
--      funcionario_id` (a conta do admin sobrevive a ele).
--   3. Tabela mantida que aponta para auth.users sem ON DELETE (hoje:
--      alcadas_compra) é reatribuída ao admin antes de apagar as contas.
--   4. DELETE dos perfis e depois das contas de quem não é admin (nessa
--      ordem, para o gatilho anti-privesc da 585 não precisar ser tocado).
--   5. caixa_bancos.saldo = 0 e o corte de ponto sai (não há ponto antigo).
--
-- `criterios_avaliacao` NÃO é estrutura: é filho de `avaliacoes` (CASCADE),
-- critério lançado numa avaliação.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.resetar_geral_admin(p_confirmacao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '180s'
AS $function$
DECLARE
  -- Estrutura que o app precisa para funcionar. Todo o resto de `public` sai.
  v_manter text[] := ARRAY[
    'filiais', 'user_profiles', 'funcionarios',            -- funcionarios sai por DELETE (passo 2)
    'categorias_produto', 'subcategorias_produto', 'taxonomia_padrao',
    'cargos', 'departamentos', 'centros_custo', 'beneficios',
    'formas_pagamento', 'condicoes_pagamento', 'caixa_bancos',
    'classificacoes_auxiliares', 'mapeamentos_rateio', 'alcadas_compra',
    'bancos_investimento', 'integracoes_bancarias',
    'rh_faixas', 'rh_parametros', 'treinamentos',
    'ponto_jornada', 'ponto_calendario_excecoes',
    'configuracoes', 'aula_config', 'blackout_config', 'capital_config',
    'filial_caixa_config', 'financeiro_config', 'loja_config',
    'loja_palavras_bloqueadas', 'marketing_config', 'maxbank_config',
    'modo_visitante_config', 'redes_sociais_links', 'ti_relogio_maquinas'
  ];
  -- Buckets de arquivo de aluno. Ficam os da estrutura mantida: logos de
  -- banco e de filial, imagens de categoria.
  v_buckets text[] := ARRAY[
    'perfil-fotos', 'produto-imagens', 'nota-anexos', 'max-show-anexos',
    'curriculos', 'planilhas-turma', 'cadastro-imagens', 'documentos',
    'arte-imagens', 'contratos'
  ];
  v_admins    uuid[];
  v_lista     text;
  v_tabelas   int;
  v_funcs     int;
  v_contas    int;
  v_arquivos  jsonb;
  r           record;
BEGIN
  -- Mesmo guard da 412/638: `role = 'admin'` literal (auth_is_admin() inclui
  -- CEO e conselheiro, que aqui são alunos) e COALESCE contra NULL.
  IF NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Apenas o administrador pode fazer o reset geral.'
      USING ERRCODE = '42501';
  END IF;

  IF p_confirmacao IS DISTINCT FROM 'RESET GERAL' THEN
    RAISE EXCEPTION 'Confirmação inválida: digite RESET GERAL.'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(id) INTO v_admins FROM public.user_profiles WHERE role = 'admin';
  IF v_admins IS NULL OR NOT (auth.uid() = ANY (v_admins)) THEN
    RAISE EXCEPTION 'Conta de administrador não encontrada — reset abortado.'
      USING ERRCODE = 'P0001';
  END IF;

  -- O perfil do admin não pode ter sido criado por aluno: apagar esse aluno
  -- trocaria o criado_por do admin, e o gatilho da 585 recusa (corretamente).
  -- Melhor recusar aqui, antes de apagar qualquer coisa, com mensagem clara.
  IF EXISTS (SELECT 1 FROM public.user_profiles p
              WHERE p.id = ANY (v_admins)
                AND p.criado_por IS NOT NULL
                AND NOT (p.criado_por = ANY (v_admins))) THEN
    RAISE EXCEPTION 'O perfil do administrador foi criado por outra conta; o reset geral não pode apagá-la. Fale com o suporte.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Lista de arquivos ANTES de apagar (a tela remove pelo Storage API; apagar
  -- linha de storage.objects por SQL deixaria o arquivo órfão no disco).
  SELECT COALESCE(jsonb_object_agg(b.bucket_id, b.nomes), '{}'::jsonb)
    INTO v_arquivos
    FROM (SELECT o.bucket_id, jsonb_agg(o.name) AS nomes
            FROM storage.objects o
           WHERE o.bucket_id = ANY (v_buckets)
           GROUP BY o.bucket_id) b;

  -- 1. Tudo que não é estrutura.
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname),
         COUNT(*)
    INTO v_lista, v_tabelas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relispartition
     AND c.relname <> ALL (v_manter);

  IF v_lista IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || v_lista || ' RESTART IDENTITY';
  END IF;

  -- 2. Funcionários (a conta do admin solta o vínculo e fica).
  UPDATE public.user_profiles SET funcionario_id = NULL WHERE funcionario_id IS NOT NULL;
  DELETE FROM public.funcionarios WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_funcs = ROW_COUNT;

  -- 3. Estrutura que aponta para conta sem ON DELETE: reatribui ao admin.
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col, a.attnotnull AS nn
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.contype = 'f'
       AND c.confrelid = 'auth.users'::regclass
       AND c.confdeltype IN ('a', 'r')
       AND n.nspname = 'public'
       AND t.relname = ANY (v_manter)
  LOOP
    EXECUTE format('UPDATE %s SET %I = %s WHERE %I IS NOT NULL AND NOT (%I = ANY ($1))',
                   r.tbl, r.col,
                   CASE WHEN r.nn THEN quote_literal(auth.uid()) || '::uuid' ELSE 'NULL' END,
                   r.col, r.col)
      USING v_admins;
  END LOOP;

  -- 4. Contas: só o admin fica. Os perfis saem ANTES das contas: apagar a
  --    conta primeiro dispara o ON DELETE SET NULL de `user_profiles.
  --    criado_por` nos perfis de aluno ainda vivos, e o gatilho anti-privesc
  --    (585) recusa — com razão — qualquer troca de criado_por. Com os perfis
  --    já fora, o SET NULL não encontra linha. O perfil do admin não aponta
  --    para aluno (conferido lá em cima).
  DELETE FROM public.user_profiles WHERE NOT (id = ANY (v_admins));
  DELETE FROM auth.users WHERE NOT (id = ANY (v_admins));
  GET DIAGNOSTICS v_contas = ROW_COUNT;

  -- 5. Saldo é consequência (327) e não sobra ponto para cortar.
  UPDATE public.caixa_bancos SET saldo = 0 WHERE saldo IS DISTINCT FROM 0;
  DELETE FROM public.configuracoes WHERE chave = 'ponto_corte_turma';

  -- 6. Gatilho de auditoria/notificação disparado pelos DELETEs dos passos 2
  --    e 4 regrava linha nas tabelas zeradas; segunda passada, barata.
  IF v_lista IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || v_lista || ' RESTART IDENTITY';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tabelas_zeradas', v_tabelas,
    'funcionarios_apagados', v_funcs,
    'contas_apagadas', v_contas,
    'contas_mantidas', array_length(v_admins, 1),
    'arquivos', v_arquivos
  );
END;
$function$;

COMMENT ON FUNCTION public.resetar_geral_admin(text) IS
  'Migr. 654 — RESET GERAL (turma nova): apaga tudo de public fora da lista de estrutura, todas as contas menos admin, e devolve os arquivos a remover pelo Storage API. Recomeço da mesma turma é resetar_dados_operacionais_admin(false).';

REVOKE ALL ON FUNCTION public.resetar_geral_admin(text) FROM public;
REVOKE ALL ON FUNCTION public.resetar_geral_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resetar_geral_admin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resetar_geral_admin(text) TO service_role;

-- ── Storage: o professor apaga os arquivos de aluno ────────────────────────
-- As policies de DELETE por bucket são de setor/dono (planilhas-turma: só o
-- dono), então o admin não alcançava tudo. Policies permissivas somam (OR).
DROP POLICY IF EXISTS reset_geral_admin_select ON storage.objects;
CREATE POLICY reset_geral_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = ANY (ARRAY['perfil-fotos','produto-imagens','nota-anexos','max-show-anexos',
                           'curriculos','planilhas-turma','cadastro-imagens','documentos',
                           'arte-imagens','contratos'])
    AND (SELECT public.auth_user_role()) = 'admin'
  );

DROP POLICY IF EXISTS reset_geral_admin_delete ON storage.objects;
CREATE POLICY reset_geral_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = ANY (ARRAY['perfil-fotos','produto-imagens','nota-anexos','max-show-anexos',
                           'curriculos','planilhas-turma','cadastro-imagens','documentos',
                           'arte-imagens','contratos'])
    AND (SELECT public.auth_user_role()) = 'admin'
  );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verificação (em transação desfeita, com JWT do admin) ──────────────────
--   BEGIN;
--   SELECT set_config('request.jwt.claims', json_build_object('sub', <admin>, 'role','authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT resetar_geral_admin('RESET GERAL') - 'arquivos';
--   SELECT count(*) FROM funcionarios;   -- 0
--   SELECT count(*) FROM user_profiles;  -- nº de admins
--   SELECT count(*) FROM filiais;        -- intacto
--   ROLLBACK;
