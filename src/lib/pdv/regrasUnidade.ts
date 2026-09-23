import { isConselheiro } from '../rbac';

// Regras do PDV que mudam conforme a unidade ou a alçada de quem opera.
// Hoje só o PDV de MaxLook/TechMax (PDVView) as usa; a SuperMax tem a própria
// lista de formas, com Vale-Alimentação.

// Só admin, CEO e Conselheiro alternam entre filiais (modo Matriz). Gerente
// fica travado na própria unidade, igual colaborador — gerente não cobre
// outras filiais (regra de negócio).
export const podeAlternarFilial = (profile: any): boolean =>
  profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);

// Devolução é ato de alçada (migr. 459): mexe em estoque, dinheiro e cobrança
// na mesma transação. Espelha o guard de `criar_devolucao_venda` —
// `auth_is_admin() OR auth_gerente_da(filial)`. A tela só evita o erro seco; a
// regra que vale é a do banco.
export const podeDevolver = (profile: any, filial: string): boolean =>
  profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile)
  || (profile?.role === 'gerente' && profile?.filial === filial);

// MaxLook/TechMax não aceitam MaxBank Benefícios — só faz sentido no
// SuperMax (supermercado tem itens elegíveis, roupa e eletrônico não).
//
// A prazo muda de nome e de existência conforme a unidade:
//   MaxLook — a loja de moda chama de CREDIÁRIO. É só o rótulo do balcão: o
//             valor gravado em `vendas.forma_pagamento` continua 'Fiado',
//             porque é ele que faz `criar_venda_pdv` abrir a conta a receber
//             em vez de dar a venda por recebida.
//   TechMax — não vende a prazo: o aparelho não sai da loja sem pagamento, e
//             quem quer parcelar usa Cartão Crédito.
const FORMAS_BASE = ['Dinheiro', 'Cartão Débito', 'Cartão Crédito', 'PIX'];

export const formasDaUnidade = (filial: string): string[] =>
  filial === 'TechMax' ? FORMAS_BASE : [...FORMAS_BASE, 'Fiado'];

export const rotuloFiado = (filial: string): string =>
  filial === 'MaxLook' ? 'Crediário' : 'Fiado';
