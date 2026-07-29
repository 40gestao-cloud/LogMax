-- 284 — Cada setor no seu papel: comprar, receber, conferir, pagar
--
-- Fecha o que a leitura da Etapa 8 expôs sobre o ciclo de compras:
--
--   * `recebimentos` aceitava `compras` — quem emite o pedido confirmava a
--     entrega dele. É o furo clássico, e é literalmente o caso do Extrato de
--     Tomate: dois pedidos, dois recebimentos "conferidos e fechados", duas
--     contas pagas, sem ninguém para dizer que a segunda entrega não chegou.
--     Some-se a isso que nas turmas não existe usuário com setor `compras`:
--     o `logistica` enxerga Compras E Estoque, então é sempre a mesma pessoa.
--   * a conta a pagar de um pedido virava `Pago` sem que ninguém tivesse
--     conferido a mercadoria — faltava o three-way match (pedido ×
--     recebimento × nota).
--   * `requisicoes_estoque` repetia o defeito que a 282 corrigiu em compras:
--     `logistica` criava e `logistica` aprovava.
--   * e a requisição interna continuava fechada a `estoque`/`logistica`,
--     enquanto a de compra já tinha sido aberta a todo setor (migr. 283).
--
-- Régua aplicada, a mesma das 282/283: quem lança não decide, quem compra não
-- recebe, e o que a área precisa ela mesma pede.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Recebimento é do almoxarifado
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS compras_all ON public.recebimentos;
CREATE POLICY estoque_all ON public.recebimentos
  FOR ALL TO authenticated
  USING      (public.auth_in_setor('estoque', 'logistica') OR public.auth_gerente_da(filial))
  WITH CHECK (public.auth_in_setor('estoque', 'logistica') OR public.auth_gerente_da(filial));

-- Segundo par de olhos: quem emitiu o pedido não fecha o recebimento dele.
-- Como hoje uma pessoa só acumula Compras e Estoque na filial, o fechamento
-- nesse caso exige o gerente — que é o nível acima, não um cargo inventado.
CREATE OR REPLACE FUNCTION public.recebimento_segregacao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido_autor uuid;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Só o fechamento é gate; registrar recebimento parcial segue livre.
  IF NEW.status IS DISTINCT FROM 'Concluído' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Concluído' THEN
    RETURN NEW;
  END IF;

  SELECT criado_por INTO v_pedido_autor
    FROM public.pedidos WHERE id = NEW.pedido_id;

  IF v_pedido_autor IS NOT NULL
     AND v_pedido_autor = auth.uid()
     AND NOT (public.auth_is_admin() OR public.auth_gerente_da(NEW.filial)) THEN
    RAISE EXCEPTION 'Quem emitiu o pedido não confere o próprio recebimento. Peça ao gerente da filial para fechar.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recebimento_segregacao_guard ON public.recebimentos;
CREATE TRIGGER trg_recebimento_segregacao_guard
  BEFORE INSERT OR UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.recebimento_segregacao_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Three-way match: não se paga o que ninguém conferiu
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.conta_pagar_exige_recebimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'Pago' OR OLD.status = 'Pago' OR NEW.pedido_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.recebimentos r
     WHERE r.pedido_id = NEW.pedido_id
       AND COALESCE(r.ativo, true)
       AND r.status = 'Concluído'
  ) THEN
    RAISE EXCEPTION 'Esta conta é de um pedido de compra e a mercadoria ainda não foi conferida no Estoque. Registre o recebimento antes de pagar.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_conta_pagar_exige_recebimento ON public.contas_pagar;
CREATE TRIGGER trg_conta_pagar_exige_recebimento
  BEFORE UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.conta_pagar_exige_recebimento();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Requisição interna: quem precisa pede, quem atende não decide sozinho
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.requisicoes_estoque
  ADD COLUMN IF NOT EXISTS setor_solicitante text;

COMMENT ON COLUMN public.requisicoes_estoque.setor_solicitante IS
  'Setor de quem pediu o material, derivado do user_profile na criação.';

DROP FUNCTION IF EXISTS public.criar_requisicao_estoque(uuid, text, integer, text, text);

CREATE OR REPLACE FUNCTION public.criar_requisicao_estoque(
  p_produto_id  uuid,
  p_solicitante text,
  p_qtd         integer DEFAULT 1,
  p_destino     text DEFAULT NULL,
  p_filial      text DEFAULT 'SuperMax'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req   requisicoes_estoque;
  v_nome  text;
  v_setor text;
BEGIN
  -- Era _assert_rpc('estoque','logistica'). Material do almoxarifado é pedido
  -- por quem precisa dele — igual à requisição de compra (migr. 283).
  PERFORM public._assert_rpc();

  IF p_produto_id IS NULL THEN
    RAISE EXCEPTION 'Produto é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = p_produto_id) THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd < 1 THEN
    p_qtd := 1;
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;

  IF NOT public.auth_pode_filial(p_filial) THEN
    RAISE EXCEPTION 'Você só abre requisição para a sua filial.' USING ERRCODE = '42501';
  END IF;

  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.requisicoes_estoque (
    produto_id, solicitante, setor_solicitante, qtd, destino, status, filial
  ) VALUES (
    p_produto_id,
    COALESCE(v_nome, trim(p_solicitante)),
    v_setor,
    p_qtd,
    NULLIF(trim(COALESCE(p_destino,'')), ''),
    'Pendente', p_filial
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_estoque (requisicao_estoque_id, status, filial)
  VALUES (v_req.id, 'Pendente', p_filial);

  RETURN to_jsonb(v_req);
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_requisicao_estoque(uuid, text, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_requisicao_estoque(uuid, text, integer, text, text)
  TO authenticated;

-- Quem pede material não é quem libera a saída dele do estoque.
CREATE OR REPLACE FUNCTION public.requisicao_estoque_decisao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  IF public.auth_is_admin() OR public.auth_gerente_da(NEW.filial) THEN
    RETURN NEW;
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem pede o material não libera a própria requisição.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.auth_in_setor('estoque', 'logistica') THEN
    RAISE EXCEPTION 'Só o Estoque (ou o gerente da filial) decide requisição de material.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_requisicao_estoque_decisao_guard ON public.requisicoes_estoque;
CREATE TRIGGER trg_requisicao_estoque_decisao_guard
  BEFORE UPDATE ON public.requisicoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.requisicao_estoque_decisao_guard();

-- O autor acompanha o que pediu (mesma lógica da 283 em `requisicoes`).
DROP POLICY IF EXISTS requisicoes_estoque_autor_select ON public.requisicoes_estoque;
CREATE POLICY requisicoes_estoque_autor_select ON public.requisicoes_estoque
  FOR SELECT TO authenticated
  USING (criado_por = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Modo Aula: remapeia os submenus que mudaram de nome/lugar
--
-- Os viewIds derivam do label do menu, então renomear a tela muda o id. Uma
-- whitelist de aula guardada com o id antigo passaria a liberar/esconder a
-- tela errada — em silêncio, no meio da aula.
--
--   Compras → Requisições            → Compras → Requisições Recebidas
--   Compras → Minhas aprovações      → Empresa → Aprovações (é do gerente)
--   Compras → Recebimentos           → Estoque → Recebimentos
--   Estoque → Requisições            → Estoque → Requisições Recebidas
--   Estoque → Minhas Aprovações      → Estoque → Liberar Requisições
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.aula_config
   SET submenus_ativos = (
     SELECT array_agg(DISTINCT novo)
       FROM (
         SELECT CASE s
           WHEN 'compras-requisições'        THEN 'compras-requisiçõesrecebidas'
           WHEN 'compras-minhasaprovações'   THEN 'empresa-aprovações'
           WHEN 'compras-recebimentos'       THEN 'estoque-recebimentos'
           WHEN 'estoque-requisições'        THEN 'estoque-requisiçõesrecebidas'
           WHEN 'estoque-minhasaprovações'   THEN 'estoque-liberarrequisições'
           ELSE s
         END AS novo
         FROM unnest(submenus_ativos) AS s
       ) m
   )
 WHERE submenus_ativos && ARRAY[
   'compras-requisições', 'compras-minhasaprovações', 'compras-recebimentos',
   'estoque-requisições', 'estoque-minhasaprovações'
 ];

COMMIT;

NOTIFY pgrst, 'reload schema';
