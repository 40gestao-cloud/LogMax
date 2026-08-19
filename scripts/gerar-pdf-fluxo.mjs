// Gera o PDF do fluxo de compras e estoque — o documento que a turma lê antes
// de operar. Rodar: npm run doc:fluxo
//
// Mora no repo, e nao num arquivo solto, por um motivo: o fluxo muda. Quando
// mudar, este script muda junto e o PDF e regerado — documento de processo que
// so existe como binario envelhece calado e passa a ensinar o que o sistema nao
// faz mais, que e pior do que nao ter documento.
//
// Cuidado com caractere fora do WinAnsi: a fonte padrao do jsPDF nao tem seta
// (U+2192). Ela sai como glifo errado, com espacamento quebrado, e a linha
// estoura a caixa para fora da pagina — aconteceu na primeira versao.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'node:fs';

const GOLD = [212, 175, 55];
const BLACK = [10, 10, 10];
const INK = [40, 40, 40];
const MID = [110, 110, 110];
const SOFT = [225, 225, 225];
const TINT = [252, 248, 235];
const GREEN = [22, 133, 90];
const RED = [180, 45, 45];
const BLUE = [40, 90, 160];

const W = 210, H = 297, M = 16;
const doc = new jsPDF({ unit: 'mm', format: 'a4' });
let y = 0;
let pagina = 0;

const rodape = () => {
  doc.setDrawColor(...SOFT); doc.setLineWidth(0.2);
  doc.line(M, H - 14, W - M, H - 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MID);
  doc.text('LogMax — Fluxo de Compras e Estoque · atualizado em 19/08/2026', M, H - 9.5);
  doc.text(`${pagina}`, W - M, H - 9.5, { align: 'right' });
};

const novaPagina = (titulo) => {
  if (pagina > 1) rodape();
  doc.addPage(); pagina++;
  // faixa de topo
  doc.setFillColor(...BLACK); doc.rect(0, 0, W, 13, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GOLD);
  doc.text('LogMax', M, 8.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(200, 200, 200);
  doc.text(titulo, W - M, 8.5, { align: 'right' });
  y = 24;
};

const espaco = (mm) => { y += mm; };

const garante = (mm, titulo) => { if (y + mm > H - 20) novaPagina(titulo); };

const h1 = (txt) => {
  garante(18, txt);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...BLACK);
  doc.text(txt, M, y); y += 2.5;
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.9);
  doc.line(M, y, M + 22, y);
  y += 7;
};

const h2 = (txt) => {
  garante(14, txt);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...BLACK);
  doc.text(txt, M, y); y += 5.5;
};

const p = (txt, opts = {}) => {
  const size = opts.size ?? 9.2;
  const cor = opts.cor ?? INK;
  const larg = opts.larg ?? (W - M * 2);
  const x = opts.x ?? M;
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
  doc.setFontSize(size); doc.setTextColor(...cor);
  const linhas = doc.splitTextToSize(txt, larg);
  garante(linhas.length * (size * 0.42) + 3);
  doc.text(linhas, x, y);
  y += linhas.length * (size * 0.42) + (opts.gap ?? 3);
};

// Caixa de destaque com barra colorida à esquerda.
const caixa = (titulo, texto, cor = GOLD) => {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const linhas = doc.splitTextToSize(texto, W - M * 2 - 12);
  const alt = linhas.length * 4 + (titulo ? 6 : 0) + 7;
  garante(alt + 4);
  doc.setFillColor(...TINT);
  doc.rect(M, y - 4, W - M * 2, alt, 'F');
  doc.setFillColor(...cor);
  doc.rect(M, y - 4, 1.6, alt, 'F');
  let yy = y + 1.5;
  if (titulo) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...BLACK);
    doc.text(titulo, M + 6, yy); yy += 5.5;
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
  doc.text(linhas, M + 6, yy);
  y += alt + 3;
};

// Passo numerado do fluxo: número em círculo, título, quem faz, descrição.
const passo = (n, titulo, quem, texto, destaque = false) => {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6);
  const linhas = doc.splitTextToSize(texto, W - M * 2 - 20);
  const alt = Math.max(13, linhas.length * 3.7 + 9);
  garante(alt + 3);

  if (destaque) {
    doc.setFillColor(...TINT);
    doc.rect(M, y - 4.5, W - M * 2, alt, 'F');
  }
  // círculo do número
  doc.setFillColor(...(destaque ? GOLD : BLACK));
  doc.circle(M + 4.5, y - 0.2, 3.6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.setTextColor(...(destaque ? BLACK : [255, 255, 255]));
  doc.text(String(n), M + 4.5, y + 0.9, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.6); doc.setTextColor(...BLACK);
  doc.text(titulo, M + 11, y);
  // etiqueta de quem faz
  const larguraTit = doc.getTextWidth(titulo);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
  const larguraQuem = doc.getTextWidth(quem) + 5;
  doc.setFillColor(...BLACK);
  doc.roundedRect(M + 14 + larguraTit, y - 3.2, larguraQuem, 4.6, 1, 1, 'F');
  doc.setTextColor(...GOLD);
  doc.text(quem, M + 16.5 + larguraTit, y + 0.1);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(...INK);
  doc.text(linhas, M + 11, y + 5);
  y += alt;
};

const tabela = (head, body, opts = {}) => {
  garante(30);
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 8.2, cellPadding: 2.4, textColor: INK, lineColor: SOFT, lineWidth: 0.1 },
    headStyles: { fillColor: BLACK, textColor: GOLD, fontStyle: 'bold', fontSize: 8.2 },
    alternateRowStyles: { fillColor: TINT },
    columnStyles: opts.columnStyles ?? {},
  });
  y = doc.lastAutoTable.finalY + 7;
};

// ─────────────────────────────────────────────────────────────────────────────
// CAPA
// ─────────────────────────────────────────────────────────────────────────────
pagina = 1;
doc.setFillColor(...BLACK); doc.rect(0, 0, W, H, 'F');

doc.setFillColor(...GOLD); doc.rect(0, 92, W, 0.8, 'F');

doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...GOLD);
doc.text('LOGMAX', M, 40);
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(150, 150, 150);
doc.text('Sistema de gestão — operação didática', M, 46);

doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(255, 255, 255);
doc.text('Fluxo de Compras', M, 68);
doc.text('e Estoque', M, 82);

doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...GOLD);
doc.text('Como funciona depois das mudanças de 19/08/2026', M, 104);

doc.setFontSize(9.5); doc.setTextColor(190, 190, 190);
const introCapa = doc.splitTextToSize(
  'Este documento existe porque o fluxo estava sendo usado fora de ordem — e o sistema deixava. '
  + 'O cadastro do produto acabava caindo na doca, no meio do recebimento, e ninguém entendia por quê. '
  + 'Aqui está a ordem certa, quem faz cada passo, o que mudou no sistema e o que fazer quando a tela recusa algo.',
  W - M * 2 - 30);
doc.text(introCapa, M, 116);

doc.setDrawColor(...GOLD); doc.setLineWidth(0.3);
doc.line(M, 150, M + 30, 150);

doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
doc.text('Para quem é', M, 160);
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(190, 190, 190);
doc.text([
  'Setor solicitante  ·  pede o que precisa',
  'Compras            ·  cota, decide o fornecedor e emite o pedido',
  'Financeiro         ·  aprova a cotação e paga',
  'Estoque            ·  recebe a carga e dá entrada',
  'Gerência           ·  acompanha as três unidades',
], M, 168);

doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GOLD);
doc.text('A regra que resolve 90% das dúvidas', M, 205);
doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
doc.text(doc.splitTextToSize(
  'O catálogo vem antes da compra. Item que vira estoque tem cadastro antes de ser comprado — '
  + 'na doca só se confere o que já tem código.', W - M * 2 - 20), M, 213);

doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
doc.text('Documento gerado a partir do sistema em 19/08/2026 · migrações 476 a 480', M, H - 18);

// ─────────────────────────────────────────────────────────────────────────────
// 1. A ORDEM CERTA
// ─────────────────────────────────────────────────────────────────────────────
novaPagina('A ordem certa');

h1('Primeiro: por que havia confusão');

p('Até agora, o produto só entrava no catálogo quando a mercadoria já estava na doca. O conferente '
+ 'registrava o recebimento, descobria que o produto não existia, ia cadastrar e voltava para confirmar. '
+ 'Isso gerava a pergunta certa: "se estou cadastrando o produto, é óbvio que ele chegou — por que preciso '
+ 'confirmar de novo?"');

caixa('A resposta',
  'Os dois passos do recebimento estão certos e continuam existindo. O que estava fora de lugar era o '
+ 'cadastro entre eles. Em sistema de gestão real não se emite pedido de compra de um item sem código: '
+ 'o cadastro acontece semanas antes, junto com a decisão de comprar. Quando a carga chega, o item já tem '
+ 'código — e a doca só confere.');

h1('Os dois momentos');

h2('Momento 1 — Abertura do catálogo (acontece uma vez)');
p('É a implantação do sistema. A unidade cadastra o que vende ou consome antes de operar. Nenhuma compra '
+ 'acontece aqui: é cadastro puro. O que já está na prateleira entra pelo campo Saldo de Abertura, que não '
+ 'gera conta a pagar.');

h2('Momento 2 — O ciclo de compra (acontece toda vez)');
p('Com o catálogo pronto, toda compra segue os sete passos da próxima página. O cadastro de produto não '
+ 'aparece em nenhum deles — porque já foi feito.');

espaco(2);
caixa('E quando aparece um item que nunca foi comprado?',
  'Duas situações diferentes, que antes saíam pela mesma porta:\n\n'
+ '1) O item vai virar estoque (uma mercadoria nova no mix). Quem decide vender é Compras, e é Compras '
+ 'quem cadastra — antes de emitir o pedido. A partir de 19/08 o sistema exige isso.\n\n'
+ '2) O item não vira estoque (café, um serviço, um conserto de urgência). Esse pode continuar como texto '
+ 'livre para sempre: é despesa, não entra no controle de saldo.', BLUE);

// ─────────────────────────────────────────────────────────────────────────────
// 2. MOMENTO 1
// ─────────────────────────────────────────────────────────────────────────────
novaPagina('Momento 1 — Abertura do catálogo');

h1('Momento 1 — Abertura do catálogo');
p('Feito uma vez por unidade, por quem responde pelo catálogo (logística ou compras). Enquanto isso não '
+ 'estiver feito, nenhum recebimento consegue ser confirmado — não há o que dar entrada.', { cor: INK });

espaco(1);
passo(1, 'Baixar o modelo', 'LOGÍSTICA',
  'Cadastros > Produtos > "Modelo de planilha". O arquivo vem com as colunas certas da SUA unidade — a ficha '
+ 'muda entre mercearia, boutique e eletrônicos. Baixar o modelo de outra unidade não funciona.');

passo(2, 'Preencher fora do sistema', 'LOGÍSTICA',
  'Uma linha por produto, no Excel ou no Google Planilhas. Categoria e Fornecedor precisam já existir no '
+ 'LogMax — se não existirem, cadastre-os primeiro, senão a linha será recusada. Sem código de barras, deixe '
+ 'a coluna vazia: o sistema gera um interno da loja.');

passo(3, 'Importar', 'LOGÍSTICA',
  'Cadastros > Produtos > "Importar planilha". O sistema lê o arquivo e mostra, linha a linha, o que entra e '
+ 'o que foi recusado com o motivo. Nada é gravado até você confirmar. Linha recusada não impede as outras: '
+ 'corrija na planilha e importe de novo, ou cadastre aquela à mão.', true);

espaco(2);
caixa('Saldo de Abertura não é compra',
  'A coluna "Saldo de Abertura" é o que já está fisicamente na prateleira hoje. Ela gera uma entrada de '
+ 'implantação no estoque e NÃO cria conta a pagar, porque não houve fornecedor nem dinheiro saindo. '
+ 'Mercadoria comprada entra pelo ciclo de compra, com documento e custo.');

h2('O que a planilha confere antes de gravar');
tabela(
  ['Verificação', 'O que acontece se estiver errado'],
  [
    ['Categoria existe no LogMax', 'Linha recusada — cadastre a categoria antes'],
    ['Código de barras (EAN)', 'Dígito verificador errado recusa; vazio gera um código interno da loja'],
    ['Unidade vale na sua unidade de negócio', 'Linha recusada, com a lista do que vale'],
    ['Fração (12,5)', 'Só passa se a unidade for KG ou L; em UN, CX, PC vai inteiro'],
    ['Código ou nome repetido', 'Recusa tanto contra o catálogo quanto dentro do próprio arquivo'],
    ['Ficha do nicho', 'Campo obrigatório da sua unidade recusa se vier vazio'],
    ['Perecível marcado "Sim"', 'Exige a validade em dias, senão o item não entra na fila de Validades'],
    ['Preço de venda abaixo do custo', 'Não impede — avisa, porque existe queima de estoque'],
  ],
  { columnStyles: { 0: { cellWidth: 62, fontStyle: 'bold' } } },
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. MOMENTO 2 — O CICLO
// ─────────────────────────────────────────────────────────────────────────────
novaPagina('Momento 2 — O ciclo de compra');

h1('Momento 2 — O ciclo de compra');
p('Oito passos, cinco setores. Cada passo só abre depois que o anterior fecha — é assim que o sistema '
+ 'garante que ninguém compra sem aprovação nem dá entrada sem conferência.');

espaco(1);
passo(1, 'Requisição', 'SETOR SOLICITANTE',
  'Requisições > Do Setor. Duas opções: REPOSIÇÃO escolhe um item do catálogo (é o caminho normal, e o mais '
+ 'rápido); EVENTUAL descreve em texto livre o que ainda não existe. Quem pede não precisa conhecer o '
+ 'catálogo — normalizar é papel de Compras, mais adiante.');

passo(2, 'Aprovação da requisição', 'GERÊNCIA',
  'Requisições > Aprovações. O gerente autoriza o que a unidade vai comprar. Alterar item ou quantidade '
+ 'depois de aprovado devolve a requisição para nova aprovação.');

passo(3, 'Cotação', 'COMPRAS',
  'Compras > Cotações. Coletar pelo menos três propostas por requisição é a boa prática — a tela avisa '
+ 'quando há menos. A proposta escolhida vai para o Financeiro.');

passo(4, 'Aprovação da cotação', 'FINANCEIRO',
  'Financeiro > Aprovações de Cotação. O Financeiro aprova, nega ou devolve para correção com o motivo. '
+ 'É aqui que o dinheiro é autorizado.');

passo(5, 'Gerar pedido', 'COMPRAS',
  'Compras > Cotações > "Gerar Pedido". Se a requisição veio como EVENTUAL, o sistema pergunta qual item do '
+ 'catálogo é aquilo, e o pedido não sai sem resposta. O item escolhido fica guardado na requisição: a '
+ 'próxima compra do mesmo produto já nasce como Reposição. O pedido cria a conta a pagar.', true);

passo(6, 'Marcar "Em entrega"', 'COMPRAS',
  'Compras > Pedidos. Avisa o Estoque de que a carga está a caminho — é o que faz o pedido aparecer na fila '
+ 'de quem recebe.');

passo(7, 'Registrar recebimento', 'ESTOQUE',
  'Estoque > Recebimentos > "Registrar". Significa "a carga chegou na doca". O estoque AINDA NÃO MUDOU e o '
+ 'fornecedor ainda não pode ser pago. É o registro da chegada, antes da conferência.');

passo(8, 'Confirmar', 'ESTOQUE',
  'Na linha do recebimento, botão "Confirmar". É aqui que o estoque sobe e o pagamento é liberado. Como o '
+ 'pedido já traz o produto, o campo vem travado — não há o que escolher. Informe lote e validade '
+ '(mercearia) ou os números de série (eletrônicos) e confirme.', true);

espaco(2);
caixa('Por que dois passos no recebimento?',
  'Entre "chegou" e "assumo" existe a conferência. É nesse intervalo que se confere quantidade, avaria e '
+ 'validade — e é por isso que a devolução ao fornecedor por divergência só existe aí. Confirmar é o ato '
+ 'que diz: conferi, está certo, o estoque é meu e o fornecedor pode ser pago.');

// ─────────────────────────────────────────────────────────────────────────────
// 4. O QUE MUDOU
// ─────────────────────────────────────────────────────────────────────────────
novaPagina('O que mudou');

h1('O que mudou em 19/08');

tabela(
  ['Onde', 'Antes', 'Agora'],
  [
    ['Compras > Cotações\n(Gerar Pedido)',
     'O pedido saía com o item em texto livre. Ninguém amarrava ao catálogo.',
     'Compra eventual pede o item do catálogo antes de gerar. A escolha volta para a requisição.'],
    ['Cadastros > Produtos',
     'O modelo de planilha só baixava. A volta era digitada, um a um.',
     '"Importar planilha" lê o arquivo, confere linha a linha e cadastra em lote.'],
    ['Estoque > Recebimentos\n(lista)',
     'Só o número do pedido. Para saber o que era, tinha de abrir.',
     'O nome do produto aparece embaixo do número.'],
    ['Recebimentos > Confirmar\n(produto)',
     'Lista vazia sem explicação quando o catálogo estava vazio.',
     'A tela diz que o catálogo está vazio e mostra o caminho, passo a passo.'],
    ['Recebimentos > Confirmar\n(IMEI)',
     'Trinta aparelhos exigiam trinta números digitados à mão.',
     'Botão "Gerar" preenche a lista inteira, do tamanho da carga.'],
    ['Recebimentos > Confirmar\n(validade e lote)',
     'Os campos apareciam nas três unidades, mesmo onde nada estraga.',
     'Só aparecem onde a ficha tem perecível — hoje, apenas a mercearia.'],
    ['Cadastros > Categorias',
     'Salvar com imagem dava erro de segurança para parte da turma.',
     'Corrigido: quem a aula autoriza consegue enviar a imagem.'],
    ['Mensagens de erro',
     '"new row violates row-level security policy"',
     'Texto em português dizendo que provavelmente é a unidade e o que fazer.'],
  ],
  { columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold' }, 1: { cellWidth: 66 } } },
);

espaco(1);
caixa('Uma coisa que NÃO mudou, de propósito',
  'No painel de Confirmar, quem tem pedido antigo (emitido antes de 19/08) ainda escolhe o produto na mão. '
+ 'Fechar isso agora deixaria os pedidos em andamento sem saída. Conforme os pedidos novos vão chegando, '
+ 'essa escolha desaparece sozinha.');

// ─────────────────────────────────────────────────────────────────────────────
// 5. QUANDO A TELA RECUSA
// ─────────────────────────────────────────────────────────────────────────────
novaPagina('Quando a tela recusa');

h1('Quando a tela recusa algo');
p('Toda recusa abaixo é o sistema protegendo o estoque ou o dinheiro. Nenhuma delas é defeito.');

tabela(
  ['A tela diz', 'O que significa', 'O que fazer'],
  [
    ['"O catálogo desta unidade ainda está vazio"',
     'Não há produto cadastrado na sua unidade.',
     'Faça a abertura do catálogo (Momento 1). Com a planilha, é uma vez só.'],
    ['"O pedido precisa apontar para um produto do catálogo"',
     'A requisição veio como Eventual e ninguém disse qual item é.',
     'Escolha no modal. Se não existe, cadastre em Cadastros > Produtos e volte.'],
    ['"O produto X é do catálogo da MaxLook, e este pedido é da SuperMax"',
     'Cada unidade tem o próprio catálogo.',
     'Escolha um produto da sua unidade, ou cadastre-o nela.'],
    ['"Sem permissão para gravar" / erro de política',
     'Quase sempre o seu cadastro está sem unidade, ou o setor não permite aquela ação.',
     'Chame o professor: é ajuste de cadastro de usuário, não erro do sistema.'],
    ['"Excede o saldo do pedido"',
     'A quantidade recebida é maior do que a que foi comprada.',
     'Confira a nota. Se veio a mais, registre a divergência com Compras.'],
    ['"Já existe produto com este nome nesta unidade"',
     'O item já está no catálogo.',
     'Use o que existe. Duplicar produto quebra o saldo e o custo médio.'],
    ['"Esta cotação já tem pedido gerado"',
     'Alguém já emitiu o pedido — provavelmente um colega.',
     'Procure o pedido em Compras > Pedidos antes de tentar de novo.'],
  ],
  { columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' }, 1: { cellWidth: 60 } } },
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. QUEM FAZ O QUÊ
// ─────────────────────────────────────────────────────────────────────────────
novaPagina('Quem faz o quê');

h1('Quem faz o quê');

tabela(
  ['Setor', 'Responsabilidades no fluxo'],
  [
    ['Setor solicitante\n(qualquer um)', 'Abre a requisição do que precisa. Escolhe do catálogo quando o item já existe (Reposição).'],
    ['Gerência', 'Aprova a requisição — autoriza o que a unidade vai comprar.'],
    ['Compras', 'Cota com fornecedores, emite o pedido, amarra o item ao catálogo e avisa quando a carga sai.'],
    ['Financeiro', 'Aprova a cotação (autoriza o dinheiro) e paga a conta depois da entrada.'],
    ['Estoque', 'Registra a chegada, confere e confirma a entrada. Devolve ao fornecedor o que veio errado.'],
    ['Logística / Compras', 'Mantém o catálogo: abertura inicial e cadastro de item novo no mix.'],
  ],
  { columnStyles: { 0: { cellWidth: 42, fontStyle: 'bold' } } },
);

espaco(2);
h1('Resumo em uma linha');
caixa('',
  'Cadastrar o produto  >  requisição  >  cotação  >  aprovação  >  pedido  >  carga chega  >  '
+ 'registrar  >  confirmar.\n\n'
+ 'O cadastro está no começo. Se ele estiver aparecendo no meio, alguma etapa foi pulada.');

espaco(3);
p('Dúvida que este documento não responde? Anote a tela, o botão e a mensagem exata que apareceu — com esses '
+ 'três dados a correção costuma sair no mesmo dia.', { cor: MID, size: 8.5 });

rodape();

const saida = process.argv[2] ?? 'LogMax-Fluxo-Compras-Estoque.pdf';
fs.writeFileSync(saida, Buffer.from(doc.output('arraybuffer')));
console.log('gerado:', saida, fs.statSync(saida).size, 'bytes,', pagina, 'páginas');
