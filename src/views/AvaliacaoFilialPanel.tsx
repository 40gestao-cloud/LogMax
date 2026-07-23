import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Star } from 'lucide-react';
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

// Painel "Avaliação das Filiais" — form dos 7 eixos + histórico consolidado
// por filial. Antes esses dois blocos viviam na aba Padrão (bloco B "Avaliar
// Filiais" + supergrupo matriz_filial dentro de Visão do Ciclo). Migrados
// pra Competição do Conselho porque as notas alimentam o placar da competição
// (RPC calcular_placar_competicao pega pelas datas da competição). Ficam
// juntos com os cards de Tarefas — mesma sessão, mesmo contexto.
//
// Persistência não muda: avaliacoes (tipo='matriz_filial') + criterios_avaliacao.
// Só admin/CEO/conselheiro dão nota; painel exibe histórico pra todos.
export function AvaliacaoFilialPanel({ profile, showToast, podeAvaliar }: {
  profile: UserProfile;
  showToast: any;
  podeAvaliar: boolean;
}) {
  const [ciclo, setCiclo]           = useState<Ciclo | null>(null);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [criterios, setCriterios]   = useState<Criterio[]>([]);
  const [users, setUsers]           = useState<Pick<UserProfile, 'id' | 'nome'>[]>([]);
  const [loading, setLoading]       = useState(true);
  const [avaliando, setAvaliando]   = useState<{ filial: string } | null>(null);
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data: cs } = await supabase
      .from('ciclos_avaliacao')
      .select('*')
      .eq('status', 'Aberto')
      .eq('filial', 'Matriz')
      .order('data_inicio', { ascending: false })
      .limit(1);
    const c = (cs?.[0] as Ciclo | undefined) ?? null;
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
      supabase.from('criterios_avaliacao')
        .select('id, avaliacao_id, categoria, criterio, nota')
        .in('avaliacao_id', ids),
      supabase.from('user_profiles')
        .select('id, nome')
        .in('id', avaliadorIds),
    ]);
    setCriterios((crs as Criterio[]) ?? []);
    setUsers((us as Pick<UserProfile, 'id' | 'nome'>[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { setLoading(true); carregar(); }, [carregar]);

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

  // Histórico agregado por filial (todas as avaliações do ciclo, todos os avaliadores).
  const historico = useMemo(() => {
    const porFilial = new Map<string, Avaliacao[]>();
    avaliacoes.forEach(a => {
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4"
    >
      {/* ── Form: cards Avaliar Filial ── */}
      <div className="neu-flat rounded-2xl border border-white/5 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Building2 size={16} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Avaliar Filiais</h3>
            <span className="text-[10px] text-gray-500 font-bold">7 eixos da competição</span>
            {ciclo && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300">
                {filiaisJaAvaliadas.size} de {FILIAIS_OP.length} avaliadas
              </span>
            )}
          </div>
          {ciclo && (
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              Ciclo: {ciclo.nome}
            </span>
          )}
        </div>

        <p className="text-[11px] text-gray-500 mb-4">
          Notas dos 7 eixos que compõem o placar. Entram na média unificada da competição
          quando o `created_at` cai no período — as 3 filiais precisam ter ≥1 nota pra fonte
          entrar (gate).
        </p>

        {!ciclo ? (
          <EmptyState message="Nenhum ciclo Matriz aberto. Crie um ciclo com unidade = Matriz para avaliar as filiais." />
        ) : !podeAvaliar ? (
          <EmptyState message="Modo leitura. Só admin, CEO e conselheiros dão nota nos 7 eixos." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {FILIAIS_OP.map(f => {
              const jaAvaliou = filiaisJaAvaliadas.has(f);
              const minhaNota = minhasNotasPorFilial[f];
              return (
                <button
                  key={f}
                  onClick={() => !jaAvaliou && setAvaliando({ filial: f })}
                  disabled={jaAvaliou}
                  className={`neu-button rounded-2xl p-5 flex flex-col gap-3 text-left transition-all border border-white/5 ${
                    jaAvaliou ? 'cursor-not-allowed opacity-90' : 'hover:border-accent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <FilialBadge filial={f} />
                    {jaAvaliou && <CheckCircle2 size={16} className="text-emerald-400" />}
                  </div>
                  {jaAvaliou ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Sua nota</span>
                      {minhaNota != null ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-black tabular-nums border ${notaCorClasses(minhaNota)}`}>
                          {minhaNota.toFixed(1)}<span className="text-[9px] opacity-70">/10</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">Avaliada</span>
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
        )}
      </div>

      {/* ── Histórico / Visão do Ciclo — consolidado das avaliações de filial ── */}
      {ciclo && historico.length > 0 && (
        <div className="neu-flat rounded-2xl border border-white/5 p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <ClipboardList size={16} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Visão do Ciclo — Avaliação das Filiais</h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300">
              {historico.length} filial{historico.length === 1 ? '' : 's'} avaliada{historico.length === 1 ? '' : 's'}
            </span>
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
          onClose={() => setAvaliando(null)}
          onSaved={carregar}
          showToast={showToast}
          criteriosSet={criteriosSetPorTipo(undefined, 'filial').cs}
          categoriaLabel={criteriosSetPorTipo(undefined, 'filial').label}
        />
      )}
    </motion.div>
  );
}
