import { formatBRL } from '../../lib/viewUtils';
import { FILIAL_DEFAULT } from '../../lib/filiais';
import type { TipoProduto } from '../../lib/tipoProduto';

// O que o formulário de Produtos (ProdutosView) e as seções dele em
// src/components/produtos/ compartilham: o estado vazio do formulário, os
// sentinelas dos selects e as duas conversões de número.

export const EMPTY_EXTRAS = {
  categoria:              '',
  categoria_id:           '' as string,
  subcategoria_id:        '' as string,
  preco_custo:            '',
  /** Exceção consciente ao bloqueio de preço abaixo do custo (migr. 601). */
  venda_abaixo_custo:     false,
  estoque:                '',
  estoque_minimo:         '',
  unidade:                'UN' as string,
  ean:                    '',
  fornecedor:             '',
  // Guarda a CHAVE; `fornecedor` acima continua com o nome porque a busca
  // trigram (migr. 028), o export e a ficha do catálogo leem da coluna de
  // texto. Migr. 488 — sugestão opcional, não pré-requisito.
  fornecedor_id:          '',
  marca:                  '',
  peso:                   '',
  // Medida do CONTEÚDO da embalagem, independente de `unidade` (que é a medida
  // do estoque). Arroz 5 KG em pacote: peso=5, peso_unidade=KG, unidade=UN.
  // Migr. 438 — antes o rótulo usava `unidade` e produzia "Peso / Volume (UN)".
  peso_unidade:           'KG' as string,
  // Embalagem de COMPRA — a terceira medida (migr. 589). Fardo de arroz com 30
  // UN: o estoque continua em UN, e é só a requisição que pede em fardo.
  embalagem_compra:       '',
  embalagem_qtd:          '',
  filial:                 FILIAL_DEFAULT as string,
  tipo:                   'estoque_venda' as TipoProduto,
  patrimonio_numero:      '',
  patrimonio_responsavel: '',
  patrimonio_localizacao: '',
  // Migr. 511 — meses até depreciar 100% (linear, sem residual). Vazio =
  // não entra na depreciação do DRE (bem cadastrado só pra controle físico).
  patrimonio_vida_util_meses: '',
  elegivel_beneficios:    false,
  // Atributos por nicho (JSONB em produtos.atributos). Cada filial preenche
  // um subconjunto: MaxLook usa tamanho/cor/genero/colecao/material; TechMax
  // usa modelo/cor/memoria/tela/bateria/camera/garantia_dias/requer_imei.
  // SuperMax fica com objeto vazio (usa as colunas físicas que já tem).
  atributos:              {} as Record<string, any>,
};

/** Estado da parte "extra" do formulário (tudo além de código, nome e preço). */
export type ExtrasProduto = typeof EMPTY_EXTRAS;

/** Código, nome e preço de venda — os três campos do formulário original. */
export type FormProduto = { codigo: string; nome: string; preco: string };

export const parseNum = (v: string | number | undefined | null): number =>
  typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')) || 0;

export const fmtBRL = (v: number) => `R$ ${formatBRL(v)}`;

// Sentinel do select "Item comprado". Produto nasce de uma compra; o cadastro
// sem pedido existe (saldo de abertura do primeiro dia, doação, item que a
// turma já tinha) mas é exceção, e exceção se escolhe com o nome dela na tela.
export const SEM_COMPRA = '__sem_compra__';

// Sentinel do "Outro…" nos campos de lista da ficha (tamanho, cor).
export const OUTRO = '__outro__';

/** Requisição de texto livre esperando o pedido sair (migr. 494) — uma das origens do produto. */
export interface ItemAguardandoPedido {
  id: string;
  descricao: string;
  numero: string;
  qtd: number;
  unidade: string;
  cotada: boolean;
  marca: string;
  fornecedor: string;
  fornecedor_id: string;
}

/** Item de pedido já recebido que ainda não tem produto no catálogo. */
export interface ItemComprado {
  descricao: string;
  marca: string;
  fornecedor: string;
  fornecedor_id: string;
  custo: number | null;
}
