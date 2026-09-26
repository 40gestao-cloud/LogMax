// Matriz → Central de Avaliação → aba Avisos.
// Admin/CEO/conselheiro publica recados com prazo de validade para gerentes
// e colaboradores das filiais. O destinatário recebe um FAB em qualquer tela
// (AvisoMatrizFAB) e precisa clicar em "Ciente" — aqui a Matriz acompanha
// quem já confirmou e quem ainda não.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Megaphone, Plus, X, Loader2, Trash2, Clock, Check, AlertCircle, ChevronDown, Building2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FilialBadge, CardContador, NeuButtonAccent } from '../components/ui';
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
  const [filtro, setFiltro] = useState<'vigentes' | 'expirados' | 'todos'>('todos');
  // Lista de nomes recolhida por padrão: com a turma inteira no alvo, os chips
  // de quem confirmou empurravam o próximo aviso para fora da tela.
  const [abertoId, setAbertoId] = useState<string | null>(null);
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

  const resumo = useMemo(() => ({
    vigentes: linhas.filter(l => !l.expirado).length,
    expirados: linhas.filter(l => l.expirado).length,
    pendentes: linhas.filter(l => !l.expirado).reduce((n, l) => n + l.pendentes.length, 0),
  }), [linhas]);
  const visiveis = linhas.filter(l => filtro === 'todos' || (filtro === 'vigentes' ? !l.expirado : l.expirado));

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5 pb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Avisos da Matriz</h2>
        <NeuButtonAccent variant="" onClick={() => setModalOpen(true)}>
          <Plus size={14} /> Novo aviso
        </NeuButtonAccent>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <CardContador label="Vigentes" value={resumo.vigentes} tom="verde"
          onClick={() => setFiltro(f => f === 'vigentes' ? 'todos' : 'vigentes')} ativo={filtro === 'vigentes'} />
        <CardContador label="Sem ciência" value={resumo.pendentes} tom="amarelo"
          onClick={() => setFiltro('vigentes')} />
        <CardContador label="Expirados" value={resumo.expirados} tom="roxo"
          onClick={() => setFiltro(f => f === 'expirados' ? 'todos' : 'expirados')} ativo={filtro === 'expirados'} />
      </div>

      {visiveis.length === 0 ? (
        <EmptyState message={linhas.length === 0
          ? 'Nenhum aviso publicado ainda.'
          : filtro === 'vigentes' ? 'Nenhum aviso vigente.' : 'Nenhum aviso expirado.'} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {visiveis.map(({ aviso, alvo, confirmaram, pendentes, expirado }) => {
            const pct = alvo.length > 0 ? Math.round((confirmaram.length / alvo.length) * 100) : 0;
            const completo = alvo.length > 0 && pendentes.length === 0;
            const aberto = abertoId === aviso.id;
            return (
              <div key={aviso.id}
                className={`neu-flat rounded-2xl border flex flex-col overflow-hidden ${expirado ? 'border-white/5 opacity-80' : 'border-white/10'}`}>
                <div className="p-4 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded flex items-center gap-1 ${
                      expirado ? 'bg-zinc-600 text-white' : 'bg-green-600 text-white'}`}>
                      <Clock size={10} /> {expirado ? 'Expirado' : 'Vigente'}
                    </span>
                    {aviso.filiais.length === 0
                      ? <span className="text-[11px] text-gray-400 flex items-center gap-1"><Building2 size={11} /> Todas as unidades</span>
                      : aviso.filiais.map(f => <FilialBadge key={f} filial={f} />)}
                    <span className="text-[11px] text-gray-500">· {PUBLICO_LABEL[aviso.publico] ?? aviso.publico}</span>
                    <button onClick={() => remover(aviso)} className="action-btn-delete ml-auto" title="Remover aviso">
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <h3 className="text-base font-black text-gray-100 leading-snug">{aviso.titulo}</h3>
                  <p className="text-sm text-gray-400 whitespace-pre-wrap leading-relaxed">{aviso.descricao}</p>
                  <p className="text-[11px] text-gray-500">
                    {aviso.nome_criador ?? '—'} · até {formatDataHoraBR(aviso.expira_em)}
                  </p>
                </div>

                {/* Ciência: barra sempre à vista, nomes sob demanda. */}
                <button type="button" onClick={() => setAbertoId(aberto ? null : aviso.id)}
                  disabled={alvo.length === 0}
                  className="px-4 py-3 border-t border-white/5 flex items-center gap-3 text-left hover:bg-white/[0.03] disabled:hover:bg-transparent">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">
                        {alvo.length === 0 ? 'Ninguém no alvo — confira unidade e público' : 'Ciência'}
                      </span>
                      {alvo.length > 0 && (
                        <span className={`font-black tabular-nums ${completo ? 'text-green-400' : 'text-amber-400'}`}>
                          {confirmaram.length}/{alvo.length}
                        </span>
                      )}
                    </div>
                    {alvo.length > 0 && (
                      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <div className={`h-full rounded-full ${completo ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                  {alvo.length > 0 && (
                    <ChevronDown size={15} className={`shrink-0 text-gray-500 transition-transform ${aberto ? 'rotate-180 text-accent' : ''}`} />
                  )}
                </button>

                {aberto && (
                  <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-green-400">Confirmaram · {confirmaram.length}</span>
                      {confirmaram.length === 0 ? <span className="text-xs text-gray-600">Ninguém ainda</span> : confirmaram.map(c => (
                        <span key={c.user_id} className="text-xs text-gray-200 flex items-center gap-1.5" title={formatDataHoraBR(c.ciente_em)}>
                          <Check size={11} className="text-green-400 shrink-0" />
                          <span className="truncate">{c.nome_snapshot ?? '—'}</span>
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Faltam · {pendentes.length}</span>
                      {pendentes.length === 0 ? <span className="text-xs text-gray-600">Todos cientes</span> : pendentes.map(p => (
                        <span key={p.id} className="text-xs text-gray-400 flex items-center gap-1.5">
                          <AlertCircle size={11} className="text-amber-400 shrink-0" />
                          <span className="truncate">{p.nome}</span>
                          {p.filial && <span className="text-[10px] text-gray-600">{p.filial}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
                    className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                      marcada ? 'btn-solido--dourado' : 'neu-pressed text-gray-400 hover:text-gray-200'
                    }`}>
                    {f}
                  </button>
                );
              })}
            </div>
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
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
          <button onClick={onClose} disabled={saving} className="btn-solido btn-solido--preto">
            Cancelar
          </button>
          <button onClick={publicar} disabled={saving || !titulo.trim() || !descricao.trim()} className="btn-solido btn-solido--dourado">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Megaphone size={13} />}
            Publicar aviso
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
