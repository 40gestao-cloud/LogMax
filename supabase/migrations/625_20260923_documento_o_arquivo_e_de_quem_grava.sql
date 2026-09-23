-- 625 — Documento: o arquivo é de quem grava, e de nenhum outro documento.
--
-- O mesmo furo que a 624 fechou em `contratos`, aberto em `documentos` desde a
-- 528 (o gerente passou a fazer INSERT/UPDATE). A policy `documentos_bucket_read`
-- libera o objeto para quem enxerga um documento com `arquivo_path = name`, e as
-- policies de INSERT/UPDATE não olham o `arquivo_path`. Exercitado como gerente
-- da MaxLook em transação revertida (Aprendiz, 23/09): um rascunho com
-- `filial_alvo='MaxLook'` e o caminho do PDF só da TechMax fazia o objeto da
-- TechMax aparecer em storage.objects (0 → 1 linha) — ou seja, baixável.
--
-- Diferença da 624: o upload do Documentos vai na RAIZ do bucket
-- (`${Date.now()}-nome`), não numa pasta do uid. Então a régua não é a pasta,
-- é o dono do objeto: o caminho tem de ser de um objeto que a própria sessão
-- subiu (storage.objects.owner_id) E que nenhum outro documento já usa.
-- O fluxo da tela (sobe, depois grava a linha) cumpre as duas coisas.
--
-- Checado só quando o caminho entra ou muda, para o acervo existente e a
-- edição de texto/publicação não dependerem disso. Isentos: sessão sem
-- auth.uid() (service_role, migração, seed) e o professor (`role='admin'`,
-- que já lê o bucket inteiro).
--
-- SECURITY DEFINER: a checagem precisa ver storage.objects e os documentos de
-- outras unidades, que a RLS esconde de quem grava.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.documento_arquivo_e_de_quem_grava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.arquivo_path IS NOT DISTINCT FROM OLD.arquivo_path THEN
    RETURN NEW;
  END IF;

  IF COALESCE((SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = v_uid), false) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'documentos'
          AND o.name = NEW.arquivo_path
          AND COALESCE(o.owner_id, o.owner::text) = v_uid::text
     )
     OR EXISTS (
       SELECT 1 FROM public.documentos d
        WHERE d.arquivo_path = NEW.arquivo_path
          AND d.id IS DISTINCT FROM NEW.id
     ) THEN
    RAISE EXCEPTION 'O arquivo do documento tem de ser um que você mesmo enviou.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.documento_arquivo_e_de_quem_grava() IS
  'Migr. 625 — arquivo_path novo tem de ser objeto do bucket documentos subido pela própria sessão e não usado por outro documento (fecha leitura de arquivo alheio via documentos_bucket_read).';

REVOKE ALL ON FUNCTION public.documento_arquivo_e_de_quem_grava() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS documento_arquivo_e_de_quem_grava_trg ON public.documentos;
CREATE TRIGGER documento_arquivo_e_de_quem_grava_trg
  BEFORE INSERT OR UPDATE ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.documento_arquivo_e_de_quem_grava();

COMMIT;
