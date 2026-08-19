import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { X, Check, Loader2, Gift } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatBRL } from '../lib/viewUtils';

type Beneficio = {
  id: string;
  nome: string;
  tipo: string | null;
  valor: number | null;
  status: string | null;
};

type Props = {
  funcionario: { id: string; nome: string };
  beneficios: Beneficio[];
  showToast: any;
  onClose: () => void;
  /** Avisa a tela-mãe do novo total, pra refletir sem refetch geral. */
  onSaved?: (total: number) => void;
};

/**
 * Atribui benefícios do catálogo da unidade a um funcionário.
 *
 * O vínculo mora em `funcionario_beneficios` (migr. 288) e é soft-delete: tirar
 * um benefício marca `ativo=false` em vez de apagar a linha, para o histórico
 * de quem teve direito a quê continuar consultável. O índice UNIQUE parcial
 * (`WHERE ativo`) é o que permite religar o mesmo benefício depois.
 */
export const FuncionarioBeneficiosModal = ({ funcionario, beneficios, showToast, onClose, onSaved }: Props) => {
  const [vinculos, setVinculos] = useState<{ id: string; beneficio_id: string }[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const disponiveis = useMemo(
    () => beneficios
      .filter(b => (b.status ?? 'Ativo') === 'Ativo')
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [beneficios],
  );

  useEffect(() => {
    if (!supabase) return;
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase!
        .from('funcionario_beneficios')
        .select('id, beneficio_id')
        .eq('funcionario_id', funcionario.id)
        .eq('ativo', true);
      if (cancelado) return;
      if (error) {
        showToast(`Erro ao carregar benefícios: ${error.message}`, 'error');
      } else {
        setVinculos(data ?? []);
        setSelecionados(new Set((data ?? []).map(v => v.beneficio_id)));
      }
      setLoading(false);
    })();
    return () => { cancelado = true; };
  }, [funcionario.id, showToast]);

  const toggle = (id: string) => {
    setSelecionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const total = disponiveis
    .filter(b => selecionados.has(b.id))
    .reduce((acc, b) => acc + Number(b.valor ?? 0), 0);

  const handleSave = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      const atuais = new Set(vinculos.map(v => v.beneficio_id));
      const novos     = [...selecionados].filter(id => !atuais.has(id));
      const removidos = vinculos.filter(v => !selecionados.has(v.beneficio_id)).map(v => v.id);

      if (novos.length > 0) {
        // `filial` sai do trigger (a do funcionário) — não mandamos daqui pra
        // não gravar a filial de quem está com a tela aberta.
        const { error } = await supabase.from('funcionario_beneficios').insert(
          novos.map(beneficio_id => ({ funcionario_id: funcionario.id, beneficio_id })),
        );
        if (error) throw error;
      }
      if (removidos.length > 0) {
        const { error } = await supabase.from('funcionario_beneficios')
          .update({ ativo: false })
          .in('id', removidos);
        if (error) throw error;
      }

      showToast(
        `Benefícios de ${funcionario.nome} atualizados — R$ ${formatBRL(total)} por mês.`,
        'success',
      );
      onSaved?.(total);
      onClose();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? err}`, 'error');
    }
    setSaving(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={e => e.stopPropagation()}
        className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-gray-200">Benefícios · {funcionario.nome}</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {selecionados.size} de {disponiveis.length} do catálogo da unidade
            </p>
          </div>
          <button onClick={onClose}
            className="modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto main-scrollbar -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-500">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : disponiveis.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-10">
              Nenhum benefício ativo no catálogo desta unidade. Cadastre em RH → Benefícios.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {disponiveis.map(b => {
                const on = selecionados.has(b.id);
                return (
                  <button key={b.id} type="button" onClick={() => toggle(b.id)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border text-left transition-colors ${
                      on ? 'neu-pressed border-accent/30' : 'neu-button border-white/5 hover:border-white/10'
                    }`}>
                    <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                      on ? 'bg-accent border-accent text-black' : 'border-gray-600 text-transparent'
                    }`}>
                      <Check size={11} strokeWidth={3} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-gray-200 truncate">{b.nome}</span>
                      {b.tipo && <span className="block text-[10px] text-gray-500">{b.tipo}</span>}
                    </span>
                    <span className="text-xs font-mono font-bold text-blue-400 shrink-0 tabular-nums">
                      R$ {formatBRL(Number(b.valor ?? 0))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Gift size={13} className="text-blue-400" />
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Total mensal</span>
            <span className="text-sm font-mono font-black text-blue-400 tabular-nums">R$ {formatBRL(total)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || loading}
              className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-accent disabled:opacity-40">
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
