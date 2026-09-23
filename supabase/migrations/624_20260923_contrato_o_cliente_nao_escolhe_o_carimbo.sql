-- 624 — Contrato: o cliente não escolhe o carimbo nem o arquivo alheio.
--
-- Achados da revisão da 623, os dois exercitados como gerente em transação
-- revertida antes deste arquivo:
--
-- (a) O rascunho aceitava QUALQUER `arquivo_path`. A policy de leitura do
--     bucket libera o objeto para quem enxerga um contrato apontando para ele —
--     então o gerente da SuperMax gravava um rascunho com o caminho do
--     contrato da TechMax e baixava o arquivo dela. Caminho adivinhado é
--     exatamente o que a policy do bucket existe para barrar.
--     Conserto: o arquivo tem de estar na pasta de quem grava (a mesma régua do
--     upload na 623). Checado só quando o caminho muda, para a edição de texto
--     do rascunho não depender disso.
--
-- (b) Carimbos vinham do navegador: `criado_por_nome` ("Professor Fulano" saía
--     no manifesto), `numero` repetido, `enviado_em`/`vigente_desde` e o
--     `contrato_pai_id` de um contrato entre outras unidades (aditivo falso).
--     Conserto: gatilho que carimba no INSERT e congela na edição de rascunho;
--     `numero` vira GENERATED ALWAYS + UNIQUE; aditivo só de contrato vigente
--     entre as MESMAS partes.
--
-- As RPCs (SECURITY DEFINER) mudam status e carimbos de ciclo — o gatilho
-- deixa passar toda UPDATE que troca o status, e o cliente não troca status
-- (a RLS de UPDATE exige rascunho antes e depois).
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── numero: o banco numera, e número não se repete ─────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contratos'
       AND column_name = 'numero' AND identity_generation = 'BY DEFAULT'
  ) THEN
    ALTER TABLE public.contratos ALTER COLUMN numero SET GENERATED ALWAYS;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contratos_numero_key'
  ) THEN
    ALTER TABLE public.contratos ADD CONSTRAINT contratos_numero_key UNIQUE (numero);
  END IF;
END $$;

-- ── Gatilho de carimbo ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contratos_carimbo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_pai  public.contratos;
BEGIN
  -- Sem sessão (service_role, migração, seed): quem escreve responde pelo que
  -- escreve. O gatilho protege o caminho do navegador.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;
    NEW.criado_por          := v_uid;
    NEW.criado_por_nome     := v_nome;
    NEW.status              := 'rascunho';
    NEW.enviado_em          := NULL;
    NEW.vigente_desde       := NULL;
    NEW.encerrado_em        := NULL;
    NEW.encerrado_por_nome  := NULL;
    NEW.motivo_encerramento := NULL;
    NEW.created_at          := now();

    IF split_part(NEW.arquivo_path, '/', 1) <> v_uid::text THEN
      RAISE EXCEPTION 'O arquivo do contrato tem de ser um que você mesmo enviou.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.contrato_pai_id IS NOT NULL THEN
      SELECT * INTO v_pai FROM public.contratos WHERE id = NEW.contrato_pai_id;
      IF NOT FOUND
         OR v_pai.status <> 'vigente'
         OR NOT (
              (v_pai.parte_a = NEW.parte_a AND v_pai.parte_b = NEW.parte_b)
           OR (v_pai.parte_a = NEW.parte_b AND v_pai.parte_b = NEW.parte_a)
         ) THEN
        RAISE EXCEPTION 'Aditivo só de contrato vigente entre as mesmas duas partes.'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE que troca status é das RPCs; o cliente não chega aqui com status
  -- diferente (a RLS exige rascunho antes e depois).
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Edição de rascunho pelo navegador: o que é carimbo fica como estava.
  NEW.numero              := OLD.numero;
  NEW.parte_a             := OLD.parte_a;
  NEW.criado_por          := OLD.criado_por;
  NEW.criado_por_nome     := OLD.criado_por_nome;
  NEW.contrato_pai_id     := OLD.contrato_pai_id;
  NEW.created_at          := OLD.created_at;
  NEW.enviado_em          := OLD.enviado_em;
  NEW.vigente_desde       := OLD.vigente_desde;
  NEW.encerrado_em        := OLD.encerrado_em;
  NEW.encerrado_por_nome  := OLD.encerrado_por_nome;
  NEW.motivo_encerramento := OLD.motivo_encerramento;

  IF NEW.arquivo_path IS DISTINCT FROM OLD.arquivo_path
     AND split_part(NEW.arquivo_path, '/', 1) <> v_uid::text THEN
    RAISE EXCEPTION 'O arquivo do contrato tem de ser um que você mesmo enviou.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.contratos_carimbo() IS
  'Migr. 624 — carimba autor/ciclo no INSERT, congela na edição de rascunho, exige arquivo na pasta de quem grava e aditivo entre as mesmas partes.';

REVOKE ALL ON FUNCTION public.contratos_carimbo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contratos_carimbo_trg ON public.contratos;
CREATE TRIGGER contratos_carimbo_trg
  BEFORE INSERT OR UPDATE ON public.contratos
  FOR EACH ROW EXECUTE FUNCTION public.contratos_carimbo();

COMMIT;

NOTIFY pgrst, 'reload schema';
