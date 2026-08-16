-- 431_20260816_o_que_a_auditoria_nao_tinha_olhado.sql
--
-- Complemento da 430. Aquela varredura olhou as RPCs de ESCRITA e parou ali —
-- o que deixou um flanco inteiro por conferir, porque `SECURITY DEFINER`
-- ignora a RLS no SELECT exatamente como ignora no UPDATE. Uma função de
-- leitura sem guard não estraga dado nenhum, mas entrega de bandeja o que a
-- RLS existe para separar: os números da filial concorrente.
--
-- Também entra aqui o item que a 430 anotou como "vandalismo cosmético" e
-- deixou passar.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1. MÉDIO — O RESULTADO FINANCEIRO DA FILIAL CONCORRENTE
--
-- `apurar_resultado_periodo(filial, inicio, fim)` soma contas_receber e
-- contas_pagar pagas no período e devolve receitas, despesas e lucro. Sem
-- guard nenhum e com a filial vindo por parâmetro: qualquer aluno logado
-- passava 'SuperMax' e lia o resultado da SuperMax.
--
-- Numa operação que é uma competição entre as três unidades
-- ([[project_competicao_matriz]]), isso é o balanço do adversário. E não há
-- adivinhação envolvida — os nomes das filiais estão no `lib/filiais.ts`, no
-- bundle.
--
-- `orcamento_execucao(orcamento_id)` é a mesma história por outro caminho:
-- devolve orçado × realizado por centro de custo, e o `filial` sai do próprio
-- orçamento, então basta ter o id. Aqui a correção é o filtro na cláusula
-- WHERE em vez de exceção: a função devolve linhas, e linha nenhuma é a
-- resposta natural para "não é seu orçamento" — a tela mostra vazio em vez de
-- estourar erro.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 2. BAIXO — atualizar_foto_usuario, o item que a 430 deixou passar
--
-- Aceita qualquer gerente e não olha filial nenhuma: gerente da MaxLook
-- trocava a foto de perfil de qualquer pessoa das outras unidades, inclusive
-- a do admin. É vandalismo, não privilégio — por isso a 430 anotou e seguiu —,
-- mas o conserto é de três linhas e não há motivo para deixar aberto.
--
-- A régua nova acompanha a do módulo Usuários, que desde a migr. 410 é escrita
-- só para `role='admin'` ([[project_usuarios_edicao]]): admin e CEO mexem em
-- qualquer um, gerente só em quem é da própria filial, e todo mundo na própria
-- foto. A foto do próprio perfil continua saindo pelo `PerfilFotoModal`, que
-- escreve direto em `user_profiles` — não passa por aqui e não muda.
--
-- ════════════════════════════════════════════════════════════════════════════
-- FICA COMO ESTÁ, agora com o motivo escrito em vez de por omissão:
--
--   • `cliente_saldo_devedor` e `cliente_titulos_vencidos` somam os títulos do
--     cliente SEM recortar por filial, e são chamadas a cada venda fiado
--     (`lib/credito.ts` e o gatilho `venda_fiado_respeita_credito`). Dá para
--     enumerar cliente_id e ler a dívida de cliente de outra unidade. Não foi
--     fechado de propósito: recortar por filial mudaria o NÚMERO que o limite
--     de crédito enxerga — hoje ele considera a exposição total do cliente na
--     holding, que é o comportamento certo para crédito. Fechar isso é decisão
--     de regra de negócio, não de segurança, e não cabe passar de contrabando
--     numa migração de hardening. Fica registrado para decidir à parte.
--
--   • As funções de leitura do placar (`ranking_competicao`,
--     `calcular_placar_competicao`, `progresso_avaliacao_matriz`,
--     `media_participantes_*`, `frequencia_filiais_competicao`,
--     `participantes_sem_nota_competicao`, `contar_votantes_matriz`) seguem
--     abertas a qualquer logado. É placar de competição — existe para ser
--     visto pelas três unidades.
--
--   • Nenhuma destas funções de leitura checa o blackout da migr. 339, então
--     durante a simulação de perda de dados elas continuam respondendo. As de
--     escrita passaram a checar pela 430. Anotado, não corrigido aqui: mexer
--     no blackout pede uma passada própria em tudo que é leitura, e não uma
--     emenda em duas funções.


BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1a. apurar_resultado_periodo
--
-- Vira plpgsql (era `LANGUAGE sql`) para poder levantar exceção. A assinatura
-- e as colunas OUT são idênticas, então o CREATE OR REPLACE passa sem 42P13.
-- Erro em vez de zero-linhas de propósito: quem chama espera um agregado, e
-- devolver 0/0/0 para quem não pode ver seria mentir "esta filial não lucrou".
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apurar_resultado_periodo(p_filial text, p_inicio date, p_fim date)
RETURNS TABLE(receitas numeric, despesas numeric, lucro numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- COALESCE: NULL não vira permissão. `auth_pode_filial` já libera admin,
  -- CEO e conselheiro; gerente e colaborador só na própria unidade.
  IF NOT public.auth_is_service_role()
     AND NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'O resultado da unidade % não é seu para consultar.', COALESCE(p_filial, '(sem filial)')
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH r AS (
    SELECT COALESCE(sum(COALESCE(valor_pago, valor)), 0) AS total
      FROM contas_receber
     WHERE ativo = true AND filial = p_filial
       AND pago_em BETWEEN p_inicio AND p_fim
  ),
  d AS (
    SELECT COALESCE(sum(COALESCE(valor_pago, valor)), 0) AS total
      FROM contas_pagar
     WHERE ativo = true AND filial = p_filial
       AND pago_em BETWEEN p_inicio AND p_fim
  )
  SELECT r.total, d.total, r.total - d.total FROM r, d;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1b. orcamento_execucao — filtro no WHERE, sem exceção (ver cabeçalho)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.orcamento_execucao(p_orcamento_id uuid)
RETURNS TABLE(item_id uuid, centro_custo_id uuid, centro_codigo text, centro_nome text, valor_proposto numeric, valor_aprovado numeric, realizado numeric, saldo numeric, consumo_pct numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    i.id,
    cc.id,
    cc.codigo,
    cc.nome,
    i.valor_proposto,
    i.valor_aprovado,
    COALESCE(r.gasto, 0) AS realizado,
    COALESCE(i.valor_aprovado, 0) - COALESCE(r.gasto, 0) AS saldo,
    CASE WHEN COALESCE(i.valor_aprovado, 0) = 0 THEN NULL
         ELSE round(COALESCE(r.gasto, 0) * 100 / i.valor_aprovado, 1)
    END AS consumo_pct
  FROM orcamento_itens i
  JOIN orcamentos_periodo o ON o.id = i.orcamento_id
  JOIN centros_custo cc     ON cc.id = i.centro_custo_id
  LEFT JOIN LATERAL (
    SELECT sum(cp.valor) AS gasto
      FROM contas_pagar cp
     WHERE cp.ativo = true
       AND cp.centro_custo_id = i.centro_custo_id
       AND cp.filial = o.filial
       AND cp.vencimento BETWEEN o.periodo_inicio AND o.periodo_fim
  ) r ON true
  WHERE i.orcamento_id = p_orcamento_id
    -- Novo na 431. A filial sai do próprio orçamento, então sem esta linha
    -- bastava ter o id para ler o orçado × realizado da unidade vizinha.
    AND (public.auth_is_service_role() OR COALESCE(public.auth_pode_filial(o.filial), false))
  ORDER BY cc.codigo;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. atualizar_foto_usuario
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.atualizar_foto_usuario(p_user_id uuid, p_foto_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        text;
  v_alvo_filial text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM user_profiles WHERE id = auth.uid();
  SELECT filial INTO v_alvo_filial FROM user_profiles WHERE id = p_user_id;

  IF NOT (
       p_user_id = auth.uid()
       OR v_role IN ('admin', 'ceo')
       OR (v_role = 'gerente' AND COALESCE(public.auth_pode_filial(v_alvo_filial), false))
     ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar a foto deste usuário.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE user_profiles SET foto_url = p_foto_url WHERE id = p_user_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- Higiene de grants — mesma régua da 430: revogar de `anon` NOMINALMENTE,
-- porque o ALTER DEFAULT PRIVILEGES do Supabase concede EXECUTE a anon de
-- forma explícita e REVOKE FROM public não o remove.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.apurar_resultado_periodo(text, date, date)',
    'public.orcamento_execucao(uuid)',
    'public.atualizar_foto_usuario(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_sig);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (rodar nos 4 — os md5 têm de bater entre si)
--
--   SELECT proname, md5(pg_get_functiondef(oid)) AS md5,
--          has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
--     FROM pg_proc WHERE pronamespace='public'::regnamespace
--      AND proname IN ('apurar_resultado_periodo','orcamento_execucao','atualizar_foto_usuario')
--    ORDER BY 1;   -- espera 3 linhas, anon_exec = false nas três
--
-- TESTE MANUAL (F12, aluno colaborador de UMA filial):
--   • rpc('apurar_resultado_periodo', {p_filial:'<outra filial>',
--         p_inicio:'2026-08-01', p_fim:'2026-08-31'})       → 42501
--   • rpc('apurar_resultado_periodo', {p_filial:'<a sua>', ...}) → devolve
--   • DestinacaoResultado e Orçamento continuam abrindo para quem é da unidade
-- ════════════════════════════════════════════════════════════════════════════
