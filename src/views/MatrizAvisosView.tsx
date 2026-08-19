// Matriz → Central de Avaliação → aba Avisos.
// Admin/CEO/conselheiro publica recados com prazo de validade para gerentes
// e colaboradores das filiais. O destinatário recebe um FAB em qualquer tela
// (AvisoMatrizFAB) e precisa clicar em "Ciente" — aqui a Matriz acompanha
// quem já confirmou e quem ainda não.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Megaphone, Plus, X, Loader2, Trash2, Clock, Check, Users, AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FilialBadge } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatDataHoraBR } from '../lib/dates';
import { avisoAlcanca, type AvisoMatriz } from '../hooks/useAvisosMatriz';
import type { UserProfile } from '../hooks/useUserProfile';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;

const PUBLICO_LABEL: Record<string, string> = {
  todos: 'Gerentes e colaboradores',
  gerentes: 'Somente gerentes',
  colaboradores: 'Somente colaboradores',
};

type Aviso = AvisoMatriz & { ativo: boolean; criado_por: string | null };
type Ciencia = { aviso_id: string; user_id: string; nome_snapshot: string | null; filial: string | null; ciente_em: string };
type Destinatario = { id: string; nome: string; filial: string | null; role: string };

// Acre não tem DST: subtrair 5h do UTC dá a hora de parede local, no formato
// que o <input type="datetime-local"> espera.
const paraInputAcre = (d: Date) => new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 16);
const doInputAcre = (v: string) => new Date(`${v}:00-05:00`).toISOString();

export function MatrizAvisosView({ profile, showToast }: { profile: UserProfile; showToast: any }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [ciencias, setCiencias] = useState<Ciencia[]>([]);
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const confirm = useConfirm();

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);

    const [{ data: avs }, { data: pessoas }] = await Promise.all([
      supabase
        .from('avisos_matriz')
        .select('id,titulo,descricao,filiais,publico,expira_em,nome_criador,created_at,ativo,criado_por')
        .eq('ativo', true)
        .order('created_at', { ascending: false }),
      supabase
        .from('user_profiles')
        .select('id,nome,filial,role')
        .in('role', ['gerente', 'colaborador']),
    ]);

    const lista = (avs ?? []) as Aviso[];
    setAvisos(lista);
    setDestinatarios((pessoas ?? []) as Destinatario[]);

    if (lista.length > 0) {
      const { data: cs } = await supabase
        .from('avisos_matriz_ciencia')
        .select('aviso_id,user_id,nome_snapshot,filial,ciente_em')
        .in('aviso_id', lista.map(a => a.id));
      setCiencias((cs ?? []) as Ciencia[]);
    } else {
      setCiencias([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const remover = async (aviso: Aviso) => {
    if (!await confirm({
      message: `Remover o aviso "${aviso.titulo}"? Ele some da tela de quem ainda não confirmou.`,
      confirmLabel: 'Remover',
      danger: true,
    })) return;
    const { error } = await supabase!.rpc('remover_aviso_matriz', { p_aviso_id: aviso.id });
    if (error) return showToast(error.message || 'Erro ao remover aviso', 'error');
    showToast('Aviso removido', 'success');
    carregar();
  };

  const linhas = useMemo(() => avisos.map(aviso => {
    // Destinatário = quem o aviso alcança pelas mesmas regras do banco.
    const alvo = destinatarios.filter(d => avisoAlcanca(aviso, d as unknown as UserProfile));
    const confirmaram = ciencias.filter(c => c.aviso_id === aviso.id);
    const idsConfirmaram = new Set(confirmaram.map(c => c.user_id));
    const pendentes = alvo.filter(d => !idsConfirmaram.has(d.id));
    const expirado = new Date(aviso.expira_em).getTime() <= Date.now();
    return { aviso, alvo, confirmaram, pendentes, expirado };
  }), [avisos, ciencias, destinatarios]);

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 pb-8">
      <div className="neu-flat rounded-2xl border border-amber-500/20 p-4 sm:p-5 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Megaphone size={16} className="text-amber-300" />
            <h2 className="text-lg sm:text-xl font-bold text-accent tracking-tight">Avisos da Matriz</h2>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Recado com prazo para gerentes e colaboradores. Aparece como botão flutuante em qualquer
            tela até a pessoa confirmar leitura.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="shrink-0 flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40"
        >
          <Plus size={14} /> Novo Aviso
        </button>
      </div>

      {linhas.length === 0 ? (
        <EmptyState message="Nenhum aviso publicado. Use o botão acima para enviar o primeiro." />
      ) : (
        <div className="flex flex-col gap-3">
          {linhas.map(({ aviso, alvo, confirmaram, pendentes, expirado }) => (
            <div key={aviso.id}
              className={`neu-flat rounded-2xl border p-4 flex flex-col gap-3 ${expirado ? 'border-gray-500/25 opacity-90' : 'border-amber-500/20'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1 ${
                      expirado
                        ? 'bg-gray-500/20 text-gray-300 ring-1 ring-gray-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                    }`}>
                      <Clock size={9} /> {expirado ? 'Expirado' : 'Vigente'}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                      {PUBLICO_LABEL[aviso.publico] ?? aviso.publico}
                    </span>
                    {aviso.filiais.length === 0
                      ? <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">· Todas as filiais</span>
                      : aviso.filiais.map(f => <FilialBadge key={f} filial={f} />)}
                  </div>
                  <h3 className="text-base font-black text-gray-100">{aviso.titulo}</h3>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap leading-snug">{aviso.descricao}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Por {aviso.nome_criador ?? '—'} · válido até {formatDataHoraBR(aviso.expira_em)}
                  </p>
                </div>
                <button onClick={() => remover(aviso)}
                  className="btn-shimmer btn-shimmer--glass-red shrink-0" title="Remover aviso">
                  <Trash2 size={11} /> Remover
                </button>
              </div>

              <div className="neu-pressed rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                  <Users size={11} className="text-gray-500" />
                  <span className="text-gray-400">
                    {confirmaram.length} de {alvo.length} confirmaram
                  </span>
                </div>
                {confirmaram.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {confirmaram.map(c => (
                      <span key={c.user_id}
                        className="text-[11px] px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-200 flex items-center gap-1.5">
                        <Check size={10} /> {c.nome_snapshot ?? '—'}
                        <span className="text-gray-500">{formatDataHoraBR(c.ciente_em)}</span>
                      </span>
                    ))}
                  </div>
                )}
                {pendentes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pendentes.map(p => (
                      <span key={p.id}
                        className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-400 flex items-center gap-1.5">
                        <AlertCircle size={10} className="text-amber-400" /> {p.nome}
                      </span>
                    ))}
                  </div>
                )}
                {alvo.length === 0 && (
                  <span className="text-[11px] text-gray-500 italic">
                    Nenhum usuário se encaixa neste alvo — confira filial e público.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <ModalNovoAviso
          profile={profile}
          onClose={() => setModalOpen(false)}
          onCriado={() => { setModalOpen(false); carregar(); }}
          showToast={showToast}
        />
      )}
    </motion.div>
  );
}

// ── Modal de criação ─────────────────────────────────────────────────
function ModalNovoAviso({ profile: _profile, onClose, onCriado, showToast }: {
  profile: UserProfile;
  onClose: () => void;
  onCriado: () => void;
  showToast: any;
}) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [filiais, setFiliais] = useState<string[]>([]);
  const [publico, setPublico] = useState<'todos' | 'gerentes' | 'colaboradores'>('gerentes');
  const [expiraEm, setExpiraEm] = useState(() => paraInputAcre(new Date(Date.now() + 7 * 86400_000)));
  const [saving, setSaving] = useState(false);

  const preset = (horas: number) => setExpiraEm(paraInputAcre(new Date(Date.now() + horas * 3600_000)));

  const toggleFilial = (f: string) =>
    setFiliais(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);

  async function publicar() {
    if (!titulo.trim()) return showToast('Informe o título do aviso', 'error');
    if (!descricao.trim()) return showToast('Informe a descrição do aviso', 'error');
    if (!expiraEm) return showToast('Defina até quando o aviso fica visível', 'error');
    const iso = doInputAcre(expiraEm);
    if (new Date(iso).getTime() <= Date.now()) return showToast('A expiração precisa ser no futuro', 'error');

    setSaving(true);
    const { error } = await supabase!.rpc('criar_aviso_matriz', {
      p_titulo:    titulo.trim(),
      p_descricao: descricao.trim(),
      p_expira_em: iso,
      p_filiais:   filiais,   // vazio = todas
      p_publico:   publico,
    });
    setSaving(false);
    if (error) return showToast(error.message || 'Erro ao publicar aviso', 'error');
    showToast('Aviso publicado', 'success');
    onCriado();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-2xl border border-accent/20 p-5 sm:p-6 w-full max-w-xl my-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-black text-gray-100 flex items-center gap-2">
            <Megaphone size={17} className="text-amber-300" /> Novo Aviso
          </h3>
          <button onClick={onClose} className="modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Título</label>
          <input
            type="text" value={titulo} onChange={e => setTitulo(e.target.value)}
            placeholder="Ex.: Reunião de alinhamento na sexta"
            className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Descrição</label>
          <textarea
            value={descricao} onChange={e => setDescricao(e.target.value)}
            rows={4}
            placeholder="O que o gerente precisa saber."
            className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100 resize-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              Filiais {filiais.length === 0 && <span className="text-gray-600">· todas</span>}
            </label>
            <div className="flex items-center gap-1 flex-wrap">
              {OP_FILIAIS.map(f => {
                const marcada = filiais.includes(f);
                return (
                  <button key={f} type="button" onClick={() => toggleFilial(f)}
                    className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all ${
                      marcada ? 'neu-button text-accent ring-1 ring-accent/40' : 'neu-pressed text-gray-400 hover:text-gray-200'
                    }`}>
                    {f}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-500">Nenhuma marcada envia para as três.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Público</label>
            <select
              value={publico} onChange={e => setPublico(e.target.value as any)}
              className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100"
            >
              <option value="gerentes">Somente gerentes</option>
              <option value="colaboradores">Somente colaboradores</option>
              <option value="todos">Gerentes e colaboradores</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            Fica visível até
          </label>
          <input
            type="datetime-local" value={expiraEm} onChange={e => setExpiraEm(e.target.value)}
            className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100"
          />
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { label: '24 horas', horas: 24 },
              { label: '3 dias',   horas: 72 },
              { label: '7 dias',   horas: 168 },
              { label: '30 dias',  horas: 720 },
            ].map(p => (
              <button key={p.horas} type="button" onClick={() => preset(p.horas)}
                className="text-[10px] font-bold px-2 py-1 rounded-lg neu-pressed text-gray-400 hover:text-accent">
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-500">
            Horário do Acre. Depois disso o aviso some da tela de quem não confirmou.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
          <button onClick={onClose} disabled={saving}
            className="text-xs font-bold px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-gray-200">
            Cancelar
          </button>
          <button onClick={publicar} disabled={saving || !titulo.trim() || !descricao.trim()}
            className="text-xs font-bold px-4 py-2 rounded-lg neu-button text-accent ring-1 ring-accent/40 hover:ring-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving && <Loader2 size={12} className="animate-spin" />}
            Publicar aviso
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
