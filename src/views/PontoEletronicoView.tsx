import React, { useMemo, useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, Trash2, ClipboardList, ListChecks, FileDown } from 'lucide-react';
import { FrequenciaTrabalhoView } from './FrequenciaTrabalhoView';
import { FrequenciaRelatorioTab } from './FrequenciaRelatorioTab';
import { JornadaTurmaFaixa } from './JornadaTurmaConfig';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FilialBadge, CardContador, type TomContador, corDoStatus } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { hasSetor, isConselheiro } from '../lib/rbac';
import { todayBR } from '../lib/dates';

// O totem (QR + código + scanner) saiu da UI em 2026-07-29, e com ele a aba de
// histórico que lia `ponto_qr_registros`: a tabela está zerada nas 4 turmas —
// o totem nunca chegou a registrar nada — então era uma aba que só sabia
// mostrar "nenhum registro".
//
// Só a captura saiu. A tabela, os endpoints `api/qr-token` e
// `api/register-ponto`, a rota `/registro-ponto-express` e o componente
// `PontoFAB` seguem no repositório, para a volta ser questão de remontar.

const PILL = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border backdrop-blur-sm';

/** Último dia de `YYYY-MM`, em string. `Date.UTC(y, m, 0)` volta um dia do mês
 *  seguinte — sem UTC o fuso do Acre puxaria para o dia anterior. */
const fimDoMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

const statusCls = (s: string) => `${PILL} ${corDoStatus(s || 'Presente')}`;


// ─── View principal ───────────────────────────────────────────────────────────

// `filial` nulo = modo Matriz: a tela deixa de ser de uma unidade e passa a
// olhar a turma inteira. Os fetches perdem o `.eq('filial', …)` e quem recorta
// vira a RLS — `ponto_rh_select` e `rh_filial_all` exigem `auth_pode_filial`, e
// admin/CEO/conselheiro passam em todas. Não é afrouxamento: é a mesma régua
// que o resto do modo Matriz usa.
const PontoEletronicoViewInner = ({ showToast, profile, filial }: { showToast: any; profile: UserProfile; filial: FilialOp | null }) => {
  const modoMatriz = !filial;
  // (504) O ponto passou a atravessar o APAGAR TUDO, então esta tabela é a
  // única aqui que acumula turma sobre turma. Sem recorte a busca vinha
  // inteira — os KPIs somavam turmas anteriores e a lista ia crescendo até
  // bater no teto de linhas do PostgREST. O mês é o recorte natural: é o que
  // a folha usa (`recalcular_folha_do_ponto` casa por `YYYY-MM`).
  const [mes, setMes] = useState(() => todayBR().slice(0, 7));
  const [filtroData, setFiltroData] = useState('');
  // Escolher um dia manda no mês exibido: filtrar por uma data fora do mês
  // carregado devolveria "nenhum registro" com o registro existindo no banco.
  const mesEfetivo = filtroData ? filtroData.slice(0, 7) : mes;
  const periodo = useMemo(
    () => ({ gte: `${mesEfetivo}-01`, lte: fimDoMes(mesEfetivo) }),
    [mesEfetivo],
  );

  const { data: ponto, setData, isLoading: loadingP } = useFetchData<any>(
    '/api/pontoeletronicoview', filial ? { filial, data: periodo } : { data: periodo });
  const { data: funcionarios, isLoading: loadingFn } = useFetchData<any>(
    '/api/funcionariosview', filial ? { filial } : undefined);
  // Sem o totem, o lançamento manual é a única forma de entrada — então é ele
  // que abre. 'registros' é a listagem de ponto_eletronico.
  const [tab, setTab] = useState<'manual' | 'registros' | 'relatorio'>('manual');

  // Exclusão de linha de ponto continua restrita a admin.
  const isAdmin = profile?.role === 'admin';

  // Quem lança presença por outro. Mesma régua da RPC registrar_ponto_manual
  // (migr. 289). Sem o totem, quem não passa aqui não tem o que fazer nesta
  // tela — por isso o submenu inteiro ganhou requireSetor em App.tsx.
  const podeLancarManual = hasSetor(profile, 'rh')
    || profile?.role === 'admin' || profile?.role === 'ceo'
    || profile?.role === 'gerente' || isConselheiro(profile);

  const [confirmandoManualId, setConfirmandoManualId] = useState<string | null>(null);
  const [excluindoManualId, setExcluindoManualId] = useState<string | null>(null);

  const handleExcluirManual = async (id: string) => {
    setExcluindoManualId(id);
    try {
      // RPC em vez de DELETE direto: recusa turma anterior e afastamento (migr. 635).
      const { error } = await supabase!.rpc('remover_ponto', { p_ponto_id: id });
      if (error) throw error;
      setData((prev: any[]) => prev.filter(p => p.id !== id));
      showToast('Registro manual removido.', 'success');
    } catch (err: any) {
      showToast(`Erro ao excluir: ${err?.message ?? 'verifique o console'}`, 'error');
    } finally {
      setExcluindoManualId(null);
      setConfirmandoManualId(null);
    }
  };
  if (loadingP || loadingFn) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const pontoFiltrado = filtroData ? ponto.filter((p: any) => p.data === filtroData) : ponto;
  const enriched = pontoFiltrado.map((p: any) => ({
    ...p,
    func: funcionarios.find((f: any) => f.id === p.funcionario_id),
  }));

  const faltas       = ponto.filter((p: any) => p.status === 'Falta').length;
  const extras       = ponto.filter((p: any) => p.status === 'Hora Extra').length;
  const justificados = ponto.filter((p: any) => p.status === 'Justificado').length;


  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      {/* Título */}
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
          Registro de Ponto{filial ? ` — ${filial}` : ''}
        </h2>
      </div>

      {/* Dias e horários da turma — cada turma é um projeto, então é uma jornada só,
          e ela é da Matriz: dentro de uma filial a faixa não aparece. */}
      {modoMatriz && <JornadaTurmaFaixa profile={profile} showToast={showToast} />}

      {/* Tab switcher */}
      <div className="flex gap-1 neu-pressed rounded-2xl p-1 w-fit border border-white/5 shrink-0">
        {([
          ...(podeLancarManual
            ? [{ key: 'manual', label: 'Lançamento', Icon: ClipboardList } as const]
            : []),
          { key: 'registros', label: 'Registros',  Icon: ListChecks },
          { key: 'relatorio', label: 'Relatório',  Icon: FileDown },
        ] as const).map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${tab === key ? 'neu-flat text-gray-200 border border-white/10' : 'text-gray-600 hover:text-gray-400'}`}>
            <Icon size={12} />{label}
          </button>
        ))}
      </div>

      {/* ── Aba Registros ── */}
      {tab === 'registros' && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
            {[
              // (504) "no mês" no rótulo: o número é do período carregado, e
              // sem dizer isso o card volta a parecer o total de sempre.
              { tom: 'verde' as TomContador, label: 'Registros no mês',   value: ponto.length,  valueCls: 'text-gray-100',    borderCls: 'border-white/5' },
              { tom: 'vermelho' as TomContador, label: 'Faltas no mês',      value: faltas,        valueCls: faltas > 0 ? 'text-red-400' : 'text-gray-400',   borderCls: faltas > 0 ? 'border-red-500/25' : 'border-white/5' },
              { tom: 'azul' as TomContador, label: 'Horas Extras no mês', value: extras,       valueCls: extras > 0 ? 'text-blue-400' : 'text-gray-400',  borderCls: extras > 0 ? 'border-blue-500/25' : 'border-white/5' },
              { tom: 'amarelo' as TomContador, label: 'Justificados no mês', value: justificados, valueCls: justificados > 0 ? 'text-yellow-400' : 'text-gray-400', borderCls: justificados > 0 ? 'border-yellow-500/25' : 'border-white/5' },
            ].map((k: any) => (
              <CardContador key={k.label} label={k.label} value={k.value} sub={k.sub} tom={k.tom} />
            ))}
          </div>

          {/* Controles manuais */}
          <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex flex-wrap items-center gap-3">
              <Clock size={14} className="text-yellow-400" />
              <label htmlFor="ponto-mes-filtro" className="text-xs text-gray-500 font-bold uppercase tracking-widest">Mês</label>
              <input id="ponto-mes-filtro" type="month" value={mesEfetivo}
                onChange={e => { setFiltroData(''); setMes(e.target.value || todayBR().slice(0, 7)); }}
                className="neu-input rounded-xl px-3 py-2 text-sm" />
              <label htmlFor="ponto-data-filtro" className="text-xs text-gray-500 font-bold uppercase tracking-widest">Dia</label>
              {/* Escolher o dia move o mês junto: quem limpa o dia depois
                  continua no mês que estava olhando, não volta para hoje. */}
              <input id="ponto-data-filtro" type="date" value={filtroData}
                onChange={e => { setFiltroData(e.target.value); if (e.target.value) setMes(e.target.value.slice(0, 7)); }}
                className="neu-input rounded-xl px-3 py-2 text-sm" />
              {filtroData && <button onClick={() => setFiltroData('')} className="text-xs text-gray-500 hover:text-white transition-colors">Limpar dia</button>}
            </div>
          </div>

          {/* Tabela de registros de ponto (QR/codigo). Registro manual foi
              removido — Frequencia de Trabalho ja cumpre esse papel. */}
          <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            {enriched.length === 0 ? <EmptyState message={filtroData ? `Nenhum registro para ${filtroData}.` : `Nenhum registro de ponto em ${mesEfetivo}.`} /> : (
              <div className="overflow-x-auto main-scrollbar">
                <table className="tabela w-full text-left border-collapse">
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Funcionário</th>
                    {/* Sem esta coluna, na Matriz a lista junta as três unidades
                        e dois nomes iguais de filiais diferentes viram um só. */}
                    {modoMatriz && <th className="pb-4 font-bold px-4">Unidade</th>}
                    <th className="pb-4 font-bold px-4">Data</th>
                    <th className="pb-4 font-bold px-4 text-center">Entrada</th>
                    <th className="pb-4 font-bold px-4 text-center">Saída</th>
                    <th className="pb-4 font-bold px-4 text-center">Horas</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                    {isAdmin && <th className="pb-4 font-bold px-4 text-right">Ações</th>}
                  </tr></thead>
                  <tbody>
                    <AnimatePresence>
                      {enriched.map((p: any) => (
                        <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.func?.nome ?? '—'}</td>
                          {modoMatriz && (
                            <td className="py-3 px-4"><FilialBadge filial={p.filial} /></td>
                          )}
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{p.data ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{p.entrada ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{p.saida ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{Number(p.horas_trabalhadas || 0).toFixed(1)}h</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusCls(p.status)}`}>{p.status}</span>
                          </td>
                          {isAdmin && (
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {confirmandoManualId === p.id ? (
                                  <>
                                    <button onClick={() => handleExcluirManual(p.id)} disabled={excluindoManualId === p.id}
                                      className="text-[10px] text-red-500 hover:text-red-300 font-bold uppercase tracking-widest transition-colors disabled:opacity-50">
                                      {excluindoManualId === p.id ? '...' : 'Confirmar'}
                                    </button>
                                    <button onClick={() => setConfirmandoManualId(null)} disabled={excluindoManualId === p.id}
                                      className="text-[10px] text-gray-500 hover:text-gray-300 font-bold uppercase tracking-widest transition-colors">
                                      Cancelar
                                    </button>
                                  </>
                                ) : (
                                  <button onClick={() => setConfirmandoManualId(p.id)}
                                    title="Excluir registro"
                                    className="action-btn-delete">
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Aba Relatório ── */}
      {tab === 'relatorio' && (
        <FrequenciaRelatorioTab
          funcionarios={funcionarios as any}
          filial={filial}
          profile={profile}
          showToast={showToast}
        />
      )}

      {/* ── Aba Histórico ── */}
      {tab === 'manual' && podeLancarManual && (
        <FrequenciaTrabalhoView showToast={showToast} profile={profile} embedded />
      )}


    </motion.div>
  );
};


export const PontoEletronicoView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();

  // Modo Matriz (sem filial ativa): a tela abre a turma inteira, em vez de só o
  // lançamento manual.
  //
  // Antes este ramo devolvia apenas o painel de cumprimento por unidade, porque
  // o totem era operação de dentro da filial e as abas faziam fetch escopado. O
  // totem saiu em 2026-07-29 e a leitura de crachá nasceu na Matriz — então
  // quem registra ali era justamente quem não tinha como VER nem corrigir o que
  // registrou, sem antes entrar numa unidade.
  //
  // Quem recorta continua sendo a RLS: `podeVer` só decide quem abre a tela, e
  // a lista mostra o que `ponto_rh_select` deixar passar para cada um — o
  // gerente enxerga a própria unidade mesmo estando na Matriz.
  const podeVer = hasSetor(profile, 'rh')
    || profile?.role === 'admin' || profile?.role === 'ceo'
    || profile?.role === 'gerente' || isConselheiro(profile);

  if (!filialAtiva) {
    if (!podeVer) return null;
    return <PontoEletronicoViewInner showToast={showToast} profile={profile} filial={null} />;
  }

  return <PontoEletronicoViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
