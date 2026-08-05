import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Star, Trash2, ShieldAlert, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, FilialBadge, LoadingSpinner } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import {
  ModalAvaliacao,
  FILIAIS_OP,
  criteriosSetPorTipo,
  notaCorClasses,
  type Ciclo,
  type Avaliacao,
  type Criterio,
} from './AvaliacoesView';
import { CRITERIOS_MATRIZ } from '../lib/avaliacaoCriterios';

// Painel "Avaliação das Filiais" — form do eixo votado + histórico consolidado
// por filial. Antes esses dois blocos viviam na aba Padrão (bloco B "Avaliar
// Filiais" + supergrupo matriz_filial dentro de Visão do Ciclo). Migrados
// pra Competição do Conselho porque as notas alimentam o placar da competição
// (RPC calcular_placar_competicao pega pelas datas da competição). Ficam
// juntos com os cards de Tarefas — mesma sessão, mesmo contexto.
//
// Persistência não muda: avaliacoes (tipo='matriz_filial') + criterios_avaliacao.
// Só admin/CEO/conselheiro dão nota; painel exibe histórico pra todos.
export function AvaliacaoFilialPanel({ profile, showToast, cicloId }: {
  profile: UserProfile;
  showToast: any;
  // Ciclo Matriz da competição corrente (criado por trigger em
  // competicoes_matriz). Sem competição ativa, o painel não aparece —
  // a Central inteira já cai em EmptyState antes de chegar aqui.
  cicloId: string;
}) {
  const [ciclo, setCiclo]           = useState<Ciclo | null>(null);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [criterios, setCriterios]   = useState<Criterio[]>([]);
  const [users, setUsers]           = useState<Pick<UserProfile, 'id' | 'nome' | 'role'>[]>([]);
  const [loading, setLoading]       = useState(true);
  const [avaliando, setAvaliando]   = useState<{ filial: string; existente?: { id: string; observacao: string | null; criterios: Criterio[] } } | null>(null);
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  const ehAdmin = profile.role === 'admin';

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data: cs } = await supabase
      .from('ciclos_avaliacao')
      .select('*')
      .eq('id', cicloId)
      .maybeSingle();
    const c = (cs as Ciclo | null) ?? null;
    setCiclo(c);
    if (!c) { setAvaliacoes([]); setCriterios([]); setUsers([]); setLoading(false); return; }

    const { data: avs } = await supabase
      .from('avaliacoes')
      .select('id, ciclo_id, avaliador_id, avaliado_id, avaliada_filial, tipo, observacao, created_at')
      .eq('ciclo_id', c.id)
      .eq('tipo', 'matriz_filial');
    const avsArr = (avs as Avaliacao[]) ?? [];
    setAvaliacoes(avsArr);

    if (avsArr.length === 0) { setCriterios([]); setUsers([]); setLoading(false); return; }

    const ids = avsArr.map(a => a.id);
    const avaliadorIds = Array.from(new Set(avsArr.map(a => a.avaliador_id)));
    const [{ data: crs }, { data: us }] = await Promise.all([
      // Só os eixos subjetivos ativos. Avaliações antigas com os 5 eixos
      // removidos ainda têm rows em criterios_avaliacao — ficam de fora
      // pra não distorcer médias históricas.
      supabase.from('criterios_avaliacao')
        .select('id, avaliacao_id, categoria, criterio, nota')
        .in('avaliacao_id', ids)
        .in('criterio', [...CRITERIOS_MATRIZ.criterios]),
      supabase.from('user_profiles')
        .select('id, nome, role')
        .in('id', avaliadorIds),
    ]);
    setCriterios((crs as Criterio[]) ?? []);
    setUsers((us as Pick<UserProfile, 'id' | 'nome' | 'role'>[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { setLoading(true); carregar(); }, [carregar, cicloId]);

  // Notas antigas do admin (não deveria ter, mas se existirem oferece
  // botão de excluir — admin não é conselho e não pesa em nada).
  const minhasNotasAdmin = useMemo(() => {
    if (!ehAdmin) return [];
    return avaliacoes
      .filter(a => a.avaliador_id === profile.id && a.avaliada_filial)
      .map(a => {
        const crits = criterios.filter(c => c.avaliacao_id === a.id);
        const media = crits.length === 0 ? null : crits.reduce((s, c) => s + c.nota, 0) / crits.length;
        return { id: a.id, filial: a.avaliada_filial as string, media };
      });
  }, [ehAdmin, avaliacoes, criterios, profile.id]);

  const excluirMinhaNotaAdmin = async (id: string) => {
    if (!supabase) return;
    setExcluindoId(id);
    const { error } = await supabase.from('avaliacoes').delete().eq('id', id);
    setExcluindoId(null);
    if (error) return showToast?.(error.message || 'Erro ao excluir', 'error');
    showToast?.('Nota removida', 'success');
    carregar();
    // Painel Comparativo dos Eixos e outros consumidores recarregam.
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
  };

  const minhasNotasPorFilial = useMemo((): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    avaliacoes
      .filter(a => a.avaliador_id === profile.id)
      .forEach(a => {
        if (!a.avaliada_filial) return;
        const crits = criterios.filter(c => c.avaliacao_id === a.id);
        out[a.avaliada_filial] = crits.length === 0
          ? null
          : crits.reduce((s, c) => s + c.nota, 0) / crits.length;
      });
    return out;
  }, [avaliacoes, criterios, profile.id]);

  const filiaisJaAvaliadas = useMemo(
    () => new Set(Object.keys(minhasNotasPorFilial)),
    [minhasNotasPorFilial],
  );

  // Snapshot da minha avaliação por filial pra passar como `avaliacaoExistente`
  // ao ModalAvaliacao — permite reabrir o form com as notas/observação já
  // preenchidas e chamar `atualizar_avaliacao` (upsert) em vez de bater na
  // UNIQUE(unq_avaliacao_filial) tentando criar de novo.
  const minhaAvalPorFilial = useMemo(() => {
    const m: Record<string, { id: string; observacao: string | null; criterios: Criterio[] }> = {};
    avaliacoes
      .filter(a => a.avaliador_id === profile.id && a.avaliada_filial)
      .forEach(a => {
        m[a.avaliada_filial as string] = {
          id: a.id,
          observacao: a.observacao ?? null,
          criterios: criterios.filter(c => c.avaliacao_id === a.id),
        };
      });
    return m;
  }, [avaliacoes, criterios, profile.id]);

  // Histórico agregado por filial (todas as avaliações do ciclo, todos os avaliadores).
  // Avaliações de admin ficam de fora do agregado — admin modera aqui mas
  // não pesa no placar (mesma regra de calcular_placar_competicao).
  const historico = useMemo(() => {
    const adminIds = new Set(users.filter(u => u.role === 'admin').map(u => u.id));
    const avaliacoesConselho = avaliacoes.filter(a => !adminIds.has(a.avaliador_id));
    const porFilial = new Map<string, Avaliacao[]>();
    avaliacoesConselho.forEach(a => {
      if (!a.avaliada_filial) return;
      const list = porFilial.get(a.avaliada_filial) ?? [];
      list.push(a);
      porFilial.set(a.avaliada_filial, list);
    });
    return Array.from(porFilial.entries()).map(([filial, avs]) => {
      const critsFilial = criterios.filter(c => avs.some(a => a.id === c.avaliacao_id));
      const media = critsFilial.length === 0
        ? 0
        : critsFilial.reduce((s, c) => s + c.nota, 0) / critsFilial.length;
      const porAvaliador = avs.map(av => {
        const crits = criterios.filter(c => c.avaliacao_id === av.id);
        const m = crits.length === 0 ? 0 : crits.reduce((s, c) => s + c.nota, 0) / crits.length;
        return {
          avaliacaoId: av.id,
          nome: users.find(u => u.id === av.avaliador_id)?.nome ?? '—',
          media: m,
          observacao: av.observacao,
        };
      }).sort((a, b) => a.nome.localeCompare(b.nome));
      return { filial, qtd: avs.length, media, porAvaliador };
    }).sort((a, b) => b.media - a.media || a.filial.localeCompare(b.filial));
  }, [avaliacoes, criterios, users]);

  if (loading) {
    return (
      <div className="neu-flat rounded-2xl border border-white/5 p-6 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  // Contadores/média excluem admin (não é conselho).
  const adminIds = new Set(users.filter(u => u.role === 'admin').map(u => u.id));
  const avaliacoesConselho = avaliacoes.filter(a => !adminIds.has(a.avaliador_id));
  const idsConselho = new Set(avaliacoesConselho.map(a => a.id));
  const criteriosConselho = criterios.filter(c => idsConselho.has(c.avaliacao_id));

  const totalAvaliacoes = avaliacoesConselho.length;
  const totalFiliaisAvaliadas = new Set(
    avaliacoesConselho.filter(a => a.avaliada_filial).map(a => a.avaliada_filial as string),
  ).size;
  const mediaCiclo = criteriosConselho.length === 0
    ? 0
    : criteriosConselho.reduce((s, c) => s + c.nota, 0) / criteriosConselho.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4"
    >
      {/* Admin não é conselho — se tem nota antiga, oferece excluir. */}
      {ehAdmin && minhasNotasAdmin.length > 0 && (
        <div className="neu-flat rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
            <ShieldAlert size={14} />
            Você (admin) tem {minhasNotasAdmin.length} nota{minhasNotasAdmin.length === 1 ? '' : 's'} antiga{minhasNotasAdmin.length === 1 ? '' : 's'} aqui — não conta em nenhum placar, mas fica registrada no banco. Remova pra limpar.
          </div>
          <div className="flex flex-col gap-1.5">
            {minhasNotasAdmin.map(n => (
              <div key={n.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2">
                  <FilialBadge filial={n.filial as any} />
                  {n.media != null && (
                    <span className="text-gray-400 font-mono">{n.media.toFixed(1)}/10</span>
                  )}
                </span>
                <button
                  onClick={() => excluirMinhaNotaAdmin(n.id)}
                  disabled={excluindoId === n.id}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg text-red-400 hover:bg-red-500/10 border border-red-500/30 disabled:opacity-50"
                >
                  <Trash2 size={11} /> {excluindoId === n.id ? 'Excluindo…' : 'Excluir'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Form "Avaliar Filiais": qualquer um da Central pode abrir.
          Nota de admin fica no banco mas não pesa em placar/painel/média
          — o filtro é feito no RPC (migr. 240) e nos memos deste painel. */}
      {ciclo && (
        <div className="neu-flat rounded-2xl border border-white/5 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-gray-200">Avaliar Filiais</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300">
                {filiaisJaAvaliadas.size} de {FILIAIS_OP.length} avaliadas
              </span>
            </div>
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              Ciclo: {ciclo.nome}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {FILIAIS_OP.map(f => {
              const jaAvaliou = filiaisJaAvaliadas.has(f);
              const minhaNota = minhasNotasPorFilial[f];
              // Reabrir a nota é permitido: admin não avalia aqui (é moderador
              // via bloco acima), CEO/conselheiro podem corrigir sua nota
              // reabrindo o mesmo modal — `atualizar_avaliacao` faz upsert.
              const podeReavaliar = jaAvaliou && !ehAdmin;
              const abrir = () => {
                if (jaAvaliou && podeReavaliar) {
                  setAvaliando({ filial: f, existente: minhaAvalPorFilial[f] });
                } else if (!jaAvaliou) {
                  setAvaliando({ filial: f });
                }
              };
              return (
                <button
                  key={f}
                  onClick={abrir}
                  disabled={jaAvaliou && !podeReavaliar}
                  className={`neu-button rounded-2xl p-5 flex flex-col gap-3 text-left transition-all border border-white/5 ${
                    jaAvaliou && !podeReavaliar ? 'cursor-not-allowed opacity-90' : 'hover:border-accent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <FilialBadge filial={f} />
                    {jaAvaliou && <CheckCircle2 size={16} className="text-emerald-400" />}
                  </div>
                  {jaAvaliou ? (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Sua nota</span>
                        {minhaNota != null && (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-black tabular-nums border ${notaCorClasses(minhaNota)}`}>
                            {minhaNota.toFixed(1)}<span className="text-[9px] opacity-70">/10</span>
                          </span>
                        )}
                      </div>
                      {podeReavaliar && (
                        <span className="text-[10px] text-accent font-bold uppercase tracking-widest flex items-center gap-1">
                          <Pencil size={10} /> Editar
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-accent font-bold uppercase tracking-widest flex items-center gap-1">
                      <Star size={10} /> Avaliar agora
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!ciclo && (
        <div className="neu-flat rounded-2xl border border-white/5 p-4 sm:p-5">
          <EmptyState message="Ciclo da competição não encontrado. Recarregue a página." />
        </div>
      )}

      {/* ── Visão do Ciclo — Avaliação das Filiais (header + contadores + tabela) ── */}
      {ciclo && historico.length > 0 && (
        <div className="neu-flat rounded-3xl p-6 border border-white/5">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <ClipboardList size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-gray-300">Visão do Ciclo — Avaliação das Filiais</h3>
              <span className="px-2 py-1 rounded-lg bg-emerald-900/40 text-emerald-400 text-[10px] font-bold uppercase tracking-widest">
                {ciclo.status === 'Aberto' ? 'Aberto' : 'Fechado'}
              </span>
            </div>
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              Ciclo: {ciclo.nome}
            </span>
          </div>

          {/* Contadores rápidos: avaliações · avaliados · média — mesmos do
              antigo bloco E de AvaliacoesView. */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="neu-pressed rounded-2xl px-4 py-3 text-center">
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Avaliações</p>
              <p className="text-xl font-black text-gray-200 tabular-nums mt-0.5">{totalAvaliacoes}</p>
            </div>
            <div className="neu-pressed rounded-2xl px-4 py-3 text-center">
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Avaliados</p>
              <p className="text-xl font-black text-gray-200 tabular-nums mt-0.5">{totalFiliaisAvaliadas}</p>
            </div>
            <div className="neu-pressed rounded-2xl px-4 py-3 text-center">
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Média</p>
              <p className="text-xl font-black text-accent tabular-nums mt-0.5">{mediaCiclo.toFixed(1)}</p>
            </div>
          </div>

          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-3 font-bold px-2 w-6"></th>
                  <th className="pb-3 font-bold px-4">Filial</th>
                  <th className="pb-3 font-bold px-4 text-center">Avaliações</th>
                  <th className="pb-3 font-bold px-4 text-center">Média</th>
                </tr>
              </thead>
              <tbody>
                {historico.map(h => {
                  const aberto = linhaAberta === h.filial;
                  return (
                    <Fragment key={h.filial}>
                      <tr
                        className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                        onClick={() => setLinhaAberta(aberto ? null : h.filial)}
                      >
                        <td className="py-3 px-2 text-gray-500">
                          {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200 flex items-center gap-1.5">
                          <Building2 size={12} className="text-accent shrink-0" />
                          {h.filial}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-center text-gray-300 tabular-nums">{h.qtd}</td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex flex-col items-center gap-1.5 min-w-[90px]">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-black tabular-nums border ${notaCorClasses(h.media)}`}>
                              {h.media.toFixed(1)}<span className="text-[9px] opacity-70">/10</span>
                            </span>
                            <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden">
                              <div className={`h-full ${h.media >= 8 ? 'bg-emerald-400' : h.media >= 5 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.max(0, Math.min(1, h.media / 10)) * 100}%` }} />
                            </div>
                          </div>
                        </td>
                      </tr>
                      {aberto && (
                        <tr className="border-b border-white/5">
                          <td colSpan={4} className="px-4 py-3 bg-white/[0.02]">
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Avaliadores</p>
                            <div className="flex flex-col gap-2.5">
                              {h.porAvaliador.map(pa => (
                                <div key={pa.avaliacaoId} className="flex flex-col gap-1 pb-2 border-b border-white/5 last:border-0 last:pb-0">
                                  <div className="flex items-center justify-between text-xs gap-2">
                                    <span className="text-gray-300">{pa.nome}</span>
                                    <span className="font-bold text-gray-200 tabular-nums">{pa.media.toFixed(1)}</span>
                                  </div>
                                  {pa.observacao && (
                                    <p className="text-[11px] text-gray-500 italic">"{pa.observacao}"</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {avaliando && ciclo && (
        <ModalAvaliacao
          ciclo={ciclo}
          alvo={{ kind: 'filial', filial: avaliando.filial }}
          avaliacaoExistente={avaliando.existente}
          onClose={() => setAvaliando(null)}
          onSaved={() => {
            carregar();
            // Placar + Painel Comparativo dos Eixos escutam esse evento.
            window.dispatchEvent(new Event('avaliacao-matriz:changed'));
          }}
          showToast={showToast}
          criteriosSet={criteriosSetPorTipo(undefined, 'filial').cs}
          categoriaLabel={criteriosSetPorTipo(undefined, 'filial').label}
        />
      )}
    </motion.div>
  );
}
