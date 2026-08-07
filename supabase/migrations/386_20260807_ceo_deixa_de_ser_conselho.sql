-- =================================================================
-- 386 — O CEO deixa de ser Conselho.
--
-- O bloco G1–G8 criou os atos (propor, prestar, deliberar) e os separou
-- no tempo. Não separou os PAPÉIS: `auth_is_admin()` devolve true para
-- admin, CEO e conselheiro, e as três telas de governança calculavam
-- `conselho = admin || ceo || conselheiro`. Resultado prático: o CEO
-- propunha o orçamento e podia aprová-lo; submetia a prestação de contas
-- e podia dar o próprio parecer. O loop de accountability não fechava —
-- era o problema que o bloco inteiro existia para resolver.
--
-- O que muda:
--   • Nasce `auth_is_conselho()`: admin, conselheiro puro e gerente com
--     `is_conselheiro`. **Sem CEO.** `auth_is_admin()` fica intacto — é
--     usado por dezenas de policies mundo afora e mexer nele é trocar a
--     régua de RBAC do sistema inteiro, não separar dois papéis.
--   • `admin` continua dentro porque é o professor: quem opera as 4
--     turmas precisa destravar qualquer etapa quando a aula empaca.
--     Aluno-CEO é que sai.
--   • Os 3 atos de deliberação passam a exigir `auth_is_conselho()`:
--     deliberar orçamento, dar parecer e encerrar prestação.
--   • E ganham o guard de conflito de interesse: quem propôs não delibera,
--     quem prestou contas não consolida o próprio parecer. Vale inclusive
--     para conselheiro — se um dia um conselheiro propuser o orçamento da
--     unidade dele, a regra continua de pé. `dar_parecer_prestacao` já
--     tinha esse guard; agora os três têm.
--
-- CONSEQUÊNCIA EM PRODUÇÃO: quem estiver com role 'ceo' nas 4 turmas
-- perde a capacidade de aprovar orçamento, dar parecer e encerrar
-- prestação de contas. É intencional — é o ponto pedagógico.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. O teste de Conselho ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_is_conselho()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  -- Igual a auth_is_admin(), MENOS 'ceo'. O CEO executa e presta contas;
  -- quem delibera sobre o que ele fez é outro corpo.
  SELECT auth_user_role() IN ('admin', 'conselheiro')
      OR EXISTS (
        SELECT 1 FROM public.user_profiles
         WHERE id = auth.uid()
           AND role = 'gerente'
           AND is_conselheiro = true
           AND desligado_em IS NULL
      );
$$;

COMMENT ON FUNCTION public.auth_is_conselho() IS
  'Conselho deliberativo: admin (professor), conselheiro puro e gerente-conselheiro. CEO fora de proposito — ele e o fiscalizado.';

REVOKE ALL ON FUNCTION public.auth_is_conselho() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_conselho() TO authenticated;

-- ── 2. Deliberar orçamento ────────────────────────────────────────
-- Corpo copiado do banco; mudam só o guard de papel e o guard de conflito.
CREATE OR REPLACE FUNCTION public.deliberar_orcamento(
  p_orcamento_id uuid,
  p_decisao      text,
  p_parecer      text DEFAULT NULL::text,
  p_itens        jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_o        orcamentos_periodo;
  v_sem_nota int;
  v_total    numeric(14,2);
BEGIN
  IF NOT COALESCE(auth_is_conselho(), false) THEN
    RAISE EXCEPTION 'Só o Conselho delibera orçamento. O CEO propõe e executa.'
      USING ERRCODE = '42501';
  END IF;

  IF p_decisao NOT IN ('aprovado','devolvido','reprovado') THEN
    RAISE EXCEPTION 'Decisão inválida: %.', p_decisao USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_o FROM orcamentos_periodo
   WHERE id = p_orcamento_id AND ativo = true;
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_o.status <> 'submetido' THEN
    RAISE EXCEPTION 'Só orçamento submetido vai a deliberação (atual: %).', v_o.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Conflito de interesse: quem pediu a verba não é quem a concede.
  IF v_o.proposto_por = auth.uid() THEN
    RAISE EXCEPTION 'Você propôs este orçamento — não pode deliberar sobre ele.'
      USING ERRCODE = '42501';
  END IF;

  -- Corte linha a linha.
  UPDATE orcamento_itens i
     SET valor_aprovado = (e->>'valor_aprovado')::numeric
    FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) e
   WHERE i.orcamento_id = p_orcamento_id
     AND i.id = (e->>'item_id')::uuid;

  IF p_decisao = 'aprovado' THEN
    SELECT count(*) INTO v_sem_nota
      FROM orcamento_itens
     WHERE orcamento_id = p_orcamento_id AND valor_aprovado IS NULL;
    IF v_sem_nota > 0 THEN
      RAISE EXCEPTION 'Aprovação exige valor em todas as % rubrica(s) — zero é corte, vazio é omissão.', v_sem_nota
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Devolução e reprovação zeram o teto: nada foi autorizado.
    UPDATE orcamento_itens SET valor_aprovado = NULL WHERE orcamento_id = p_orcamento_id;
  END IF;

  UPDATE orcamentos_periodo
     SET status         = CASE WHEN p_decisao = 'devolvido' THEN 'devolvido' ELSE p_decisao END,
         parecer        = p_parecer,
         deliberado_por = auth.uid(),
         deliberado_em  = now(),
         updated_at     = now()
   WHERE id = p_orcamento_id;

  SELECT COALESCE(sum(valor_aprovado), 0) INTO v_total
    FROM orcamento_itens WHERE orcamento_id = p_orcamento_id;

  RETURN jsonb_build_object(
    'sucesso', true, 'status', p_decisao, 'total_aprovado', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.deliberar_orcamento(uuid,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deliberar_orcamento(uuid,text,text,jsonb) TO authenticated;

-- ── 3. Dar parecer na prestação de contas ─────────────────────────
CREATE OR REPLACE FUNCTION public.dar_parecer_prestacao(
  p_prestacao_id uuid,
  p_voto         text,
  p_ressalva     text DEFAULT NULL::text,
  p_prazo_acao   date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_p prestacoes_contas;
BEGIN
  IF NOT COALESCE(auth_is_conselho(), false) THEN
    RAISE EXCEPTION 'Só o Conselho dá parecer. O CEO presta contas, não as julga.'
      USING ERRCODE = '42501';
  END IF;

  IF p_voto NOT IN ('aprovar','ressalvar','reprovar') THEN
    RAISE EXCEPTION 'Voto inválido: %.', p_voto USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_p FROM prestacoes_contas WHERE id = p_prestacao_id AND ativo = true;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'Prestação não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF v_p.status <> 'submetida' THEN
    RAISE EXCEPTION 'A prestação não está em deliberação (atual: %).', v_p.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Quem presta contas não delibera sobre a própria prestação.
  IF v_p.autor_id = auth.uid() THEN
    RAISE EXCEPTION 'Você submeteu esta prestação — não pode dar parecer sobre ela.'
      USING ERRCODE = '42501';
  END IF;

  IF p_voto = 'ressalvar'
     AND (COALESCE(btrim(p_ressalva), '') = '' OR p_prazo_acao IS NULL) THEN
    RAISE EXCEPTION 'Ressalva exige texto e prazo — sem prazo é reclamação, não plano de ação.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO prestacao_pareceres (prestacao_id, conselheiro_id, voto, ressalva, prazo_acao)
  VALUES (p_prestacao_id, auth.uid(), p_voto,
          CASE WHEN p_voto = 'ressalvar' THEN p_ressalva ELSE NULLIF(btrim(COALESCE(p_ressalva,'')), '') END,
          CASE WHEN p_voto = 'ressalvar' THEN p_prazo_acao ELSE NULL END)
  ON CONFLICT (prestacao_id, conselheiro_id) DO UPDATE
     SET voto = EXCLUDED.voto, ressalva = EXCLUDED.ressalva,
         prazo_acao = EXCLUDED.prazo_acao, updated_at = now();

  RETURN jsonb_build_object('sucesso', true, 'voto', p_voto);
END;
$$;

REVOKE ALL ON FUNCTION public.dar_parecer_prestacao(uuid,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dar_parecer_prestacao(uuid,text,text,date) TO authenticated;

-- ── 4. Encerrar a prestação (consolidar os pareceres) ─────────────
CREATE OR REPLACE FUNCTION public.encerrar_prestacao(
  p_prestacao_id uuid,
  p_conclusao    text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_p         prestacoes_contas;
  v_pareceres int;
  v_reprovar  int;
  v_ressalvar int;
  v_status    text;
  v_tarefas   int := 0;
  r           record;
BEGIN
  IF NOT COALESCE(auth_is_conselho(), false) THEN
    RAISE EXCEPTION 'Só o Conselho encerra a deliberação.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_p FROM prestacoes_contas WHERE id = p_prestacao_id AND ativo = true;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'Prestação não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF v_p.status <> 'submetida' THEN
    RAISE EXCEPTION 'A prestação não está em deliberação (atual: %).', v_p.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Consolidar o placar da própria prestação é o mesmo conflito de dar
  -- parecer nela: quem submeteu não bate o martelo.
  IF v_p.autor_id = auth.uid() THEN
    RAISE EXCEPTION 'Você submeteu esta prestação — não pode encerrar a deliberação dela.'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE voto = 'reprovar'),
         count(*) FILTER (WHERE voto = 'ressalvar')
    INTO v_pareceres, v_reprovar, v_ressalvar
    FROM prestacao_pareceres WHERE prestacao_id = p_prestacao_id;

  IF v_pareceres = 0 THEN
    RAISE EXCEPTION 'Nenhum parecer registrado — nada a consolidar.' USING ERRCODE = 'P0001';
  END IF;

  -- Regra mais severa presente. Conselho não decide por média.
  v_status := CASE
                WHEN v_reprovar  > 0 THEN 'reprovada'
                WHEN v_ressalvar > 0 THEN 'aprovada_com_ressalva'
                ELSE 'aprovada'
              END;

  -- Cada ressalva vira tarefa com prazo. É o que transforma parecer em
  -- consequência — sem isto, a reunião acaba e nada muda.
  FOR r IN
    SELECT pp.ressalva, pp.prazo_acao, up.nome AS conselheiro
      FROM prestacao_pareceres pp
      JOIN user_profiles up ON up.id = pp.conselheiro_id
     WHERE pp.prestacao_id = p_prestacao_id AND pp.voto = 'ressalvar'
  LOOP
    INSERT INTO tarefas (modulo, titulo, descricao, prioridade, prazo, filial, origem, criado_por, nome_criador)
    VALUES ('governanca',
            format('Ressalva do Conselho — %s', v_p.titulo),
            r.ressalva,
            'Alta',
            r.prazo_acao,
            v_p.filial,
            'ressalva_conselho',
            auth.uid(),
            r.conselheiro);
    v_tarefas := v_tarefas + 1;
  END LOOP;

  UPDATE prestacoes_contas
     SET status = v_status, conclusao = p_conclusao,
         encerrada_por = auth.uid(), encerrada_em = now(), updated_at = now()
   WHERE id = p_prestacao_id;

  RETURN jsonb_build_object(
    'sucesso', true, 'status', v_status,
    'pareceres', v_pareceres, 'tarefas_geradas', v_tarefas);
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_prestacao(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_prestacao(uuid,text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) anon fora e os 3 atos exigindo o teste novo:
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode,
--        pg_get_functiondef(p.oid) ILIKE '%auth_is_conselho()%' AS usa_conselho
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public'
--    AND p.proname IN ('deliberar_orcamento','dar_parecer_prestacao','encerrar_prestacao');
-- Esperado: anon_pode = false, usa_conselho = true nas 3.
--
-- 2) `auth_is_admin()` intacto (dezenas de policies dependem dele):
-- SELECT pg_get_functiondef('public.auth_is_admin()'::regprocedure) ILIKE '%ceo%';
-- Esperado: true.
--
-- 3) Fim a fim, logado como CEO: propor e submeter orçamento tem de
--    funcionar; deliberar tem de devolver 42501.
