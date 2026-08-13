import { useEffect } from 'react';
import { supabase } from '../lib/supabase';

// Varredura de cobranças abandonadas (Pix e cartão) ao abrir um PDV.
//
// Substitui um cron de servidor, impossível no plano Hobby do Vercel (1
// execução por dia). Quem abre o caixa faz a limpeza — efeito coletivo.
//
// Duas janelas de idade:
//   • > 5 min do PRÓPRIO operador: sessão anterior dele (fechou a aba no meio
//     do checkout). Margem curta porque sabemos de quem é; cliente real
//     confirma em menos de 1 min. Sem recorte de filial de propósito — é a
//     mesma pessoa limpando QR fantasma dela, em qualquer loja onde operou.
//   • > 1h de qualquer operador DESTA filial: terminal que não voltou ao PDV.
//     Margem longa pra não pisar em cobrança legítima em andamento noutro
//     caixa, e recortada por filial pra que uma loja não mexa no caixa da
//     outra — a RLS já contém o colaborador no próprio operador_id, mas
//     admin e CEO passam por `auth_is_admin()` e enxergam o banco inteiro
//     (migr. 414).
//
// Antes existia só para Pix, e só dentro do PDV de MaxLook/TechMax. Cartão
// ficava 'aguardando' para sempre quando o operador fechava a aba com a
// maquininha na tela, e a SuperMax nunca varria nada.

const JANELA_PROPRIA_MS = 5 * 60 * 1000;
const JANELA_FILIAL_MS  = 60 * 60 * 1000;

type Tabela = 'pix_pendentes' | 'cartao_pendentes';

async function varrerTabela(tabela: Tabela, filial: string, userId: string): Promise<number> {
  if (!supabase) return 0;
  const cutoffProprio = new Date(Date.now() - JANELA_PROPRIA_MS).toISOString();
  const cutoffFilial  = new Date(Date.now() - JANELA_FILIAL_MS).toISOString();

  const [proprios, daFilial] = await Promise.all([
    supabase.from(tabela).select('id')
      .eq('operador_id', userId)
      .eq('status', 'aguardando')
      .lt('created_at', cutoffProprio),
    supabase.from(tabela).select('id')
      .eq('filial', filial)
      .eq('status', 'aguardando')
      .lt('created_at', cutoffFilial),
  ]);

  // Dedupe: pendente do próprio operador com mais de 1h aparece nas duas.
  const ids = Array.from(new Set([
    ...((proprios.data ?? []).map((o: any) => o.id)),
    ...((daFilial.data ?? []).map((o: any) => o.id)),
  ]));
  if (ids.length === 0) return 0;

  await supabase.from(tabela).update({ status: 'cancelado' }).in('id', ids);
  return ids.length;
}

export function useVarrerPendentesOrfaos(
  filial: string | null | undefined,
  userId: string | null | undefined,
  showToast?: (msg: string, tipo?: string, persist?: boolean) => void,
) {
  useEffect(() => {
    if (!supabase || !userId || !filial) return;
    let cancelled = false;
    (async () => {
      const [pix, cartao] = await Promise.all([
        varrerTabela('pix_pendentes', filial, userId),
        varrerTabela('cartao_pendentes', filial, userId),
      ]);
      if (cancelled) return;
      const total = pix + cartao;
      if (total === 0) return;
      const partes: string[] = [];
      if (pix > 0)    partes.push(`${pix} Pix`);
      if (cartao > 0) partes.push(`${cartao} de cartão`);
      showToast?.(
        `${total} cobrança${total > 1 ? 's' : ''} antiga${total > 1 ? 's' : ''} cancelada${total > 1 ? 's' : ''} (${partes.join(' e ')}).`,
        'info',
        true,
      );
    })();
    return () => { cancelled = true; };
  }, [filial, userId, showToast]);
}
