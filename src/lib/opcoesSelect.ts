// Opções padronizadas para o SelectBusca — o mesmo cadastro aparece do mesmo
// jeito em toda tela: nome em destaque, o resto na segunda linha. Antes cada
// <select> montava a sua frase ("Nome — Marca (COD) — saldo 12 un").

import type { SelectBuscaOpcao } from '../components/SelectBusca';
import { qtdBR, formatBRL } from './viewUtils';
import { normalizarUnidade } from './unidades';

const junta = (...partes: (string | null | undefined | false)[]) =>
  partes.filter(Boolean).join(' · ') || null;

/** Produto: marca e código na segunda linha; `saldo` acrescenta o estoque. */
export function opcaoProduto(p: any, opts: { saldo?: boolean } = {}): SelectBuscaOpcao {
  return {
    value: String(p.id),
    label: p.nome ?? '—',
    sub: junta(
      p.marca,
      p.codigo,
      opts.saldo && `saldo ${qtdBR(Number(p.estoque ?? 0))} ${normalizarUnidade(p.unidade)}`,
    ),
    hint: [p.ean, p.categoria].filter(Boolean).join(' '),
  };
}

/** Funcionário: cargo e unidade na segunda linha. */
export function opcaoFuncionario(f: any, extra: Partial<SelectBuscaOpcao> = {}): SelectBuscaOpcao {
  return {
    value: String(f.id),
    label: f.nome ?? '—',
    sub: junta(f.cargo, f.departamento, f.filial),
    hint: f.matricula ?? undefined,
    ...extra,
  };
}

/** Conta bancária / caixa: banco e agência/conta na segunda linha. */
export function opcaoConta(c: any, extra: Partial<SelectBuscaOpcao> = {}): SelectBuscaOpcao {
  const numero = [c.agencia && `ag. ${c.agencia}`, c.conta && `cc ${c.conta}`].filter(Boolean).join(' ');
  return {
    value: String(c.id),
    label: c.nome ?? c.descricao ?? c.banco ?? '—',
    sub: junta(c.nome && c.banco && c.banco !== c.nome ? c.banco : null, numero || null, c.tipo, c.filial),
    ...extra,
  };
}

/** Conta de `caixa_bancos`: banco em destaque, conta (e unidade) embaixo, saldo no selo. */
export function opcaoBanco(b: any, opts: { saldo?: boolean; filial?: boolean } = {}): SelectBuscaOpcao {
  const saldo = Number(b.saldo ?? 0);
  return {
    value: String(b.id),
    label: b.banco ?? b.conta ?? '—',
    sub: junta(b.banco ? b.conta : null, b.tipo, opts.filial ? (b.filial ?? 'Global') : null),
    tag: opts.saldo ? { texto: `R$ ${formatBRL(saldo)}`, tom: saldo < 0 ? 'vermelho' : 'cinza' } : null,
  };
}
