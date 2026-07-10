-- Empresa › Projetos ganha campo de descrição livre.
-- Form em GenericCRUDView passa a aceitar type=textarea (md:col-span-3).
-- Idempotente: IF NOT EXISTS pra rodar com segurança em qualquer ambiente.

ALTER TABLE projetos
  ADD COLUMN IF NOT EXISTS descricao text;
