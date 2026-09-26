// Agrupa cadastros (clientes/fornecedores) em <optgroup> por:
//   1) Tipo de pessoa (PJ antes de PF)
//   2) Filial da holding (SuperMax, MaxLook, TechMax, Matriz)
//   3) Ordem alfabética por nome
//
// Usado em selects de fornecedor (Cotações, Notas Recebidas, Contas a Pagar)
// e cliente (Contas a Receber, Orçamentos, PDV).

import { FILIAIS_HOLDING, type FilialHolding } from './filiais';

type Cadastro = {
  id: any;
  nome?: string | null;
  pessoa_tipo?: string | null;
  filial?: string | null;
};

const TIPO_ORDER: Record<string, number> = { PJ: 0, PF: 1 };
const FILIAL_ORDER: Record<string, number> = FILIAIS_HOLDING.reduce(
  (acc, f, i) => ({ ...acc, [f]: i }),
  {} as Record<FilialHolding, number>,
);

const TIPO_FALLBACK   = 'Sem tipo';
const FILIAL_FALLBACK = 'Sem filial';

export type CadastroGroup<T> = { label: string; items: T[] };

export function groupCadastrosParaSelect<T extends Cadastro>(rows: T[]): CadastroGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    const tipo   = r.pessoa_tipo || TIPO_FALLBACK;
    const filial = r.filial      || FILIAL_FALLBACK;
    const key    = `${tipo}|${filial}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(r);
  }

  const groups = Array.from(buckets.entries()).map(([key, items]) => {
    const [tipo, filial] = key.split('|');
    items.sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR', { sensitivity: 'base' }));
    return {
      label:     `${tipo} — ${filial}`,
      items,
      tipoIdx:   TIPO_ORDER[tipo]   ?? 99,
      filialIdx: FILIAL_ORDER[filial] ?? 99,
    };
  });

  groups.sort((a, b) =>
    a.tipoIdx   - b.tipoIdx   ||
    a.filialIdx - b.filialIdx ||
    a.label.localeCompare(b.label, 'pt-BR'),
  );

  return groups.map(({ label, items }) => ({ label, items }));
}

// Mesmos grupos, já no formato do SelectBusca (lista de escolha rica). `sub`
// é a segunda linha da opção (documento, cidade…); `extra` deixa quem chama
// pôr selo ou travar uma opção.
import type { SelectBuscaGrupo, SelectBuscaOpcao } from '../components/SelectBusca';

export function gruposDeCadastro<T extends Cadastro>(
  rows: T[],
  extra?: (r: T) => Partial<SelectBuscaOpcao>,
): SelectBuscaGrupo[] {
  return groupCadastrosParaSelect(rows).map(g => ({
    label: g.label,
    opcoes: g.items.map(r => ({
      value: String(r.id),
      label: r.nome ?? '—',
      sub: documentoDe(r),
      ...(extra ? extra(r) : {}),
    })),
  }));
}

function documentoDe(r: any): string | null {
  const doc = r.cnpj || r.cpf || r.documento || r.cpf_cnpj;
  const cidade = r.cidade;
  return [doc, cidade].filter(Boolean).join(' · ') || null;
}
