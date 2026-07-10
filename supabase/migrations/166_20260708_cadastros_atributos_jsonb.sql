-- =================================================================
-- Cadastros por nicho (Produtos, Serviços, Fornecedores) — Fase 3
-- =================================================================
-- Cada filial (SuperMax, MaxLook, TechMax) tem particularidades de
-- cadastro que não cabem em colunas físicas comuns:
--   • MaxLook (moda): tamanho, cor, gênero, coleção, material.
--   • TechMax (eletrônicos+assistência): modelo, memória, tela,
--     bateria, câmera, garantia_dias, requer_imei; serviços têm
--     categoria, tempo_estimado_horas, requer_peca, marcas, garantia.
--   • SuperMax segue o schema atual (não precisa de atributos).
--
-- Optamos por JSONB flexível em vez de dezenas de colunas físicas:
--   • Cada nicho é NULL nos campos dos outros → colunas com muito
--     NULL polui schema e não indexa bem sem WHERE parcial.
--   • Cadastros didáticos podem evoluir (add campo novo sem migrar).
--   • Se algum atributo virar filtro pesado, migra ISOLADO pra
--     coluna dedicada com GIN → BTREE.
--
-- Idempotente: pode ser rodado várias vezes sem efeito colateral.
-- =================================================================

ALTER TABLE produtos      ADD COLUMN IF NOT EXISTS atributos jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE servicos      ADD COLUMN IF NOT EXISTS atributos jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE fornecedores  ADD COLUMN IF NOT EXISTS atributos jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Índice GIN em cada tabela permite buscar por atributos.tamanho='P',
-- atributos.marca='Apple' etc. via operadores @> ou ? do jsonb.
-- Usar jsonb_path_ops (mais compacto e rápido pra @>) porque nossa
-- consulta típica será {"key":"value"} match, não busca por chave só.
CREATE INDEX IF NOT EXISTS produtos_atributos_gin_idx
  ON produtos USING gin (atributos jsonb_path_ops);
CREATE INDEX IF NOT EXISTS servicos_atributos_gin_idx
  ON servicos USING gin (atributos jsonb_path_ops);
CREATE INDEX IF NOT EXISTS fornecedores_atributos_gin_idx
  ON fornecedores USING gin (atributos jsonb_path_ops);

-- Documenta o formato esperado. Como campos são opcionais e por
-- filial, comment vale como contrato leve.
COMMENT ON COLUMN produtos.atributos IS
  'Atributos por nicho (JSONB). MaxLook: {tamanho, cor, genero, colecao, material}. TechMax: {modelo, cor, memoria, tela, bateria, camera, garantia_dias, requer_imei}. SuperMax: {} vazio.';
COMMENT ON COLUMN servicos.atributos IS
  'Atributos por nicho (JSONB). MaxLook: {categoria_svc, tempo_estimado_min}. TechMax: {categoria_svc, tempo_estimado_horas, requer_peca, marcas, garantia_dias}.';
COMMENT ON COLUMN fornecedores.atributos IS
  'Atributos por nicho (JSONB). MaxLook: {tipo_fornecedor, moq, prazo_entrega_dias, marcas}. TechMax: {tipo_fornecedor, marcas, prazo_entrega_dias, garantia_reposicao_dias}.';
