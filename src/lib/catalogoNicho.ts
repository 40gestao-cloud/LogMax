// Catálogo semente por nicho — colhido do que as 4 turmas cadastraram de
// verdade, não gerado por IA.
//
// A ideia nasceu de um problema concreto: gerar lista de produto com um LLM
// (dentro ou fora do LogMax, tanto faz) produz "Arroz Tio João Integral
// 2,5kg" que não existe, ou peso que ninguém confere — porque um LLM gerando
// nome de produto está amostrando linguagem, não consultando catálogo.
// Nenhuma instrução conserta isso; é a natureza da tarefa.
//
// A saída não é gerar, é COLHER. Os 112 itens abaixo vêm de `produtos` das 4
// turmas (2026-08-21) — cada um passou pelo único teste que importa: um
// aluno procurou o nome, achou a marca certa, e cadastrou. Curados à mão:
// removidas duplicatas entre turmas (ex.: "Esponja de Aço" e "Lã de Aço" do
// mesmo Bombril eram o mesmo produto com nomes diferentes) e resolvidos dois
// conflitos onde turmas diferentes atribuíram marca ou peso incompatível ao
// "mesmo" item — nesses casos ficou o dado mais plausível, não os dois.
//
// O que este arquivo NÃO tem, de propósito:
//   - EAN. O código que cada turma gravou é sintético (gerado pelo botão
//     "Gerar" em Cadastros > Produtos), não o código de barras real do
//     fabricante. Reaproveitar um único EAN nesta semente faria toda turma
//     futura nascer com o MESMO código de barras — pior que não ter nenhum.
//     O cadastro real continua gerando o dele.
//   - Imagem. É o aluno que sobe a foto ao cadastrar; a semente só entrega o
//     texto.
//
// Uso pretendido: sugestão de nome/marca/peso ao cadastrar produto (ex.:
// futuro módulo de conteúdo em Matriz), nunca escrita direta em `produtos` —
// quem cadastra confere e ajusta, do mesmo jeito que confere hoje o que vem
// de uma requisição.

export type ItemCatalogoNicho = {
  nome: string;
  marca: string;
  /** Categoria e subcategoria da taxonomia padrão (migr. 629/630) —
   *  exatamente os nomes de `taxonomia_padrao`, que a folha manda o aluno
   *  escolher em Cadastros › Produtos. */
  categoria: string;
  subcategoria: string;
  /** Só preenchido quando a embalagem declara conteúdo (mercearia). */
  peso: number | null;
  pesoUnidade: 'G' | 'KG' | 'ML' | 'L' | null;
  unidade: string;
};

export const CATALOGO_NICHO: Record<'SuperMax' | 'MaxLook' | 'TechMax', ItemCatalogoNicho[]> = {
  SuperMax: [
    { nome: 'Desengordurante Spray 500ml', marca: 'Veja', categoria: 'Limpeza', subcategoria: 'Limpeza de cozinha', peso: 500, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Vinagre de Álcool 750ml', marca: 'Castelo', categoria: 'Mercearia', subcategoria: 'Óleos, azeites e vinagres', peso: 750, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Achocolatado em Pó 400g', marca: 'Toddy', categoria: 'Matinais', subcategoria: 'Achocolatados e cappuccinos', peso: 400, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Amaciante Tradicional 2L', marca: 'Downy', categoria: 'Limpeza', subcategoria: 'Amaciantes', peso: 2, pesoUnidade: 'L', unidade: 'UN' },
    { nome: 'Delicadas 500g', marca: 'Tixan Coco', categoria: 'Limpeza', subcategoria: 'Sabão para roupas', peso: 500, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Papel Higiênico Folha Dupla 12 rolos', marca: 'Personal', categoria: 'Higiene e beleza', subcategoria: 'Papel higiênico', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Sabão Líquido para Roupas 3L', marca: 'Omo', categoria: 'Limpeza', subcategoria: 'Sabão para roupas', peso: 3, pesoUnidade: 'L', unidade: 'UN' },
    { nome: 'Leite em Pó Integral 400g', marca: 'Ninho', categoria: 'Matinais', subcategoria: 'Leite em pó', peso: 400, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Água Sanitária 2L', marca: 'Qboa', categoria: 'Limpeza', subcategoria: 'Desinfetantes e água sanitária', peso: 2, pesoUnidade: 'L', unidade: 'UN' },
    { nome: 'Álcool Etílico 70% 1L', marca: 'Coperalcool', categoria: 'Limpeza', subcategoria: 'Álcool', peso: 1, pesoUnidade: 'L', unidade: 'UN' },
    { nome: 'Amaciante de Roupas Concentrado 2L', marca: 'Comfort', categoria: 'Limpeza', subcategoria: 'Amaciantes', peso: 2, pesoUnidade: 'L', unidade: 'UN' },
    { nome: 'Desinfetante Pinho 500ml', marca: 'Pinho Sol', categoria: 'Limpeza', subcategoria: 'Desinfetantes e água sanitária', peso: 500, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Detergente Líquido Neutro 500ml', marca: 'Ypê', categoria: 'Limpeza', subcategoria: 'Detergentes', peso: 500, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Esponja de Louça Kit 4 unidades', marca: 'Spontex', categoria: 'Limpeza', subcategoria: 'Esponjas e palhas de aço', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Esponja Multiuso', marca: 'Scotch-Brite', categoria: 'Limpeza', subcategoria: 'Esponjas e palhas de aço', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Lã de Aço Pacote com 8 unidades', marca: 'Bombril', categoria: 'Limpeza', subcategoria: 'Esponjas e palhas de aço', peso: 60, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Limpador de Vidros 500ml', marca: 'Veja', categoria: 'Limpeza', subcategoria: 'Limpa-vidros e lustra-móveis', peso: 500, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Limpador Multiuso Tradicional 500ml', marca: 'Veja', categoria: 'Limpeza', subcategoria: 'Limpadores multiuso', peso: 500, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Limpador Sanitário Gel Pinho 500ml', marca: 'Harpic', categoria: 'Limpeza', subcategoria: 'Limpeza de banheiro', peso: 500, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Lustra-Móveis Lavanda 200ml', marca: 'Poliflor', categoria: 'Limpeza', subcategoria: 'Limpa-vidros e lustra-móveis', peso: 200, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Sabão em Barra Glicerinado 5 unidades', marca: 'Ypê', categoria: 'Limpeza', subcategoria: 'Sabão para roupas', peso: 1, pesoUnidade: 'KG', unidade: 'UN' },
    { nome: 'Sabão em Pó Ação Multi 1kg', marca: 'Omo', categoria: 'Limpeza', subcategoria: 'Sabão para roupas', peso: 1, pesoUnidade: 'KG', unidade: 'UN' },
    { nome: 'Sabão em Pó Power Act', marca: 'Ypê', categoria: 'Limpeza', subcategoria: 'Sabão para roupas', peso: 500, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Saco para Lixo Reforçado 50L com 10 unidades', marca: 'Dover-Roll', categoria: 'Limpeza', subcategoria: 'Sacos de lixo e lixeiras', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Tira-Manchas em Pó O2 450g', marca: 'Vanish', categoria: 'Limpeza', subcategoria: 'Alvejantes e tira-manchas', peso: 450, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Arroz Branco Tipo 1 5kg', marca: 'Tio João', categoria: 'Mercearia', subcategoria: 'Arroz', peso: 5, pesoUnidade: 'KG', unidade: 'UN' },
    { nome: 'Azeite Extra Virgem 500ml', marca: 'Gallo', categoria: 'Mercearia', subcategoria: 'Óleos, azeites e vinagres', peso: 500, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Biscoito Cream Cracker 350g', marca: 'Bauducco', categoria: 'Matinais', subcategoria: 'Biscoitos e bolachas', peso: 350, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Biscoito Recheado Chocolate 130g', marca: 'Oreo', categoria: 'Matinais', subcategoria: 'Biscoitos e bolachas', peso: 130, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Cereal Matinal de Milho 300g', marca: "Kellogg's", categoria: 'Matinais', subcategoria: 'Cereais matinais e granolas', peso: 300, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Feijão Carioca Tipo 1 1kg', marca: 'Camil', categoria: 'Mercearia', subcategoria: 'Feijão', peso: 1, pesoUnidade: 'KG', unidade: 'UN' },
    { nome: 'Feijão Preto Tipo 1 1kg', marca: 'Kicaldo', categoria: 'Mercearia', subcategoria: 'Feijão', peso: 1, pesoUnidade: 'KG', unidade: 'UN' },
    { nome: 'Ketchup Tradicional 400g', marca: 'Hemmer', categoria: 'Mercearia', subcategoria: 'Temperos e condimentos', peso: 400, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Maionese Tradicional 500g', marca: "Hellmann's", categoria: 'Mercearia', subcategoria: 'Temperos e condimentos', peso: 500, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Molho de Tomate Tradicional 300g', marca: 'Pomarola', categoria: 'Mercearia', subcategoria: 'Molhos e extratos de tomate', peso: 300, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Óleo de Soja 900ml', marca: 'Liza', categoria: 'Mercearia', subcategoria: 'Óleos, azeites e vinagres', peso: 900, pesoUnidade: 'ML', unidade: 'UN' },
    { nome: 'Sal Refinado 1kg', marca: 'Cisne', categoria: 'Mercearia', subcategoria: 'Temperos e condimentos', peso: 1, pesoUnidade: 'KG', unidade: 'UN' },
    { nome: 'Atum Sólido em Óleo 170g', marca: 'Gomes da Costa', categoria: 'Mercearia', subcategoria: 'Enlatados e conservas', peso: 170, pesoUnidade: 'G', unidade: 'UN' },
    { nome: 'Sardinha em Óleo 125g', marca: 'Coqueiro', categoria: 'Mercearia', subcategoria: 'Enlatados e conservas', peso: 125, pesoUnidade: 'G', unidade: 'UN' },
  ],
  MaxLook: [
    { nome: 'Bolsa Feminina Transversal-Anacapri', marca: 'Anacapri', categoria: 'Acessórios', subcategoria: 'Bolsas', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Boné Aba Curva', marca: 'New Era', categoria: 'Acessórios', subcategoria: 'Bonés e chapéus', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Carteira Masculina Couro', marca: 'Couro e Cia', categoria: 'Acessórios', subcategoria: 'Carteiras', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Cinto Masculino Couro Legítimo', marca: 'Fasolo', categoria: 'Acessórios', subcategoria: 'Cintos', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Luvas de Inverno em Malha', marca: 'Puket', categoria: 'Acessórios', subcategoria: 'Cachecóis, luvas e gorros', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Papete Unissex Conforto', marca: 'Melissa', categoria: 'Calçados', subcategoria: 'Sandálias e rasteirinhas', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Rasteirinha Feminina de Tiras', marca: 'Vizzano', categoria: 'Calçados', subcategoria: 'Sandálias e rasteirinhas', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Sandália Havaianas Top', marca: 'Havaianas', categoria: 'Calçados', subcategoria: 'Chinelos', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Sapatilha Feminina Bico Arredondado', marca: 'Moleca', categoria: 'Calçados', subcategoria: 'Sapatilhas', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Scarpin Feminino Bico Fino', marca: 'Santa Lolla', categoria: 'Calçados', subcategoria: 'Scarpins', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Chinelo Masculino Slide', marca: 'Cartago', categoria: 'Calçados', subcategoria: 'Chinelos', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Meia Esportiva Cano Médio Kit 3 Pares', marca: 'Lupo', categoria: 'Moda íntima e pijamas', subcategoria: 'Meias', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Meia-Calça Fina 40 Fios', marca: 'Trifil', categoria: 'Moda íntima e pijamas', subcategoria: 'Meias', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Sapato Social Masculino Couro', marca: 'Democrata', categoria: 'Calçados', subcategoria: 'Sapatos', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Tênis Casual Unissex Old Skool', marca: 'Vans', categoria: 'Calçados', subcategoria: 'Tênis', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Tênis Esportivo Masculino de Corrida', marca: 'Olympikus', categoria: 'Calçados', subcategoria: 'Tênis', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Blusa Regata Feminina', marca: 'C&A', categoria: 'Roupas', subcategoria: 'Regatas', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Calça Cargo Unissex', marca: 'Hering', categoria: 'Roupas', subcategoria: 'Calças', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Calça Legging Feminina Esportiva', marca: 'Nike', categoria: 'Moda esportiva', subcategoria: 'Leggings', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Calça Pantalona Feminina', marca: 'Shoulder', categoria: 'Roupas', subcategoria: 'Calças', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Jaqueta Jeans Feminina', marca: 'Renner', categoria: 'Roupas', subcategoria: 'Casacos e jaquetas', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Short Jeans Feminino Cintura Alta', marca: 'Sawary', categoria: 'Roupas', subcategoria: 'Bermudas e shorts', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Vestido Feminino Midi', marca: 'Farm', categoria: 'Roupas', subcategoria: 'Vestidos', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Chapéu de Palha Feminino', marca: 'Martha Medeiros', categoria: 'Acessórios', subcategoria: 'Bonés e chapéus', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Bermuda Masculina Chino', marca: 'Reserva', categoria: 'Roupas', subcategoria: 'Bermudas e shorts', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Cachecol de Tricô Unissex', marca: 'Puket', categoria: 'Acessórios', subcategoria: 'Cachecóis, luvas e gorros', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Calça Jeans Masculina Slim', marca: "Levi's", categoria: 'Roupas', subcategoria: 'Calças', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Camisa Polo Masculina Piquet', marca: 'Dudalina', categoria: 'Roupas', subcategoria: 'Polos', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Camiseta Masculina Básica', marca: 'Hering', categoria: 'Roupas', subcategoria: 'Camisetas', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Moletom Canguru Unissex', marca: 'Adidas', categoria: 'Roupas', subcategoria: 'Moletons e suéteres', peso: null, pesoUnidade: null, unidade: 'UN' },
  ],
  TechMax: [
    { nome: 'Adaptador HDMI para VGA', marca: 'Multilaser', categoria: 'TV e vídeo', subcategoria: 'Cabos HDMI e de vídeo', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Cabo USB-C 2 Metros', marca: 'Geonav', categoria: 'Acessórios para celular', subcategoria: 'Cabos e adaptadores USB', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Carregador Portátil Universal 20000mah', marca: 'Xiaomi', categoria: 'Acessórios para celular', subcategoria: 'Power banks', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Caixa de Som Portátil', marca: 'Ultimate Ears', categoria: 'Áudio', subcategoria: 'Caixas de som', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Fone de Ouvido TWS com Cancelamento de Ruído', marca: 'Sony', categoria: 'Áudio', subcategoria: 'Fones de ouvido', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Microfone Condensador USB', marca: 'Fifine', categoria: 'Áudio', subcategoria: 'Microfones', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Soundbar 2.1 Canais Bluetooth', marca: 'Samsung', categoria: 'Áudio', subcategoria: 'Soundbars e home theater', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Câmera Digital Compacta 20MP', marca: 'Canon', categoria: 'Câmeras e segurança', subcategoria: 'Câmeras digitais', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'iPhone 15', marca: 'Apple', categoria: 'Celulares e tablets', subcategoria: 'Smartphones', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Motorola Edge 50 Fusion', marca: 'Motorola', categoria: 'Celulares e tablets', subcategoria: 'Smartphones', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Redmi Note 13 Pro 5G', marca: 'Xiaomi', categoria: 'Celulares e tablets', subcategoria: 'Smartphones', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Samsung Galaxy A07 4G', marca: 'Samsung', categoria: 'Celulares e tablets', subcategoria: 'Smartphones', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Tablet Tab M10 64GB', marca: 'Lenovo', categoria: 'Celulares e tablets', subcategoria: 'Tablets', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Adaptador Bluetooth USB', marca: 'Orico', categoria: 'Redes', subcategoria: 'Adaptadores Wi-Fi e Bluetooth', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Roteador Wi-Fi 6 Gigabit Dual Band AX3000', marca: 'TP-Link', categoria: 'Redes', subcategoria: 'Roteadores', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Carregador Veicular USB-C', marca: 'Geonav', categoria: 'Acessórios para celular', subcategoria: 'Carregadores', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Estabilizador 500VA', marca: 'TS Shara', categoria: 'Energia', subcategoria: 'Estabilizadores', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Fonte de Alimentação 500W', marca: 'Corsair', categoria: 'Hardware', subcategoria: 'Fontes', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Nobreak 1200VA', marca: 'SMS', categoria: 'Energia', subcategoria: 'Nobreaks', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Console de Videogame 1TB', marca: 'Sony', categoria: 'Games', subcategoria: 'Consoles', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Controle PS5', marca: 'Sony', categoria: 'Games', subcategoria: 'Controles', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Controle Sem Fio para PC', marca: '8BitDo', categoria: 'Games', subcategoria: 'Controles', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Mouse Pad Gamer Grande', marca: 'Husk', categoria: 'Periféricos', subcategoria: 'Mousepads', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Aspire 5 Ryzen 7', marca: 'Acer', categoria: 'Computadores', subcategoria: 'Notebooks', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Chromebook 14" Full HD', marca: 'Samsung', categoria: 'Computadores', subcategoria: 'Notebooks', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Headset Gamer USB com Microfone', marca: 'HyperX', categoria: 'Periféricos', subcategoria: 'Headsets', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Impressora Multifuncional Wi-Fi', marca: 'HP', categoria: 'Computadores', subcategoria: 'Impressoras e scanners', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Impressora Térmica Bluetooth', marca: 'Elgin', categoria: 'Computadores', subcategoria: 'Impressoras e scanners', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'MacBook Air M2 13"', marca: 'Apple', categoria: 'Computadores', subcategoria: 'Notebooks', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Monitor LED 24" Full HD', marca: 'LG', categoria: 'Computadores', subcategoria: 'Monitores', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Monitor Ultrawide 29" IPS', marca: 'LG', categoria: 'Computadores', subcategoria: 'Monitores', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Projetor Full HD 1080p', marca: 'Epson', categoria: 'TV e vídeo', subcategoria: 'Projetores', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Scanner de Mesa A4', marca: 'Canon', categoria: 'Computadores', subcategoria: 'Impressoras e scanners', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Teclado Sem Fio Slim', marca: 'Microsoft', categoria: 'Periféricos', subcategoria: 'Teclados', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Webcam Full HD 1080p', marca: 'Logitech', categoria: 'Periféricos', subcategoria: 'Webcams', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Câmera de Ação 4K', marca: 'GoPro', categoria: 'Câmeras e segurança', subcategoria: 'Câmeras de ação', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Câmera de Segurança Wi-Fi Full HD', marca: 'Intelbras', categoria: 'Câmeras e segurança', subcategoria: 'Câmeras de segurança', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Hub USB-C 7 em 1', marca: 'Baseus', categoria: 'Periféricos', subcategoria: 'Hubs e adaptadores', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Leitor de Cartão USB 3.0', marca: 'Ugreen', categoria: 'Periféricos', subcategoria: 'Hubs e adaptadores', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Mouse Gamer RGB 8000 DPI', marca: 'Razer', categoria: 'Periféricos', subcategoria: 'Mouses', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Mouse sem Fio M170', marca: 'Logitech', categoria: 'Periféricos', subcategoria: 'Mouses', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Smart TV 43" 4K UHD', marca: 'TCL', categoria: 'TV e vídeo', subcategoria: 'Smart TVs', peso: null, pesoUnidade: null, unidade: 'UN' },
    { nome: 'Smart TV 65" QLED 4K', marca: 'Samsung', categoria: 'TV e vídeo', subcategoria: 'Smart TVs', peso: null, pesoUnidade: null, unidade: 'UN' },
  ],
};
