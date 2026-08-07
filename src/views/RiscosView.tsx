import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ClipboardCheck, Plus, TrendingDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, LoadingSpinner, FilialBadge } from '../components/ui';
import { isConselheiro } from '../lib/rbac';
import { formatDataHoraBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';

// Matriz de riscos (migração 385) — o que ainda não aconteceu e vai doer.
//
// Severidade é probabilidade × impacto e vem GERADA do banco: nota derivada
// que se digita vira nota inventada. Quem move a nota é a revisão, que é
// append-only — ver a severidade cair de 20 para 6 ao longo de três ciclos
// é o gráfico que ensina o que é gestão de risco.
//
// 'Aceito' é desfecho legítimo e só o Conselho assina: assumir um risco
// conscientemente é decisão de Conselho, diferente de esquecer dele.

const UNIDADES = ['Matriz', 'SuperMax', 'MaxLook', 'TechMax'] as const;
const CATEGORIAS = ['Operacional', 'Financeiro', 'Pessoas', 'Imagem', 'Tecnologia', 'Legal'] as const;

const STATUS_LABEL: Record<string, string> = {
  aberto: 'Aberto', mitigando: 'Mitigando', aceito: 'Aceito', encerrado: 'Encerrado',
};

type Risco = {
  id: string; titulo: string; descricao: string | null; categoria: string; filial: string;
  dono_id: string; dono_nome: string | null;
  probabilidade: number; impacto: number; severidade: number;
  mitigacao: string | null; prazo: string | null; status: string;
  revisado_em: string | null; created_at: string;
};

type Revisao = {
  id: string; risco_id: string; probabilidade: number; impacto: number;
  status: string; parecer: string | null; revisor_nome: string | null; revisado_em: string;
};

type Pessoa = { id: string; nome: string; filial: string | null };

/** Faixa de severidade (1-25). A cor é a mensagem: 15+ é o que vai à pauta. */
function faixa(sev: number): { label: string; classe: string } {
  if (sev >= 15) return { label: 'Crítico', classe: 'bg-red-500/15 text-red-400 border-red-500/30' };
  if (sev >= 8)  return { label: 'Alto',    classe: 'bg-orange-500/15 text-orange-400 border-orange-500/30' };
  if (sev >= 4)  return { label: 'Médio',   classe: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
  return { label: 'Baixo', classe: 'bg-green-500/15 text-green-400 border-green-500/30' };
}

export function RiscosView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const conselho = profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);

  const [riscos, setRiscos]     = useState<Risco[]>([]);
  const [revisoes, setRevisoes] = useState<Revisao[]>([]);
  const [pessoas, setPessoas]   = useState<Pessoa[]>([]);
  const [loading, setLoading]   = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto]     = useState<string | null>(null);
  const [verEncerrados, setVerEncerrados] = useState(false);

  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({
    titulo: '', descricao: '', categoria: 'Operacional', filial: 'Matriz',
    dono_id: '', probabilidade: 3, impacto: 3, mitigacao: '', prazo: '',
  });

  // Revisão em curso.
  const [rev, setRev] = useState({ probabilidade: 3, impacto: 3, status: 'mitigando', parecer: '', mitigacao: '' });

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [{ data: rs }, { data: rvs }, { data: ps }] = await Promise.all([
      supabase.from('riscos')
        .select('id, titulo, descricao, categoria, filial, dono_id, dono_nome, probabilidade, impacto, severidade, mitigacao, prazo, status, revisado_em, created_at')
        .eq('ativo', true).order('severidade', { ascending: false }),
      supabase.from('risco_revisoes')
        .select('id, risco_id, probabilidade, impacto, status, parecer, revisor_nome, revisado_em')
        .order('revisado_em', { ascending: true }),
      supabase.from('user_profiles')
        .select('id, nome, filial')
        .eq('ativo', true).is('desligado_em', null).order('nome'),
    ]);
    setRiscos((rs ?? []) as Risco[]);
    setRevisoes((rvs ?? []) as Revisao[]);
    setPessoas((ps ?? []) as Pessoa[]);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = useMemo(
    () => riscos.filter(r => verEncerrados || r.status !== 'encerrado'),
    [riscos, verEncerrados],
  );

  const criar = async () => {
    if (!supabase) return;
    if (!form.titulo.trim() || !form.dono_id) {
      showToast('Título e dono são obrigatórios — risco sem dono é conversa.', 'error'); return;
    }
    setSalvando(true);
    const dono = pessoas.find(p => p.id === form.dono_id);
    const { error } = await supabase.from('riscos').insert({
      titulo: form.titulo, descricao: form.descricao || null, categoria: form.categoria,
      filial: form.filial, dono_id: form.dono_id, dono_nome: dono?.nome ?? null,
      probabilidade: form.probabilidade, impacto: form.impacto,
      mitigacao: form.mitigacao || null, prazo: form.prazo || null,
      criado_por: profile?.id ?? null, criado_por_nome: profile?.nome ?? null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast('Risco registrado.', 'success');
    setNovo(false);
    setForm(f => ({ ...f, titulo: '', descricao: '', dono_id: '', mitigacao: '', prazo: '' }));
    carregar();
  };

  const revisar = async (risco: Risco) => {
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.rpc('revisar_risco', {
      p_risco_id: risco.id,
      p_probabilidade: rev.probabilidade,
      p_impacto: rev.impacto,
      p_status: rev.status,
      p_parecer: rev.parecer || null,
      p_mitigacao: rev.mitigacao || null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast('Revisão registrada.', 'success');
    setAberto(null);
    carregar();
  };

  const abrirRevisao = (r: Risco) => {
    if (aberto === r.id) { setAberto(null); return; }
    setAberto(r.id);
    setRev({
      probabilidade: r.probabilidade, impacto: r.impacto,
      status: r.status === 'aberto' ? 'mitigando' : r.status,
      parecer: '', mitigacao: '',
    });
  };

  if (loading) return <LoadingSpinner />;

  const criticos = visiveis.filter(r => r.severidade >= 15 && r.status !== 'encerrado').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Matriz de Riscos</h1>
        <p className="text-sm text-gray-400 mt-1">
          O ERP inteiro registra o que já aconteceu. Aqui fica o que ainda não
          aconteceu e vai doer se acontecer — com dono, prazo e revisão a cada ciclo.
        </p>
        {criticos > 0 && (
          <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
            <AlertTriangle size={13} /> {criticos} risco(s) em faixa crítica aguardando pauta.
          </p>
        )}
      </div>

      {conselho && (
        <div className="neu-card p-4 space-y-3">
          <button onClick={() => setNovo(v => !v)}
            className="neu-button px-3 py-1.5 rounded-xl text-xs text-accent flex items-center gap-2">
            <Plus size={13} /> Registrar risco
          </button>
          {novo && (
            <div className="grid sm:grid-cols-2 gap-3 bg-black/20 rounded-xl p-3">
              <div className="sm:col-span-2">
                <Campo rotulo="O que pode dar errado">
                  <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                    className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                </Campo>
              </div>
              <div className="sm:col-span-2">
                <Campo rotulo="Descrição">
                  <textarea value={form.descricao} rows={2}
                    onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                    className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                </Campo>
              </div>
              <Campo rotulo="Categoria">
                <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                  className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Unidade exposta">
                <select value={form.filial} onChange={e => setForm(f => ({ ...f, filial: e.target.value }))}
                  className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Dono do risco">
                <select value={form.dono_id} onChange={e => setForm(f => ({ ...f, dono_id: e.target.value }))}
                  className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                  <option value="">Selecione…</option>
                  {pessoas.map(p => (
                    <option key={p.id} value={p.id}>{p.nome}{p.filial ? ` · ${p.filial}` : ''}</option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Prazo da mitigação">
                <input type="date" value={form.prazo}
                  onChange={e => setForm(f => ({ ...f, prazo: e.target.value }))}
                  className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
              </Campo>
              <Campo rotulo={`Probabilidade — ${form.probabilidade}`}>
                <input type="range" min={1} max={5} value={form.probabilidade}
                  onChange={e => setForm(f => ({ ...f, probabilidade: Number(e.target.value) }))}
                  className="w-full" />
              </Campo>
              <Campo rotulo={`Impacto — ${form.impacto}`}>
                <input type="range" min={1} max={5} value={form.impacto}
                  onChange={e => setForm(f => ({ ...f, impacto: Number(e.target.value) }))}
                  className="w-full" />
              </Campo>
              <div className="sm:col-span-2">
                <Campo rotulo="Mitigação proposta">
                  <textarea value={form.mitigacao} rows={2}
                    onChange={e => setForm(f => ({ ...f, mitigacao: e.target.value }))}
                    className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                </Campo>
              </div>
              <div className="sm:col-span-2 flex items-center gap-3">
                <button onClick={criar} disabled={salvando}
                  className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium disabled:opacity-50">
                  Registrar
                </button>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${faixa(form.probabilidade * form.impacto).classe}`}>
                  Severidade {form.probabilidade * form.impacto} · {faixa(form.probabilidade * form.impacto).label}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-gray-400">
        <input type="checkbox" checked={verEncerrados} onChange={e => setVerEncerrados(e.target.checked)} />
        Mostrar riscos encerrados
      </label>

      {visiveis.length === 0 ? (
        <EmptyState message="Nenhum risco registrado." />
      ) : (
        <div className="space-y-3">
          {visiveis.map(r => {
            const f = faixa(r.severidade);
            const hist = revisoes.filter(x => x.risco_id === r.id);
            const podeRevisar = conselho || r.dono_id === profile?.id;
            const primeira = hist[0];
            return (
              <div key={r.id} className="neu-card overflow-hidden">
                <div className="p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-100">{r.titulo}</span>
                      <FilialBadge filial={r.filial} />
                    </div>
                    <div className="text-xs text-gray-500">
                      {r.categoria} · dono {r.dono_nome ?? '—'} · {STATUS_LABEL[r.status] ?? r.status}
                      {r.prazo && <> · prazo {r.prazo.split('-').reverse().join('/')}</>}
                    </div>
                    <div className="text-xs text-gray-500">
                      P{r.probabilidade} × I{r.impacto}
                      {primeira && primeira.probabilidade * primeira.impacto > r.severidade && (
                        <span className="text-green-400 inline-flex items-center gap-1 ml-2">
                          <TrendingDown size={11} />
                          caiu de {primeira.probabilidade * primeira.impacto}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${f.classe}`}>
                    {r.severidade} · {f.label}
                  </span>
                </div>

                <div className="px-4 pb-4 space-y-3">
                  {r.descricao && <p className="text-xs text-gray-400">{r.descricao}</p>}
                  {r.mitigacao && (
                    <p className="text-xs text-gray-400">
                      <span className="text-gray-500">Mitigação:</span> {r.mitigacao}
                    </p>
                  )}

                  {hist.length > 0 && (
                    <div className="space-y-1 border-l-2 border-white/5 pl-3">
                      {hist.map(h => (
                        <div key={h.id} className="text-xs text-gray-500">
                          {formatDataHoraBR(h.revisado_em)} · {h.revisor_nome ?? '—'} ·
                          {' '}P{h.probabilidade}×I{h.impacto} = {h.probabilidade * h.impacto} ·
                          {' '}{STATUS_LABEL[h.status] ?? h.status}
                          {h.parecer && <div className="text-gray-400 italic">“{h.parecer}”</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {podeRevisar && r.status !== 'encerrado' && (
                    <button onClick={() => abrirRevisao(r)}
                      className="neu-button px-3 py-1.5 rounded-xl text-xs text-gray-100 flex items-center gap-2">
                      <ClipboardCheck size={12} /> Revisar
                    </button>
                  )}

                  {aberto === r.id && (
                    <div className="grid sm:grid-cols-2 gap-3 bg-black/20 rounded-xl p-3">
                      <Campo rotulo={`Probabilidade — ${rev.probabilidade}`}>
                        <input type="range" min={1} max={5} value={rev.probabilidade}
                          onChange={e => setRev(v => ({ ...v, probabilidade: Number(e.target.value) }))}
                          className="w-full" />
                      </Campo>
                      <Campo rotulo={`Impacto — ${rev.impacto}`}>
                        <input type="range" min={1} max={5} value={rev.impacto}
                          onChange={e => setRev(v => ({ ...v, impacto: Number(e.target.value) }))}
                          className="w-full" />
                      </Campo>
                      <Campo rotulo="Situação">
                        <select value={rev.status} onChange={e => setRev(v => ({ ...v, status: e.target.value }))}
                          className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                          <option value="aberto">Aberto</option>
                          <option value="mitigando">Mitigando</option>
                          {conselho && <option value="aceito">Aceito (conviver com ele)</option>}
                          <option value="encerrado">Encerrado</option>
                        </select>
                      </Campo>
                      <Campo rotulo="Mitigação (atualiza a atual)">
                        <input value={rev.mitigacao} onChange={e => setRev(v => ({ ...v, mitigacao: e.target.value }))}
                          className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                      </Campo>
                      <div className="sm:col-span-2">
                        <Campo rotulo="Parecer desta revisão">
                          <textarea value={rev.parecer} rows={2}
                            onChange={e => setRev(v => ({ ...v, parecer: e.target.value }))}
                            className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                        </Campo>
                      </div>
                      <div className="sm:col-span-2 flex items-center gap-3">
                        <button onClick={() => revisar(r)} disabled={salvando}
                          className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium disabled:opacity-50">
                          Registrar revisão
                        </button>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${faixa(rev.probabilidade * rev.impacto).classe}`}>
                          {rev.probabilidade * rev.impacto} · {faixa(rev.probabilidade * rev.impacto).label}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{rotulo}</label>
      {children}
    </div>
  );
}
