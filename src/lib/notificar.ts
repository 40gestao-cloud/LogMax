import { supabase } from './supabase';
import type { Notificacao } from '../hooks/useNotificacoes';

// Aviso no sino de um setor, via RPC `notificar_setor` (migr. 022).
//
// Existia uma cópia deste helper em três telas, e chamadas diretas em outras
// quatro — nenhuma passava a unidade. Aviso sem filial é recado para TODAS
// (vide `useNotificacoes`), então o Financeiro da TechMax recebia a cotação
// pendente da SuperMax com item, fornecedor e valor (migr. 619).
//
// `filial` é obrigatório de propósito, e é a unidade DO REGISTRO — não a do
// topbar: quem decide pela Matriz está com o topbar em "Matriz" e o documento
// é de uma unidade (vide feedback_nicho_do_topbar_nao_e_o_do_registro).
// `null` só quando o aviso é mesmo para todas as unidades.
//
// Best-effort: a operação principal já foi gravada; aviso que falha só loga.
export async function notificarSetor(n: {
  setor: string;
  tipo: Notificacao['tipo'];
  titulo: string;
  mensagem?: string | null;
  link_view?: string | null;
  urgencia?: Notificacao['urgencia'];
  ref_id?: string | null;
  motivo?: string | null;
  filial: string | null;
}): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase.rpc('notificar_setor', {
      p_setor:     n.setor,
      p_tipo:      n.tipo,
      p_titulo:    n.titulo,
      p_mensagem:  n.mensagem ?? null,
      p_link_view: n.link_view ?? null,
      p_urgencia:  n.urgencia ?? 'Média',
      p_ref_id:    n.ref_id ?? null,
      p_motivo:    n.motivo ?? null,
      p_filial:    n.filial,
    });
    if (error) console.warn(`[notificar_setor] ${n.setor}:`, error.message);
  } catch (err) {
    console.warn(`[notificar_setor] ${n.setor}:`, err);
  }
}
