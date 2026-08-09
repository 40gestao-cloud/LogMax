-- Snapshot do placar nasce com o resultado, não com o estado anterior.
--
-- Sintoma: competição declarada, vencedora na tela, e o chip da Competição
-- dizendo "Aguardando encerramento".
--
-- Causa: `declarar_vencedora` congela o placar ANTES do UPDATE que grava
-- status='encerrada' e a vencedora. O snapshot fica, para sempre, com
-- `competicao.status = 'aguardando_encerramento'` e `vencedora = null` —
-- descrevendo o instante anterior à declaração, que é justamente o que ele
-- não deveria descrever.
--
-- Quem sofre: todo mundo que NÃO é da Matriz. `calcular_placar_competicao`
-- (migr. 373) devolve o cálculo ao vivo para Matriz e o snapshot congelado
-- para o resto — então a Matriz via 'encerrada' e a filial via o estado
-- velho, a partir da mesma competição. O front foi corrigido junto para
-- preferir a linha da tabela, mas o dado errado tinha de sair do banco:
-- o snapshot também alimenta PDF e análise de IA.
--
-- Correção em duas partes: a função carimba status e vencedora no snapshot
-- antes de gravar, e o backfill conserta o que já está gravado.

BEGIN;

-- ── 1. A função ───────────────────────────────────────────────────
-- Cópia da versão vigente (migr. 375, idêntica nos 4 projetos —
-- md5 b49ae0b7a330b5c125a4db80e60a6428) com o carimbo acrescentado.
CREATE OR REPLACE FUNCTION public.declarar_vencedora(
  p_competicao_id uuid,
  p_vencedora     text,
  p_justificativa text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_comp       competicoes_matriz;
  v_snapshot   jsonb;
  v_validos    int;
  v_quorum     int;
  v_eleitores  int;
  v_sugestao   text;
  v_topo       record;
  v_esperada   text;
  v_sem_nota   int;
  v_divergente boolean;
  v_just       text := NULLIF(TRIM(COALESCE(p_justificativa,'')), '');
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

  v_esperada   := COALESCE(v_sugestao, v_topo.filial);
  v_divergente := p_vencedora IS DISTINCT FROM v_esperada;
  v_sem_nota   := public.participantes_sem_nota_competicao(p_competicao_id);

  -- Divergir do apurado é prerrogativa da Administração, não acidente.
  IF v_divergente AND (v_just IS NULL OR LENGTH(v_just) < 20) THEN
    RAISE EXCEPTION
      'Declarar % contraria o resultado (esperada: %). Escreva uma justificativa de ao menos 20 caracteres.',
      p_vencedora, v_esperada
      USING ERRCODE = 'P0001';
  END IF;

  -- Homologar média de gente que metade do conselho não avaliou é o
  -- cenário em que ela mente mais. Não trava — conselheiro ausente
  -- pararia a competição pra sempre —, mas exige que fique escrito.
  IF v_sem_nota > 0 AND (v_just IS NULL OR LENGTH(v_just) < 20) THEN
    RAISE EXCEPTION
      '% participante(s) ainda sem nota de todo o conselho. Complete as notas ou justifique por escrito (20+ caracteres) por que o placar já pode ser homologado.',
      v_sem_nota
      USING ERRCODE = 'P0001';
  END IF;

  -- Sem divergência e com avaliação completa não há o que justificar:
  -- evita texto órfão descrevendo decisão que não houve.
  IF NOT v_divergente AND v_sem_nota = 0 THEN
    v_just := NULL;
  END IF;

  -- Congela placar do momento da declaração.
  v_snapshot := calcular_placar_competicao(p_competicao_id);

  -- O snapshot é lido como se fosse o resultado, então ele tem de conter o
  -- resultado. Sem este carimbo ele guarda o instante ANTERIOR ao UPDATE
  -- abaixo, e a filial — que recebe o snapshot em vez do cálculo ao vivo —
  -- lê "aguardando encerramento" e vencedora nula numa competição decidida.
  IF v_snapshot ? 'competicao' THEN
    v_snapshot := jsonb_set(v_snapshot, '{competicao,status}',    '"encerrada"'::jsonb);
    v_snapshot := jsonb_set(v_snapshot, '{competicao,vencedora}', to_jsonb(p_vencedora));
  END IF;

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
    'divergente',    v_divergente,
    'sem_nota',      v_sem_nota,
    'votos',         v_validos,
    'quorum',        v_quorum,
    'snapshot',      v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.declarar_vencedora(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declarar_vencedora(uuid,text,text) TO authenticated;

-- ── 2. Backfill ───────────────────────────────────────────────────
-- Competição já declarada continua mostrando o estado velho para a filial
-- enquanto o snapshot não for corrigido — e não há como recalculá-lo sem
-- desfazer o congelamento. Só o cabeçalho muda; as médias ficam intactas.
UPDATE competicoes_matriz
   SET placar_snapshot = jsonb_set(
         jsonb_set(placar_snapshot, '{competicao,status}', '"encerrada"'::jsonb),
         '{competicao,vencedora}', to_jsonb(vencedora))
 WHERE status = 'encerrada'
   AND vencedora IS NOT NULL
   AND placar_snapshot ? 'competicao'
   AND placar_snapshot->'competicao'->>'status' IS DISTINCT FROM 'encerrada';

COMMIT;
