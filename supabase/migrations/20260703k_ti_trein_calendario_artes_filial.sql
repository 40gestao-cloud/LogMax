BEGIN;

-- TreinamentosView
ALTER TABLE treinamentos
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

-- TIView
ALTER TABLE ti_chamados
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

-- CalendarioEditorialView
ALTER TABLE marketing_calendario
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

-- ArtesPromocionaisView — propaga filial da promoção vinculada
ALTER TABLE marketing_artes
  ADD COLUMN IF NOT EXISTS filial text NOT NULL DEFAULT 'SuperMax';

UPDATE marketing_artes a
  SET filial = p.filial
  FROM marketing_promocoes p
  WHERE a.promocao_id = p.id
    AND p.filial IS NOT NULL
    AND p.filial <> '';

COMMIT;
