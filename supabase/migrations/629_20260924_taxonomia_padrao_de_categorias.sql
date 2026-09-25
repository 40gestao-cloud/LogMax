-- MIGR 629 — taxonomia padrão de categorias e subcategorias.
--
-- Até 24/09 cada turma digitava à mão as categorias a partir de três PDFs de
-- referência, e cada uma chegou a um resultado diferente: grafias trocadas
-- ("Bebidas não alcolatras", "LATICINEOS"), categorias com barra no nome
-- ("Informatica/ Notebooks"), a TechMax da Contabilidade com o dobro de
-- categorias. O professor pediu uma lista padrão, "conforme o mercado": o
-- aluno cuida da imagem e do markup, e pode criar uma categoria própria para o
-- que a lista não cobre. Proposta aprovada em docs/taxonomia-padrao-proposta.md.
--
-- O que esta migração faz:
--   1. `padrao` em categorias_produto e subcategorias_produto.
--   2. `taxonomia_padrao`: a lista oficial das três lojas (fonte única — é
--      dela que `aplicar_taxonomia_padrao` monta uma filial nova).
--   3. Gatilho que protege a linha padrão: nome não muda, não sai da
--      categoria, não é excluída; imagem, cor, ícone, markup e ativo seguem
--      livres. Linha criada pelo app nasce `padrao = false` (é "Própria").
--   4. Aplicação nas três filiais, ADOTANDO a linha que já tem o mesmo nome
--      (guarda imagem e markup que o aluno já pôs).
--   5. Reclassificação dos produtos: pela categoria e subcategoria antigas,
--      entendendo as grafias variadas. MaxLook: o gênero que estava no nome
--      da categoria ("Roupas femininas") vai para o campo Gênero do produto,
--      quando ele está vazio.
--   6. Limpeza: categoria/subcategoria antiga que ficou sem produto e vinha
--      dos PDFs sai; o que o aluno inventou fica, como Própria.
--   7. TechMax: serviços saem da taxonomia de produto; as categorias do
--      catálogo de Serviços passam a ser as da lista (campo categoria_svc).

ALTER TABLE public.categorias_produto    ADD COLUMN IF NOT EXISTS padrao boolean NOT NULL DEFAULT false;
ALTER TABLE public.subcategorias_produto ADD COLUMN IF NOT EXISTS padrao boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.taxonomia_padrao (
  nicho        text    NOT NULL,
  categoria    text    NOT NULL,
  -- '' = a linha da própria categoria (ordem, cor e ícone dela)
  subcategoria text    NOT NULL DEFAULT '',
  ordem        integer NOT NULL,
  cor          text,
  icone        text,
  PRIMARY KEY (nicho, categoria, subcategoria)
);
ALTER TABLE public.taxonomia_padrao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS taxonomia_padrao_select ON public.taxonomia_padrao;
CREATE POLICY taxonomia_padrao_select ON public.taxonomia_padrao
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.taxonomia_padrao FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.taxonomia_padrao TO authenticated;

DELETE FROM public.taxonomia_padrao;
INSERT INTO public.taxonomia_padrao (nicho, categoria, subcategoria, ordem, cor, icone) VALUES
  ('SuperMax', 'Mercearia', '', 1, '#f59e0b', '🥫'),
  ('SuperMax', 'Mercearia', 'Arroz', 1, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Feijão', 2, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Grãos e cereais', 3, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Farinhas e farofas', 4, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Massas', 5, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Molhos e extratos de tomate', 6, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Temperos e condimentos', 7, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Óleos, azeites e vinagres', 8, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Açúcar e adoçantes', 9, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Enlatados e conservas', 10, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Sopas e caldos', 11, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Ingredientes para bolos e sobremesas', 12, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Leite condensado e creme de leite', 13, NULL, NULL),
  ('SuperMax', 'Mercearia', 'Naturais e integrais', 14, NULL, NULL),
  ('SuperMax', 'Matinais', '', 2, '#f97316', '🍞'),
  ('SuperMax', 'Matinais', 'Café', 1, NULL, NULL),
  ('SuperMax', 'Matinais', 'Chás', 2, NULL, NULL),
  ('SuperMax', 'Matinais', 'Achocolatados e cappuccinos', 3, NULL, NULL),
  ('SuperMax', 'Matinais', 'Leite em pó', 4, NULL, NULL),
  ('SuperMax', 'Matinais', 'Cereais matinais e granolas', 5, NULL, NULL),
  ('SuperMax', 'Matinais', 'Biscoitos e bolachas', 6, NULL, NULL),
  ('SuperMax', 'Matinais', 'Torradas', 7, NULL, NULL),
  ('SuperMax', 'Matinais', 'Geleias, mel e cremes para pão', 8, NULL, NULL),
  ('SuperMax', 'Doces e snacks', '', 3, '#ec4899', '🍫'),
  ('SuperMax', 'Doces e snacks', 'Chocolates', 1, NULL, NULL),
  ('SuperMax', 'Doces e snacks', 'Balas, gomas e pirulitos', 2, NULL, NULL),
  ('SuperMax', 'Doces e snacks', 'Doces e sobremesas prontas', 3, NULL, NULL),
  ('SuperMax', 'Doces e snacks', 'Salgadinhos', 4, NULL, NULL),
  ('SuperMax', 'Doces e snacks', 'Amendoins e petiscos', 5, NULL, NULL),
  ('SuperMax', 'Bebidas', '', 4, '#06b6d4', '🥤'),
  ('SuperMax', 'Bebidas', 'Águas', 1, NULL, NULL),
  ('SuperMax', 'Bebidas', 'Refrigerantes', 2, NULL, NULL),
  ('SuperMax', 'Bebidas', 'Sucos e néctares', 3, NULL, NULL),
  ('SuperMax', 'Bebidas', 'Chás prontos', 4, NULL, NULL),
  ('SuperMax', 'Bebidas', 'Energéticos e isotônicos', 5, NULL, NULL),
  ('SuperMax', 'Bebidas', 'Bebidas vegetais', 6, NULL, NULL),
  ('SuperMax', 'Bebidas', 'Água de coco', 7, NULL, NULL),
  ('SuperMax', 'Bebidas', 'Gelo', 8, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', '', 5, '#8b5cf6', '🥤'),
  ('SuperMax', 'Bebidas alcoólicas', 'Cervejas', 1, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', 'Vinhos', 2, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', 'Espumantes', 3, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', 'Cachaças', 4, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', 'Vodcas', 5, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', 'Uísques', 6, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', 'Gins', 7, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', 'Licores e aperitivos', 8, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', 'Outros destilados', 9, NULL, NULL),
  ('SuperMax', 'Bebidas alcoólicas', 'Drinks prontos', 10, NULL, NULL),
  ('SuperMax', 'Açougue', '', 6, '#ef4444', '🥩'),
  ('SuperMax', 'Açougue', 'Carne bovina', 1, NULL, NULL),
  ('SuperMax', 'Açougue', 'Carne suína', 2, NULL, NULL),
  ('SuperMax', 'Açougue', 'Aves', 3, NULL, NULL),
  ('SuperMax', 'Açougue', 'Cordeiro e outras carnes', 4, NULL, NULL),
  ('SuperMax', 'Açougue', 'Linguiças frescas', 5, NULL, NULL),
  ('SuperMax', 'Açougue', 'Carnes temperadas e preparadas', 6, NULL, NULL),
  ('SuperMax', 'Peixaria', '', 7, '#3b82f6', '🧊'),
  ('SuperMax', 'Peixaria', 'Peixes', 1, NULL, NULL),
  ('SuperMax', 'Peixaria', 'Frutos do mar', 2, NULL, NULL),
  ('SuperMax', 'Peixaria', 'Bacalhau e pescados salgados', 3, NULL, NULL),
  ('SuperMax', 'Hortifruti', '', 8, '#22c55e', '🥦'),
  ('SuperMax', 'Hortifruti', 'Frutas', 1, NULL, NULL),
  ('SuperMax', 'Hortifruti', 'Legumes', 2, NULL, NULL),
  ('SuperMax', 'Hortifruti', 'Verduras', 3, NULL, NULL),
  ('SuperMax', 'Hortifruti', 'Temperos frescos', 4, NULL, NULL),
  ('SuperMax', 'Hortifruti', 'Cogumelos', 5, NULL, NULL),
  ('SuperMax', 'Hortifruti', 'Frutas secas e castanhas', 6, NULL, NULL),
  ('SuperMax', 'Hortifruti', 'Frutas e saladas cortadas', 7, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', '', 9, '#D4AF37', '🛒'),
  ('SuperMax', 'Frios e laticínios', 'Leites', 1, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Iogurtes e fermentados', 2, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Queijos', 3, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Requeijão e cream cheese', 4, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Manteigas e margarinas', 5, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Natas e chantilly', 6, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Ovos', 7, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Frios fatiados', 8, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Salsichas', 9, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Bacon e embutidos defumados', 10, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Patês e antepastos', 11, NULL, NULL),
  ('SuperMax', 'Frios e laticínios', 'Massas frescas', 12, NULL, NULL),
  ('SuperMax', 'Congelados', '', 10, '#06b6d4', '🧊'),
  ('SuperMax', 'Congelados', 'Hambúrgueres e empanados', 1, NULL, NULL),
  ('SuperMax', 'Congelados', 'Pratos prontos', 2, NULL, NULL),
  ('SuperMax', 'Congelados', 'Pizzas', 3, NULL, NULL),
  ('SuperMax', 'Congelados', 'Lasanhas e massas congeladas', 4, NULL, NULL),
  ('SuperMax', 'Congelados', 'Salgados e pães de queijo congelados', 5, NULL, NULL),
  ('SuperMax', 'Congelados', 'Vegetais congelados', 6, NULL, NULL),
  ('SuperMax', 'Congelados', 'Polpas de fruta', 7, NULL, NULL),
  ('SuperMax', 'Congelados', 'Sorvetes e açaí', 8, NULL, NULL),
  ('SuperMax', 'Congelados', 'Sobremesas congeladas', 9, NULL, NULL),
  ('SuperMax', 'Padaria e confeitaria', '', 11, '#D4AF37', '🍞'),
  ('SuperMax', 'Padaria e confeitaria', 'Pães da casa', 1, NULL, NULL),
  ('SuperMax', 'Padaria e confeitaria', 'Pães industrializados', 2, NULL, NULL),
  ('SuperMax', 'Padaria e confeitaria', 'Bolos', 3, NULL, NULL),
  ('SuperMax', 'Padaria e confeitaria', 'Doces e tortas de confeitaria', 4, NULL, NULL),
  ('SuperMax', 'Padaria e confeitaria', 'Salgados', 5, NULL, NULL),
  ('SuperMax', 'Padaria e confeitaria', 'Panetones e sazonais', 6, NULL, NULL),
  ('SuperMax', 'Rotisseria', '', 12, '#f97316', '🥩'),
  ('SuperMax', 'Rotisseria', 'Pratos quentes', 1, NULL, NULL),
  ('SuperMax', 'Rotisseria', 'Assados', 2, NULL, NULL),
  ('SuperMax', 'Rotisseria', 'Saladas e acompanhamentos', 3, NULL, NULL),
  ('SuperMax', 'Rotisseria', 'Marmitas e refeições completas', 4, NULL, NULL),
  ('SuperMax', 'Limpeza', '', 13, '#3b82f6', '🧼'),
  ('SuperMax', 'Limpeza', 'Sabão para roupas', 1, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Amaciantes', 2, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Alvejantes e tira-manchas', 3, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Detergentes', 4, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Desinfetantes e água sanitária', 5, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Limpadores multiuso', 6, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Limpeza de banheiro', 7, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Limpeza de cozinha', 8, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Limpa-vidros e lustra-móveis', 9, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Álcool', 10, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Inseticidas', 11, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Vassouras, rodos e baldes', 12, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Esponjas e palhas de aço', 13, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Panos e flanelas', 14, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Luvas', 15, NULL, NULL),
  ('SuperMax', 'Limpeza', 'Sacos de lixo e lixeiras', 16, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', '', 14, '#ec4899', '🧴'),
  ('SuperMax', 'Higiene e beleza', 'Shampoos', 1, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Condicionadores', 2, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Cremes e finalizadores', 3, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Colorações', 4, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Sabonetes', 5, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Desodorantes', 6, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Hidratantes', 7, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Protetor solar', 8, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Repelentes', 9, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Perfumes', 10, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Maquiagem', 11, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Unhas', 12, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Barbear e depilação', 13, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Creme dental', 14, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Escovas e fio dental', 15, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Enxaguantes bucais', 16, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Absorventes', 17, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Papel higiênico', 18, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Lenços de papel', 19, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Algodão e hastes', 20, NULL, NULL),
  ('SuperMax', 'Higiene e beleza', 'Primeiros socorros', 21, NULL, NULL),
  ('SuperMax', 'Bebê', '', 15, '#8b5cf6', '🎁'),
  ('SuperMax', 'Bebê', 'Fraldas', 1, NULL, NULL),
  ('SuperMax', 'Bebê', 'Lenços umedecidos', 2, NULL, NULL),
  ('SuperMax', 'Bebê', 'Higiene infantil', 3, NULL, NULL),
  ('SuperMax', 'Bebê', 'Papinhas e cereais infantis', 4, NULL, NULL),
  ('SuperMax', 'Bebê', 'Fórmulas infantis', 5, NULL, NULL),
  ('SuperMax', 'Pet', '', 16, '#f97316', '🐾'),
  ('SuperMax', 'Pet', 'Ração para cães', 1, NULL, NULL),
  ('SuperMax', 'Pet', 'Ração para gatos', 2, NULL, NULL),
  ('SuperMax', 'Pet', 'Ração para outros animais', 3, NULL, NULL),
  ('SuperMax', 'Pet', 'Petiscos', 4, NULL, NULL),
  ('SuperMax', 'Pet', 'Higiene e areia', 5, NULL, NULL),
  ('SuperMax', 'Pet', 'Acessórios e brinquedos', 6, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', '', 17, '#6b7280', '🏠'),
  ('SuperMax', 'Bazar e utilidades', 'Utensílios de cozinha', 1, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Descartáveis', 2, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Papel-toalha, guardanapos e alumínio', 3, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Organização', 4, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Churrasco', 5, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Camping, praia e piscina', 6, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Ferramentas', 7, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Automotivo', 8, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Pilhas e lâmpadas', 9, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Papelaria', 10, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Brinquedos', 11, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Festas', 12, NULL, NULL),
  ('SuperMax', 'Bazar e utilidades', 'Velas e fósforos', 13, NULL, NULL),
  ('TechMax', 'Celulares e tablets', '', 1, '#3b82f6', '📱'),
  ('TechMax', 'Celulares e tablets', 'Smartphones', 1, NULL, NULL),
  ('TechMax', 'Celulares e tablets', 'Celulares básicos', 2, NULL, NULL),
  ('TechMax', 'Celulares e tablets', 'Tablets', 3, NULL, NULL),
  ('TechMax', 'Celulares e tablets', 'Smartwatches e smartbands', 4, NULL, NULL),
  ('TechMax', 'Acessórios para celular', '', 2, '#06b6d4', '🔌'),
  ('TechMax', 'Acessórios para celular', 'Capas', 1, NULL, NULL),
  ('TechMax', 'Acessórios para celular', 'Películas', 2, NULL, NULL),
  ('TechMax', 'Acessórios para celular', 'Carregadores', 3, NULL, NULL),
  ('TechMax', 'Acessórios para celular', 'Cabos e adaptadores USB', 4, NULL, NULL),
  ('TechMax', 'Acessórios para celular', 'Power banks', 5, NULL, NULL),
  ('TechMax', 'Acessórios para celular', 'Suportes', 6, NULL, NULL),
  ('TechMax', 'TV e vídeo', '', 3, '#8b5cf6', '🖥️'),
  ('TechMax', 'TV e vídeo', 'Smart TVs', 1, NULL, NULL),
  ('TechMax', 'TV e vídeo', 'Projetores', 2, NULL, NULL),
  ('TechMax', 'TV e vídeo', 'Aparelhos de streaming', 3, NULL, NULL),
  ('TechMax', 'TV e vídeo', 'Suportes para TV', 4, NULL, NULL),
  ('TechMax', 'TV e vídeo', 'Cabos HDMI e de vídeo', 5, NULL, NULL),
  ('TechMax', 'Áudio', '', 4, '#ec4899', '🎧'),
  ('TechMax', 'Áudio', 'Fones de ouvido', 1, NULL, NULL),
  ('TechMax', 'Áudio', 'Caixas de som', 2, NULL, NULL),
  ('TechMax', 'Áudio', 'Soundbars e home theater', 3, NULL, NULL),
  ('TechMax', 'Áudio', 'Microfones', 4, NULL, NULL),
  ('TechMax', 'Áudio', 'Cabos e adaptadores de áudio', 5, NULL, NULL),
  ('TechMax', 'Computadores', '', 5, '#3b82f6', '💻'),
  ('TechMax', 'Computadores', 'Notebooks', 1, NULL, NULL),
  ('TechMax', 'Computadores', 'Desktops e mini PCs', 2, NULL, NULL),
  ('TechMax', 'Computadores', 'Monitores', 3, NULL, NULL),
  ('TechMax', 'Computadores', 'Impressoras e scanners', 4, NULL, NULL),
  ('TechMax', 'Computadores', 'Cartuchos e toners', 5, NULL, NULL),
  ('TechMax', 'Hardware', '', 6, '#6b7280', '🔧'),
  ('TechMax', 'Hardware', 'Processadores', 1, NULL, NULL),
  ('TechMax', 'Hardware', 'Placas-mãe', 2, NULL, NULL),
  ('TechMax', 'Hardware', 'Placas de vídeo', 3, NULL, NULL),
  ('TechMax', 'Hardware', 'Memórias RAM', 4, NULL, NULL),
  ('TechMax', 'Hardware', 'SSDs e HDs', 5, NULL, NULL),
  ('TechMax', 'Hardware', 'Fontes', 6, NULL, NULL),
  ('TechMax', 'Hardware', 'Gabinetes', 7, NULL, NULL),
  ('TechMax', 'Hardware', 'Coolers e refrigeração', 8, NULL, NULL),
  ('TechMax', 'Periféricos', '', 7, '#22c55e', '🖥️'),
  ('TechMax', 'Periféricos', 'Teclados', 1, NULL, NULL),
  ('TechMax', 'Periféricos', 'Mouses', 2, NULL, NULL),
  ('TechMax', 'Periféricos', 'Kits teclado e mouse', 3, NULL, NULL),
  ('TechMax', 'Periféricos', 'Headsets', 4, NULL, NULL),
  ('TechMax', 'Periféricos', 'Webcams', 5, NULL, NULL),
  ('TechMax', 'Periféricos', 'Mousepads', 6, NULL, NULL),
  ('TechMax', 'Periféricos', 'Hubs e adaptadores', 7, NULL, NULL),
  ('TechMax', 'Armazenamento externo', '', 8, '#f59e0b', '📦'),
  ('TechMax', 'Armazenamento externo', 'HDs e SSDs externos', 1, NULL, NULL),
  ('TechMax', 'Armazenamento externo', 'Pendrives', 2, NULL, NULL),
  ('TechMax', 'Armazenamento externo', 'Cartões de memória', 3, NULL, NULL),
  ('TechMax', 'Games', '', 9, '#8b5cf6', '🎮'),
  ('TechMax', 'Games', 'Consoles', 1, NULL, NULL),
  ('TechMax', 'Games', 'Jogos', 2, NULL, NULL),
  ('TechMax', 'Games', 'Controles', 3, NULL, NULL),
  ('TechMax', 'Games', 'Acessórios para consoles', 4, NULL, NULL),
  ('TechMax', 'Games', 'Cartões e gift cards', 5, NULL, NULL),
  ('TechMax', 'Games', 'Cadeiras e mesas gamer', 6, NULL, NULL),
  ('TechMax', 'Redes', '', 10, '#06b6d4', '🔌'),
  ('TechMax', 'Redes', 'Roteadores', 1, NULL, NULL),
  ('TechMax', 'Redes', 'Repetidores e mesh', 2, NULL, NULL),
  ('TechMax', 'Redes', 'Switches', 3, NULL, NULL),
  ('TechMax', 'Redes', 'Adaptadores Wi-Fi e Bluetooth', 4, NULL, NULL),
  ('TechMax', 'Redes', 'Cabos e conectores de rede', 5, NULL, NULL),
  ('TechMax', 'Redes', 'Modems', 6, NULL, NULL),
  ('TechMax', 'Energia', '', 11, '#f59e0b', '🔋'),
  ('TechMax', 'Energia', 'Nobreaks', 1, NULL, NULL),
  ('TechMax', 'Energia', 'Estabilizadores', 2, NULL, NULL),
  ('TechMax', 'Energia', 'Filtros de linha', 3, NULL, NULL),
  ('TechMax', 'Energia', 'Pilhas e baterias', 4, NULL, NULL),
  ('TechMax', 'Energia', 'Fontes e carregadores universais', 5, NULL, NULL),
  ('TechMax', 'Peças para assistência', '', 12, '#ef4444', '🔧'),
  ('TechMax', 'Peças para assistência', 'Telas e displays', 1, NULL, NULL),
  ('TechMax', 'Peças para assistência', 'Baterias', 2, NULL, NULL),
  ('TechMax', 'Peças para assistência', 'Conectores de carga', 3, NULL, NULL),
  ('TechMax', 'Peças para assistência', 'Cabos flex', 4, NULL, NULL),
  ('TechMax', 'Peças para assistência', 'Câmeras', 5, NULL, NULL),
  ('TechMax', 'Peças para assistência', 'Alto-falantes e microfones', 6, NULL, NULL),
  ('TechMax', 'Peças para assistência', 'Carcaças e tampas', 7, NULL, NULL),
  ('TechMax', 'Peças para assistência', 'Placas e componentes', 8, NULL, NULL),
  ('TechMax', 'Ferramentas e insumos de reparo', '', 13, '#f97316', '🔧'),
  ('TechMax', 'Ferramentas e insumos de reparo', 'Ferramentas', 1, NULL, NULL),
  ('TechMax', 'Ferramentas e insumos de reparo', 'Pasta térmica', 2, NULL, NULL),
  ('TechMax', 'Ferramentas e insumos de reparo', 'Adesivos e colas', 3, NULL, NULL),
  ('TechMax', 'Ferramentas e insumos de reparo', 'Solda e insumos', 4, NULL, NULL),
  ('MaxLook', 'Roupas', '', 1, '#D4AF37', '👕'),
  ('MaxLook', 'Roupas', 'Camisetas', 1, NULL, NULL),
  ('MaxLook', 'Roupas', 'Regatas', 2, NULL, NULL),
  ('MaxLook', 'Roupas', 'Blusas', 3, NULL, NULL),
  ('MaxLook', 'Roupas', 'Camisas', 4, NULL, NULL),
  ('MaxLook', 'Roupas', 'Polos', 5, NULL, NULL),
  ('MaxLook', 'Roupas', 'Moletons e suéteres', 6, NULL, NULL),
  ('MaxLook', 'Roupas', 'Casacos e jaquetas', 7, NULL, NULL),
  ('MaxLook', 'Roupas', 'Blazers e alfaiataria', 8, NULL, NULL),
  ('MaxLook', 'Roupas', 'Calças', 9, NULL, NULL),
  ('MaxLook', 'Roupas', 'Bermudas e shorts', 10, NULL, NULL),
  ('MaxLook', 'Roupas', 'Saias', 11, NULL, NULL),
  ('MaxLook', 'Roupas', 'Vestidos', 12, NULL, NULL),
  ('MaxLook', 'Roupas', 'Macacões', 13, NULL, NULL),
  ('MaxLook', 'Roupas', 'Conjuntos', 14, NULL, NULL),
  ('MaxLook', 'Moda íntima e pijamas', '', 2, '#ec4899', '👕'),
  ('MaxLook', 'Moda íntima e pijamas', 'Calcinhas', 1, NULL, NULL),
  ('MaxLook', 'Moda íntima e pijamas', 'Cuecas', 2, NULL, NULL),
  ('MaxLook', 'Moda íntima e pijamas', 'Sutiãs e tops', 3, NULL, NULL),
  ('MaxLook', 'Moda íntima e pijamas', 'Cintas e modeladores', 4, NULL, NULL),
  ('MaxLook', 'Moda íntima e pijamas', 'Meias', 5, NULL, NULL),
  ('MaxLook', 'Moda íntima e pijamas', 'Pijamas e camisolas', 6, NULL, NULL),
  ('MaxLook', 'Moda praia', '', 3, '#06b6d4', '🕶️'),
  ('MaxLook', 'Moda praia', 'Biquínis', 1, NULL, NULL),
  ('MaxLook', 'Moda praia', 'Maiôs', 2, NULL, NULL),
  ('MaxLook', 'Moda praia', 'Sungas', 3, NULL, NULL),
  ('MaxLook', 'Moda praia', 'Bermudas de praia', 4, NULL, NULL),
  ('MaxLook', 'Moda praia', 'Saídas de praia', 5, NULL, NULL),
  ('MaxLook', 'Moda esportiva', '', 4, '#22c55e', '👟'),
  ('MaxLook', 'Moda esportiva', 'Leggings', 1, NULL, NULL),
  ('MaxLook', 'Moda esportiva', 'Tops esportivos', 2, NULL, NULL),
  ('MaxLook', 'Moda esportiva', 'Camisetas e regatas esportivas', 3, NULL, NULL),
  ('MaxLook', 'Moda esportiva', 'Shorts e bermudas esportivos', 4, NULL, NULL),
  ('MaxLook', 'Moda esportiva', 'Calças e agasalhos esportivos', 5, NULL, NULL),
  ('MaxLook', 'Calçados', '', 5, '#f97316', '👟'),
  ('MaxLook', 'Calçados', 'Tênis', 1, NULL, NULL),
  ('MaxLook', 'Calçados', 'Sapatos', 2, NULL, NULL),
  ('MaxLook', 'Calçados', 'Sapatênis', 3, NULL, NULL),
  ('MaxLook', 'Calçados', 'Sapatilhas', 4, NULL, NULL),
  ('MaxLook', 'Calçados', 'Scarpins', 5, NULL, NULL),
  ('MaxLook', 'Calçados', 'Sandálias e rasteirinhas', 6, NULL, NULL),
  ('MaxLook', 'Calçados', 'Chinelos', 7, NULL, NULL),
  ('MaxLook', 'Calçados', 'Botas', 8, NULL, NULL),
  ('MaxLook', 'Calçados', 'Tamancos e mules', 9, NULL, NULL),
  ('MaxLook', 'Acessórios', '', 6, '#8b5cf6', '👜'),
  ('MaxLook', 'Acessórios', 'Bolsas', 1, NULL, NULL),
  ('MaxLook', 'Acessórios', 'Mochilas', 2, NULL, NULL),
  ('MaxLook', 'Acessórios', 'Carteiras', 3, NULL, NULL),
  ('MaxLook', 'Acessórios', 'Cintos', 4, NULL, NULL),
  ('MaxLook', 'Acessórios', 'Bonés e chapéus', 5, NULL, NULL),
  ('MaxLook', 'Acessórios', 'Óculos', 6, NULL, NULL),
  ('MaxLook', 'Acessórios', 'Relógios', 7, NULL, NULL),
  ('MaxLook', 'Acessórios', 'Bijuterias', 8, NULL, NULL);

-- ── Proteção da linha padrão ──────────────────────────────────────────────
-- `app.taxonomia_padrao = 'on'` é o bypass da própria migração e de
-- `aplicar_taxonomia_padrao`; o app nunca liga.
CREATE OR REPLACE FUNCTION public.fn_taxonomia_padrao_protege()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.taxonomia_padrao', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.padrao := false;          -- o que o app cria é Própria
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.padrao THEN
      RAISE EXCEPTION '"%" faz parte da lista padrão e não pode ser excluída. Se a unidade não usa, desative.', OLD.nome
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  NEW.padrao := OLD.padrao;       -- ninguém promove nem rebaixa pelo app
  IF OLD.padrao AND NEW.nome IS DISTINCT FROM OLD.nome THEN
    RAISE EXCEPTION '"%" faz parte da lista padrão: o nome não muda. Imagem, cor, ícone e markup podem ser alterados.', OLD.nome
      USING ERRCODE = 'P0001';
  END IF;
  -- to_jsonb: a mesma função serve às duas tabelas, e só uma tem categoria_id.
  IF OLD.padrao AND (to_jsonb(NEW) ->> 'categoria_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'categoria_id') THEN
    RAISE EXCEPTION '"%" faz parte da lista padrão e não muda de categoria.', OLD.nome
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.padrao AND (to_jsonb(NEW) ->> 'filial') IS DISTINCT FROM (to_jsonb(OLD) ->> 'filial') THEN
    RAISE EXCEPTION '"%" faz parte da lista padrão da unidade e não muda de unidade.', OLD.nome
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_taxonomia_padrao_protege ON public.categorias_produto;
CREATE TRIGGER trg_taxonomia_padrao_protege
  BEFORE INSERT OR UPDATE OR DELETE ON public.categorias_produto
  FOR EACH ROW EXECUTE FUNCTION public.fn_taxonomia_padrao_protege();
DROP TRIGGER IF EXISTS trg_taxonomia_padrao_protege ON public.subcategorias_produto;
CREATE TRIGGER trg_taxonomia_padrao_protege
  BEFORE INSERT OR UPDATE OR DELETE ON public.subcategorias_produto
  FOR EACH ROW EXECUTE FUNCTION public.fn_taxonomia_padrao_protege();

-- ── Aplica a lista numa filial (idempotente) ──────────────────────────────
-- Adota a linha que já tem o mesmo nome (comparação de nome_item_normalizado,
-- migr. 627): a imagem e o markup que o aluno pôs ficam. Serve à migração e a
-- turma nova; o app não chama.
CREATE OR REPLACE FUNCTION public.aplicar_taxonomia_padrao(p_filial text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  s     record;
  v_cat uuid;
  v_sub uuid;
  v_n   integer := 0;
BEGIN
  PERFORM set_config('app.taxonomia_padrao', 'on', true);
  FOR r IN SELECT * FROM taxonomia_padrao
            WHERE nicho = p_filial AND subcategoria = '' ORDER BY ordem LOOP
    SELECT id INTO v_cat FROM categorias_produto
     WHERE filial = p_filial AND excluido_em IS NULL
       AND nome_item_normalizado(nome) = nome_item_normalizado(r.categoria)
     ORDER BY padrao DESC, created_at
     LIMIT 1;
    IF v_cat IS NULL THEN
      INSERT INTO categorias_produto (nome, cor, icone, filial, padrao)
      VALUES (r.categoria, r.cor, r.icone, p_filial, true)
      RETURNING id INTO v_cat;
      v_n := v_n + 1;
    ELSE
      UPDATE categorias_produto SET nome = r.categoria, padrao = true WHERE id = v_cat;
    END IF;

    FOR s IN SELECT * FROM taxonomia_padrao
              WHERE nicho = p_filial AND categoria = r.categoria AND subcategoria <> ''
              ORDER BY ordem LOOP
      SELECT id INTO v_sub FROM subcategorias_produto
       WHERE categoria_id = v_cat AND excluido_em IS NULL
         AND nome_item_normalizado(nome) = nome_item_normalizado(s.subcategoria)
       ORDER BY padrao DESC, created_at
       LIMIT 1;
      IF v_sub IS NULL THEN
        INSERT INTO subcategorias_produto (categoria_id, nome, cor, icone, padrao)
        VALUES (v_cat, s.subcategoria, COALESCE(r.cor, '#6b7280'), COALESCE(r.icone, '📦'), true);
        v_n := v_n + 1;
      ELSE
        UPDATE subcategorias_produto SET nome = s.subcategoria, padrao = true WHERE id = v_sub;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.taxonomia_padrao', '', true);
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.aplicar_taxonomia_padrao(text) FROM PUBLIC, anon, authenticated;

-- ── Migração dos dados (uma vez) ──────────────────────────────────────────
CREATE TEMP TABLE _ctx (nicho text, ordem integer, padrao text, categoria text) ON COMMIT DROP;
INSERT INTO _ctx VALUES
    ('SuperMax', 1, '%alcool%nao%', 'Bebidas'),
    ('SuperMax', 2, '%nao alc%', 'Bebidas'),
    ('SuperMax', 3, '%alcolatr%', 'Bebidas'),
    ('SuperMax', 4, '%alcool%', 'Bebidas alcoólicas'),
    ('SuperMax', 5, '%mercearia%', 'Mercearia'),
    ('SuperMax', 6, '%acougue%', 'Açougue'),
    ('SuperMax', 7, '%peixaria%', 'Peixaria'),
    ('SuperMax', 8, '%hortifruti%', 'Hortifruti'),
    ('SuperMax', 9, '%latic%', 'Frios e laticínios'),
    ('SuperMax', 10, '%congelad%', 'Congelados'),
    ('SuperMax', 11, '%padaria%', 'Padaria e confeitaria'),
    ('SuperMax', 12, '%rotisser%', 'Rotisseria'),
    ('SuperMax', 13, '%acessorios de limpeza%', 'Limpeza'),
    ('SuperMax', 14, '%limpeza%', 'Limpeza'),
    ('SuperMax', 15, '%bebe%', 'Bebê'),
    ('SuperMax', 16, '%higiene%', 'Higiene e beleza'),
    ('SuperMax', 17, '%pet%', 'Pet'),
    ('SuperMax', 18, '%bazar%', 'Bazar e utilidades'),
    ('SuperMax', 19, '%ferramentas e faca%', 'Bazar e utilidades'),
    ('TechMax', 1, '%celulares%', 'Celulares e tablets'),
    ('TechMax', 2, '%acessorio%celular%', 'Acessórios para celular'),
    ('TechMax', 3, '%tv e video%', 'TV e vídeo'),
    ('TechMax', 4, '%audio%', 'Áudio'),
    ('TechMax', 5, '%informatica%', 'Computadores'),
    ('TechMax', 6, '%componentes%', 'Hardware'),
    ('TechMax', 7, '%perifericos%', 'Periféricos'),
    ('TechMax', 8, '%games%', 'Games'),
    ('TechMax', 9, '%conectividade%', 'Redes'),
    ('TechMax', 10, '%energia%', 'Energia'),
    ('TechMax', 11, '%pecas%', 'Peças para assistência'),
    ('TechMax', 12, '%insumo%', 'Ferramentas e insumos de reparo'),
    ('TechMax', 13, '%ferramentas%', 'Ferramentas e insumos de reparo'),
    ('MaxLook', 1, '%intima%', 'Moda íntima e pijamas'),
    ('MaxLook', 2, '%praia%', 'Moda praia'),
    ('MaxLook', 3, '%esport%', 'Moda esportiva'),
    ('MaxLook', 4, '%espotiv%', 'Moda esportiva'),
    ('MaxLook', 5, '%calcad%', 'Calçados'),
    ('MaxLook', 6, '%acessor%', 'Acessórios'),
    ('MaxLook', 7, '%roupa%', 'Roupas'),
    ('MaxLook', 8, '%moda feminina%', 'Roupas'),
    ('MaxLook', 9, '%moda masculina%', 'Roupas');
CREATE TEMP TABLE _depara (nicho text, ctx text, antigo text, categoria text, subcategoria text) ON COMMIT DROP;
INSERT INTO _depara VALUES
    ('SuperMax', 'Mercearia', 'Arroz', 'Mercearia', 'Arroz'),
    ('SuperMax', 'Mercearia', 'Feijão e leguminosas', 'Mercearia', 'Feijão'),
    ('SuperMax', 'Mercearia', 'Feijão', 'Mercearia', 'Feijão'),
    ('SuperMax', 'Mercearia', 'Grãos e cereais', 'Mercearia', 'Grãos e cereais'),
    ('SuperMax', 'Mercearia', 'Farinhas e farináceos', 'Mercearia', 'Farinhas e farofas'),
    ('SuperMax', 'Mercearia', 'Massas secas e instantâneas', 'Mercearia', 'Massas'),
    ('SuperMax', 'Mercearia', 'Massas', 'Mercearia', 'Massas'),
    ('SuperMax', 'Mercearia', 'Biscoitos', 'Matinais', 'Biscoitos e bolachas'),
    ('SuperMax', 'Mercearia', 'Açúcar e adoçantes', 'Mercearia', 'Açúcar e adoçantes'),
    ('SuperMax', 'Mercearia', 'Cafés', 'Matinais', 'Café'),
    ('SuperMax', 'Mercearia', 'Café', 'Matinais', 'Café'),
    ('SuperMax', 'Mercearia', 'Chás', 'Matinais', 'Chás'),
    ('SuperMax', 'Mercearia', 'Leite em pó', 'Matinais', 'Leite em pó'),
    ('SuperMax', 'Mercearia', 'Óleos e azeites', 'Mercearia', 'Óleos, azeites e vinagres'),
    ('SuperMax', 'Mercearia', 'Molhos e condimentos', 'Mercearia', 'Temperos e condimentos'),
    ('SuperMax', 'Mercearia', 'Conservas e enlatados', 'Mercearia', 'Enlatados e conservas'),
    ('SuperMax', 'Mercearia', 'Sopas e cremes', 'Mercearia', 'Sopas e caldos'),
    ('SuperMax', 'Mercearia', 'Doces, chocolates e bomboniere', 'Doces e snacks', 'Chocolates'),
    ('SuperMax', 'Mercearia', 'Ingredientes culinários', 'Mercearia', 'Ingredientes para bolos e sobremesas'),
    ('SuperMax', 'Mercearia', 'Alimentos saudáveis', 'Mercearia', 'Naturais e integrais'),
    ('SuperMax', 'Mercearia', 'Alimentos à base de plantas', 'Mercearia', 'Naturais e integrais'),
    ('SuperMax', 'Mercearia', 'Sementes e suplementos', 'Mercearia', 'Naturais e integrais'),
    ('SuperMax', 'Mercearia', 'Snacks', 'Doces e snacks', 'Salgadinhos'),
    ('SuperMax', 'Bebidas', 'Água com e sem gás', 'Bebidas', 'Águas'),
    ('SuperMax', 'Bebidas', 'Água saborizada', 'Bebidas', 'Águas'),
    ('SuperMax', 'Bebidas', 'Água de coco', 'Bebidas', 'Água de coco'),
    ('SuperMax', 'Bebidas', 'Refrigerantes', 'Bebidas', 'Refrigerantes'),
    ('SuperMax', 'Bebidas', 'Sucos prontos', 'Bebidas', 'Sucos e néctares'),
    ('SuperMax', 'Bebidas', 'Sucos integrais', 'Bebidas', 'Sucos e néctares'),
    ('SuperMax', 'Bebidas', 'Concentrados', 'Bebidas', 'Sucos e néctares'),
    ('SuperMax', 'Bebidas', 'Sucos naturais', 'Bebidas', 'Sucos e néctares'),
    ('SuperMax', 'Bebidas', 'Refrescos', 'Bebidas', 'Sucos e néctares'),
    ('SuperMax', 'Bebidas', 'Bebidas vegetais', 'Bebidas', 'Bebidas vegetais'),
    ('SuperMax', 'Bebidas', 'Chás prontos', 'Bebidas', 'Chás prontos'),
    ('SuperMax', 'Bebidas', 'Energéticos', 'Bebidas', 'Energéticos e isotônicos'),
    ('SuperMax', 'Bebidas', 'Isotônicos', 'Bebidas', 'Energéticos e isotônicos'),
    ('SuperMax', 'Bebidas', 'Polpas e bebidas congeladas', 'Congelados', 'Polpas de fruta'),
    ('SuperMax', 'Bebidas', 'Gelo', 'Bebidas', 'Gelo'),
    ('SuperMax', 'Bebidas alcoólicas', 'Cervejas', 'Bebidas alcoólicas', 'Cervejas'),
    ('SuperMax', 'Bebidas alcoólicas', 'Kits e barris de cerveja', 'Bebidas alcoólicas', 'Cervejas'),
    ('SuperMax', 'Bebidas alcoólicas', 'Vinhos e espumantes', 'Bebidas alcoólicas', 'Vinhos'),
    ('SuperMax', 'Bebidas alcoólicas', 'Cachaças', 'Bebidas alcoólicas', 'Cachaças'),
    ('SuperMax', 'Bebidas alcoólicas', 'Conhaques', 'Bebidas alcoólicas', 'Outros destilados'),
    ('SuperMax', 'Bebidas alcoólicas', 'Saquê', 'Bebidas alcoólicas', 'Outros destilados'),
    ('SuperMax', 'Bebidas alcoólicas', 'Tequila', 'Bebidas alcoólicas', 'Outros destilados'),
    ('SuperMax', 'Bebidas alcoólicas', 'Gin', 'Bebidas alcoólicas', 'Gins'),
    ('SuperMax', 'Bebidas alcoólicas', 'Licores', 'Bebidas alcoólicas', 'Licores e aperitivos'),
    ('SuperMax', 'Bebidas alcoólicas', 'Vodka', 'Bebidas alcoólicas', 'Vodcas'),
    ('SuperMax', 'Bebidas alcoólicas', 'Whisky', 'Bebidas alcoólicas', 'Uísques'),
    ('SuperMax', 'Bebidas alcoólicas', 'Coquetéis e drinks prontos', 'Bebidas alcoólicas', 'Drinks prontos'),
    ('SuperMax', 'Açougue', 'Carnes exóticas e especiais', 'Açougue', 'Cordeiro e outras carnes'),
    ('SuperMax', 'Açougue', 'Carnes temperadas', 'Açougue', 'Carnes temperadas e preparadas'),
    ('SuperMax', 'Peixaria', 'Peixes frescos', 'Peixaria', 'Peixes'),
    ('SuperMax', 'Peixaria', 'Peixes congelados', 'Peixaria', 'Peixes'),
    ('SuperMax', 'Peixaria', 'Bacalhau', 'Peixaria', 'Bacalhau e pescados salgados'),
    ('SuperMax', 'Peixaria', 'Pescados salgados', 'Peixaria', 'Bacalhau e pescados salgados'),
    ('SuperMax', 'Peixaria', 'Pratos prontos da peixaria', 'Rotisseria', 'Pratos quentes'),
    ('SuperMax', 'Hortifruti', 'Frutas secas', 'Hortifruti', 'Frutas secas e castanhas'),
    ('SuperMax', 'Hortifruti', 'Frutas fracionadas', 'Hortifruti', 'Frutas e saladas cortadas'),
    ('SuperMax', 'Hortifruti', 'Hortaliças', 'Hortifruti', 'Verduras'),
    ('SuperMax', 'Hortifruti', 'Produtos orgânicos', 'Hortifruti', 'Verduras'),
    ('SuperMax', 'Hortifruti', 'Produtos hidropônicos', 'Hortifruti', 'Verduras'),
    ('SuperMax', 'Hortifruti', 'Temperos', 'Hortifruti', 'Temperos frescos'),
    ('SuperMax', 'Frios e laticínios', 'Leites especiais e sem lactose', 'Frios e laticínios', 'Leites'),
    ('SuperMax', 'Frios e laticínios', 'Iogurtes', 'Frios e laticínios', 'Iogurtes e fermentados'),
    ('SuperMax', 'Frios e laticínios', 'Leite fermentado', 'Frios e laticínios', 'Iogurtes e fermentados'),
    ('SuperMax', 'Frios e laticínios', 'Queijo cremoso', 'Frios e laticínios', 'Requeijão e cream cheese'),
    ('SuperMax', 'Frios e laticínios', 'Creme de leite, nata e chantilly', 'Frios e laticínios', 'Natas e chantilly'),
    ('SuperMax', 'Frios e laticínios', 'Massas refrigeradas', 'Frios e laticínios', 'Massas frescas'),
    ('SuperMax', 'Frios e laticínios', 'Frios e embutidos', 'Frios e laticínios', 'Frios fatiados'),
    ('SuperMax', 'Frios e laticínios', 'Presunto', 'Frios e laticínios', 'Frios fatiados'),
    ('SuperMax', 'Frios e laticínios', 'Mortadela', 'Frios e laticínios', 'Frios fatiados'),
    ('SuperMax', 'Frios e laticínios', 'Salames', 'Frios e laticínios', 'Frios fatiados'),
    ('SuperMax', 'Frios e laticínios', 'Linguiças', 'Açougue', 'Linguiças frescas'),
    ('SuperMax', 'Frios e laticínios', 'Pratos prontos refrigerados', 'Rotisseria', 'Marmitas e refeições completas'),
    ('SuperMax', 'Congelados', 'Carnes, aves e pescados congelados', 'Congelados', 'Hambúrgueres e empanados'),
    ('SuperMax', 'Congelados', 'Pratos prontos congelados', 'Congelados', 'Pratos prontos'),
    ('SuperMax', 'Congelados', 'Sopas congeladas', 'Congelados', 'Pratos prontos'),
    ('SuperMax', 'Congelados', 'Tortas congeladas', 'Congelados', 'Pratos prontos'),
    ('SuperMax', 'Congelados', 'Massas congeladas', 'Congelados', 'Lasanhas e massas congeladas'),
    ('SuperMax', 'Congelados', 'Lanches e salgados congelados', 'Congelados', 'Salgados e pães de queijo congelados'),
    ('SuperMax', 'Congelados', 'Legumes e vegetais congelados', 'Congelados', 'Vegetais congelados'),
    ('SuperMax', 'Congelados', 'Açaí', 'Congelados', 'Sorvetes e açaí'),
    ('SuperMax', 'Congelados', 'Sorvetes', 'Congelados', 'Sorvetes e açaí'),
    ('SuperMax', 'Congelados', 'Polpas e frutas congeladas', 'Congelados', 'Polpas de fruta'),
    ('SuperMax', 'Padaria e confeitaria', 'Pães de fabricação própria', 'Padaria e confeitaria', 'Pães da casa'),
    ('SuperMax', 'Padaria e confeitaria', 'Pães orgânicos', 'Padaria e confeitaria', 'Pães da casa'),
    ('SuperMax', 'Padaria e confeitaria', 'Doces', 'Padaria e confeitaria', 'Doces e tortas de confeitaria'),
    ('SuperMax', 'Padaria e confeitaria', 'Tortas', 'Padaria e confeitaria', 'Doces e tortas de confeitaria'),
    ('SuperMax', 'Padaria e confeitaria', 'Confeitaria gelada', 'Padaria e confeitaria', 'Doces e tortas de confeitaria'),
    ('SuperMax', 'Padaria e confeitaria', 'Biscoitos', 'Matinais', 'Biscoitos e bolachas'),
    ('SuperMax', 'Padaria e confeitaria', 'Torradas', 'Matinais', 'Torradas'),
    ('SuperMax', 'Padaria e confeitaria', 'Ingredientes e insumos de padaria', 'Mercearia', 'Ingredientes para bolos e sobremesas'),
    ('SuperMax', 'Padaria e confeitaria', 'Panetones e colombas', 'Padaria e confeitaria', 'Panetones e sazonais'),
    ('SuperMax', 'Rotisseria', 'Pratos principais', 'Rotisseria', 'Pratos quentes'),
    ('SuperMax', 'Rotisseria', 'Pratos semiprontos', 'Rotisseria', 'Pratos quentes'),
    ('SuperMax', 'Rotisseria', 'Sopas e cremes', 'Rotisseria', 'Pratos quentes'),
    ('SuperMax', 'Rotisseria', 'Tortas e quiches', 'Rotisseria', 'Pratos quentes'),
    ('SuperMax', 'Rotisseria', 'Refeições completas', 'Rotisseria', 'Marmitas e refeições completas'),
    ('SuperMax', 'Rotisseria', 'Saladas', 'Rotisseria', 'Saladas e acompanhamentos'),
    ('SuperMax', 'Rotisseria', 'Acompanhamentos', 'Rotisseria', 'Saladas e acompanhamentos'),
    ('SuperMax', 'Rotisseria', 'Salgados', 'Padaria e confeitaria', 'Salgados'),
    ('SuperMax', 'Rotisseria', 'Sanduíches', 'Padaria e confeitaria', 'Salgados'),
    ('SuperMax', 'Rotisseria', 'Doces', 'Padaria e confeitaria', 'Doces e tortas de confeitaria'),
    ('SuperMax', 'Rotisseria', 'Sobremesas', 'Padaria e confeitaria', 'Doces e tortas de confeitaria'),
    ('SuperMax', 'Rotisseria', 'Bebidas da rotisserie', 'Bebidas', 'Sucos e néctares'),
    ('SuperMax', 'Limpeza', 'Amaciante', 'Limpeza', 'Amaciantes'),
    ('SuperMax', 'Limpeza', 'Alvejante', 'Limpeza', 'Alvejantes e tira-manchas'),
    ('SuperMax', 'Limpeza', 'Tira-manchas', 'Limpeza', 'Alvejantes e tira-manchas'),
    ('SuperMax', 'Limpeza', 'Desengordurantes', 'Limpeza', 'Limpeza de cozinha'),
    ('SuperMax', 'Limpeza', 'Limpa-alumínio', 'Limpeza', 'Limpeza de cozinha'),
    ('SuperMax', 'Limpeza', 'Produtos para limpeza de cozinha', 'Limpeza', 'Limpeza de cozinha'),
    ('SuperMax', 'Limpeza', 'Desinfetantes', 'Limpeza', 'Desinfetantes e água sanitária'),
    ('SuperMax', 'Limpeza', 'Água sanitária', 'Limpeza', 'Desinfetantes e água sanitária'),
    ('SuperMax', 'Limpeza', 'Produtos para limpeza de banheiro', 'Limpeza', 'Limpeza de banheiro'),
    ('SuperMax', 'Limpeza', 'Limpadores sanitários', 'Limpeza', 'Limpeza de banheiro'),
    ('SuperMax', 'Limpeza', 'Produtos para limpeza geral', 'Limpeza', 'Limpadores multiuso'),
    ('SuperMax', 'Limpeza', 'Limpa-vidros', 'Limpeza', 'Limpa-vidros e lustra-móveis'),
    ('SuperMax', 'Limpeza', 'Proteção da casa', 'Limpeza', 'Inseticidas'),
    ('SuperMax', 'Limpeza', 'Vassouras', 'Limpeza', 'Vassouras, rodos e baldes'),
    ('SuperMax', 'Limpeza', 'Rodos', 'Limpeza', 'Vassouras, rodos e baldes'),
    ('SuperMax', 'Limpeza', 'Pás', 'Limpeza', 'Vassouras, rodos e baldes'),
    ('SuperMax', 'Limpeza', 'Baldes e bacias', 'Limpeza', 'Vassouras, rodos e baldes'),
    ('SuperMax', 'Limpeza', 'Escovas', 'Limpeza', 'Vassouras, rodos e baldes'),
    ('SuperMax', 'Limpeza', 'Esponjas e lã de aço', 'Limpeza', 'Esponjas e palhas de aço'),
    ('SuperMax', 'Limpeza', 'Lixeiras', 'Limpeza', 'Sacos de lixo e lixeiras'),
    ('SuperMax', 'Limpeza', 'Sacos para lixo', 'Limpeza', 'Sacos de lixo e lixeiras'),
    ('SuperMax', 'Limpeza', 'Papel-toalha', 'Bazar e utilidades', 'Papel-toalha, guardanapos e alumínio'),
    ('SuperMax', 'Limpeza', 'Rolos de alumínio', 'Bazar e utilidades', 'Papel-toalha, guardanapos e alumínio'),
    ('SuperMax', 'Limpeza', 'Guardanapos', 'Bazar e utilidades', 'Papel-toalha, guardanapos e alumínio'),
    ('SuperMax', 'Limpeza', 'Copos, pratos e talheres descartáveis', 'Bazar e utilidades', 'Descartáveis'),
    ('SuperMax', 'Limpeza', 'Palitos', 'Bazar e utilidades', 'Descartáveis'),
    ('SuperMax', 'Higiene e beleza', 'Cabelos', 'Higiene e beleza', 'Shampoos'),
    ('SuperMax', 'Higiene e beleza', 'Shampoo', 'Higiene e beleza', 'Shampoos'),
    ('SuperMax', 'Higiene e beleza', 'Condicionador', 'Higiene e beleza', 'Condicionadores'),
    ('SuperMax', 'Higiene e beleza', 'Finalizadores', 'Higiene e beleza', 'Cremes e finalizadores'),
    ('SuperMax', 'Higiene e beleza', 'Tratamentos capilares', 'Higiene e beleza', 'Cremes e finalizadores'),
    ('SuperMax', 'Higiene e beleza', 'Corpo e banho', 'Higiene e beleza', 'Sabonetes'),
    ('SuperMax', 'Higiene e beleza', 'Cuidados para o rosto', 'Higiene e beleza', 'Hidratantes'),
    ('SuperMax', 'Higiene e beleza', 'Proteção solar', 'Higiene e beleza', 'Protetor solar'),
    ('SuperMax', 'Higiene e beleza', 'Higiene bucal', 'Higiene e beleza', 'Creme dental'),
    ('SuperMax', 'Higiene e beleza', 'Escovas de dentes', 'Higiene e beleza', 'Escovas e fio dental'),
    ('SuperMax', 'Higiene e beleza', 'Fio dental', 'Higiene e beleza', 'Escovas e fio dental'),
    ('SuperMax', 'Higiene e beleza', 'Enxaguante bucal', 'Higiene e beleza', 'Enxaguantes bucais'),
    ('SuperMax', 'Higiene e beleza', 'Lenços de papel e umedecidos', 'Higiene e beleza', 'Lenços de papel'),
    ('SuperMax', 'Bebê', 'Fraldas infantis', 'Bebê', 'Fraldas'),
    ('SuperMax', 'Bebê', 'Cuidados com cabelo, corpo e dentes', 'Bebê', 'Higiene infantil'),
    ('SuperMax', 'Bebê', 'Nutrição infantil', 'Bebê', 'Papinhas e cereais infantis'),
    ('SuperMax', 'Bebê', 'Cereais infantis', 'Bebê', 'Papinhas e cereais infantis'),
    ('SuperMax', 'Bebê', 'Papinhas', 'Bebê', 'Papinhas e cereais infantis'),
    ('SuperMax', 'Bebê', 'Complementos nutricionais', 'Bebê', 'Papinhas e cereais infantis'),
    ('SuperMax', 'Bebê', 'Leites e fórmulas', 'Bebê', 'Fórmulas infantis'),
    ('SuperMax', 'Pet', 'Ração para aves', 'Pet', 'Ração para outros animais'),
    ('SuperMax', 'Pet', 'Ração para peixes', 'Pet', 'Ração para outros animais'),
    ('SuperMax', 'Pet', 'Ração para outros pets', 'Pet', 'Ração para outros animais'),
    ('SuperMax', 'Pet', 'Petiscos e biscoitos', 'Pet', 'Petiscos'),
    ('SuperMax', 'Pet', 'Higiene animal', 'Pet', 'Higiene e areia'),
    ('SuperMax', 'Pet', 'Brinquedos e utilidades para animais', 'Pet', 'Acessórios e brinquedos'),
    ('SuperMax', 'Bazar e utilidades', 'Cutelaria e utensílios de cozinha', 'Bazar e utilidades', 'Utensílios de cozinha'),
    ('SuperMax', 'Bazar e utilidades', 'Decoração', 'Bazar e utilidades', 'Organização'),
    ('SuperMax', 'Bazar e utilidades', 'Artigos de viagem', 'Bazar e utilidades', 'Organização'),
    ('SuperMax', 'Bazar e utilidades', 'Jardinagem', 'Bazar e utilidades', 'Ferramentas'),
    ('SuperMax', 'Bazar e utilidades', 'Ferramentas e faça você mesmo', 'Bazar e utilidades', 'Ferramentas'),
    ('SuperMax', 'Bazar e utilidades', 'Acessórios automotivos', 'Bazar e utilidades', 'Automotivo'),
    ('SuperMax', 'Bazar e utilidades', 'Bicicletas', 'Bazar e utilidades', 'Camping, praia e piscina'),
    ('SuperMax', 'Bazar e utilidades', 'Artigos esportivos', 'Bazar e utilidades', 'Camping, praia e piscina'),
    ('SuperMax', 'Bazar e utilidades', 'Artigos para camping', 'Bazar e utilidades', 'Camping, praia e piscina'),
    ('SuperMax', 'Bazar e utilidades', 'Artigos para praia e piscina', 'Bazar e utilidades', 'Camping, praia e piscina'),
    ('SuperMax', 'Bazar e utilidades', 'Artigos para churrasco', 'Bazar e utilidades', 'Churrasco'),
    ('SuperMax', 'Bazar e utilidades', 'Livros', 'Bazar e utilidades', 'Papelaria'),
    ('SuperMax', 'Bazar e utilidades', 'Fósforos', 'Bazar e utilidades', 'Velas e fósforos'),
    ('SuperMax', 'Bazar e utilidades', 'Velas', 'Bazar e utilidades', 'Velas e fósforos'),
    ('SuperMax', 'Bazar e utilidades', 'Artigos e acessórios para festas', 'Bazar e utilidades', 'Festas'),
    ('TechMax', 'Celulares e tablets', 'Smartwatches', 'Celulares e tablets', 'Smartwatches e smartbands'),
    ('TechMax', 'Celulares e tablets', 'Smartbands', 'Celulares e tablets', 'Smartwatches e smartbands'),
    ('TechMax', 'Acessórios para celular', 'Capas e cases', 'Acessórios para celular', 'Capas'),
    ('TechMax', 'Acessórios para celular', 'Acessórios compatíveis', 'Acessórios para celular', 'Capas'),
    ('TechMax', 'Acessórios para celular', 'Cabos', 'Acessórios para celular', 'Cabos e adaptadores USB'),
    ('TechMax', 'Acessórios para celular', 'Adaptadores', 'Acessórios para celular', 'Cabos e adaptadores USB'),
    ('TechMax', 'Acessórios para celular', 'Baterias', 'Peças para assistência', 'Baterias'),
    ('TechMax', 'TV e vídeo', 'Televisores', 'TV e vídeo', 'Smart TVs'),
    ('TechMax', 'TV e vídeo', 'Monitores de vídeo', 'Computadores', 'Monitores'),
    ('TechMax', 'TV e vídeo', 'Suportes para TV e vídeo', 'TV e vídeo', 'Suportes para TV'),
    ('TechMax', 'TV e vídeo', 'Cabos e adaptadores de vídeo', 'TV e vídeo', 'Cabos HDMI e de vídeo'),
    ('TechMax', 'Áudio', 'Soundbars', 'Áudio', 'Soundbars e home theater'),
    ('TechMax', 'Áudio', 'Amplificadores', 'Áudio', 'Soundbars e home theater'),
    ('TechMax', 'Áudio', 'Acessórios de áudio', 'Áudio', 'Cabos e adaptadores de áudio'),
    ('TechMax', 'Computadores', 'Desktops', 'Computadores', 'Desktops e mini PCs'),
    ('TechMax', 'Computadores', 'Mini PCs', 'Computadores', 'Desktops e mini PCs'),
    ('TechMax', 'Computadores', 'Monitores para computador', 'Computadores', 'Monitores'),
    ('TechMax', 'Computadores', 'Impressoras', 'Computadores', 'Impressoras e scanners'),
    ('TechMax', 'Computadores', 'Impressora', 'Computadores', 'Impressoras e scanners'),
    ('TechMax', 'Computadores', 'Scanners', 'Computadores', 'Impressoras e scanners'),
    ('TechMax', 'Computadores', 'Armazenamento', 'Armazenamento externo', 'HDs e SSDs externos'),
    ('TechMax', 'Computadores', 'Acessórios de informática', 'Periféricos', 'Hubs e adaptadores'),
    ('TechMax', 'Hardware', 'Memórias', 'Hardware', 'Memórias RAM'),
    ('TechMax', 'Hardware', 'SSDs', 'Hardware', 'SSDs e HDs'),
    ('TechMax', 'Hardware', 'HDs', 'Hardware', 'SSDs e HDs'),
    ('TechMax', 'Hardware', 'Fontes para computador', 'Hardware', 'Fontes'),
    ('TechMax', 'Hardware', 'Coolers', 'Hardware', 'Coolers e refrigeração'),
    ('TechMax', 'Hardware', 'Placas e adaptadores de hardware', 'Hardware', NULL),
    ('TechMax', 'Periféricos', 'Controles', 'Games', 'Controles'),
    ('TechMax', 'Periféricos', 'Leitores', 'Periféricos', 'Hubs e adaptadores'),
    ('TechMax', 'Periféricos', 'Mesas gamer', 'Games', 'Cadeiras e mesas gamer'),
    ('TechMax', 'Periféricos', 'Acessórios gamer', 'Periféricos', 'Mousepads'),
    ('TechMax', 'Games', 'Jogos físicos', 'Games', 'Jogos'),
    ('TechMax', 'Games', 'Controles para consoles', 'Games', 'Controles'),
    ('TechMax', 'Games', 'Cadeiras gamer', 'Games', 'Cadeiras e mesas gamer'),
    ('TechMax', 'Games', 'Cartões e códigos digitais', 'Games', 'Cartões e gift cards'),
    ('TechMax', 'Redes', 'Access points', 'Redes', 'Roteadores'),
    ('TechMax', 'Redes', 'Repetidores', 'Redes', 'Repetidores e mesh'),
    ('TechMax', 'Redes', 'Cabos de rede', 'Redes', 'Cabos e conectores de rede'),
    ('TechMax', 'Redes', 'Conectores de rede', 'Redes', 'Cabos e conectores de rede'),
    ('TechMax', 'Redes', 'Racks e acessórios de rede', 'Redes', 'Cabos e conectores de rede'),
    ('TechMax', 'Energia', 'Fontes de alimentação', 'Energia', 'Fontes e carregadores universais'),
    ('TechMax', 'Energia', 'Adaptadores de energia', 'Energia', 'Fontes e carregadores universais'),
    ('TechMax', 'Energia', 'Cabos de energia', 'Energia', 'Fontes e carregadores universais'),
    ('TechMax', 'Peças para assistência', 'Telas e módulos', 'Peças para assistência', 'Telas e displays'),
    ('TechMax', 'Peças para assistência', 'Conectores', 'Peças para assistência', 'Conectores de carga'),
    ('TechMax', 'Peças para assistência', 'Placas', 'Peças para assistência', 'Placas e componentes'),
    ('TechMax', 'Peças para assistência', 'Parafusos', 'Peças para assistência', 'Placas e componentes'),
    ('TechMax', 'Peças para assistência', 'Alto-falantes', 'Peças para assistência', 'Alto-falantes e microfones'),
    ('TechMax', 'Peças para assistência', 'Microfones', 'Peças para assistência', 'Alto-falantes e microfones'),
    ('TechMax', 'Peças para assistência', 'Carcaças', 'Peças para assistência', 'Carcaças e tampas'),
    ('TechMax', 'Ferramentas e insumos de reparo', 'Ferramentas de assistência técnica', 'Ferramentas e insumos de reparo', 'Ferramentas'),
    ('TechMax', 'Ferramentas e insumos de reparo', 'Adesivos', 'Ferramentas e insumos de reparo', 'Adesivos e colas'),
    ('TechMax', 'Ferramentas e insumos de reparo', 'Adesivo', 'Ferramentas e insumos de reparo', 'Adesivos e colas'),
    ('TechMax', 'Ferramentas e insumos de reparo', 'Insumos de reparo', 'Ferramentas e insumos de reparo', 'Solda e insumos'),
    ('TechMax', 'Ferramentas e insumos de reparo', 'Insumo de Preparo', 'Ferramentas e insumos de reparo', 'Solda e insumos'),
    ('MaxLook', 'Roupas', 'Blusas e camisetas', 'Roupas', 'Blusas'),
    ('MaxLook', 'Roupas', 'Básicos', 'Roupas', 'Camisetas'),
    ('MaxLook', 'Roupas', 'Camisetas e regatas', 'Roupas', 'Camisetas'),
    ('MaxLook', 'Roupas', 'Jeans', 'Roupas', 'Calças'),
    ('MaxLook', 'Roupas', 'Shorts e bermudas', 'Roupas', 'Bermudas e shorts'),
    ('MaxLook', 'Roupas', 'Bermudas', 'Roupas', 'Bermudas e shorts'),
    ('MaxLook', 'Roupas', 'Alfaiataria', 'Roupas', 'Blazers e alfaiataria'),
    ('MaxLook', 'Roupas', 'Moda plus size', 'Roupas', NULL),
    ('MaxLook', 'Acessórios', 'Bonés e chapéus', 'Acessórios', 'Bonés e chapéus'),
    ('MaxLook', 'Acessórios', 'Chapéus e bonés', 'Acessórios', 'Bonés e chapéus'),
    ('MaxLook', 'Acessórios', 'Bonés', 'Acessórios', 'Bonés e chapéus'),
    ('MaxLook', 'Acessórios', 'Bijuterias e bijoux', 'Acessórios', 'Bijuterias'),
    ('MaxLook', 'Acessórios', 'Bolsas e mochilas', 'Acessórios', 'Bolsas'),
    ('MaxLook', 'Acessórios', 'Pequenos acessórios', 'Acessórios', NULL),
    ('MaxLook', 'Acessórios', 'Acessórios de verão', 'Acessórios', NULL),
    ('MaxLook', 'Calçados', 'Rasteirinhas', 'Calçados', 'Sandálias e rasteirinhas'),
    ('MaxLook', 'Calçados', 'Sandálias', 'Calçados', 'Sandálias e rasteirinhas'),
    ('MaxLook', 'Calçados', 'Sandálias e papetes', 'Calçados', 'Sandálias e rasteirinhas'),
    ('MaxLook', 'Calçados', 'Tamancos', 'Calçados', 'Tamancos e mules'),
    ('MaxLook', 'Calçados', 'Calçados esportivos', 'Calçados', 'Tênis'),
    ('MaxLook', 'Moda íntima e pijamas', 'Pijamas', 'Moda íntima e pijamas', 'Pijamas e camisolas'),
    ('MaxLook', 'Moda esportiva', 'Acessórios esportivos', 'Acessórios', NULL),
    ('MaxLook', 'Moda esportiva', 'Blusas esportivas', 'Moda esportiva', 'Camisetas e regatas esportivas'),
    ('MaxLook', 'Moda esportiva', 'Camisetas esportivas', 'Moda esportiva', 'Camisetas e regatas esportivas'),
    ('MaxLook', 'Moda esportiva', 'Regatas esportivas', 'Moda esportiva', 'Camisetas e regatas esportivas'),
    ('MaxLook', 'Moda esportiva', 'Shorts e bermudas esportivas', 'Moda esportiva', 'Shorts e bermudas esportivos'),
    ('MaxLook', 'Moda esportiva', 'Bermudas esportivas', 'Moda esportiva', 'Shorts e bermudas esportivos'),
    ('MaxLook', 'Moda esportiva', 'Calçados esportivos', 'Calçados', 'Tênis'),
    ('MaxLook', 'Moda esportiva', 'Calças esportivas', 'Moda esportiva', 'Calças e agasalhos esportivos'),
    ('MaxLook', 'Moda praia', 'Bermudas e boardshorts', 'Moda praia', 'Bermudas de praia'),
    ('MaxLook', 'Moda praia', 'Shorts', 'Moda praia', 'Bermudas de praia'),
    ('MaxLook', 'Moda praia', 'Camisas leves', 'Roupas', 'Camisas'),
    ('MaxLook', 'Moda praia', 'Regatas', 'Roupas', 'Regatas'),
    ('MaxLook', 'Moda praia', 'Chinelos', 'Calçados', 'Chinelos'),
    ('MaxLook', 'Moda praia', 'Bonés', 'Acessórios', 'Bonés e chapéus'),
    ('MaxLook', 'Moda praia', 'Óculos', 'Acessórios', 'Óculos');

DO $migra$
DECLARE
  f       text;
  p       record;
  c       record;
  v_ctx   text;
  v_cand  text;
  v_dcat  text;
  v_dsub  text;
  v_cat   uuid;
  v_sub   uuid;
  v_gen   text;
BEGIN
  FOREACH f IN ARRAY ARRAY['SuperMax', 'MaxLook', 'TechMax'] LOOP
    PERFORM public.aplicar_taxonomia_padrao(f);
    PERFORM set_config('app.taxonomia_padrao', 'on', true);

    -- Herança: a categoria padrão recebe a imagem e o markup da categoria
    -- antiga que correspondia a ela — a mais usada primeiro.
    FOR c IN
      SELECT o.*, (SELECT categoria FROM _ctx x
                    WHERE x.nicho = f AND nome_item_normalizado(o.nome) LIKE x.padrao
                    ORDER BY x.ordem LIMIT 1) AS ctx
        FROM categorias_produto o
       WHERE o.filial = f AND NOT o.padrao
       ORDER BY (SELECT count(*) FROM produtos pr WHERE pr.categoria_id = o.id) DESC
    LOOP
      CONTINUE WHEN c.ctx IS NULL;
      UPDATE categorias_produto
         SET imagem_url  = COALESCE(imagem_url, c.imagem_url),
             margem_alvo = COALESCE(margem_alvo, c.margem_alvo)
       WHERE filial = f AND padrao AND nome = c.ctx;
    END LOOP;

    -- Reclassificação: todo produto cuja categoria ou subcategoria não é padrão.
    FOR p IN
      SELECT pr.id, cat.nome AS cat_nome, cat.padrao AS cat_padrao, sub.nome AS sub_nome
        FROM produtos pr
        JOIN categorias_produto cat ON cat.id = pr.categoria_id
        LEFT JOIN subcategorias_produto sub ON sub.id = pr.subcategoria_id
       WHERE pr.filial = f
         AND NOT (cat.padrao AND COALESCE(sub.padrao, true))
    LOOP
      IF p.cat_padrao THEN
        v_ctx := p.cat_nome;
      ELSE
        SELECT x.categoria INTO v_ctx FROM _ctx x
         WHERE x.nicho = f AND nome_item_normalizado(p.cat_nome) LIKE x.padrao
         ORDER BY x.ordem LIMIT 1;
      END IF;
      CONTINUE WHEN v_ctx IS NULL;          -- categoria inventada: fica Própria

      -- "Informatica/ Notebooks": a parte depois da barra era a subcategoria.
      v_cand := COALESCE(p.sub_nome, NULLIF(btrim(split_part(p.cat_nome, '/', 2)), ''));
      v_dcat := NULL; v_dsub := NULL;
      IF v_cand IS NOT NULL THEN
        SELECT d.categoria, d.subcategoria INTO v_dcat, v_dsub FROM _depara d
         WHERE d.nicho = f AND d.ctx = v_ctx
           AND nome_item_normalizado(d.antigo) = nome_item_normalizado(v_cand)
         LIMIT 1;
        IF v_dcat IS NULL THEN
          SELECT t.categoria, t.subcategoria INTO v_dcat, v_dsub FROM taxonomia_padrao t
           WHERE t.nicho = f AND t.subcategoria <> ''
             AND nome_item_normalizado(t.subcategoria) = nome_item_normalizado(v_cand)
           ORDER BY (t.categoria = v_ctx) DESC
           LIMIT 1;
        END IF;
      END IF;
      v_dcat := COALESCE(v_dcat, v_ctx);

      SELECT id INTO v_cat FROM categorias_produto WHERE filial = f AND padrao AND nome = v_dcat;
      v_sub := NULL;
      IF v_dsub IS NOT NULL THEN
        SELECT id INTO v_sub FROM subcategorias_produto WHERE categoria_id = v_cat AND padrao AND nome = v_dsub;
      END IF;

      v_gen := NULL;
      IF f = 'MaxLook' THEN
        v_gen := CASE
          WHEN nome_item_normalizado(p.cat_nome) LIKE '%femin%' THEN 'Feminino'
          WHEN nome_item_normalizado(p.cat_nome) LIKE '%mascul%' THEN 'Masculino'
          WHEN nome_item_normalizado(p.cat_nome) LIKE '%unissex%' THEN 'Unissex'
        END;
      END IF;

      UPDATE produtos SET categoria_id = v_cat, subcategoria_id = v_sub, categoria = v_dcat
       WHERE id = p.id;
      -- O gênero vai à parte: o gatilho de variante duplicada olha os
      -- atributos, e uma recusa dele não pode desfazer a reclassificação.
      IF v_gen IS NOT NULL THEN
        BEGIN
          UPDATE produtos
             SET atributos = COALESCE(atributos, '{}'::jsonb) || jsonb_build_object('genero', v_gen)
           WHERE id = p.id AND COALESCE(atributos ->> 'genero', '') = '';
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END LOOP;

    -- Produto que ficou sem subcategoria ganha uma pela PRIMEIRA palavra do
    -- nome ("Vestido Midi…" → Vestidos; "Meia Soquete…", que estava em
    -- Calçados, → Moda íntima › Meias). Radical de 4 letras contra as palavras
    -- da subcategoria; a da mesma categoria vence. Sem casamento, fica como está.
    -- Vale também para o que estava em "Serviços de assistência técnica": o
    -- que se cadastrou ali como produto (na Aprendiz, um mouse) não é serviço.
    FOR p IN
      SELECT pr.id, pr.nome, cat.nome AS cat_nome
        FROM produtos pr JOIN categorias_produto cat ON cat.id = pr.categoria_id
       WHERE pr.filial = f
         AND ((cat.padrao AND pr.subcategoria_id IS NULL)
              OR nome_item_normalizado(cat.nome) LIKE '%servicos de assistencia%')
    LOOP
      v_cand := left(split_part(nome_item_normalizado(p.nome), ' ', 1), 4);
      CONTINUE WHEN length(v_cand) < 4;
      v_dcat := NULL; v_dsub := NULL;
      SELECT t.categoria, t.subcategoria INTO v_dcat, v_dsub FROM taxonomia_padrao t
       WHERE t.nicho = f AND t.subcategoria <> ''
         AND EXISTS (SELECT 1 FROM regexp_split_to_table(nome_item_normalizado(t.subcategoria), ' ') w
                      WHERE length(w) >= 4 AND left(w, 4) = v_cand)
       ORDER BY (t.categoria = p.cat_nome) DESC, t.ordem
       LIMIT 1;
      CONTINUE WHEN v_dcat IS NULL;
      SELECT id INTO v_cat FROM categorias_produto WHERE filial = f AND padrao AND nome = v_dcat;
      SELECT id INTO v_sub FROM subcategorias_produto WHERE categoria_id = v_cat AND padrao AND nome = v_dsub;
      UPDATE produtos SET categoria_id = v_cat, subcategoria_id = v_sub, categoria = v_dcat WHERE id = p.id;
    END LOOP;

    -- Subcategoria antiga (fora da lista) sem produto sai. Eram as dos PDFs,
    -- digitadas à mão e com grafia variada ("Futas", "Ração pras cães"): o
    -- único conteúdo delas era o nome, que agora existe certo na lista. As que
    -- têm produto ficam, como Próprias.
    DELETE FROM subcategorias_produto s
     USING categorias_produto cat
     WHERE s.categoria_id = cat.id AND cat.filial = f AND NOT s.padrao
       AND NOT EXISTS (SELECT 1 FROM produtos pr WHERE pr.subcategoria_id = s.id);

    -- Categorias antigas dos PDFs que ficaram vazias: as subcategorias
    -- inventadas que sobraram dentro delas mudam para a categoria padrão
    -- correspondente (como Próprias), e a antiga sai.
    FOR c IN
      SELECT o.id, (SELECT categoria FROM _ctx x
                     WHERE x.nicho = f AND nome_item_normalizado(o.nome) LIKE x.padrao
                     ORDER BY x.ordem LIMIT 1) AS ctx
        FROM categorias_produto o
       WHERE o.filial = f AND NOT o.padrao
         AND NOT EXISTS (SELECT 1 FROM produtos pr WHERE pr.categoria_id = o.id)
    LOOP
      CONTINUE WHEN c.ctx IS NULL;
      UPDATE subcategorias_produto
         SET categoria_id = (SELECT id FROM categorias_produto WHERE filial = f AND padrao AND nome = c.ctx)
       WHERE categoria_id = c.id;
      DELETE FROM categorias_produto WHERE id = c.id;
    END LOOP;

    -- "Serviços de assistência técnica" (TechMax): serviço não é produto — o
    -- lugar é Cadastros › Serviços. Vazia, sai; com produto, fica Própria para
    -- o professor ver o que foi cadastrado como mercadoria.
    DELETE FROM categorias_produto o
     WHERE o.filial = f AND NOT o.padrao
       AND nome_item_normalizado(o.nome) LIKE '%servicos de assistencia%'
       AND NOT EXISTS (SELECT 1 FROM produtos pr WHERE pr.categoria_id = o.id);
  END LOOP;

  -- Serviços da TechMax: as categorias do catálogo passam a ser as da lista.
  UPDATE servicos
     SET atributos = jsonb_set(atributos, '{categoria_svc}', to_jsonb(m.novo))
    FROM (VALUES ('Formatação', 'Formatação e instalação de software'),
                 ('Software',   'Formatação e instalação de software'),
                 ('Instalação', 'Configuração')) AS m(antigo, novo)
   WHERE servicos.filial = 'TechMax'
     AND servicos.atributos ->> 'categoria_svc' = m.antigo;

  PERFORM set_config('app.taxonomia_padrao', '', true);
END;
$migra$;

NOTIFY pgrst, 'reload schema';
