import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ClipboardList, Plus, X, Loader2, Check, Users, Calendar, Star,
  Lock, Unlock, Pencil, Trash2, ChevronDown, ChevronRight, EyeOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FilialBadge, NeuButtonAccent } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { todayBR } from '../lib/dates';
import { isConselheiro } from '../lib/rbac';
import { TIPOS_TAREFA, metaDoTipo, type TipoTarefa } from '../lib/cicloTarefaTipos';
import type { UserProfile } from '../hooks/useUserProfile';

const FILIAIS_OP = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof FILIAIS_OP[number];

type Tarefa = {
  id: string;
  ciclo_id: string;
  tipo: string;
  nome: string;
  descricao: string | null;
  data: string;
  status: 'rascunho' | 'aberta' | 'encerrada';
  created_at: string;
};

type Participante = {
  id: string;
  tarefa_id: string;
  funcionario_id: string | null;
  nome_snapshot: string;
  filial: FilialOp;
};

type Nota = {
  id: string;
  participante_id: string;
  avaliador_id: string;
  nota: number;
  comentario: string | null;
};

const fmtData = (iso: string) => iso ? iso.split('-').reverse().join('/') : '';

const STATUS_META: Record<Tarefa['status'], { label: string; classe: string }> = {
  rascunho:  { label: 'Rascunho',  classe: 'border-gray-500/30 bg-gray-500/10 text-gray-400' },
  aberta:    { label: 'Em avaliação', classe: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  encerrada: { label: 'Encerrada', classe: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
};

// ─────────────────────────────────────────────────────────────────────
// Painel de demandas do ciclo Padrão (modo Matriz).
//
// O ciclo Padrão criava só o ciclo — não tinha canal de pauta pra filial.
// Aqui a Matriz cria a demanda, libera pra nota e encerra; a filial lê em
// Demandas > Padrão. Tabela própria (`ciclo_tarefas`, migr. 361): a nota
// daqui NÃO entra no placar da competição inter-filiais.
export function CicloTarefasPanel({ ciclo, profile, showToast }: {
  ciclo: { id: string; nome: string; status: string };
  profile: UserProfile;
  showToast: any;
}) {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [expandida, setExpandida] = useState<string | null>(null);
  const [modal, setModal] = useState<{ tarefa: Tarefa | null } | null>(null);

  // Gerir = conselho da Matriz (inclui admin). Dar nota = CEO/conselheiro;
  // admin modera e não vota, mesma régua da Competição.
  const podeGerir = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  const podeAvaliar = profile.role === 'ceo' || isConselheiro(profile);
  const cicloAberto = ciclo.status === 'Aberto';

  const carregar = useCallback(async (comSpinner = true) => {
    if (!supabase) { setLoading(false); return; }
    if (comSpinner) setLoading(true);
    try {
      const { data: ts, error } = await supabase
        .from('ciclo_tarefas')
        .select('id,ciclo_id,tipo,nome,descricao,data,status,created_at')
        .eq('ciclo_id', ciclo.id)
        .eq('ativo', true)
        .order('data', { ascending: true });
      if (error) throw error;
      const lista = (ts ?? []) as Tarefa[];
      setTarefas(lista);

      const ids = lista.map(t => t.id);
      if (ids.length === 0) { setParticipantes([]); setNotas([]); return; }

      const { data: ps } = await supabase
        .from('ciclo_tarefa_participantes')
        .select('id,tarefa_id,funcionario_id,nome_snapshot,filial')
        .in('tarefa_id', ids)
        .eq('ativo', true);
      const listaP = (ps ?? []) as Participante[];
      setParticipantes(listaP);

      const partIds = listaP.map(p => p.id);
      if (partIds.length === 0) { setNotas([]); return; }

      // RLS sela o voto: enquanto a tarefa não encerra, o conselheiro só
      // recebe a própria linha. Não há o que filtrar aqui.
      const { data: ns } = await supabase
        .from('ciclo_tarefa_avaliacoes')
        .select('id,participante_id,avaliador_id,nota,comentario')
        .in('participante_id', partIds)
        .eq('ativo', true);
      setNotas((ns ?? []) as Nota[]);

      // Nota de admin fica fora da média exibida (regra da 240).
      const { data: admins } = await supabase
        .from('user_profiles').select('id').eq('role', 'admin');
      setAdminIds(new Set((admins ?? []).map((a: any) => a.id)));
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao carregar demandas do ciclo.', 'error');
    } finally {
      setLoading(false);
    }
  }, [ciclo.id, showToast]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!supabase) return;
    const canal = supabase
      .channel(`ciclo-tarefas-${ciclo.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ciclo_tarefas', filter: `ciclo_id=eq.${ciclo.id}` }, () => carregar(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ciclo_tarefa_participantes' }, () => carregar(false))
      .subscribe();
    return () => { supabase!.removeChannel(canal); };
  }, [ciclo.id, carregar]);

  const partPorTarefa = useMemo(() => {
    const m: Record<string, Participante[]> = {};
    for (const p of participantes) (m[p.tarefa_id] ??= []).push(p);
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => a.filial === b.filial
        ? a.nome_snapshot.localeCompare(b.nome_snapshot)
        : a.filial.localeCompare(b.filial));
    }
    return m;
  }, [participantes]);

  const notasPorParticipante = useMemo(() => {
    const m: Record<string, Nota[]> = {};
    for (const n of notas) (m[n.participante_id] ??= []).push(n);
    return m;
  }, [notas]);

  const mediaDoParticipante = useCallback((partId: string): number | null => {
    const lista = (notasPorParticipante[partId] ?? []).filter(n => !adminIds.has(n.avaliador_id));
    if (lista.length === 0) return null;
    return lista.reduce((s, n) => s + Number(n.nota), 0) / lista.length;
  }, [notasPorParticipante, adminIds]);

  const acao = async (rpc: string, args: Record<string, any>, ok: string) => {
    if (!supabase) return;
    const { error } = await supabase.rpc(rpc, args);
    if (error) { showToast?.(error.message, 'error'); return; }
    showToast?.(ok, 'success');
    carregar(false);
  };

  const excluir = async (t: Tarefa) => {
    const n = (partPorTarefa[t.id] ?? []).length;
    const msg = `Excluir a demanda "${t.nome}"?\n\n`
      + `  • ${n} participante(s)\n`
      + (t.status !== 'rascunho' ? '  • A filial deixa de ver esta demanda\n' : '')
      + `\nEsta ação é irreversível.`;
    if (!await confirm(msg)) return;
    acao('excluir_ciclo_tarefa', { p_tarefa_id: t.id }, 'Demanda excluída.');
  };

  if (loading) return (
    <div className="neu-flat rounded-3xl p-12 border border-white/5 shrink-0">
      <div className="flex items-center justify-center"><LoadingSpinner /></div>
    </div>
  );

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList size={16} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-300">Demandas do Ciclo</h3>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
            {ciclo.nome}
          </span>
        </div>
        {podeGerir && cicloAberto && (
          <NeuButtonAccent onClick={() => setModal({ tarefa: null })}>
            <Plus size={14} /> Nova Demanda
          </NeuButtonAccent>
        )}
      </div>

      <p className="text-[11px] text-gray-500 mb-4">
        A pauta que a Matriz publica pras filiais neste ciclo. Aparece em
        <span className="text-gray-400 font-semibold"> Demandas → Padrão</span> assim que for liberada.
        As notas ficam no ciclo — não entram no placar da competição.
      </p>

      {!cicloAberto && (
        <p className="text-[11px] text-amber-300/80 mb-4">
          Ciclo fechado — reabra o ciclo para criar ou editar demandas.
        </p>
      )}

      {tarefas.length === 0 ? (
        <EmptyState message="Nenhuma demanda neste ciclo ainda." />
      ) : (
        <div className="flex flex-col gap-3">
          {tarefas.map(t => {
            const meta = metaDoTipo(t.tipo);
            const Icone = meta.icon;
            const st = STATUS_META[t.status];
            const parts = partPorTarefa[t.id] ?? [];
            const aberta = expandida === t.id;

            return (
              <div key={t.id} className="neu-pressed rounded-2xl border border-white/5 overflow-hidden">
                <div className="flex items-start justify-between gap-3 p-4 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setExpandida(aberta ? null : t.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {aberta ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
                      <Icone size={13} className={meta.color} />
                      <span className={`text-[10px] font-black uppercase tracking-widest ${meta.color}`}>{meta.label}</span>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${st.classe}`}>{st.label}</span>
                    </div>
                    <p className="text-sm font-black text-gray-100 leading-tight">{t.nome}</p>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-1">
                      <Calendar size={10} /> {fmtData(t.data)}
                      <span className="flex items-center gap-1"><Users size={10} /> {parts.length}</span>
                    </p>
                  </button>

                  {podeGerir && (
                    <div className="flex items-center gap-2 shrink-0">
                      {t.status === 'rascunho' && cicloAberto && (
                        <button
                          onClick={() => acao('liberar_ciclo_tarefa', { p_tarefa_id: t.id }, 'Demanda liberada — a filial já enxerga.')}
                          className="btn-shimmer btn-shimmer--glass-yellow"
                          title="Publicar pra filial e liberar as notas do conselho"
                        >
                          <Unlock size={11} /> Liberar
                        </button>
                      )}
                      {t.status === 'aberta' && (
                        <button
                          onClick={() => acao('encerrar_ciclo_tarefa', { p_tarefa_id: t.id }, 'Demanda encerrada — as médias foram publicadas.')}
                          className="btn-shimmer btn-shimmer--glass-yellow"
                          title="Fechar as notas e publicar a média pra filial"
                        >
                          <Lock size={11} /> Encerrar
                        </button>
                      )}
                      {t.status === 'encerrada' && cicloAberto && (
                        <button
                          onClick={() => acao('reabrir_ciclo_tarefa', { p_tarefa_id: t.id }, 'Demanda reaberta.')}
                          className="btn-shimmer btn-shimmer--glass-yellow"
                          title="Voltar a aceitar notas"
                        >
                          <Unlock size={11} /> Reabrir
                        </button>
                      )}
                      {t.status !== 'encerrada' && cicloAberto && (
                        <button onClick={() => setModal({ tarefa: t })} className="btn-shimmer btn-shimmer--glass-blue" title="Editar pauta e participantes">
                          <Pencil size={11} /> Editar
                        </button>
                      )}
                      <button onClick={() => excluir(t)} className="btn-shimmer btn-shimmer--glass-red" title="Excluir demanda">
                        <Trash2 size={11} /> Excluir
                      </button>
                    </div>
                  )}
                </div>

                {aberta && (
                  <div className="px-4 pb-4 flex flex-col gap-3 border-t border-white/5 pt-3">
                    {t.descricao && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Descrição / pauta</p>
                        <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">{t.descricao}</p>
                      </div>
                    )}
                    {parts.length === 0 ? (
                      <p className="text-xs text-gray-500 italic">Sem participantes — adicione antes de liberar.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {parts.map(p => (
                          <LinhaParticipante
                            key={p.id}
                            participante={p}
                            tarefaStatus={t.status}
                            minhaNota={(notasPorParticipante[p.id] ?? []).find(n => n.avaliador_id === profile.id) ?? null}
                            media={mediaDoParticipante(p.id)}
                            nNotas={(notasPorParticipante[p.id] ?? []).filter(n => !adminIds.has(n.avaliador_id)).length}
                            podeAvaliar={podeAvaliar}
                            onSalvo={() => carregar(false)}
                            showToast={showToast}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <ModalDemanda
          ciclo={ciclo}
          tarefa={modal.tarefa}
          participantesAtuais={modal.tarefa ? (partPorTarefa[modal.tarefa.id] ?? []) : []}
          onClose={() => setModal(null)}
          onSalvo={() => { setModal(null); carregar(false); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ── Linha de participante: nota do conselho ──────────────────────────
function LinhaParticipante({ participante, tarefaStatus, minhaNota, media, nNotas, podeAvaliar, onSalvo, showToast }: {
  participante: Participante;
  tarefaStatus: Tarefa['status'];
  minhaNota: Nota | null;
  media: number | null;
  nNotas: number;
  podeAvaliar: boolean;
  onSalvo: () => void;
  showToast: any;
}) {
  const [editando, setEditando] = useState(false);
  const [nota, setNota] = useState(minhaNota ? String(minhaNota.nota) : '');
  const [comentario, setComentario] = useState(minhaNota?.comentario ?? '');
  const [saving, setSaving] = useState(false);

  const podeEscrever = podeAvaliar && tarefaStatus === 'aberta';

  const salvar = async () => {
    if (!supabase) return;
    const n = Number(nota.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      showToast?.('Nota deve estar entre 0 e 10.', 'error'); return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('avaliar_ciclo_tarefa', {
      p_participante_id: participante.id,
      p_nota: n,
      p_comentario: comentario || null,
    });
    setSaving(false);
    if (error) { showToast?.(error.message, 'error'); return; }
    showToast?.('Nota registrada.', 'success');
    setEditando(false);
    onSalvo();
  };

  return (
    <div className="neu-flat rounded-xl px-3 py-2.5 border border-white/5 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <FilialBadge filial={participante.filial} />
        <span className="text-xs font-semibold text-gray-200 flex-1 min-w-0 truncate">{participante.nome_snapshot}</span>

        {tarefaStatus === 'encerrada' && media != null && (
          <span className="text-[11px] font-black tabular-nums text-accent">
            {media.toFixed(1)}/10 <span className="text-gray-500 font-semibold">({nNotas})</span>
          </span>
        )}
        {tarefaStatus === 'aberta' && (
          minhaNota
            ? <span className="text-[11px] font-black tabular-nums text-emerald-300">
                sua nota {Number(minhaNota.nota).toFixed(1)}
              </span>
            : <span className="text-[10px] text-gray-500 flex items-center gap-1">
                <EyeOff size={10} /> sem sua nota
              </span>
        )}
        {tarefaStatus === 'rascunho' && (
          <span className="text-[10px] text-gray-500">aguardando liberação</span>
        )}

        {podeEscrever && !editando && (
          <button
            onClick={() => setEditando(true)}
            className="text-[10px] font-bold px-2 py-1 rounded-lg neu-button text-accent flex items-center gap-1"
          >
            <Star size={10} /> {minhaNota ? 'Alterar' : 'Dar nota'}
          </button>
        )}
      </div>

      {editando && (
        <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text" inputMode="decimal" value={nota}
              onChange={e => setNota(e.target.value)}
              placeholder="0-10"
              className="neu-input rounded-lg px-2 py-1.5 text-xs w-20"
            />
            <input
              type="text" value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder="Comentário (opcional)"
              className="neu-input rounded-lg px-2 py-1.5 text-xs flex-1 min-w-[140px]"
            />
            <button onClick={salvar} disabled={saving}
              className="text-[10px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent ring-1 ring-accent/40 flex items-center gap-1 disabled:opacity-50">
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Salvar
            </button>
            <button onClick={() => setEditando(false)}
              className="text-[10px] font-bold px-2 py-1.5 rounded-lg neu-button text-gray-400">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {minhaNota?.comentario && !editando && (
        <p className="text-[11px] text-gray-400 italic pl-2 border-l-2 border-accent/30">"{minhaNota.comentario}"</p>
      )}
    </div>
  );
}

// ── Modal criar/editar demanda ───────────────────────────────────────
function ModalDemanda({ ciclo, tarefa, participantesAtuais, onClose, onSalvo, showToast }: {
  ciclo: { id: string; nome: string };
  tarefa: Tarefa | null;
  participantesAtuais: Participante[];
  onClose: () => void;
  onSalvo: () => void;
  showToast: any;
}) {
  const isEdit = !!tarefa;
  const [tipo, setTipo] = useState<TipoTarefa>((tarefa?.tipo as TipoTarefa) ?? 'tarefa_apresentacao');
  const [nome, setNome] = useState(tarefa?.nome ?? '');
  const [descricao, setDescricao] = useState(tarefa?.descricao ?? '');
  const [data, setData] = useState(tarefa?.data ?? todayBR());
  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [loadingFn, setLoadingFn] = useState(true);
  const [filtroFilial, setFiltroFilial] = useState<'todas' | FilialOp>('todas');
  const [saving, setSaving] = useState(false);
  const [selecionados, setSelecionados] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    participantesAtuais.forEach(p => { if (p.funcionario_id) init[p.funcionario_id] = true; });
    return init;
  });

  useEffect(() => {
    (async () => {
      if (!supabase) { setLoadingFn(false); return; }
      const { data } = await supabase
        .from('funcionarios')
        .select('id,nome,filial,cargo,ativo')
        .in('filial', FILIAIS_OP as unknown as string[])
        .eq('ativo', true)
        .order('nome', { ascending: true });
      setFuncionarios(data ?? []);
      setLoadingFn(false);
    })();
  }, []);

  const filtrados = useMemo(() =>
    filtroFilial === 'todas' ? funcionarios : funcionarios.filter(f => f.filial === filtroFilial),
    [funcionarios, filtroFilial]);

  const total = Object.values(selecionados).filter(Boolean).length;

  const salvar = async () => {
    if (!supabase) return;
    if (!nome.trim()) { showToast?.('Informe o nome da demanda.', 'error'); return; }
    if (total === 0) { showToast?.('Selecione ao menos 1 participante.', 'error'); return; }
    setSaving(true);
    const participantes = funcionarios
      .filter(f => selecionados[f.id])
      .map(f => ({ funcionario_id: f.id, nome: f.nome, filial: f.filial }));

    const { error } = isEdit
      ? await supabase.rpc('atualizar_ciclo_tarefa', {
          p_tarefa_id: tarefa!.id,
          p_nome: nome.trim(),
          p_descricao: descricao.trim(),
          p_data: data,
          p_participantes: participantes,
        })
      : await supabase.rpc('criar_ciclo_tarefa', {
          p_ciclo_id: ciclo.id,
          p_tipo: tipo,
          p_nome: nome.trim(),
          p_descricao: descricao.trim(),
          p_data: data,
          p_participantes: participantes,
        });
    setSaving(false);
    if (error) { showToast?.(error.message, 'error'); return; }
    showToast?.(isEdit ? 'Demanda atualizada.' : 'Demanda criada — libere quando a pauta estiver pronta.', 'success');
    onSalvo();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-2xl border border-accent/20 p-5 sm:p-6 w-full max-w-2xl my-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-gray-100">
              {isEdit ? 'Editar demanda' : 'Nova demanda do ciclo'}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Ciclo {ciclo.nome}</p>
          </div>
          <button onClick={onClose} className="neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="ct-tipo" className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Tipo</label>
            <select
              id="ct-tipo" value={tipo}
              onChange={e => setTipo(e.target.value as TipoTarefa)}
              disabled={isEdit}
              className="neu-input py-2 px-3 text-sm rounded-lg disabled:opacity-60"
            >
              {TIPOS_TAREFA.map(t => (
                <option key={t} value={t}>{metaDoTipo(t).label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ct-data" className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Data</label>
            <input
              id="ct-data" type="date" value={data}
              onChange={e => setData(e.target.value)}
              className="neu-input py-2 px-3 text-sm rounded-lg"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="ct-nome" className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Nome</label>
          <input
            id="ct-nome" type="text" value={nome}
            onChange={e => setNome(e.target.value)}
            placeholder="Ex.: Pauta comercial do trimestre"
            className="neu-input py-2 px-3 text-sm rounded-lg"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="ct-desc" className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            Descrição / pauta (opcional)
          </label>
          <textarea
            id="ct-desc" value={descricao} rows={3}
            onChange={e => setDescricao(e.target.value)}
            placeholder="O que a filial precisa entregar, como será avaliado…"
            className="neu-input py-2 px-3 text-sm rounded-lg resize-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              Participantes ({total} selecionados)
            </label>
            <div className="flex items-center gap-1 neu-pressed rounded-lg p-0.5">
              {(['todas', ...FILIAIS_OP] as const).map(f => (
                <button
                  key={f} onClick={() => setFiltroFilial(f as any)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded transition-all ${
                    filtroFilial === f ? 'neu-button text-accent' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {f === 'todas' ? 'Todas' : f}
                </button>
              ))}
            </div>
          </div>

          {loadingFn ? (
            <div className="flex items-center justify-center py-6"><Loader2 size={16} className="animate-spin text-accent" /></div>
          ) : filtrados.length === 0 ? (
            <p className="text-xs text-gray-500 italic py-3 text-center">Nenhum funcionário disponível.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto neu-pressed rounded-xl p-2 flex flex-col gap-1">
              {filtrados.map(f => {
                const marcado = !!selecionados[f.id];
                return (
                  <label
                    key={f.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      marcado ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <input
                      type="checkbox" checked={marcado}
                      onChange={e => setSelecionados(s => ({ ...s, [f.id]: e.target.checked }))}
                      className="accent-current"
                    />
                    <span className="text-xs text-gray-200 flex-1 truncate">{f.nome}</span>
                    {f.cargo && <span className="text-[10px] text-gray-500 hidden sm:inline">{f.cargo}</span>}
                    <FilialBadge filial={f.filial} />
                    {marcado && <Check size={12} className="text-accent" />}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
          <button onClick={onClose} disabled={saving}
            className="text-xs font-bold px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-gray-200">
            Cancelar
          </button>
          <button onClick={salvar} disabled={saving || !nome.trim() || total === 0}
            className="text-xs font-bold px-4 py-2 rounded-lg neu-button text-accent ring-1 ring-accent/40 hover:ring-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving && <Loader2 size={12} className="animate-spin" />}
            {isEdit ? 'Salvar' : 'Criar demanda'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
