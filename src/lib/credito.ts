// Crédito do cliente na venda a prazo (migr. 416).
//
// A trava de verdade é a trigger `trg_venda_fiado_respeita_credito` em
// `vendas` — vale para os dois PDVs, para a loja online e para quem chama a
// RPC pelo F12. Este módulo existe só para a tela conseguir DIZER o número
// antes de o caixa tentar fechar: descobrir o estouro pela mensagem de erro
// funciona, mas manda o aluno bater na parede em vez de mostrar a parede.
//
// Nada aqui autoriza coisa nenhuma. Se este arquivo falhar (rede, migração
// pendente numa turma), a venda segue e quem decide continua sendo o banco.

import { supabase } from './supabase';

export type CreditoCliente = {
  /** Teto cadastrado. `null` = a casa não definiu limite para este cliente. */
  limite: number | null;
  /** Soma dos títulos em aberto (contas a receber não pagas). */
  devedor: number;
  /** Quantos desses títulos já passaram do vencimento. */
  vencidos: number;
  /** Quanto ainda cabe. `null` quando não há limite cadastrado. */
  disponivel: number | null;
};

export async function consultarCreditoCliente(clienteId: string): Promise<CreditoCliente | null> {
  if (!supabase || !clienteId) return null;
  try {
    const [cli, saldo, vencidos] = await Promise.all([
      supabase.from('clientes').select('limite_credito').eq('id', clienteId).maybeSingle(),
      supabase.rpc('cliente_saldo_devedor',    { p_cliente_id: clienteId }),
      supabase.rpc('cliente_titulos_vencidos', { p_cliente_id: clienteId }),
    ]);
    // Migração pendente na turma: degrada para "não sei" em vez de inventar
    // um limite. A tela some, a trigger (que também não existe) não trava, e
    // o comportamento é o de antes da 416.
    if (cli.error || saldo.error || vencidos.error) {
      console.warn('[credito] indisponível:',
        cli.error?.message ?? saldo.error?.message ?? vencidos.error?.message);
      return null;
    }
    const limite = cli.data?.limite_credito == null ? null : Number(cli.data.limite_credito);
    const devedor = Number(saldo.data ?? 0);
    return {
      limite,
      devedor,
      vencidos: Number(vencidos.data ?? 0),
      disponivel: limite === null ? null : Math.max(0, limite - devedor),
    };
  } catch (err: any) {
    console.warn('[credito] falha ao consultar:', err?.message ?? err);
    return null;
  }
}

/** Motivo pelo qual esta venda a prazo não pode fechar, ou `null` se pode. */
export function bloqueioFiado(credito: CreditoCliente | null, totalVenda: number): string | null {
  if (!credito) return null;
  if (credito.vencidos > 0) {
    return `Cliente com ${credito.vencidos} título(s) vencido(s) em aberto. `
         + 'Venda a prazo só depois de acertar — receba em Financeiro → Contas a Receber, ou cobre esta compra à vista.';
  }
  if (credito.limite === null) return null;
  const estouro = credito.devedor + totalVenda - credito.limite;
  if (estouro > 0.005) {
    return `Estoura o limite de crédito em ${brl(estouro)}. `
         + `Limite ${brl(credito.limite)}, já em aberto ${brl(credito.devedor)}.`;
  }
  return null;
}

const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
