import React, { useMemo, useState, useCallback } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, XCircle, Clock, X, User, Search, Save, Loader2, MessageSquarePlus, Building2, FileCheck, Lock,
} from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { PONTO_JORNADA_HORAS } from '../lib/pontoHorarios';
import { useJornadaTurma, usePontoCorteTurma } from '../hooks/useJornadaTurma';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { LoadingSpinner, EmptyState, CardContador } from '../components/ui';
import { hasSetor, isConselheiro } from '../lib/rbac';

// 'Justificado' cobre dois caminhos: o afastamento aprovado (linha somente-
// leitura, com afastamento_id) e a falta justificada lançada aqui à mão
// (migr. 303). O primeiro continua sendo verdade do módulo Afastamentos — só
// ele bloqueia a linha.
type StatusFreq = 'Presente' | 'Falta' | 'Presente com Atraso' | 'Justificado';

const STATUS_CONFIG: Record<StatusFreq, { icon: any; color: string; bg: string; border: string }> = {
  'Presente':           { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  'Falta':              { icon: XCircle,      color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  'Presente com Atraso': { icon: Clock,        color: 'text-yellow-400',  bg: 'bg-yellow-500/10',  border: 'border-yellow-500/20' },
  // Azul: separa visualmente de Atraso (amarelo), que antes dividia a mesma cor.
  'Justificado':        { icon: FileCheck,    color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
};

/** Rótulos curtos dos botões — o nome do banco é longo demais para a coluna. */
const STATUS_LABEL: Record<StatusFreq, string> = {
  'Presente': 'Presente',
  'Falta': 'Falta',
  'Presente com Atraso': 'Atraso',
  'Justificado': 'Justificada',
};

const STATUS_BTN_CLASS: Record<StatusFreq, string> = {
  'Presente': 'freq-status-btn--presente',
  'Falta': 'freq-status-btn--falta',
  'Presente com Atraso': 'freq-status-btn--atraso',
  'Justificado': 'freq-status-btn--justificada',
};

/** Os quatro que se lançam à mão. */
const STATUSES: StatusFreq[] = ['Presente', 'Falta', 'Presente com Atraso', 'Justificado'];

/**
 * Uma linha de `ponto_eletronico` na forma que esta tela consome.
 *
 * A tela deixou de ter tabela própria na migr. 289 — presença virou dado único
 * em ponto_eletronico, com dois modos de entrada (totem e este lançamento
 * manual). O que resta aqui é tradução de vocabulário.
 */
type Frequencia = {
  id: string;
  funcionario_id: string;
  data: string;
  status: StatusFreq;
  justificativa: string | null;
  registrado_por_nome: string | null;
  created_at: string;
  entrada: string | null;
  origem: string | null;
  /** Dia coberto por afastamento: não se edita por aqui. */
  bloqueado: boolean;
  /** (505) Dia anterior ao último APAGAR TUDO: registro da turma passada. */
  turma_anterior: boolean;
};

type PontoRow = {
  id: string;
  funcionario_id: string;
  data: string;
  status: string | null;
  entrada: string | null;
  observacao: string | null;
  origem: string | null;
  afastamento_id: string | null;
  registrado_por_nome: string | null;
  created_at: string;
};

/**
 * Vocabulário do ponto → vocabulário da tela.
 *
 * Atraso não é status no banco: `recalcular_folha_do_ponto` deriva o desconto
 * comparando `entrada` com o horário-alvo da turma. Então "Presente com
 * Atraso" é 'Normal' com entrada depois do alvo — e a comparação lexicográfica
 * de "HH:MM" basta.
 *
 * O alvo chega por parâmetro (migr. 350): a fonte é `ponto_jornada` quando a
 * turma já confirmou o horário, senão o env do site. Ler o env direto aqui
 * faria esta tela chamar de atrasado quem o placar da competição considera
 * pontual, e vice-versa.
 */
const pontoParaFrequencia = (p: PontoRow, alvoEntrada: string, corte?: string | null): Frequencia => {
  let status: StatusFreq;
  if (p.status === 'Falta') status = 'Falta';
  else if (p.status === 'Justificado') status = 'Justificado';
  else if (p.entrada && p.entrada > alvoEntrada) status = 'Presente com Atraso';
  else status = 'Presente';

  return {
    id: p.id,
    funcionario_id: p.funcionario_id,
    data: p.data,
    status,
    justificativa: p.observacao,
    registrado_por_nome: p.registrado_por_nome,
    created_at: p.created_at,
    entrada: p.entrada,
    origem: p.origem,
    bloqueado: !!p.afastamento_id,
    // (505) Comparação de string serve: as duas pontas são 'YYYY-MM-DD'.
    turma_anterior: !!corte && p.data < corte,
  };
};

type Funcionario = { id: string; nome: string; status: string | null; cargo: string | null; departamento: string | null; filial: string | null };

type FilterPeriod = 'dia' | 'semana' | 'mes';

const fmtData = (s: string) => {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const fmtHorario = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });

const fmtDiaSemana = (s: string) => {
  const d = new Date(s + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'America/Rio_Branco' });
};

const startOfWeek = (dateStr: string): string => {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
};

const endOfWeek = (dateStr: string): string => {
  const s = startOfWeek(dateStr);
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
};

const startOfMonth = (dateStr: string): string => dateStr.slice(0, 7) + '-01';

const endOfMonth = (dateStr: string): string => {
  const [y, m] = dateStr.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
};

const getDaysInRange = (start: string, end: string): string[] => {
  const days: string[] = [];
  const d = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  while (d <= e) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
};

// Matriz entra como unidade registrável: os funcionários da holding também têm
// frequência lançada, e é a partir daí que dá pra comparar o cumprimento das filiais.
const FILIAIS_REG = ['Matriz', 'SuperMax', 'MaxLook', 'TechMax'] as const;

// Funcionário sem filial definida é tratado como Matriz (FILIAL_DEFAULT).
//
// Desligado também: aqui o desligamento não é saída do curso — o aluno sai da
// filial e vai para recuperação, continuando a ter presença lançada. Quem
// lança passa a ser a Matriz (migr. 357), então para efeito de frequência ele
// é da Matriz. `funcionarios.filial` continua com a filial de origem, que é o
// que o RH precisa saber e o que a readmissão usa para devolvê-lo.
const filialDoFunc = (f: any): string =>
  f?.status === 'Desligado' ? 'Matriz' : (f?.filial ?? 'Matriz');

// Quem tem presença a lançar. Desligado entra; soft-delete e demais status,
// não.
const contaNaFrequencia = (f: any): boolean => {
  const st = f?.status ?? 'Ativo';
  return st === 'Ativo' || st === 'Desligado';
};

/**
 * Modal de histórico de uma pessoa.
 *
 * (504) Tem busca própria, escopada por `funcionario_id`. A grade passou a
 * carregar só o período visível — sem esta busca, "histórico" viraria
 * "histórico da semana selecionada". Por pessoa o volume é pequeno, então
 * aqui não há recorte de data: é justamente o lugar de ver o passado inteiro.
 */
const HistoricoFuncModal = ({ func, alvoEntrada, onClose }: { func: Funcionario; alvoEntrada: string; onClose: () => void }) => {
  const { data: pontos, isLoading } = useFetchData<PontoRow>('/api/pontoeletronicoview', { funcionario_id: func.id });
  const historicoFunc = useMemo(
    () => (pontos ?? [])
      .map(p => pontoParaFrequencia(p, alvoEntrada))
      .sort((a, b) => b.data.localeCompare(a.data)),
    [pontos, alvoEntrada],
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="neu-flat rounded-3xl p-6 border border-white/10 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-accent">{func.nome}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {[func.cargo, func.departamento, func.filial].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <button onClick={onClose} className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        {/* Resumo rápido */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 shrink-0">
          {(['Presente', 'Falta', 'Presente com Atraso', 'Justificado'] as StatusFreq[]).map(s => {
            const count = historicoFunc.filter(f => f.status === s).length;
            const cfg = STATUS_CONFIG[s];
            const Ic = cfg.icon;
            return (
              <div key={s} className={`rounded-xl p-3 border ${cfg.bg} ${cfg.border}`}>
                <div className="flex items-center gap-2">
                  <Ic size={14} className={cfg.color} />
                  <span className={`text-xs font-bold ${cfg.color}`}>{STATUS_LABEL[s]}</span>
                </div>
                <div className={`text-xl font-bold tabular-nums mt-1 ${cfg.color}`}>{count}</div>
              </div>
            );
          })}
        </div>

        {/* Lista de registros */}
        <div className="flex-1 overflow-y-auto main-scrollbar">
          {isLoading ? (
            <p className="text-sm text-gray-500 text-center py-8">Carregando histórico...</p>
          ) : historicoFunc.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">Nenhum registro de frequência.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {historicoFunc.map(f => {
                const cfg = STATUS_CONFIG[f.status];
                const Ic = cfg.icon;
                return (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors">
                    <Ic size={14} className={cfg.color} />
                    <span className="text-xs font-mono text-gray-400 tabular-nums w-20 shrink-0">{fmtData(f.data)}</span>
                    <span className={`text-xs font-bold ${cfg.color} w-36 shrink-0`}>{f.status}</span>
                    <span className="text-xs text-gray-500 truncate flex-1">{f.justificativa || '—'}</span>
                    <span className="text-[10px] text-gray-600 shrink-0">{f.registrado_por_nome ?? ''}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

const FrequenciaTrabalhoViewInner = ({ showToast, profile, filial, embedded }: any) => {
  const { user } = useAuth();
  // Presença agora vive em ponto_eletronico (migr. 289) — mesma tabela do
  // totem. `ponto_eletronico` TEM coluna filial, e a RLS já a usa; o filtro
  // client-side abaixo continua servindo ao seletor de unidade no modo Matriz.
  //
  // (504) A busca é recortada pelo período visível. O ponto passou a
  // atravessar o APAGAR TUDO, então esta tabela acumula turma sobre turma —
  // sem recorte, a grade de um dia baixava o histórico inteiro e, passado o
  // teto de linhas da API, passaria a baixá-lo pela metade, em silêncio.
  const today = todayBR();
  const [dataSelecionada, setDataSelecionada] = useState(today);
  const [filtro, setFiltro] = useState<FilterPeriod>('dia');
  const periodoRange = useMemo(() => {
    if (filtro === 'dia')    return { gte: dataSelecionada, lte: dataSelecionada };
    if (filtro === 'semana') return { gte: startOfWeek(dataSelecionada), lte: endOfWeek(dataSelecionada) };
    return { gte: startOfMonth(dataSelecionada), lte: endOfMonth(dataSelecionada) };
  }, [filtro, dataSelecionada]);

  // Escopo de unidade: a RLS deixa admin, CEO e conselheiro passarem em
  // todas as filiais (`auth_pode_filial`), então quem opera dentro de uma
  // unidade via dado de outra. Em Matriz o filtro não existe, que é o ponto.
  const { data: pontos, isLoading, reload } = useFetchData<PontoRow>('/api/pontoeletronicoview',
    filial ? { data: periodoRange, filial } : { data: periodoRange });
  // Mesmo alvo que o placar da competição usa (migr. 350), com o env de
  // fallback enquanto a turma não confirmar o horário.
  const jornada = useJornadaTurma();
  const corteTurma = usePontoCorteTurma();
  const frequencias = useMemo(
    () => (pontos ?? []).map(p => pontoParaFrequencia(p, jornada.entrada, corteTurma)),
    [pontos, jornada.entrada, corteTurma],
  );
  // No modo Matriz (filial===null) carrega todos sem filtro
  const { data: funcionarios, isLoading: loadingFunc } = useFetchData<Funcionario>(
    '/api/funcionariosview',
    filial ? { filial } : undefined,
  );
  // (504) Mesmo recorte do ponto, e pela mesma razão: `justificativas_falta`
  // também passou a atravessar o reset, e o painel listava tudo desde sempre.
  const { data: justificativas } = useFetchData<any>('/api/justificativasfaltaview', { data: periodoRange }, true);

  // Filtro de filial dentro do modo Matriz (null = todas)
  const [filialFiltro, setFilialFiltro] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Edições locais antes de salvar. `entrada` só é usada quando o status é
  // 'Presente com Atraso' — é o horário que vira desconto na folha.
  const [edits, setEdits] = useState<Record<string, { status: StatusFreq; justificativa: string; entrada: string }>>({});

  // Modal de histórico
  const [modalFunc, setModalFunc] = useState<Funcionario | null>(null);

  // Modal de justificativa: a coluna virou botão porque o input de uma linha
  // não cabia um motivo escrito de verdade — digitava-se três palavras e olhe lá.
  const [justModal, setJustModal] = useState<{ func: Funcionario; texto: string } | null>(null);

  const canEdit = hasSetor(profile, 'rh') || profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'gerente' || isConselheiro(profile);

  // No modo filial: filtra pela filial ativa.
  // No modo Matriz (filial===null): filtra pelo filialFiltro local (null = todas).
  const filialEfetiva = filial ?? filialFiltro;

  const funcionariosAtivos = useMemo(
    () => (funcionarios ?? [])
      .filter(contaNaFrequencia)
      .filter((f: any) => filialEfetiva === null || filialDoFunc(f) === filialEfetiva)
      .sort((a: any, b: any) =>
        (a.nome ?? '').trim().localeCompare((b.nome ?? '').trim(), 'pt-BR', { sensitivity: 'base' })
      ),
    [funcionarios, filialEfetiva],
  );

  const funcIdsFilial = useMemo(
    () => new Set(
      (funcionarios ?? [])
        .filter((f: any) => filialEfetiva === null || filialDoFunc(f) === filialEfetiva)
        .map((f: any) => f.id)
    ),
    [funcionarios, filialEfetiva],
  );

  const filteredFuncs = useMemo(() => {
    if (!search.trim()) return funcionariosAtivos;
    const s = search.toLowerCase();
    return funcionariosAtivos.filter((f: any) => (f.nome ?? '').toLowerCase().includes(s));
  }, [funcionariosAtivos, search]);

  const freqMap = useMemo(() => {
    const m = new Map<string, Frequencia>();
    (frequencias ?? [])
      .filter(f => funcIdsFilial.has(f.funcionario_id))
      .forEach(f => m.set(`${f.funcionario_id}|${f.data}`, f));
    return m;
  }, [frequencias, funcIdsFilial]);

  const getFreq = (funcId: string, data: string) => freqMap.get(`${funcId}|${data}`);

  const getEdit = (funcId: string) => edits[funcId];

  const setEdit = (funcId: string, partial: Partial<{ status: StatusFreq; justificativa: string; entrada: string }>) => {
    setEdits(prev => ({
      ...prev,
      [funcId]: { status: 'Presente', justificativa: '', entrada: '', ...prev[funcId], ...partial },
    }));
  };

  /** O que impede este rascunho de virar linha no banco, ou null se nada
   *  impede. Separado da gravação porque o lote precisa da mesma régua ANTES
   *  de começar a gravar — descobrir no meio deixaria metade lançada. */
  const recusaDoRascunho = (edit: { status: StatusFreq; justificativa: string; entrada: string }): string | null => {
    // Atraso sem horário não é quantificável — e é exatamente o que a folha
    // precisa para descontar. Pedir aqui evita gravar um rótulo que não vira
    // nada, que era o defeito do modelo antigo.
    if (edit.status === 'Presente com Atraso' && !edit.entrada) {
      return 'Informe o horário de entrada para registrar o atraso.';
    }
    // Falta justificada sem motivo é falta com nome bonito: a RPC recusa
    // (migr. 303) e aqui a recusa chega antes do round-trip.
    if (edit.status === 'Justificado' && !edit.justificativa.trim()) {
      return 'Escreva a justificativa antes de salvar a falta justificada.';
    }
    return null;
  };

  /** Uma linha, sem toast e sem reload: quem chama decide o que dizer e quando
   *  recarregar. O lote grava dezenas destas e não pode disparar dezenas de
   *  toasts nem dezenas de refetches. */
  const gravarLinha = useCallback(async (
    funcId: string,
    edit: { status: StatusFreq; justificativa: string; entrada: string },
  ) => {
    // 'Presente com Atraso' vai como Normal + entrada real; o desconto sai do
    // recalcular_folha_do_ponto comparando com o horário-alvo da turma.
    // 'Justificado' vai como está: a folha já o trata como zero desconto.
    const statusPonto = edit.status === 'Falta' || edit.status === 'Justificado' ? edit.status : 'Normal';
    const entrada = edit.status === 'Falta' || edit.status === 'Justificado'
      ? null
      : (edit.status === 'Presente com Atraso' ? edit.entrada : jornada.entrada);

    const { error } = await supabase!.rpc('registrar_ponto_manual', {
      p_funcionario_id: funcId,
      p_data:           dataSelecionada,
      p_status:         statusPonto,
      p_entrada:        entrada,
      p_observacao:     edit.justificativa.trim() || null,
      // Jornada da turma (migr. 290). Sem isso o dia gravaria a jornada
      // padrão da manhã mesmo numa turma da tarde.
      p_horas:          PONTO_JORNADA_HORAS,
    });
    if (error) throw error;
  }, [dataSelecionada, jornada.entrada]);

  const handleSave = useCallback(async (func: Funcionario) => {
    if (!supabase || !canEdit) return;
    const edit = edits[func.id];
    if (!edit) return;

    const recusa = recusaDoRascunho(edit);
    if (recusa) { showToast(recusa, 'error'); return; }

    const key = func.id;
    setSaving(prev => ({ ...prev, [key]: true }));

    try {
      await gravarLinha(func.id, edit);
      setEdits(prev => { const n = { ...prev }; delete n[func.id]; return n; });
      // silent: a tela tem `if (isLoading) return <spinner>`, e um reload
      // normal aqui desmontaria a grade inteira que o operador está
      // preenchendo linha por linha. O feedback já é o saving[key] da linha.
      await reload({ silent: true });
      showToast(`Presença de ${func.nome} registrada no ponto.`, 'success');
    } catch (err: any) {
      // A régua mora na RPC (migr. 289): dia de afastamento, filial alheia,
      // data futura e falta de autoridade voltam com mensagem própria — engolir
      // isso num erro genérico é o que faz a tela parecer quebrada.
      showToast(err?.message ?? 'Erro ao registrar.', 'error', true);
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
  }, [edits, canEdit, gravarLinha, reload, showToast]);

  // ── Lançamento em lote ────────────────────────────────────────────────
  //
  // O dia normal de uma turma é "todo mundo veio, menos um". Lançar isso a
  // mão são 30 cliques em Presente e 30 em Salvar para chegar ao mesmo lugar.
  // Aqui é: marca todos presentes, corrige quem faltou (a linha continua
  // editável), salva de uma vez.
  //
  // Quem já tem registro no dia fica de fora da marcação: a linha lançada é
  // decisão de alguém, e o botão não vai por cima dela. Dia de afastamento e
  // dia de turma anterior também não entram — o banco recusa os dois.
  const [salvandoLote, setSalvandoLote] = useState(false);

  const marcaveis = useMemo(
    () => filteredFuncs.filter((f: Funcionario) => {
      const freq = getFreq(f.id, dataSelecionada);
      return !freq && !edits[f.id];
    }),
    [filteredFuncs, freqMap, dataSelecionada, edits],
  );

  const pendentesDeSalvar = useMemo(
    () => funcionariosAtivos.filter((f: Funcionario) => !!edits[f.id]),
    [funcionariosAtivos, edits],
  );

  const marcarTodosPresentes = () => {
    if (!marcaveis.length) return;
    setEdits(prev => {
      const n = { ...prev };
      marcaveis.forEach((f: Funcionario) => {
        n[f.id] = { status: 'Presente', justificativa: '', entrada: '' };
      });
      return n;
    });
    showToast(`${marcaveis.length} marcado(s) como presente. Ajuste quem faltou e salve.`, 'info');
  };

  const salvarTodos = useCallback(async () => {
    if (!supabase || !canEdit || !pendentesDeSalvar.length) return;

    // Valida tudo antes de gravar qualquer coisa: descobrir no meio deixaria
    // metade do dia lançada e a outra metade em rascunho, sem a pessoa saber
    // onde parou.
    for (const f of pendentesDeSalvar) {
      const recusa = recusaDoRascunho(edits[f.id]);
      if (recusa) { showToast(`${f.nome}: ${recusa}`, 'error'); return; }
    }

    setSalvandoLote(true);
    // Ordem fixa por id: várias máquinas da turma salvam o mesmo dia ao mesmo
    // tempo, e gravar em ordens diferentes é como se fabrica deadlock.
    const fila = [...pendentesDeSalvar].sort((a, b) => a.id.localeCompare(b.id));
    const falhas: { nome: string; motivo: string }[] = [];
    let gravados = 0;

    for (const f of fila) {
      const edit = edits[f.id];
      if (!edit) continue;
      setSaving(prev => ({ ...prev, [f.id]: true }));
      try {
        await gravarLinha(f.id, edit);
        gravados++;
        setEdits(prev => { const n = { ...prev }; delete n[f.id]; return n; });
      } catch (err: any) {
        falhas.push({ nome: f.nome, motivo: err?.message ?? 'erro desconhecido' });
      } finally {
        setSaving(prev => ({ ...prev, [f.id]: false }));
      }
    }

    await reload({ silent: true });
    setSalvandoLote(false);

    if (falhas.length === 0) {
      showToast(`${gravados} lançamento(s) gravado(s) no ponto.`, 'success');
    } else {
      // O rascunho de quem falhou continua na tela, então dá para tentar de
      // novo sem relançar o dia inteiro.
      showToast(
        `${gravados} gravado(s), ${falhas.length} recusado(s) — ${falhas.slice(0, 3).map(x => `${x.nome}: ${x.motivo}`).join(' · ')}`,
        'error', true,
      );
    }
  }, [pendentesDeSalvar, edits, canEdit, gravarLinha, reload, showToast]);

  // Stats do dia
  const statsForDate = useMemo(() => {
    const total = funcionariosAtivos.length;
    // 'Justificado' entra num balde próprio: sem ele os dias de afastamento
    // não apareciam em nenhum card e a soma não fechava com o total.
    let presentes = 0, faltas = 0, atrasos = 0, justificados = 0, semRegistro = 0;
    funcionariosAtivos.forEach((f: any) => {
      const freq = getFreq(f.id, dataSelecionada);
      if (!freq) { semRegistro++; return; }
      if (freq.status === 'Presente') presentes++;
      else if (freq.status === 'Falta') faltas++;
      else if (freq.status === 'Presente com Atraso') atrasos++;
      else if (freq.status === 'Justificado') justificados++;
    });
    return { total, presentes, faltas, atrasos, justificados, semRegistro };
  }, [funcionariosAtivos, freqMap, dataSelecionada]);

  // Histórico do funcionário selecionado (modal)
  const historicoFunc = useMemo(() => {
    if (!modalFunc) return [];
    return (frequencias ?? [])
      .filter(f => f.funcionario_id === modalFunc.id)
      .sort((a, b) => b.data.localeCompare(a.data));
  }, [modalFunc, frequencias]);

  // Período label
  const periodoLabel = useMemo(() => {
    if (filtro === 'dia') return fmtData(dataSelecionada);
    if (filtro === 'semana') return `${fmtData(startOfWeek(dataSelecionada))} — ${fmtData(endOfWeek(dataSelecionada))}`;
    return `${fmtData(startOfMonth(dataSelecionada))} — ${fmtData(endOfMonth(dataSelecionada))}`;
  }, [filtro, dataSelecionada]);

  // Dias no período para a visão semanal/mensal
  const diasPeriodo = useMemo(() => {
    if (filtro === 'dia') return [dataSelecionada];
    if (filtro === 'semana') return getDaysInRange(startOfWeek(dataSelecionada), endOfWeek(dataSelecionada));
    return getDaysInRange(startOfMonth(dataSelecionada), endOfMonth(dataSelecionada));
  }, [filtro, dataSelecionada]);

  // Mapa de frequência sem recorte de filial — base do painel de cumprimento.
  const freqMapGlobal = useMemo(() => {
    const m = new Map<string, Frequencia>();
    (frequencias ?? []).forEach(f => m.set(`${f.funcionario_id}|${f.data}`, f));
    return m;
  }, [frequencias]);

  // Dias cobrados: só dias úteis (seg–sex) já passados ou hoje.
  const diasCobrados = useMemo(
    () => diasPeriodo.filter(d => {
      if (d > today) return false;
      const dow = new Date(d + 'T12:00:00').getDay();
      return dow >= 1 && dow <= 5;
    }),
    [diasPeriodo, today],
  );

  // Cumprimento por unidade: quantos lançamentos existem vs. quantos deveriam existir.
  const cumprimento = useMemo(() => {
    const ativos = (funcionarios ?? []).filter(contaNaFrequencia);
    return FILIAIS_REG.map(unidade => {
      const doUnidade = ativos.filter((f: any) => filialDoFunc(f) === unidade);
      const esperado = doUnidade.length * diasCobrados.length;
      let registrados = 0;
      let ultimo: string | null = null;
      doUnidade.forEach((f: any) => {
        diasCobrados.forEach(d => {
          const reg = freqMapGlobal.get(`${f.id}|${d}`);
          if (reg) {
            registrados++;
            if (!ultimo || d > ultimo) ultimo = d;
          }
        });
      });
      const pct = esperado > 0 ? Math.round((registrados / esperado) * 100) : 0;
      return { unidade, funcionarios: doUnidade.length, esperado, registrados, pct, ultimo };
    });
  }, [funcionarios, diasCobrados, freqMapGlobal]);

  if (!canEdit) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center">
        <User size={36} className="text-gray-600" />
        <p className="text-sm text-gray-400">Apenas Admin, CEO, Conselheiro, Gerente ou setor de RH podem registrar frequência.</p>
      </div>
    );
  }

  if (isLoading || loadingFunc) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  return (
    // Embutida, a tela NÃO é um segundo container de rolagem. Registro de
    // Ponto já rola por fora; o `h-full overflow-y-auto` daqui dentro virava
    // uma caixa de altura fixa dentro de outra caixa que rola — a grade ficava
    // espremida numa janelinha com barra própria, e a página inteira ainda
    // tinha espaço sobrando embaixo.
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col gap-5 pb-6 ${embedded ? '' : 'h-full overflow-y-auto main-scrollbar'}`}>

      {/* Título + filtros. Embutida como aba de Registro de Ponto, o cabeçalho
          próprio vira ruído: o título já está na tela de cima. Só o cabeçalho
          é condicional — lançamento, filtros e painéis seguem idênticos. */}
      <div className="shrink-0 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {!embedded && (
            <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Frequência de Trabalho</h2>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro de filial — só no modo Matriz */}
          {filial === null && (
            <div className="flex items-center gap-1 rounded-xl border border-white/10 p-1 neu-flat">
              {([null, ...FILIAIS_REG] as (string | null)[]).map(f => (
                <button
                  key={f ?? 'todas'}
                  onClick={() => setFilialFiltro(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${filialFiltro === f ? 'bg-accent/20 text-accent border border-accent/30' : 'text-gray-400 hover:text-gray-200'}`}
                >
                  {f ?? 'Todas'}
                </button>
              ))}
            </div>
          )}
          {/* Filtro período */}
          {(['dia', 'semana', 'mes'] as FilterPeriod[]).map(p => (
            <button
              key={p}
              onClick={() => setFiltro(p)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-widest border transition ${filtro === p ? 'bg-accent/15 text-accent border-accent/30' : 'neu-button text-gray-400 border-white/5 hover:text-gray-200'}`}
            >
              {p === 'dia' ? 'Dia' : p === 'semana' ? 'Semana' : 'Mês'}
            </button>
          ))}

          {/* Navegador contextual por modo */}
          {filtro === 'dia' && (
            <input
              type="date"
              value={dataSelecionada}
              onChange={e => setDataSelecionada(e.target.value || today)}
              className="neu-input px-3 py-1.5 rounded-xl text-xs tabular-nums"
            />
          )}
          {filtro === 'semana' && (
            <div className="flex items-center gap-1 neu-flat rounded-xl border border-white/10 px-1 py-1">
              <button
                onClick={() => {
                  const d = new Date(dataSelecionada + 'T12:00:00');
                  d.setDate(d.getDate() - 7);
                  setDataSelecionada(d.toISOString().slice(0, 10));
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition text-sm"
              >‹</button>
              <span className="text-xs tabular-nums text-gray-300 px-1 select-none min-w-[130px] text-center">
                {fmtData(startOfWeek(dataSelecionada))} – {fmtData(endOfWeek(dataSelecionada))}
              </span>
              <button
                onClick={() => {
                  const d = new Date(dataSelecionada + 'T12:00:00');
                  d.setDate(d.getDate() + 7);
                  setDataSelecionada(d.toISOString().slice(0, 10));
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition text-sm"
              >›</button>
            </div>
          )}
          {filtro === 'mes' && (
            <div className="flex items-center gap-1 neu-flat rounded-xl border border-white/10 px-1 py-1">
              <button
                onClick={() => {
                  const [y, m] = dataSelecionada.split('-').map(Number);
                  const d = new Date(y, m - 2, 1);
                  setDataSelecionada(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition text-sm"
              >‹</button>
              <span className="text-xs text-gray-300 px-1 select-none min-w-[100px] text-center capitalize">
                {new Date(dataSelecionada + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Rio_Branco' })}
              </span>
              <button
                onClick={() => {
                  const [y, m] = dataSelecionada.split('-').map(Number);
                  const d = new Date(y, m, 1);
                  setDataSelecionada(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition text-sm"
              >›</button>
            </div>
          )}
        </div>
      </div>

      {/* Resumo cards */}
      {filtro === 'dia' && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 shrink-0">
          {/* Mesmas cores dos botões da linha: a cor é a legenda, fica mesmo com zero. */}
          <CardContador label="Presentes" value={statsForDate.presentes} tom="verde" corFixa />
          <CardContador label="Faltas" value={statsForDate.faltas} tom="vermelho" corFixa />
          <CardContador label="Atrasos" value={statsForDate.atrasos} tom="amarelo" corFixa />
          <CardContador label="Justificados" value={statsForDate.justificados} tom="azul" corFixa />
          <CardContador label="Sem registro" value={statsForDate.semRegistro} tom="roxo" />
        </div>
      )}

      {/* Cumprimento por unidade — só no modo Matriz */}
      {filial === null && (
        <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={14} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-300">Cumprimento do Registro por Unidade</h3>
          </div>
          <p className="text-[11px] text-gray-500 mb-4">
            {diasCobrados.length} dia(s) útil(eis) até hoje no período · esperado = funcionários ativos × dias úteis
          </p>
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse min-w-[560px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-3 font-bold px-3">Unidade</th>
                  <th className="pb-3 font-bold px-3 text-center">Funcionários</th>
                  <th className="pb-3 font-bold px-3 text-center">Registros</th>
                  <th className="pb-3 font-bold px-3 text-center">Esperado</th>
                  <th className="pb-3 font-bold px-3">Cobertura</th>
                  <th className="pb-3 font-bold px-3 text-center">Último</th>
                </tr>
              </thead>
              <tbody>
                {cumprimento.map(c => {
                  const cor = c.pct >= 90 ? 'text-emerald-400' : c.pct >= 60 ? 'text-yellow-400' : 'text-red-400';
                  const barra = c.pct >= 90 ? 'bg-emerald-400' : c.pct >= 60 ? 'bg-yellow-400' : 'bg-red-400';
                  return (
                    <tr key={c.unidade} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 px-3 text-sm font-semibold text-gray-200">{c.unidade}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-400 text-center tabular-nums">{c.funcionarios}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-300 text-center tabular-nums">{c.registrados}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 text-center tabular-nums">{c.esperado}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden min-w-[60px]">
                            <div className={`h-full rounded-full ${barra}`} style={{ width: `${Math.min(c.pct, 100)}%` }} />
                          </div>
                          <span className={`text-xs font-bold tabular-nums w-10 text-right ${cor}`}>{c.pct}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] font-mono text-gray-500 text-center tabular-nums">
                        {c.ultimo ? fmtData(c.ultimo) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Busca */}
      <div className="relative shrink-0">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar funcionário..."
          className="neu-input w-full pl-9 pr-3 py-2 rounded-xl text-sm"
        />
      </div>

      {/* Lançamento em lote — só na visão de um dia, que é onde se lança. */}
      {filtro === 'dia' && (
        <div className="shrink-0 flex flex-wrap items-center gap-2.5" title="Marque todos e corrija só quem faltou — a linha continua editável antes de salvar.">
          <button
            type="button"
            onClick={marcarTodosPresentes}
            disabled={!marcaveis.length || salvandoLote}
            title={marcaveis.length
              ? `Marca ${marcaveis.length} funcionário(s) ainda sem lançamento em ${fmtData(dataSelecionada)}. Quem já tem registro não é tocado.`
              : 'Todo mundo da lista já tem lançamento ou rascunho neste dia.'}
            className="btn-solido btn-solido--verde !py-2.5 !px-4 !text-xs"
          >
            <CheckCircle2 size={15} />
            Todos presentes
            {marcaveis.length > 0 && (
              <span className="ml-1 min-w-[1.5rem] px-1.5 py-0.5 rounded-md bg-black/25 text-[11px] font-black tabular-nums">{marcaveis.length}</span>
            )}
          </button>

          <button
            type="button"
            onClick={salvarTodos}
            disabled={!pendentesDeSalvar.length || salvandoLote}
            title={pendentesDeSalvar.length
              ? `Grava ${pendentesDeSalvar.length} lançamento(s) em aberto.`
              : 'Nada em aberto para gravar.'}
            className="btn-solido btn-solido--dourado !py-2.5 !px-4 !text-xs"
          >
            {salvandoLote ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {salvandoLote ? 'Gravando…' : 'Salvar tudo'}
            {!salvandoLote && pendentesDeSalvar.length > 0 && (
              <span className="ml-1 min-w-[1.5rem] px-1.5 py-0.5 rounded-md bg-black/20 text-[11px] font-black tabular-nums">{pendentesDeSalvar.length}</span>
            )}
          </button>
        </div>
      )}

      {/* Visão DIA — tabela editável */}
      {filtro === 'dia' && (
        <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0">
          {filteredFuncs.length === 0 ? (
            <EmptyState message="Nenhum funcionário ativo encontrado." />
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="tabela w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-3 font-bold px-3">Funcionário</th>
                    {filial === null && <th className="pb-3 font-bold px-3">Filial</th>}
                    <th className="pb-3 font-bold px-3">Cargo</th>
                    <th className="pb-3 font-bold px-3 text-center">Status</th>
                    <th className="pb-3 font-bold px-3 text-center">Registro</th>
                    <th className="pb-3 font-bold px-3 text-center w-px whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFuncs.map((func: Funcionario) => {
                    const freq = getFreq(func.id, dataSelecionada);
                    const edit = getEdit(func.id);
                    // (505) Dia da turma anterior é só-leitura, e a razão é
                    // outra: o banco recusa reescrever aquela linha. Bandeira
                    // separada porque a de afastamento manda para a tela
                    // errada — lá não há nada desta turma para ajustar.
                    const turmaAnterior = !!freq?.turma_anterior;
                    const bloqueado = !!freq?.bloqueado || turmaAnterior;
                    // Justificado vindo de afastamento (bloqueado) não vira estado
                    // de botão — a coluna inteira fica somente-leitura logo abaixo.
                    const freqStatus = bloqueado ? undefined : freq?.status;
                    const currentStatus: StatusFreq = edit?.status ?? freqStatus ?? 'Presente';
                    const currentJust = edit?.justificativa ?? freq?.justificativa ?? '';
                    const currentEntrada = edit?.entrada ?? freq?.entrada ?? '';
                    const isDirty = !!edit;
                    const isSaving = saving[func.id] ?? false;
                    const cfg = STATUS_CONFIG[currentStatus];

                    return (
                      <tr key={func.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-3">
                          <button
                            onClick={() => setModalFunc(func)}
                            className="text-sm font-semibold text-gray-200 hover:text-accent transition-colors text-left"
                          >
                            {func.nome}
                          </button>
                          {func.status === 'Desligado' && (
                            <span
                              title={`Desligado de ${func.filial ?? '—'} — em recuperação. O ponto é lançado pela Matriz e não conta na frequência da filial de origem.`}
                              className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 align-middle"
                            >
                              Recuperação
                            </span>
                          )}
                        </td>
                        {filial === null && (
                          <td className="py-3 px-3 text-xs text-gray-400">
                            {filialDoFunc(func)}
                            {func.status === 'Desligado' && func.filial && (
                              <span className="block text-[10px] text-gray-600">era {func.filial}</span>
                            )}
                          </td>
                        )}
                        <td className="py-3 px-3 text-xs text-gray-500">{func.cargo ?? '—'}</td>
                        <td className="py-3 px-3">
                          {turmaAnterior ? (
                            <div className="flex items-center justify-center gap-1.5 text-gray-500"
                                 title={`Registro anterior ao APAGAR TUDO de ${corteTurma} — histórico da turma passada, só leitura.`}>
                              <Lock size={13} />
                              <span className="text-[11px] font-semibold">Turma anterior</span>
                            </div>
                          ) : bloqueado ? (
                            // Dia coberto por afastamento: a verdade é do módulo
                            // Afastamentos. Antes as duas telas se contradiziam.
                            <div className="flex items-center justify-center gap-1.5 text-yellow-400" title="Ajuste pelo módulo Afastamentos">
                              <FileCheck size={13} />
                              <span className="text-[11px] font-semibold">Afastamento</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1.5">
                              <div className="flex flex-nowrap items-center justify-center gap-1">
                                {STATUSES.map(s => {
                                  const sc = STATUS_CONFIG[s];
                                  const Ic = sc.icon;
                                  const active = currentStatus === s;
                                  const colorCls = STATUS_BTN_CLASS[s];
                                  return (
                                    <button
                                      key={s}
                                      onClick={() => {
                                        setEdit(func.id, { status: s, justificativa: currentJust, entrada: currentEntrada });
                                        // Justificada exige motivo: abrir o modal aqui
                                        // poupa o clique extra na coluna ao lado.
                                        if (s === 'Justificado' && !currentJust.trim()) {
                                          setJustModal({ func, texto: '' });
                                        }
                                      }}
                                      title={s === 'Justificado'
                                        ? 'Falta justificada — registra o motivo. O desconto na folha só é perdoado por afastamento aprovado pela Matriz.'
                                        : s}
                                      className={`freq-status-btn ${colorCls}${active ? ' freq-status-btn--active' : ''}`}
                                    >
                                      <Ic size={14} />
                                      <span className="hidden sm:inline">{STATUS_LABEL[s]}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              {currentStatus === 'Presente com Atraso' && (
                                <input
                                  type="time"
                                  value={currentEntrada}
                                  onChange={e => setEdit(func.id, { status: currentStatus, justificativa: currentJust, entrada: e.target.value })}
                                  title={`Horário de entrada — alvo da turma: ${jornada.entrada}`}
                                  className="neu-input px-2 py-1 rounded-lg text-xs font-mono tabular-nums w-24"
                                />
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {freq ? (() => {
                            const cfg = STATUS_CONFIG[freq.status];
                            const Ic = cfg.icon;
                            return (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className={`flex items-center gap-1 ${cfg.color}`}>
                                  <Ic size={13} />
                                  <span className="text-[11px] font-semibold">{STATUS_LABEL[freq.status]}</span>
                                </div>
                                {/* Marcação do totem é o colaborador no horário;
                                    manual é alguém afirmando por ele. A diferença
                                    importa para conferir, então fica visível. */}
                                <span className="text-[10px] font-mono text-gray-500 tabular-nums">
                                  {freq.entrada ?? fmtHorario(freq.created_at)}
                                  {freq.origem === 'manual' ? ' · manual' : freq.origem === 'totem' ? ' · totem' : ''}
                                </span>
                              </div>
                            );
                          })() : <span className="text-gray-700 text-xs">—</span>}
                        </td>
                        <td className="py-3 px-3 w-px whitespace-nowrap">
                          {/* Justificativa e Salvar lado a lado: eram duas
                              colunas de um botão só cada, e a tabela
                              distribuía a sobra de largura entre elas. */}
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              disabled={bloqueado}
                              onClick={() => setJustModal({ func, texto: currentJust })}
                              title={turmaAnterior ? 'Histórico da turma anterior' : bloqueado ? 'Motivo no módulo Afastamentos' : (currentJust || 'Escrever justificativa')}
                              aria-label="Justificativa"
                              className={`freq-acao-btn ${currentJust ? 'freq-acao-btn--just-cheio' : 'freq-acao-btn--just'}`}
                            >
                              <MessageSquarePlus size={15} />
                            </button>
                            <button
                              onClick={() => handleSave(func)}
                              disabled={!isDirty || isSaving || bloqueado || salvandoLote}
                              aria-label="Salvar"
                              className={`freq-acao-btn ${isDirty && !bloqueado ? 'freq-acao-btn--salvar-cheio' : 'freq-acao-btn--salvar'}`}
                              title={turmaAnterior ? 'Dia da turma anterior — não se reescreve' : bloqueado ? 'Dia coberto por afastamento' : isDirty ? 'Salvar esta linha' : 'Nada a salvar'}
                            >
                              {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Visão SEMANA / MÊS — grade com dias nas colunas */}
      {filtro !== 'dia' && (
        <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0">
          {filteredFuncs.length === 0 ? (
            <EmptyState message="Nenhum funcionário ativo encontrado." />
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="tabela w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-3 font-bold px-3 sticky left-0 bg-[var(--color-bg-base)] z-10 min-w-[160px]">Funcionário</th>
                    {diasPeriodo.map(d => (
                      <th key={d} className="pb-3 font-bold px-1 text-center min-w-[40px]">
                        <div>{d.slice(8)}</div>
                        <div className="text-[8px] text-gray-600 normal-case">{fmtDiaSemana(d)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredFuncs.map((func: Funcionario) => (
                    <tr key={func.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2 px-3 sticky left-0 bg-[var(--color-bg-base)] z-10">
                        <button
                          onClick={() => setModalFunc(func)}
                          className="text-xs font-semibold text-gray-200 hover:text-accent transition-colors text-left truncate max-w-[150px] block"
                        >
                          {func.nome}
                        </button>
                      </td>
                      {diasPeriodo.map(d => {
                        const freq = getFreq(func.id, d);
                        if (!freq) return (
                          <td key={d} className="py-2 px-1 text-center">
                            <span className="text-gray-700 text-[10px]">—</span>
                          </td>
                        );
                        const cfg = STATUS_CONFIG[freq.status];
                        const Ic = cfg.icon;
                        return (
                          <td key={d} className="py-2 px-1 text-center" title={`${freq.status}${freq.justificativa ? ` — ${freq.justificativa}` : ''}`}>
                            <Ic size={14} className={cfg.color} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Justificativas de falta recebidas */}
      {(justificativas ?? []).filter((j: any) => funcIdsFilial.has(j.funcionario_id)).length > 0 && (
        <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquarePlus size={14} className="text-yellow-400" />
            <h3 className="text-sm font-bold text-gray-300">Justificativas de Falta Recebidas</h3>
            <span className="ml-auto text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
              {(justificativas ?? []).filter((j: any) => funcIdsFilial.has(j.funcionario_id)).length}
            </span>
          </div>
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-3 font-bold px-3">Funcionário</th>
                  <th className="pb-3 font-bold px-3">Data</th>
                  <th className="pb-3 font-bold px-3">Motivo</th>
                  <th className="pb-3 font-bold px-3">Enviado por</th>
                  <th className="pb-3 font-bold px-3">Cargo</th>
                </tr>
              </thead>
              <tbody>
                {(justificativas ?? []).filter((j: any) => funcIdsFilial.has(j.funcionario_id)).map((j: any) => (
                  <tr key={j.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2.5 px-3 text-sm font-semibold text-gray-200">{j.nome_funcionario ?? '—'}</td>
                    <td className="py-2.5 px-3 text-xs font-mono text-gray-400">{j.data ? fmtData(j.data) : '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-300 max-w-[300px]">{j.motivo ?? '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">{j.nome_criador ?? '—'}</td>
                    <td className="py-2.5 px-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded border border-yellow-400/20">
                        {j.role_criador ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de justificativa — grava só no rascunho local; quem persiste
          continua sendo o botão Salvar da linha. */}
      <AnimatePresence>
        {justModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setJustModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="neu-flat rounded-3xl p-6 border border-white/10 max-w-lg w-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-accent">Justificativa</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {justModal.func.nome} · {fmtData(dataSelecionada)}
                  </p>
                </div>
                <button onClick={() => setJustModal(null)} className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-200">
                  <X size={16} />
                </button>
              </div>

              <textarea
                autoFocus
                rows={5}
                value={justModal.texto}
                onChange={e => setJustModal(m => (m ? { ...m, texto: e.target.value } : m))}
                placeholder="Descreva o motivo (atestado, convocação, problema de transporte…)"
                className="neu-input w-full px-3 py-2.5 rounded-xl text-sm resize-none"
              />

              <div className="flex items-center justify-end gap-2 mt-5">
                <button
                  onClick={() => setJustModal(null)}
                  className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-200"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const alvo = justModal.func.id;
                    const freq = getFreq(alvo, dataSelecionada);
                    setEdit(alvo, {
                      status: edits[alvo]?.status ?? (freq?.bloqueado ? 'Presente' : freq?.status) ?? 'Presente',
                      justificativa: justModal.texto,
                      entrada: edits[alvo]?.entrada ?? freq?.entrada ?? '',
                    });
                    setJustModal(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 transition"
                >
                  Aplicar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal histórico do funcionário */}
      <AnimatePresence>
        {modalFunc && (
          <HistoricoFuncModal func={modalFunc} alvoEntrada={jornada.entrada} onClose={() => setModalFunc(null)} />
        )}
      </AnimatePresence>

    </motion.div>
  );
};


/**
 * Aba "Lançamento manual" de Registro de Ponto.
 *
 * Deixou de ser submenu próprio na reorganização de 2026-07-29 — depois da
 * migr. 289 ela e o totem escrevem na mesma tabela, e dois itens de menu para
 * dois modos de entrada do mesmo dado era a redundância que a auditoria achou.
 * O lançamento em si não mudou nada: só o cabeçalho sabe que está embutido.
 */
export const FrequenciaTrabalhoView = ({ showToast, profile, embedded }: any) => {
  const { filialAtiva } = useFilial();
  // filialAtiva===null = modo Matriz → passa null para mostrar todas as filiais
  return <FrequenciaTrabalhoViewInner showToast={showToast} profile={profile} filial={filialAtiva} embedded={embedded} />;
};
