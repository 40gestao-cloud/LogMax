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
import { metaDoTipo, ehDemandaPadrao, TIPO_DEMANDA_PADRAO } from '../lib/cicloTarefaTipos';
import type { UserProfile } from '../hooks/useUserProfile';

const FILIAIS_OP = ['SuperMax', 'MaxLook', 'TechMax'] as const;
// A demanda do Padrão alcança a Matriz também: CEO e conselheiros são
// avaliáveis e não têm filial operacional (migr. 367).
const FILIAIS_DEMANDA = ['Matriz', ...FILIAIS_OP] as const;
type FilialOp = typeof FILIAIS_DEMANDA[number];

// Quem pode ser posto numa demanda. Admin fica fora de propósito: modera e
// não é julgado, mesma régua de sempre: quem cria a pauta não é participante dela.
const ROLES_AVALIAVEIS = ['ceo', 'conselheiro', 'gerente', 'colaborador'] as const;

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
  user_profile_id: string | null;
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
  const [avaliadores, setAvaliadores] = useState<{ tarefa_id: string; user_profile_id: string }[]>([]);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [modal, setModal] = useState<{ tarefa: Tarefa | null } | null>(null);

  // Gerir = conselho da Matriz (inclui admin).
  // O `filial === 'Matriz'` não é redundante: modo Matriz é contexto de tela
  // (FilialContext), não o perfil. Sem ele, um gerente com is_conselheiro que
  // caísse nesse contexto veria botões que as RPCs recusam — elas exigem
  // filial 'Matriz' no perfil.
  const daMatriz = profile.filial === 'Matriz';
  const podeGerir = daMatriz && (profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile));
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
      if (ids.length === 0) { setParticipantes([]); setNotas([]); setAvaliadores([]); return; }

      // Quem dá nota em cada demanda (migr. 368). Lista vazia = demanda
      // anterior à 368, que segue a régua antiga: CEO e conselheiros.
      const { data: avs } = await supabase
        .from('ciclo_tarefa_avaliadores')
        .select('tarefa_id,user_profile_id')
        .in('tarefa_id', ids)
        .eq('ativo', true);
      setAvaliadores((avs ?? []) as { tarefa_id: string; user_profile_id: string }[]);

      const { data: ps } = await supabase
        .from('ciclo_tarefa_participantes')
        .select('id,tarefa_id,funcionario_id,user_profile_id,nome_snapshot,filial')
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ciclo_tarefa_avaliadores' }, () => carregar(false))
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

  // Toda nota gravada passou pelo guard da 368, então toda nota é nota
  // autorizada — não há mais o que filtrar por cargo aqui.
  const mediaDoParticipante = useCallback((partId: string): number | null => {
    const lista = notasPorParticipante[partId] ?? [];
    if (lista.length === 0) return null;
    return lista.reduce((s, n) => s + Number(n.nota), 0) / lista.length;
  }, [notasPorParticipante]);

  const avaliadoresPorTarefa = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const a of avaliadores) (m[a.tarefa_id] ??= []).push(a.user_profile_id);
    return m;
  }, [avaliadores]);

  // Quem dá nota é quem a demanda designou. Sem lista (demanda anterior à
  // 368), vale a régua antiga: CEO e conselheiros, admin fora.
  const podeAvaliarTarefa = useCallback((tarefaId: string) => {
    if (!daMatriz) return false;
    const lista = avaliadoresPorTarefa[tarefaId];
    if (lista?.length) return lista.includes(profile.id);
    return profile.role === 'ceo' || isConselheiro(profile);
  }, [daMatriz, avaliadoresPorTarefa, profile]);

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
        <span className="block mt-1">
          Quem você marca aqui é quem entra na lista de avaliação do ciclo: sem demanda,
          ninguém é cobrado.
        </span>
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
                      {/* Demanda do Padrão não tem categoria: o selo só aparece
                          nas antigas, criadas com os tipos da Competição. */}
                      {!ehDemandaPadrao(t.tipo) && (
                        <>
                          <Icone size={13} className={meta.color} />
                          <span className={`text-[10px] font-black uppercase tracking-widest ${meta.color}`}>{meta.label}</span>
                        </>
                      )}
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
                            nNotas={(notasPorParticipante[p.id] ?? []).length}
                            podeAvaliar={podeAvaliarTarefa(t.id)}
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
          profile={profile}
          participantesAtuais={modal.tarefa ? (partPorTarefa[modal.tarefa.id] ?? []) : []}
          avaliadoresAtuais={modal.tarefa ? (avaliadoresPorTarefa[modal.tarefa.id] ?? []) : []}
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
            // "sem sua nota" só cobra quem foi designado (migr. 368); pra quem
            // não dá nota nesta demanda seria cobrança de dívida que não existe.
            : podeAvaliar
              ? <span className="text-[10px] text-gray-500 flex items-center gap-1">
                  <EyeOff size={10} /> sem sua nota
                </span>
              : null
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
function ModalDemanda({ ciclo, tarefa, profile, participantesAtuais, avaliadoresAtuais, onClose, onSalvo, showToast }: {
  ciclo: { id: string; nome: string };
  tarefa: Tarefa | null;
  profile: UserProfile;
  participantesAtuais: Participante[];
  avaliadoresAtuais: string[];
  onClose: () => void;
  onSalvo: () => void;
  showToast: any;
}) {
  const isEdit = !!tarefa;
  const [nome, setNome] = useState(tarefa?.nome ?? '');
  const [descricao, setDescricao] = useState(tarefa?.descricao ?? '');
  const [data, setData] = useState(tarefa?.data ?? todayBR());
  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [loadingFn, setLoadingFn] = useState(true);
  const [filtroFilial, setFiltroFilial] = useState<'todas' | FilialOp>('todas');
  const [saving, setSaving] = useState(false);
  const [selecionados, setSelecionados] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    participantesAtuais.forEach(p => { if (p.user_profile_id) init[p.user_profile_id] = true; });
    return init;
  });

  // Quem dá nota nesta demanda (migr. 368). Numa demanda nova quem cria já
  // entra marcado — quem montou a pauta sabe o que ela cobra.
  const [avaliadoresPool, setAvaliadoresPool] = useState<any[]>([]);
  const [avaliadoresSel, setAvaliadoresSel] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    if (avaliadoresAtuais.length > 0) avaliadoresAtuais.forEach(id => { init[id] = true; });
    else if (!tarefa) init[profile.id] = true;
    return init;
  });
  const totalAvaliadores = Object.values(avaliadoresSel).filter(Boolean).length;

  // A lista vem de `user_profiles`, não de `funcionarios`: quem a demanda
  // marca é quem depois vira pendência de avaliação, e essa identidade é o
  // perfil. `funcionarios` entra só para preencher o cargo e manter a FK de
  // RH viva quando a pessoa tem ficha (migr. 367).
  useEffect(() => {
    (async () => {
      if (!supabase) { setLoadingFn(false); return; }
      const [{ data: perfis }, { data: fichas }, { data: matriz }] = await Promise.all([
        supabase
          .from('user_profiles')
          .select('id,nome,filial,role,desligado_em')
          .in('role', ROLES_AVALIAVEIS as unknown as string[])
          .order('nome', { ascending: true }),
        supabase
          .from('funcionarios')
          .select('id,cargo,user_profile_id')
          .eq('ativo', true),
        // Pool de avaliadores: só a Matriz dá nota em demanda do ciclo.
        supabase
          .from('user_profiles')
          .select('id,nome,role,is_conselheiro,desligado_em')
          .eq('filial', 'Matriz')
          .order('nome', { ascending: true }),
      ]);
      const pool = (matriz ?? []).filter((u: any) =>
        !u.desligado_em
        && (['admin', 'ceo', 'conselheiro'].includes(u.role)
            || (u.role === 'gerente' && u.is_conselheiro)));
      setAvaliadoresPool(pool);

      // Demanda anterior à 368 não tem lista e hoje é avaliada por CEO +
      // conselheiros. Pré-marcar esse conjunto faz o default do modal ser o
      // comportamento vigente — salvar sem mexer não tira o direito de nota
      // de ninguém pelas costas.
      if (tarefa && avaliadoresAtuais.length === 0) {
        const legado: Record<string, boolean> = {};
        pool.forEach((u: any) => {
          if (u.role === 'ceo' || u.role === 'conselheiro'
              || (u.role === 'gerente' && u.is_conselheiro)) legado[u.id] = true;
        });
        setAvaliadoresSel(legado);
      }
      const porPerfil = new Map<string, any>();
      (fichas ?? []).forEach((f: any) => { if (f.user_profile_id) porPerfil.set(f.user_profile_id, f); });
      setFuncionarios(
        (perfis ?? [])
          .filter((p: any) => !p.desligado_em)
          .map((p: any) => ({
            id: p.id,
            nome: p.nome,
            role: p.role,
            filial: p.filial || 'Matriz',
            cargo: porPerfil.get(p.id)?.cargo ?? null,
            funcionario_id: porPerfil.get(p.id)?.id ?? null,
          })),
      );
      setLoadingFn(false);
    })();
  }, []);

  const filtrados = useMemo(() =>
    filtroFilial === 'todas' ? funcionarios : funcionarios.filter(f => f.filial === filtroFilial),
    [funcionarios, filtroFilial]);

  const total = Object.values(selecionados).filter(Boolean).length;

  // "Todos" age sobre a lista VISÍVEL, não sobre o cadastro inteiro: com o
  // filtro em MaxLook, marcar todos deve pegar a MaxLook e não estourar a
  // demanda pras outras duas filiais sem o gestor perceber.
  const todosVisiveisMarcados = filtrados.length > 0 && filtrados.every(f => selecionados[f.id]);
  const marcarVisiveis = (valor: boolean) =>
    setSelecionados(s => {
      const novo = { ...s };
      filtrados.forEach(f => { novo[f.id] = valor; });
      return novo;
    });

  const salvar = async () => {
    if (!supabase) return;
    if (!nome.trim()) { showToast?.('Informe o nome da demanda.', 'error'); return; }
    if (total === 0) { showToast?.('Selecione ao menos 1 participante.', 'error'); return; }
    if (totalAvaliadores === 0) { showToast?.('Selecione ao menos 1 avaliador.', 'error'); return; }
    setSaving(true);
    const participantes = funcionarios
      .filter(f => selecionados[f.id])
      .map(f => ({
        user_profile_id: f.id,
        funcionario_id: f.funcionario_id,
        nome: f.nome,
        filial: f.filial,
      }));

    const listaAvaliadores = Object.entries(avaliadoresSel)
      .filter(([, on]) => on)
      .map(([id]) => id);

    const { data: novaId, error } = isEdit
      ? await supabase.rpc('atualizar_ciclo_tarefa', {
          p_tarefa_id: tarefa!.id,
          p_nome: nome.trim(),
          p_descricao: descricao.trim(),
          p_data: data,
          p_participantes: participantes,
        })
      : await supabase.rpc('criar_ciclo_tarefa', {
          p_ciclo_id: ciclo.id,
          // Demanda do Padrão não tem categoria (migr. 366) — os tipos do
          // select antigo eram a pauta da Competição do Conselho.
          p_tipo: TIPO_DEMANDA_PADRAO,
          p_nome: nome.trim(),
          p_descricao: descricao.trim(),
          p_data: data,
          p_participantes: participantes,
        });
    if (error) { setSaving(false); showToast?.(error.message, 'error'); return; }

    // RPC separada porque incluir os avaliadores no criar/atualizar mudaria a
    // assinatura delas e o PostgREST recusa sobrecarga.
    const tarefaId = isEdit ? tarefa!.id : (novaId as unknown as string);
    const { error: errAv } = await supabase.rpc('definir_avaliadores_ciclo_tarefa', {
      p_tarefa_id: tarefaId,
      p_avaliadores: listaAvaliadores,
    });
    setSaving(false);
    if (errAv) {
      // A demanda existe; só a lista falhou. Dizer isso evita que o gestor
      // ache que perdeu a pauta e crie tudo de novo.
      showToast?.(`Demanda salva, mas os avaliadores não: ${errAv.message}`, 'error');
      onSalvo();
      return;
    }
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

        <div className="flex flex-col gap-1">
          <label htmlFor="ct-data" className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Data</label>
          <input
            id="ct-data" type="date" value={data}
            onChange={e => setData(e.target.value)}
            className="neu-input py-2 px-3 text-sm rounded-lg"
          />
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
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            Quem dá nota nesta demanda ({totalAvaliadores} selecionados)
          </label>
          {avaliadoresPool.length === 0 ? (
            <p className="text-xs text-gray-500 italic py-2">Nenhum avaliador disponível na Matriz.</p>
          ) : (
            <div className="neu-pressed rounded-xl p-2 flex flex-wrap gap-1.5">
              {avaliadoresPool.map(a => {
                const on = !!avaliadoresSel[a.id];
                const papel = a.role === 'admin' ? 'Administração'
                  : a.role === 'ceo' ? 'CEO' : 'Conselho';
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAvaliadoresSel(s => ({ ...s, [a.id]: !s[a.id] }))}
                    className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors border ${
                      on ? 'bg-accent/10 border-accent/30 text-accent' : 'border-white/5 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {on && <Check size={11} />}
                    {a.nome}
                    <span className="text-[9px] uppercase tracking-widest opacity-60">{papel}</span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-600">
            Só quem estiver aqui consegue lançar nota nesta demanda.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                Quem faz e será avaliado ({total} selecionados)
              </label>
              {filtrados.length > 0 && (
                <button
                  type="button"
                  onClick={() => marcarVisiveis(!todosVisiveisMarcados)}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-lg neu-button text-accent"
                  title={filtroFilial === 'todas'
                    ? 'Marcar/desmarcar todo mundo da lista visível'
                    : `Marcar/desmarcar todos da ${filtroFilial}`}
                >
                  {todosVisiveisMarcados ? 'Limpar' : 'Todos'}
                  {filtroFilial !== 'todas' && ` da ${filtroFilial}`}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 neu-pressed rounded-lg p-0.5">
              {(['todas', ...FILIAIS_DEMANDA] as const).map(f => (
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
          <button onClick={salvar} disabled={saving || !nome.trim() || total === 0 || totalAvaliadores === 0}
            className="text-xs font-bold px-4 py-2 rounded-lg neu-button text-accent ring-1 ring-accent/40 hover:ring-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving && <Loader2 size={12} className="animate-spin" />}
            {isEdit ? 'Salvar' : 'Criar demanda'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
