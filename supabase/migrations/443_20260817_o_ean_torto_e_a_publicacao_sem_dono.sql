-- 443_20260817_o_ean_torto_e_a_publicacao_sem_dono.sql
--
-- DOIS ACHADOS DA AUDITORIA DO CADASTRO DE PRODUTOS QUE FICARAM EM ABERTO.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. EAN COM DÍGITO VERIFICADOR ERRADO SALVA
--
-- O campo aceitava qualquer coisa. Dígito verificador errado não é "quase
-- certo": `normalizeEan13` recusa o número, a etiqueta é silenciosamente
-- omitida da grade de impressão (`drawEtiquetasGridOnDoc` filtra por
-- `norm.valid`) e o leitor do PDV nunca acha o produto. O erro aparece dias
-- depois, na frente do cliente, longe de onde foi cometido.
--
-- E havia o caso mais comum: o fornecedor manda os 12 dígitos, o aluno digita
-- os 12, a tela mostra o 13º calculado — e gravava os 12. O banco ficava com
-- um "EAN" que nenhum leitor aceita.
--
-- A tela passa a barrar e a gravar o número completo no mesmo commit. O
-- gatilho aqui é a regra que vale para o F12, para a importação e para
-- qualquer tela futura.
--
-- Não há backfill: o gatilho só olha o valor que está sendo escrito. Nas 4
-- turmas os 23 produtos com EAN estão no formato de 13 dígitos — e mesmo que
-- algum tivesse dígito torto, ele continua onde está até alguém reescrever
-- aquele campo. Migração não conserta cadastro de aluno por adivinhação.
--
-- **E o EAN passa a ser obrigatório em mercadoria.** Produto que vai ao caixa
-- sem código de barras é produto que o operador digita à mão na fila — a etapa
-- que o PDV existe para eliminar. Vale só para `tipo = 'estoque_venda'`:
-- patrimônio não passa no caixa, e material de consumo sai por requisição, não
-- por leitura.
--
-- A cobrança é no que se escreve, não no que já está gravado:
--
--   INSERT de mercadoria sem EAN            → recusado
--   UPDATE que APAGA o EAN de uma mercadoria → recusado
--   UPDATE de outro campo num produto legado sem EAN → passa
--
-- A terceira linha é deliberada. Existem produtos cadastrados antes desta
-- regra; travar o UPDATE deles transformaria "corrigir o preço" em "achar o
-- código de barras da caixa que já foi para o lixo", e a turma pararia de
-- corrigir preço.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1b. E O MESMO EAN EM DOIS PRODUTOS DA MESMA LOJA
--
-- Dígito verificador correto não impede repetição, e é a repetição que quebra
-- o caixa: o leitor devolve dois produtos e o PDV escolhe um — o preço errado
-- sai na frente do cliente sem ninguém perceber. Nas 4 turmas isso já
-- aconteceu (conferido hoje):
--
--   Contabilidade  MaxLook  7894342716124 em duas peças diferentes
--                  TechMax  7890000000000 em dois smartphones
--   Adm            SuperMax 7890000000000 em três produtos (bebida, arroz,
--                           macarrão)
--
-- `7890000000000` tem dígito verificador válido — é o "789 e enche de zero"
-- que o aluno digita para o formulário deixar passar. Só a unicidade pega.
--
-- A régua é POR FILIAL, não global: as três unidades são lojas diferentes, e a
-- mesma Coca-Cola cadastrada na SuperMax e (um dia) noutra unidade é o mesmo
-- GTIN do fabricante, legitimamente repetido. Dentro de uma loja, não.
--
-- Duas camadas, porque as duas turmas acima não podem receber o índice hoje:
--
--   * o gatilho recusa a repetição em toda escrita nova, nas 4 turmas;
--   * o índice único entra onde não há duplicata (ERP e Aprendiz), e é pulado
--     com aviso onde há. Depois que a turma corrigir os cadastros, roda-se o
--     bloco de novo e o índice nasce.
--
-- Não escolho qual dos dois produtos perde o EAN: quem sabe qual é o arroz e
-- qual é o macarrão é a turma, e apagar o dado certo por adivinhação é pior
-- que a duplicata.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. PUBLICAR SEM PASSAR PELA CHECAGEM DE AUTORIDADE
--
-- `produto_loja_online_guard` era BEFORE **UPDATE**. Quem cadastra produto
-- (compras, logística, estoque — a policy de INSERT só cobra `auth_pode_filial`)
-- podia nascer com `loja_online = true` no próprio INSERT e publicar na loja
-- sem ser vendas, marketing, gerente nem Matriz. O guard só acordava na
-- segunda escrita, quando o produto já estava publicado.
--
-- `vitrine_publica` estava pior: não tinha guard nenhum. A autoridade morava
-- só dentro da RPC `marcar_vitrine` (admin/CEO ou marketing), e um UPDATE
-- direto na tabela — que a policy `update_produtos` permite a qualquer um da
-- filial — punha o produto no carrossel da TELA DE LOGIN, que é pública e
-- anônima. Mais exposto que a loja, e sem nenhuma porta.
--
-- Os dois passam a ser cobrados no INSERT e no UPDATE, cada um com a
-- autoridade que já era a dele:
--
--   loja_online      `auth_opera_loja` — vendas, marketing ou gerente da filial
--   vitrine_publica  a régua da `marcar_vitrine` — admin/CEO ou marketing
--
-- Este gatilho responde "QUEM pode publicar". O `fn_produto_publicavel` da
-- migr. 440 responde "O QUE pode ser publicado" (só mercadoria) e continua
-- separado, de propósito: são duas perguntas, e juntá-las faria mudar uma
-- mexer na outra.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. EAN-13 ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ean13_valido(p_ean text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_soma int := 0;
  i      int;
BEGIN
  -- Vazio é válido: EAN é opcional. Quem quiser exigir, exige na tela.
  IF p_ean IS NULL OR btrim(p_ean) = '' THEN
    RETURN true;
  END IF;
  IF p_ean !~ '^\d{13}$' THEN
    RETURN false;
  END IF;
  -- Posições ímpares peso 1, pares peso 3 (padrão GS1).
  FOR i IN 1..12 LOOP
    v_soma := v_soma + substr(p_ean, i, 1)::int * CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END;
  END LOOP;
  RETURN ((10 - (v_soma % 10)) % 10) = substr(p_ean, 13, 1)::int;
END;
$function$;

COMMENT ON FUNCTION public.ean13_valido(text) IS
  'Confere o dígito verificador de um EAN-13 (migr. 443). Vazio conta como válido: o campo é opcional.';

-- Código interno para quem não tem o do fabricante — o caso da roupa sem
-- etiqueta, do seminovo e de toda variante aberta pela grade (migr. 445). O
-- prefixo 2 é o que a GS1 reserva para uso interno da loja: não colide com
-- código de fabricante nenhum, e é exatamente o que supermercado usa para
-- pesar item a granel.
CREATE OR REPLACE FUNCTION public.ean13_interno()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public'
AS $function$
DECLARE
  v_base text;
  v_soma int := 0;
  i      int;
BEGIN
  LOOP
    v_base := '2' || lpad((floor(random() * 100000000000))::bigint::text, 11, '0');
    v_soma := 0;
    FOR i IN 1..12 LOOP
      v_soma := v_soma + substr(v_base, i, 1)::int * CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END;
    END LOOP;
    v_base := v_base || ((10 - (v_soma % 10)) % 10)::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.produtos WHERE ean = v_base);
  END LOOP;
  RETURN v_base;
END;
$function$;

COMMENT ON FUNCTION public.ean13_interno() IS
  'EAN-13 de uso interno (prefixo 2, migr. 443) para produto sem código de fabricante. Verifica colisão em produtos.ean antes de devolver.';

CREATE OR REPLACE FUNCTION public.fn_produto_ean_valido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_digitos text;
BEGIN
  v_digitos := regexp_replace(COALESCE(NEW.ean, ''), '\D', '', 'g');

  IF v_digitos = '' THEN
    -- Mercadoria sem código de barras é digitação à mão na fila do caixa. Só
    -- não se cobra do que já estava assim antes desta regra (ver cabeçalho).
    IF COALESCE(NEW.tipo, 'estoque_venda') = 'estoque_venda'
       AND (TG_OP = 'INSERT'
            OR regexp_replace(COALESCE(OLD.ean, ''), '\D', '', 'g') <> '') THEN
      RAISE EXCEPTION
        'Código de barras é obrigatório em mercadoria: é ele que o PDV lê. Patrimônio e material de uso e consumo não precisam.'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.ean := NULL;
    RETURN NEW;
  END IF;

  -- 12 dígitos é o que vem impresso na caixa do fornecedor sem o verificador.
  -- Completar aqui é o mesmo que a tela faz, e evita gravar um número que
  -- nenhum leitor aceita.
  IF length(v_digitos) = 12 THEN
    NEW.ean := v_digitos || (
      SELECT ((10 - (SUM(substr(v_digitos, i, 1)::int
                         * CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END) % 10)) % 10)::text
        FROM generate_series(1, 12) AS i
    );
    RETURN NEW;
  END IF;

  IF NOT public.ean13_valido(v_digitos) THEN
    RAISE EXCEPTION
      'EAN-13 inválido: "%". São 12 dígitos (o verificador é calculado) ou 13 com o dígito verificador correto.',
      NEW.ean USING ERRCODE = 'P0001';
  END IF;

  -- Repetido dentro da MESMA loja: o leitor do caixa devolveria dois produtos.
  IF EXISTS (
    SELECT 1 FROM public.produtos p
     WHERE p.ean = v_digitos
       AND p.filial IS NOT DISTINCT FROM NEW.filial
       AND COALESCE(p.ativo, true)
       AND p.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    RAISE EXCEPTION
      'O código de barras % já está em outro produto desta unidade. Dois produtos com o mesmo EAN fazem o PDV vender o errado.',
      v_digitos USING ERRCODE = 'P0001';
  END IF;

  NEW.ean := v_digitos;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_produto_ean_valido ON public.produtos;
CREATE TRIGGER trg_produto_ean_valido
  BEFORE INSERT OR UPDATE OF ean ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_ean_valido();

-- O índice é a garantia dura — o gatilho ainda perde para duas escritas
-- simultâneas. Só nasce onde a base já está limpa; nas turmas com duplicata
-- fica o aviso, e o bloco pode ser rodado de novo depois da correção.
DO $ean$
DECLARE
  v_dups int;
  v_lista text;
BEGIN
  SELECT count(*), string_agg(DISTINCT filial || ' ' || ean, ', ')
    INTO v_dups, v_lista
    FROM (
      SELECT filial, ean FROM public.produtos
       WHERE COALESCE(ativo, true) AND ean IS NOT NULL AND btrim(ean) <> ''
       GROUP BY filial, ean HAVING count(*) > 1
    ) d;

  IF v_dups > 0 THEN
    RAISE NOTICE
      'Índice único de EAN NÃO criado: % duplicata(s) nesta turma (%). O gatilho já impede novas; corrija os cadastros e rode este bloco de novo.',
      v_dups, v_lista;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_ean_filial
      ON public.produtos (filial, ean)
      WHERE ativo = true AND ean IS NOT NULL AND ean <> '';
  END IF;
END
$ean$;

-- ── 2. Quem publica ─────────────────────────────────────────────────────────
--
-- Corpo copiado do banco, com o INSERT tratado (`OLD` não existe em INSERT —
-- lê-lo ali levantaria "record old is not assigned yet") e a vitrine incluída.

CREATE OR REPLACE FUNCTION public.produto_loja_online_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_muda_loja    boolean;
  v_muda_vitrine boolean;
  v_role         text;
  v_setor        text;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Nascer desligado não é publicar. Só o `true` é ato.
    v_muda_loja    := COALESCE(NEW.loja_online, false);
    v_muda_vitrine := COALESCE(NEW.vitrine_publica, false);
  ELSE
    v_muda_loja    := NEW.loja_online     IS DISTINCT FROM OLD.loja_online;
    v_muda_vitrine := NEW.vitrine_publica IS DISTINCT FROM OLD.vitrine_publica;
  END IF;

  IF v_muda_loja AND NOT COALESCE(
       public.auth_opera_loja(COALESCE(NEW.filial, OLD.filial)), false) THEN
    RAISE EXCEPTION 'Publicar na loja pública é de vendas, marketing, gerente da filial ou Matriz.'
      USING ERRCODE = '42501';
  END IF;

  -- Vitrine é o carrossel da tela de login: público e anônimo. A régua é a
  -- mesma da RPC `marcar_vitrine`, que era a única porta que a checava.
  IF v_muda_vitrine THEN
    SELECT role, setor INTO v_role, v_setor
      FROM public.user_profiles WHERE id = auth.uid();

    IF COALESCE(v_role, '') NOT IN ('admin', 'ceo')
       AND COALESCE(v_setor, '') NOT IN ('marketing', 'all') THEN
      RAISE EXCEPTION 'A vitrine pública é do Marketing (ou admin/CEO) — é a tela de login da holding.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_produto_loja_online_guard ON public.produtos;
CREATE TRIGGER trg_produto_loja_online_guard
  BEFORE INSERT OR UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.produto_loja_online_guard();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. o dígito verificador é conferido de verdade
--   SELECT public.ean13_valido('7891234567895') AS deve_ser_true,
--          public.ean13_valido('7891234567890') AS deve_ser_false,
--          public.ean13_valido(NULL)            AS deve_ser_true;
--
--   -- 2. os gatilhos existem e cobrem INSERT
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgrelid = 'public.produtos'::regclass AND NOT tgisinternal
--      AND tgname IN ('trg_produto_ean_valido', 'trg_produto_loja_online_guard');
--   -- esperado: os dois com "BEFORE INSERT OR UPDATE".
--
--   -- 3. nenhum EAN vigente ficou fora do formato
--   SELECT count(*) FROM produtos
--    WHERE ean IS NOT NULL AND btrim(ean) <> '' AND NOT public.ean13_valido(ean);
--
--   -- 4. duplicatas a corrigir com a turma (e o índice, onde já nasceu)
--   SELECT filial, ean, count(*), string_agg(codigo || ' ' || nome, ' | ')
--     FROM produtos WHERE ativo AND ean IS NOT NULL AND btrim(ean) <> ''
--    GROUP BY 1, 2 HAVING count(*) > 1;
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'produtos' AND indexname = 'uq_produtos_ean_filial';
--
-- E o teste que vale a aula: cadastrar produto com EAN 7891234567891 (dígito
-- torto) e ver a recusa; digitar só os 12 e conferir que o 13º chega gravado.
-- =================================================================
