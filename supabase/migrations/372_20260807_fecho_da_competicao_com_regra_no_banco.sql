-- =================================================================
-- 372 — O fecho da Competição passa a ter regra no banco.
--
-- Auditoria de lisura em 07/08. Três buracos, todos no mesmo gesto:
-- declarar a vencedora.
--
-- (1) DECLARAR NÃO OLHAVA NADA
--     `declarar_vencedora` (369) exigia role='admin', competição não
--     encerrada e ≥1 voto. Só isso. O quórum de maioria simples morava
--     no cliente (MatrizCompeticaoView.tsx) — o próprio comentário de
--     lá dizia "o banco não tem segunda barreira". E `p_vencedora` não
--     tinha relação nenhuma com o placar: dava pra declarar a 3ª
--     colocada, com 1 voto, numa competição ainda em andamento.
--     Agora, no banco:
--       • status precisa ser 'aguardando_encerramento' (a votação já
--         aconteceu; em_andamento ainda aceita nota nova);
--       • votos válidos ≥ maioria simples do eleitorado;
--       • `p_vencedora` tem de ser a ESPERADA — topo do ranking, ou a
--         filial que a maioria indicou ao rejeitar o placar. Divergir
--         continua possível (é decisão da Administração), mas exige
--         justificativa, que fica gravada na competição.
--
-- (2) REABRIR MANTINHA O MANDATO ANTIGO
--     A 371 devolve a competição para 'em_andamento', as notas mudam —
--     e os votos continuavam valendo. Pior: `voto_update` só liberava
--     em 'aguardando_encerramento', então o conselho nem conseguia
--     corrigir o voto que agora falava de um placar que não existe
--     mais. Resultado: admin reabria, mexia nas notas e redeclarava
--     com o mandato velho.
--     Agora `reaberta_em` marca o corte: voto anterior a ele não conta
--     em quórum, contagem nem empate. Ele NÃO é apagado — fica visível
--     como voto da rodada anterior. E `voto_update` passa a valer
--     também em 'em_andamento', pra o conselho poder revotar assim que
--     a competição reabre.
--     `votado_em` (nova coluna + trigger) é o que faz a régua funcionar
--     na troca de voto: `created_at` não se move num UPDATE, então um
--     voto corrigido depois da reabertura continuaria contando como
--     anterior a ela.
--
-- (3) ELEITOR PODIA SER DE FILIAL
--     `voto_read`/`voto_write`/`voto_update` cobravam o cargo mas não a
--     filial — um gerente de filial com `is_conselheiro = true` votaria
--     na competição que a própria filial disputa. E como
--     `contar_votantes_matriz` e `_competicao_empatada` exigem Matriz,
--     esse voto entrava na contagem da tela sem entrar no eleitorado:
--     quórum inflado e empate mal medido. Hoje ninguém está nessa
--     situação (4 eleitores, todos Matriz) — é um clique no cadastro.
--
--     Junto vai o critério de desempate do pódio, que era implícito e
--     divergente entre as telas (a Matriz ordenava só por média, a
--     filial por média e depois nº de notas — empate exato dava o 1º
--     lugar a quem estivesse primeiro no array). `ranking_competicao`
--     passa a ser a única fonte da ordem, e é dela que sai a vencedora
--     esperada.
--
-- Idempotente. Não recalcula nem apaga nota, voto ou placar já
-- congelado.
-- =================================================================

BEGIN;

-- ── 1. Colunas do fecho ───────────────────────────────────────────
ALTER TABLE public.competicoes_matriz
  ADD COLUMN IF NOT EXISTS reaberta_em              timestamptz,
  ADD COLUMN IF NOT EXISTS declaracao_justificativa text;

COMMENT ON COLUMN public.competicoes_matriz.reaberta_em IS
  'Momento da ultima reabertura. Voto com votado_em anterior a isto e da rodada passada e nao conta.';
COMMENT ON COLUMN public.competicoes_matriz.declaracao_justificativa IS
  'Preenchida so quando a Administracao declara filial diferente da esperada pelo ranking/votacao.';

-- `votado_em` nasce igual ao `created_at` do voto: antes desta migração
-- não havia reabertura, então todo voto existente é da rodada corrente.
ALTER TABLE public.competicao_votos
  ADD COLUMN IF NOT EXISTS votado_em timestamptz;

UPDATE public.competicao_votos
   SET votado_em = created_at
 WHERE votado_em IS NULL;

ALTER TABLE public.competicao_votos
  ALTER COLUMN votado_em SET DEFAULT now();
ALTER TABLE public.competicao_votos
  ALTER COLUMN votado_em SET NOT NULL;

-- Trocar o voto é um UPDATE, e `created_at` não se mexe nele. Sem esta
-- trigger o voto corrigido depois da reabertura continuaria contando
-- como voto da rodada anterior — ou seja, não contaria.
-- `SET search_path` é obrigatório em trigger function (senão o INSERT
-- quebra em contextos com search_path diferente).
CREATE OR REPLACE FUNCTION public._competicao_voto_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  NEW.votado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competicao_voto_touch ON public.competicao_votos;
CREATE TRIGGER trg_competicao_voto_touch
  BEFORE UPDATE ON public.competicao_votos
  FOR EACH ROW EXECUTE FUNCTION public._competicao_voto_touch();

-- ── 2. Quais votos valem ──────────────────────────────────────────
-- Um lugar só decide isso, e todo o resto (empate, quórum, sugestão)
-- pergunta aqui. Recorte: eleitor da Matriz, não desligado, com cargo
-- de voto — admin incluído, porque o desempate dele entra na contagem
-- como qualquer outro (369) — e voto posterior à última reabertura.
CREATE OR REPLACE FUNCTION public._competicao_votos_validos(p_competicao_id uuid)
RETURNS TABLE (votante_id uuid, voto text, filial_escolhida text, eh_conselho boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT v.votante_id,
         v.voto,
         v.filial_escolhida,
         (up.role IN ('ceo','conselheiro')
          OR (up.role = 'gerente' AND COALESCE(up.is_conselheiro,false))) AS eh_conselho
    FROM public.competicao_votos v
    JOIN public.user_profiles    up ON up.id = v.votante_id
    JOIN public.competicoes_matriz c ON c.id = v.competicao_id
   WHERE v.competicao_id = p_competicao_id
     AND up.filial = 'Matriz'
     AND up.desligado_em IS NULL
     AND (up.role IN ('admin','ceo','conselheiro')
          OR (up.role = 'gerente' AND COALESCE(up.is_conselheiro,false)))
     AND v.votado_em >= COALESCE(c.reaberta_em, '-infinity'::timestamptz);
$$;

COMMENT ON FUNCTION public._competicao_votos_validos(uuid) IS
  'Votos que ainda descrevem o placar atual: eleitor da Matriz ativo e voto posterior a ultima reabertura.';

-- Interna: só as RPCs SECURITY DEFINER chamam.
REVOKE ALL ON FUNCTION public._competicao_votos_validos(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Empate passa a ignorar voto da rodada anterior ─────────────
-- Mesma regra da 369 (só o conselho, admin de fora pra o desempate não
-- se anular), agora sobre os votos válidos.
CREATE OR REPLACE FUNCTION public._competicao_empatada(p_competicao_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*) = public.contar_votantes_matriz()
     AND COUNT(*) FILTER (WHERE voto = 'aceita')
       = COUNT(*) FILTER (WHERE voto = 'rejeita')
     AND COUNT(*) > 0
    FROM public._competicao_votos_validos(p_competicao_id)
   WHERE eh_conselho;
$$;

COMMENT ON FUNCTION public._competicao_empatada(uuid) IS
  'True quando todo o conselho votou na rodada corrente e aceita = rejeita. Ignora o voto do admin de proposito: o desempate nao pode se anular.';

REVOKE ALL ON FUNCTION public._competicao_empatada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._competicao_empatada(uuid) TO authenticated;

-- ── 4. Ranking com desempate explícito ────────────────────────────
-- Fonte única da ordem do pódio, pras duas telas e pra própria
-- declaração. Critério, em cascata:
--   média final → média do conselho → taxa de frequência → nº de notas
--   → nome da filial (só pra ordem ser determinística no empate total).
-- Filial sem nota nenhuma vai pro fim: `n = 0` significa "não avaliada",
-- não "nota zero".
CREATE OR REPLACE FUNCTION public.ranking_competicao(p_competicao_id uuid)
RETURNS TABLE (
  posicao        int,
  filial         text,
  media          numeric,
  media_conselho numeric,
  taxa           numeric,
  n              int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH placar AS (
    SELECT public.calcular_placar_competicao(p_competicao_id) AS j
  ),
  linhas AS (
    SELECT e.key                                        AS filial,
           COALESCE((e.value->>'media')::numeric, 0)    AS media,
           COALESCE((e.value->>'media_conselho')::numeric, 0) AS media_conselho,
           NULLIF(e.value->'frequencia'->>'taxa','')::numeric AS taxa,
           COALESCE((e.value->>'n')::int, 0)            AS n
      FROM placar, jsonb_each(placar.j->'por_filial') e
  )
  -- Tudo qualificado por `l`: os nomes do RETURNS TABLE ficam em escopo como
  -- parâmetros e uma referência solta a `media`/`n`/`filial` sairia como
  -- 42702 (column reference is ambiguous).
  SELECT ROW_NUMBER() OVER (
           ORDER BY (l.n > 0) DESC, l.media DESC, l.media_conselho DESC,
                    l.taxa DESC NULLS LAST, l.n DESC, l.filial ASC
         )::int,
         l.filial, l.media, l.media_conselho, l.taxa, l.n
    FROM linhas l;
$$;

COMMENT ON FUNCTION public.ranking_competicao(uuid) IS
  'Ordem oficial do podio, com desempate explicito. Mesma exposicao de calcular_placar_competicao, que ela consome.';

REVOKE ALL ON FUNCTION public.ranking_competicao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ranking_competicao(uuid) TO authenticated;

-- ── 5. Sugestão quando o conselho rejeita o placar ────────────────
-- Espelha o que a tela já calculava: se a maioria dos votos válidos
-- rejeitou, vale a filial mais indicada nos "rejeita → filial". Empate
-- entre indicações devolve NULL — aí a esperada volta a ser o topo do
-- ranking.
CREATE OR REPLACE FUNCTION public._sugestao_rejeicao_competicao(p_competicao_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_aceita  int;
  v_rejeita int;
  v_top     record;
BEGIN
  SELECT COUNT(*) FILTER (WHERE voto = 'aceita'),
         COUNT(*) FILTER (WHERE voto = 'rejeita')
    INTO v_aceita, v_rejeita
    FROM public._competicao_votos_validos(p_competicao_id);

  IF COALESCE(v_rejeita,0) <= COALESCE(v_aceita,0) THEN
    RETURN NULL;
  END IF;

  SELECT filial_escolhida AS f, COUNT(*) AS c
    INTO v_top
    FROM public._competicao_votos_validos(p_competicao_id)
   WHERE voto = 'rejeita' AND filial_escolhida IS NOT NULL
   GROUP BY filial_escolhida
   ORDER BY COUNT(*) DESC
   LIMIT 1;

  IF v_top IS NULL THEN
    RETURN NULL;
  END IF;

  -- Duas filiais com a mesma indicação não formam maioria de ninguém.
  IF (SELECT COUNT(*) FROM (
        SELECT filial_escolhida
          FROM public._competicao_votos_validos(p_competicao_id)
         WHERE voto = 'rejeita' AND filial_escolhida IS NOT NULL
         GROUP BY filial_escolhida
        HAVING COUNT(*) = v_top.c
      ) q) > 1 THEN
    RETURN NULL;
  END IF;

  RETURN v_top.f;
END;
$$;

REVOKE ALL ON FUNCTION public._sugestao_rejeicao_competicao(uuid) FROM PUBLIC, anon, authenticated;

-- ── 6. Declarar vencedora com as três barreiras ───────────────────
-- Ganha `p_justificativa`, então a assinatura muda: DROP antes do
-- CREATE. CREATE OR REPLACE criaria SOBRECARGA e o PostgREST recusa
-- resolver duas funções de mesmo nome.
DROP FUNCTION IF EXISTS public.declarar_vencedora(uuid, text);

CREATE OR REPLACE FUNCTION public.declarar_vencedora(
  p_competicao_id uuid,
  p_vencedora     text,
  p_justificativa text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp      competicoes_matriz;
  v_snapshot  jsonb;
  v_validos   int;
  v_quorum    int;
  v_eleitores int;
  v_sugestao  text;
  v_topo      record;
  v_esperada  text;
  v_just      text := NULLIF(TRIM(COALESCE(p_justificativa,'')), '');
BEGIN
  -- Quem julga é o conselho; quem homologa é a Administração.
  -- `auth_is_admin()` não serve aqui: devolve true para CEO e conselheiro.
  IF auth_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Apenas a Administração declara a vencedora'
      USING ERRCODE = '42501';
  END IF;

  IF p_vencedora NOT IN ('SuperMax','MaxLook','TechMax') THEN
    RAISE EXCEPTION 'Filial inválida: %', p_vencedora USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_comp FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp.status = 'encerrada' THEN
    RAISE EXCEPTION 'Competição já encerrada' USING ERRCODE = 'P0001';
  END IF;
  -- Em 'em_andamento' a competição ainda aceita nota nova: declarar ali
  -- seria congelar um placar que o próprio conselho ainda está mexendo.
  IF v_comp.status <> 'aguardando_encerramento' THEN
    RAISE EXCEPTION 'Encerre a competição antes de declarar (status atual: %)', v_comp.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Quórum de maioria simples — MAIS da metade, não a metade: com 4
  -- eleitores são 3, porque 2×2 é empate e não mandato.
  SELECT COUNT(*)::int INTO v_validos
    FROM public._competicao_votos_validos(p_competicao_id);

  v_eleitores := public.contar_votantes_matriz();
  v_quorum    := GREATEST(1, (GREATEST(v_eleitores, 1) / 2) + 1);

  IF v_validos < v_quorum THEN
    RAISE EXCEPTION 'Quórum não atingido: % de % voto(s) necessário(s)%',
      v_validos, v_quorum,
      CASE WHEN v_comp.reaberta_em IS NOT NULL
           THEN ' — a competição foi reaberta, o conselho precisa votar de novo'
           ELSE '' END
      USING ERRCODE = 'P0001';
  END IF;

  -- Vencedora esperada: o que o conselho decidiu ao rejeitar o placar
  -- ou, na falta disso, o topo do ranking.
  v_sugestao := public._sugestao_rejeicao_competicao(p_competicao_id);

  SELECT r.filial, r.n INTO v_topo
    FROM public.ranking_competicao(p_competicao_id) r
   WHERE r.posicao = 1;

  IF v_topo IS NULL OR v_topo.n = 0 THEN
    RAISE EXCEPTION 'Nenhuma nota registrada — não há placar para homologar'
      USING ERRCODE = 'P0001';
  END IF;

  v_esperada := COALESCE(v_sugestao, v_topo.filial);

  -- Divergir é prerrogativa da Administração, não acidente: exige
  -- justificativa, e ela fica gravada junto do resultado.
  IF p_vencedora IS DISTINCT FROM v_esperada THEN
    IF v_just IS NULL OR LENGTH(v_just) < 20 THEN
      RAISE EXCEPTION
        'Declarar % contraria o resultado (esperada: %). Escreva uma justificativa de ao menos 20 caracteres.',
        p_vencedora, v_esperada
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Sem divergência não há o que justificar: evita texto órfão
    -- descrevendo uma decisão que não houve.
    v_just := NULL;
  END IF;

  -- Congela placar do momento da declaração.
  v_snapshot := calcular_placar_competicao(p_competicao_id);

  UPDATE competicoes_matriz
     SET status                   = 'encerrada',
         vencedora                = p_vencedora,
         placar_snapshot          = v_snapshot,
         declaracao_justificativa = v_just,
         encerrada_por            = auth.uid(),
         updated_at               = now()
   WHERE id = p_competicao_id;

  RETURN jsonb_build_object(
    'competicao_id', p_competicao_id,
    'vencedora',     p_vencedora,
    'esperada',      v_esperada,
    'divergente',    (p_vencedora IS DISTINCT FROM v_esperada),
    'votos',         v_validos,
    'quorum',        v_quorum,
    'snapshot',      v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.declarar_vencedora(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declarar_vencedora(uuid,text,text) TO authenticated;

-- ── 7. Reabrir marca o corte do mandato ───────────────────────────
-- Corpo copiado do estado vigente no banco (371); muda só o
-- `reaberta_em` e o texto do aviso.
CREATE OR REPLACE FUNCTION public.reabrir_competicao(
  p_competicao_id uuid,
  p_data_fim      date DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status   text;
  v_nome     text;
  v_data_fim date;
  v_hoje     date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
  v_nova_fim date;
BEGIN
  IF auth_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Apenas a Administração reabre uma competição'
      USING ERRCODE = '42501';
  END IF;

  SELECT status, nome, data_fim INTO v_status, v_nome, v_data_fim
    FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'encerrada' THEN
    RAISE EXCEPTION 'Só competição encerrada pode ser reaberta (status atual: %)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF p_data_fim IS NOT NULL AND p_data_fim < v_hoje THEN
    RAISE EXCEPTION 'A nova data de fim não pode ser anterior a hoje' USING ERRCODE = 'P0001';
  END IF;

  -- Só empurra se precisa: competição ainda dentro do prazo mantém a data
  -- que o admin definiu.
  v_nova_fim := COALESCE(p_data_fim, GREATEST(v_data_fim, v_hoje));

  UPDATE competicoes_matriz
     SET status                   = 'em_andamento',
         data_fim                 = v_nova_fim,
         vencedora                = NULL,
         placar_snapshot          = NULL,
         declaracao_justificativa = NULL,
         encerrada_por            = NULL,
         -- O corte do mandato: o que foi votado descrevia o placar
         -- anterior. Os votos ficam registrados, mas param de contar.
         reaberta_em              = now(),
         updated_at               = now()
   WHERE id = p_competicao_id;

  -- A filial viu o pódio e o card de vencedora sumir da tela dela. Sem
  -- aviso isso lê como falha do sistema.
  INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
  VALUES (
    'all', 'info',
    'Competição reaberta',
    format('"%s" voltou a correr até %s — o resultado anterior deixa de valer e o conselho vota de novo antes da próxima declaração.',
           v_nome, to_char(v_nova_fim, 'DD/MM/YYYY')),
    'matriz-competicao', 'Alta', auth.uid(), p_competicao_id, 'competicao_reaberta', 'Matriz'
  );

  RETURN v_nova_fim;
END;
$$;

REVOKE ALL ON FUNCTION public.reabrir_competicao(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_competicao(uuid,date) TO authenticated;

-- ── 8. Eleitor tem de ser da Matriz ───────────────────────────────
-- As três policies cobravam o cargo e esqueciam a filial. `auth_is_admin()`
-- também não olha filial — por isso a leitura passa a ser um EXISTS
-- nominal em vez dela.
DROP POLICY IF EXISTS voto_read ON public.competicao_votos;
CREATE POLICY voto_read ON public.competicao_votos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
       WHERE up.id = auth.uid()
         AND up.filial = 'Matriz'
         AND (up.role IN ('admin','ceo','conselheiro')
              OR (up.role = 'gerente' AND COALESCE(up.is_conselheiro,false)))
    )
  );

DROP POLICY IF EXISTS voto_write ON public.competicao_votos;
CREATE POLICY voto_write ON public.competicao_votos
  FOR INSERT TO authenticated
  WITH CHECK (
    votante_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
       WHERE up.id = auth.uid()
         AND up.filial = 'Matriz'
         AND up.desligado_em IS NULL
         AND (
           up.role IN ('ceo','conselheiro')
           OR (up.role = 'gerente' AND COALESCE(up.is_conselheiro,false))
           -- Admin entra na votação só pra desempatar (369).
           OR (up.role = 'admin' AND public._competicao_empatada(competicao_id))
         )
    )
  );

-- UPDATE agora vale também em 'em_andamento': é o estado em que a
-- competição volta ao reabrir, e é justamente aí que o conselho precisa
-- refazer o voto.
DROP POLICY IF EXISTS voto_update ON public.competicao_votos;
CREATE POLICY voto_update ON public.competicao_votos
  FOR UPDATE TO authenticated
  USING (
    votante_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.competicoes_matriz c
       WHERE c.id = competicao_votos.competicao_id
         AND c.status IN ('aguardando_encerramento','em_andamento')
    )
  )
  WITH CHECK (
    votante_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
       WHERE up.id = auth.uid()
         AND up.filial = 'Matriz'
         AND up.desligado_em IS NULL
         AND (
           up.role IN ('ceo','conselheiro')
           OR (up.role = 'gerente' AND COALESCE(up.is_conselheiro,false))
           OR (up.role = 'admin' AND public._competicao_empatada(competicao_id))
         )
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
