import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Award, CalendarClock, History, RotateCcw, UserMinus, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, LoadingSpinner, StatusBadge, FilialBadge } from '../components/ui';
import { isConselho } from '../lib/rbac';
import { todayBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';
import { SelectBusca } from '../components/SelectBusca';
import { dataSimplesBR } from '../lib/dates';

// Nomeação com mandato (migração 383) — o cargo ganha origem, prazo e desfecho.
//
// O mandato NÃO expira sozinho: vencido, ele fica vigente e a tela cobra a
// decisão do Conselho (reconduzir, substituir ou encerrar). É de propósito —
// mandato vence, mas quem tira alguém do posto é gente, não o relógio.
//
// O critério mostrado ao lado do titular é o placar da última competição
// encerrada da unidade. É a régua que a recondução deveria olhar.

const UNIDADES = ['SuperMax', 'MaxLook', 'TechMax', 'Matriz'] as const;

type Mandato = {
  id: string; user_profile_id: string; nome_snapshot: string | null;
  cargo: string; filial: string; data_inicio: string; data_fim: string;
  ato: string | null; status: 'vigente' | 'encerrado';
  desfecho: string | null; origem_mandato_id: string | null;
  aplicou_acesso: boolean; nomeado_por_nome: string | null;
  encerramento_motivo: string | null; encerrado_em: string | null;
};

type Pessoa = { id: string; nome: string; role: string; filial: string | null };

const DESFECHO_LABEL: Record<string, string> = {
  reconduzido: 'Reconduzido',
  substituido: 'Substituído',
  encerrado:   'Encerrado',
};

/** Dias entre hoje e a data de fim. Negativo = vencido. */
function diasRestantes(dataFim: string): number {
  const fim = new Date(`${dataFim}T00:00:00`);
  const hoje = new Date(`${todayBR()}T00:00:00`);
  return Math.round((fim.getTime() - hoje.getTime()) / 86400000);
}

export function MandatosView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  // Nomear e encerrar mandato é ato de Conselho (migr. 387) — o CEO não
  // nomeia, inclusive porque poderia nomear a si mesmo. E ninguém decide o
  // próprio desfecho: a RPC barra, e a tela esconde o botão.
  const conselho = isConselho(profile);

  const [mandatos, setMandatos] = useState<Mandato[]>([]);
  const [pessoas, setPessoas]   = useState<Pessoa[]>([]);
  const [placar, setPlacar]     = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [historico, setHistorico] = useState<string | null>(null);

  // Formulário de nomeação, aberto por unidade.
  const [nomeando, setNomeando] = useState<string | null>(null);
  const [form, setForm] = useState({
    user_profile_id: '', cargo: 'Gerente',
    data_inicio: todayBR(), data_fim: '', ato: '', aplicar_acesso: false,
  });

  // Encerramento: mandato + desfecho escolhidos.
  const [encerrando, setEncerrando] = useState<Mandato | null>(null);
  const [enc, setEnc] = useState({ desfecho: 'substituido', motivo: '', nova_data_fim: '' });

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [{ data: mds }, { data: ps }, { data: comps }] = await Promise.all([
      supabase.from('mandatos')
        .select('id, user_profile_id, nome_snapshot, cargo, filial, data_inicio, data_fim, ato, status, desfecho, origem_mandato_id, aplicou_acesso, nomeado_por_nome, encerramento_motivo, encerrado_em')
        .eq('ativo', true).order('data_inicio', { ascending: false }),
      supabase.from('user_profiles')
        .select('id, nome, role, filial')
        .eq('ativo', true).is('desligado_em', null).order('nome'),
      supabase.from('competicoes_matriz')
        .select('placar_snapshot, data_fim')
        .eq('ativo', true).eq('status', 'encerrada')
        .order('data_fim', { ascending: false }).limit(1),
    ]);
    setMandatos((mds ?? []) as Mandato[]);
    setPessoas((ps ?? []) as Pessoa[]);

    const snap = (comps ?? [])[0]?.placar_snapshot as any;
    const porFilial = snap?.por_filial ?? {};
    setPlacar(Object.fromEntries(
      Object.entries(porFilial).map(([f, v]: [string, any]) => [f, Number(v?.media ?? 0)]),
    ));
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const vigentes = useMemo(
    () => mandatos.filter(m => m.status === 'vigente'),
    [mandatos],
  );

  // `nomear_mandato` (migr. 383) recusa quem já tem mandato vigente: "Encerre
  // o atual antes". A lista de nomeação mostrava essas pessoas iguais às
  // livres, então o erro só aparecia depois de preencher o formulário inteiro.
  const mandatoVigentePorPessoa = useMemo(() => {
    const m = new Map<string, Mandato>();
    vigentes.forEach(v => { if (!m.has(v.user_profile_id)) m.set(v.user_profile_id, v); });
    return m;
  }, [vigentes]);
  const pessoasLivres = useMemo(
    () => pessoas.filter(p => !mandatoVigentePorPessoa.has(p.id)), [pessoas, mandatoVigentePorPessoa]);
  const pessoasComMandato = useMemo(
    () => pessoas.filter(p => mandatoVigentePorPessoa.has(p.id)), [pessoas, mandatoVigentePorPessoa]);

  const nomear = async () => {
    if (!supabase) return;
    if (!form.user_profile_id || !form.cargo || !form.data_fim) {
      showToast('Pessoa, cargo e prazo são obrigatórios.', 'error'); return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc('nomear_mandato', {
      p_user_profile_id: form.user_profile_id,
      p_cargo: form.cargo,
      p_filial: nomeando,
      p_data_inicio: form.data_inicio,
      p_data_fim: form.data_fim,
      p_ato: form.ato || null,
      p_aplicar_acesso: form.aplicar_acesso,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast('Mandato registrado.', 'success');
    setNomeando(null);
    setForm(f => ({ ...f, user_profile_id: '', data_fim: '', ato: '', aplicar_acesso: false }));
    carregar();
  };

  const encerrar = async () => {
    if (!supabase || !encerrando) return;
    if (enc.desfecho === 'reconduzido' && !enc.nova_data_fim) {
      showToast('Recondução precisa de novo prazo.', 'error'); return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc('encerrar_mandato', {
      p_mandato_id: encerrando.id,
      p_desfecho: enc.desfecho,
      p_motivo: enc.motivo || null,
      p_nova_data_fim: enc.desfecho === 'reconduzido' ? enc.nova_data_fim : null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast(enc.desfecho === 'reconduzido' ? 'Titular reconduzido.' : 'Mandato encerrado.', 'success');
    setEncerrando(null);
    setEnc({ desfecho: 'substituido', motivo: '', nova_data_fim: '' });
    carregar();
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Mandatos</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {UNIDADES.map(unidade => {
          const titulares = vigentes.filter(m => m.filial === unidade);
          const nota = placar[unidade];
          return (
            <div key={unidade} className="neu-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <FilialBadge filial={unidade} />
                {nota !== undefined && (
                  <span className="text-xs text-gray-500">
                    Placar da última competição: <span className="text-gray-300 tabular-nums">{nota.toFixed(1)}</span>
                  </span>
                )}
              </div>

              {titulares.length === 0 ? (
                <div className="text-xs text-gray-500">Nenhum posto com titular nomeado.</div>
              ) : titulares.map(m => {
                const dias = diasRestantes(m.data_fim);
                const vencido = dias < 0;
                return (
                  <div key={m.id} className="bg-black/20 rounded-xl p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-100 truncate">{m.nome_snapshot ?? '—'}</div>
                        <div className="text-xs text-gray-500">{m.cargo}</div>
                      </div>
                      <StatusBadge status={vencido ? 'Vencido' : 'Vigente'} />
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <CalendarClock size={12} className="shrink-0" />
                      <span>
                        {m.data_inicio.split('-').reverse().join('/')} —
                        {' '}{m.data_fim.split('-').reverse().join('/')} ·
                        {' '}{vencido
                          ? <span className="text-orange-400">vencido há {Math.abs(dias)} dia(s)</span>
                          : <>faltam {dias} dia(s)</>}
                      </span>
                    </div>

                    {m.ato && <p className="text-xs text-gray-400 italic">“{m.ato}”</p>}

                    {/* Ninguém decide o próprio desfecho, nem para se
                        reconduzir — a RPC barra e a tela explica. */}
                    {conselho && m.user_profile_id === profile?.id && (
                      <div className="text-xs text-yellow-400/80">
                        Este mandato é seu — outro conselheiro tem de decidir o desfecho.
                      </div>
                    )}
                    {conselho && m.user_profile_id !== profile?.id && (
                      <button onClick={() => { setEncerrando(m); setEnc({ desfecho: vencido ? 'reconduzido' : 'substituido', motivo: '', nova_data_fim: '' }); }}
                        className="neu-button px-3 py-1.5 rounded-xl text-xs text-gray-100 flex items-center gap-2">
                        <RotateCcw size={12} /> Decidir o desfecho
                      </button>
                    )}
                  </div>
                );
              })}

              {conselho && (
                <button onClick={() => setNomeando(n => n === unidade ? null : unidade)}
                  className="neu-button px-3 py-1.5 rounded-xl text-xs text-accent flex items-center gap-2">
                  <UserPlus size={12} /> Nomear
                </button>
              )}

              {nomeando === unidade && (
                <div className="grid sm:grid-cols-2 gap-3 bg-black/20 rounded-xl p-3">
                  <Campo rotulo="Pessoa">
                    <SelectBusca
                      value={form.user_profile_id}
                      onChange={v => setForm(f => ({ ...f, user_profile_id: v }))}
                      placeholder="Escolha a pessoa"
                      grupos={[
                        { label: 'Sem mandato vigente', opcoes: pessoasLivres.map(p => ({
                          value: String(p.id), label: p.nome, sub: [p.role, p.filial].filter(Boolean).join(' · ') || null,
                        })) },
                        { label: 'Já com mandato vigente — encerre antes', opcoes: pessoasComMandato.map(p => {
                          const md = mandatoVigentePorPessoa.get(p.id)!;
                          return {
                            value: String(p.id), label: p.nome,
                            sub: `${md.cargo}${md.filial ? ` · ${md.filial}` : ''} até ${dataSimplesBR(md.data_fim)}`,
                            tag: { texto: 'Com mandato', tom: 'roxo' as const },
                            disabled: true,
                          };
                        }) },
                      ].filter(g => g.opcoes.length > 0)}
                    />
                  </Campo>
                  <Campo rotulo="Cargo">
                    <input value={form.cargo} onChange={e => setForm(f => ({ ...f, cargo: e.target.value }))}
                      className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                  </Campo>
                  <Campo rotulo="Início">
                    <input type="date" value={form.data_inicio}
                      onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                      className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                  </Campo>
                  <Campo rotulo="Fim do mandato">
                    <input type="date" value={form.data_fim}
                      onChange={e => setForm(f => ({ ...f, data_fim: e.target.value }))}
                      className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                  </Campo>
                  <div className="sm:col-span-2">
                    <Campo rotulo="Ato de nomeação (por quê esta pessoa)">
                      <textarea value={form.ato} rows={2}
                        onChange={e => setForm(f => ({ ...f, ato: e.target.value }))}
                        className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                    </Campo>
                  </div>
                  <label className="sm:col-span-2 flex items-start gap-2 text-xs text-gray-400">
                    <input type="checkbox" checked={form.aplicar_acesso}
                      onChange={e => setForm(f => ({ ...f, aplicar_acesso: e.target.checked }))}
                      className="mt-0.5" />
                    <span>
                      Dar o acesso de gerente junto com o posto. Ao encerrar sem recondução,
                      o acesso volta a colaborador. Só vale entre colaborador e gerente —
                      mandato não promove ninguém a admin, CEO ou conselheiro.
                    </span>
                  </label>
                  <div className="sm:col-span-2">
                    <button onClick={nomear} disabled={salvando}
                      className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium disabled:opacity-50">
                      Registrar nomeação
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Desfecho ── */}
      {encerrando && (
        <div className="neu-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <Award size={15} className="text-accent" />
            Desfecho do mandato — {encerrando.nome_snapshot} ({encerrando.cargo} · {encerrando.filial})
          </div>
          {placar[encerrando.filial] !== undefined && (
            <p className="text-xs text-gray-500">
              Critério na mesa: a unidade fechou a última competição com{' '}
              <span className="text-gray-300 tabular-nums">{placar[encerrando.filial].toFixed(1)}</span> de placar.
            </p>
          )}
          <div className="grid sm:grid-cols-3 gap-3">
            <Campo rotulo="Decisão">
              <select value={enc.desfecho} onChange={e => setEnc(v => ({ ...v, desfecho: e.target.value }))}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                <option value="reconduzido">Reconduzir</option>
                <option value="substituido">Substituir</option>
                <option value="encerrado">Encerrar o posto</option>
              </select>
            </Campo>
            {enc.desfecho === 'reconduzido' && (
              <Campo rotulo="Novo fim de mandato">
                <input type="date" value={enc.nova_data_fim}
                  onChange={e => setEnc(v => ({ ...v, nova_data_fim: e.target.value }))}
                  className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
              </Campo>
            )}
            <div className="sm:col-span-3">
              <Campo rotulo="Motivo da decisão">
                <textarea value={enc.motivo} rows={2}
                  onChange={e => setEnc(v => ({ ...v, motivo: e.target.value }))}
                  className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
              </Campo>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={encerrar} disabled={salvando}
              className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium flex items-center gap-2 disabled:opacity-50">
              <UserMinus size={14} /> Confirmar decisão
            </button>
            <button onClick={() => setEncerrando(null)}
              className="neu-button px-4 py-2 rounded-xl text-sm text-gray-300">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Histórico dos postos ── */}
      <div className="neu-card p-4 space-y-3">
        <button onClick={() => setHistorico(h => h ? null : 'aberto')}
          className="flex items-center gap-2 text-sm font-medium text-gray-300">
          <History size={15} /> Mandatos encerrados
        </button>
        {historico && (
          mandatos.filter(m => m.status === 'encerrado').length === 0 ? (
            <EmptyState message="Nenhum mandato encerrado ainda." />
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-gray-500 text-left">
                    <th className="py-2 pr-3">Pessoa</th>
                    <th className="py-2 px-3">Posto</th>
                    <th className="py-2 px-3">Período</th>
                    <th className="py-2 px-3">Desfecho</th>
                  </tr>
                </thead>
                <tbody>
                  {mandatos.filter(m => m.status === 'encerrado').map(m => (
                    <tr key={m.id} className="border-t border-white/5 align-top">
                      <td className="py-2 pr-3 text-gray-200">{m.nome_snapshot ?? '—'}</td>
                      <td className="py-2 px-3 text-gray-400">{m.cargo} · {m.filial}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs whitespace-nowrap">
                        {m.data_inicio.split('-').reverse().join('/')} —
                        {' '}{m.data_fim.split('-').reverse().join('/')}
                      </td>
                      <td className="py-2 px-3">
                        <div className="text-gray-300">{DESFECHO_LABEL[m.desfecho ?? ''] ?? '—'}</div>
                        {m.encerramento_motivo && (
                          <div className="text-xs text-gray-500 italic">“{m.encerramento_motivo}”</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
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
