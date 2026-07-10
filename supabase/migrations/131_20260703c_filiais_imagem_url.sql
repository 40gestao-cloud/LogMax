-- Adiciona coluna de logo em filiais.
ALTER TABLE public.filiais
  ADD COLUMN IF NOT EXISTS imagem_url text;
