import { MenuMais, ItemMenu, CABECALHO_TABELA } from '../components/MenuMais';
import React, { useMemo, useState, useEffect } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import {
  UserMinus, X, Calculator, RotateCcw, FileText, Loader2, DollarSign,
  Check, Ban, Send, Hourglass, MessageSquareText,
} from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, CardContador, AbaComContador, type CorAba, SecaoFormulario, ModalFormulario, FormField, StatusBadge } from '../components/ui';
import { hasSetor } from '../lib/rbac';
import { useConfirm } from '../contexts/ConfirmContext';
import type { UserProfile } from '../hooks/useUserProfile';
import { SelectBusca } from '../components/SelectBusca';
import { opcaoFuncionario } from '../lib/opcoesSelect';

/**
 * Tela de Desligamento (migrs. 306/307).
 *
 * O ciclo do colaborador só tinha entrada até aqui: demitir era editar
 * `funcionarios.status` na mão, sem motivo, sem cálculo e sem cortar acesso.
 *
 * O que esta tela NÃO faz, de propósito: nada de escrita direta em
 * `demissoes`/`rescisoes`. As duas tabelas não têm policy de INSERT — tudo
 * passa por RPC SECURITY DEFINER, para que desligar alguém não seja um POST
 * solto do DevTools.
 */

const TIPOS = [
  'Sem justa causa',
  'Com justa causa',
  'Pedido de demissão',
  'Acordo',
] as const;

type Tipo = typeof TIPOS[number];

const TIPO_SOLIDO: Record<string, string> = {
  'Sem justa causa':    'bg-blue-600 text-white',
  'Com justa causa':    'bg-red-600 text-white',
  'Pedido de demissão': 'bg-yellow-400 text-black',
  'Acordo':             'bg-purple-600 text-white',
};
const TIPO_BOTAO: Record<string, string> = {
  'Sem justa causa':    'btn-solido--azul',
  'Com justa causa':    'btn-solido--vermelho',
  'Pedido de demissão': 'btn-solido--amarelo',
  'Acordo':             'btn-solido--roxo',
};

type AbaDesl = 'pendentes' | 'desligados' | 'readmitidos' | 'recusados';

/** O que cada tipo muda no bolso — a explicação é metade do valor da tela. */
const TIPO_RESUMO: Record<string, string> = {
  'Sem justa causa':    'Aviso prévio + 13º e férias proporcionais + multa de 40% do FGTS. É o desligamento mais caro para a empresa.',
  'Com justa causa':    'Só saldo de salário e férias vencidas. Perde aviso, 13º e férias proporcionais, e não há multa de FGTS.',
  'Pedido de demissão': 'Recebe 13º e férias, mas não tem aviso indenizado nem multa. Se não cumprir o aviso, o valor é descontado.',
  'Acordo':             'Art. 484-A: metade do aviso prévio e multa de 20% do FGTS. Meio-termo negociado entre as partes.',
};

const AVISOS_POR_TIPO: Record<string, string[]> = {
  'Sem justa causa':    ['Indenizado', 'Trabalhado'],
  'Com justa causa':    ['Não se aplica'],
  'Pedido de demissão': ['Trabalhado', 'Não cumprido'],
  'Acordo':             ['Indenizado'],
};

type Rescisao = {
  funcionario: string;
  filial: string;
  tipo: string;
  aviso_previo: string;
  salario_base: number;
  data_admissao: string;
  data_desligamento: string;
  meses_trabalhados: number;
  anos_completos: number;
  dias_aviso: number;
  periodos_ferias_vencidas: number;
  saldo_salario: number;
  aviso_previo_valor: number;
  decimo_terceiro: number;
  ferias_vencidas: number;
  ferias_proporcionais: number;
  terco_ferias: number;
  fgts_depositado: number;
  multa_fgts: number;
  desconto_inss: number;
  desconto_irrf: number;
  desconto_aviso: number;
  /** Fase 3 (migr. 321) — histórico da folha + acertos de fidelidade. */
  media_variaveis?: number;
  ferias_periodos_dobro?: number;
  data_projetada?: string | null;
  fgts_origem?: 'real' | 'simulado';
  desconto_inss_13?: number;
  desconto_irrf_13?: number;
  total_bruto: number;
  total_descontos: number;
  total_liquido: number;
};

const brl = (n: any) =>
  `R$ ${Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtData = (s?: string | null) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const EMPTY = {
  funcionario_id: '',
  tipo: 'Sem justa causa' as Tipo,
  data_desligamento: '',
  aviso_previo: 'Indenizado',
  motivo: '',
};

const DesligamentosViewInner = ({ showToast, profile, filial }: {
  showToast: any; profile: UserProfile; filial: FilialOp;
}) => {
  const { data: funcionarios, isLoading: loadingFn, reload: reloadFunc } =
    useFetchData<any>('/api/funcionariosview', { filial });
  // includeInactive: readmissão inativa a linha, e o histórico de readmitidos
  // é justamente o que some se deixarmos o filtro padrão agir.
  const { data: demissoes, isLoading: loadingD, reload: reloadDem } =
    useFetchData<any>('/api/demissoesview', { filial }, false, { includeInactive: true });
  const { data: rescisoes, reload: reloadResc } =
    useFetchData<any>('/api/rescisoesview', { filial }, false, { includeInactive: true });

  const confirm = useConfirm();

  const [form, setForm] = useState({ ...EMPTY, data_desligamento: todayBR() });
  const [preview, setPreview] = useState<Rescisao | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [acaoId, setAcaoId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<{ nome: string; r: any } | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [aba, setAba] = useState<AbaDesl | null>(null);

  // A decisão continua sendo da Matriz (migr. 307), mas a instrução do
  // processo passou a ser da filial (migr. 318): RH ou gerência montam a
  // solicitação — colaborador, tipo, data, aviso, motivo — e admin/CEO
  // aprovam ou recusam. Sem isso o aluno de RH nunca operava a tela.
  const podeDecidir = profile?.role === 'admin' || profile?.role === 'ceo';
  const podeSolicitar = !podeDecidir && (hasSetor(profile, 'rh') || profile?.role === 'gerente');
  const podeMontarProcesso = podeDecidir || podeSolicitar;
  const podeProcessar = hasSetor(profile, 'rh') || podeDecidir;

  const desligadosIds = useMemo(
    () => new Set((demissoes ?? []).filter((d: any) => d.ativo).map((d: any) => d.funcionario_id)),
    [demissoes],
  );

  const ativos = useMemo(
    () => (funcionarios ?? [])
      .filter((f: any) => (f.status ?? 'Ativo') === 'Ativo' && !desligadosIds.has(f.id))
      .sort((a: any, b: any) =>
        (a.nome ?? '').trim().localeCompare((b.nome ?? '').trim(), 'pt-BR', { sensitivity: 'base' })),
    [funcionarios, desligadosIds],
  );

  const rescisaoDe = (demissaoId: string) =>
    (rescisoes ?? []).find((r: any) => r.demissao_id === demissaoId && r.ativo);

  // Preview do cálculo: recalcula sozinho a cada mudança que altera o valor.
  // A RPC é STABLE e não grava nada — chamar a cada tecla do motivo seria
  // desperdício, então o motivo fica fora das dependências.
  useEffect(() => {
    let cancelado = false;
    const { funcionario_id, tipo, data_desligamento, aviso_previo } = form;

    if (!supabase || !funcionario_id || !data_desligamento) {
      setPreview(null);
      return;
    }

    setCalculando(true);
    (async () => {
      const { data, error } = await supabase.rpc('calcular_rescisao', {
        p_funcionario_id: funcionario_id,
        p_tipo:           tipo,
        p_data:           data_desligamento,
        p_aviso_previo:   aviso_previo,
      });
      if (cancelado) return;
      if (error) {
        setPreview(null);
        showToast(error.message, 'error');
      } else {
        setPreview(data as Rescisao);
      }
      setCalculando(false);
    })();

    return () => { cancelado = true; };
  }, [form.funcionario_id, form.tipo, form.data_desligamento, form.aviso_previo]);

  // Troca de tipo pode invalidar o aviso escolhido (justa causa não tem aviso).
  const setTipo = (tipo: Tipo) => {
    const opcoes = AVISOS_POR_TIPO[tipo];
    setForm(f => ({
      ...f,
      tipo,
      aviso_previo: opcoes.includes(f.aviso_previo) ? f.aviso_previo : opcoes[0],
    }));
  };

  const handleDesligar = async () => {
    if (!supabase) return;
    if (!form.funcionario_id) { showToast('Selecione o colaborador.', 'error'); return; }
    if (!form.motivo.trim())  { showToast('Escreva o motivo do desligamento.', 'error'); return; }

    const nome = ativos.find((f: any) => f.id === form.funcionario_id)?.nome ?? 'o colaborador';
    const liquido = preview ? brl(preview.total_liquido) : 'a calcular';

    const ok = await confirm(
      podeDecidir
        ? `Desligar ${nome}?\n\n` +
          `Tipo: ${form.tipo}\n` +
          `Rescisão líquida: ${liquido}\n\n` +
          `O acesso à plataforma continua, mas ele não poderá mais lançar nem editar nada. ` +
          `A ação é reversível pela readmissão.`
        : `Enviar a solicitação de desligamento de ${nome} para a Matriz?\n\n` +
          `Tipo: ${form.tipo}\n` +
          `Rescisão estimada: ${liquido}\n\n` +
          `Nada acontece com ${nome} até admin ou CEO aprovarem: ele continua ativo e com acesso normal.`
    );
    if (!ok) return;

    setSalvando(true);
    try {
      // Mesma tela, dois caminhos: Matriz efetiva na hora, filial instrui e
      // espera. O RPC de solicitação não toca em funcionário nem em acesso.
      const { data, error } = podeDecidir
        ? await supabase.rpc('demitir_funcionario', {
            p_funcionario_id: form.funcionario_id,
            p_tipo:           form.tipo,
            p_motivo:         form.motivo.trim(),
            p_data:           form.data_desligamento,
            p_aviso_previo:   form.aviso_previo,
          })
        : await supabase.rpc('solicitar_desligamento', {
            p_funcionario_id: form.funcionario_id,
            p_tipo:           form.tipo,
            p_motivo:         form.motivo.trim(),
            p_data:           form.data_desligamento,
            p_aviso_previo:   form.aviso_previo,
          });
      if (error) throw error;

      const res = data as any;
      if (podeDecidir) {
        showToast(
          `${res?.funcionario ?? nome} desligado.` +
          (res?.acesso_cortado ? ' O acesso foi encerrado.' : ' (sem login vinculado — só o registro em RH)'),
          'success',
        );
      } else {
        showToast(`Solicitação enviada. ${res?.funcionario ?? nome} segue ativo até a Matriz decidir.`, 'success');
      }
      setForm({ ...EMPTY, data_desligamento: todayBR() });
      setPreview(null);
      setFormAberto(false);
      setAba(podeDecidir ? 'desligados' : 'pendentes');
      await Promise.all([reloadDem(), reloadResc(), reloadFunc()]);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao registrar.', 'error', true);
    } finally {
      setSalvando(false);
    }
  };

  const handleDecidir = async (d: any, aprovar: boolean) => {
    if (!supabase) return;
    const ok = await confirm(
      aprovar
        ? `Aprovar o desligamento de ${d.nome_funcionario}?\n\n` +
          `Solicitado por ${d.solicitado_por_nome ?? d.filial}.\n` +
          `A rescisão é calculada e gravada agora, e o acesso dele é encerrado.`
        : `Recusar o desligamento de ${d.nome_funcionario}?\n\n` +
          `A solicitação é encerrada e ${d.nome_funcionario} continua ativo, sem nenhum efeito.`
    );
    if (!ok) return;

    setAcaoId(d.id);
    try {
      const { data, error } = await supabase.rpc('decidir_desligamento', {
        p_demissao_id: d.id,
        p_aprovar:     aprovar,
      });
      if (error) throw error;
      const res = data as any;
      showToast(
        aprovar
          ? `${res?.funcionario ?? d.nome_funcionario} desligado.` +
            (res?.acesso_cortado ? ' O acesso foi encerrado.' : ' (sem login vinculado)')
          : 'Solicitação recusada.',
        'success',
      );
      await Promise.all([reloadDem(), reloadResc(), reloadFunc()]);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao decidir.', 'error', true);
    } finally {
      setAcaoId(null);
    }
  };

  const handleReadmitir = async (d: any) => {
    if (!supabase) return;
    const r = rescisaoDe(d.id);
    const aviso = r?.status === 'Paga'
      ? '\n\nATENÇÃO: a rescisão já foi paga e creditada no MaxBank. A readmissão NÃO estorna esse valor — o acerto é manual, pela carteira.'
      : '';
    if (!await confirm(`Readmitir ${d.nome_funcionario ?? 'o colaborador'}?\n\nO acesso volta imediatamente.${aviso}`)) return;

    setAcaoId(d.id);
    try {
      const { error } = await supabase.rpc('readmitir_funcionario', { p_funcionario_id: d.funcionario_id });
      if (error) throw error;
      showToast('Readmitido — acesso devolvido.', 'success');
      await Promise.all([reloadDem(), reloadResc(), reloadFunc()]);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao readmitir.', 'error', true);
    } finally {
      setAcaoId(null);
    }
  };

  const handleProcessar = async (d: any) => {
    if (!supabase) return;
    const r = rescisaoDe(d.id);
    if (!r) { showToast('Rescisão não encontrada.', 'error'); return; }
    if (!await confirm(`Processar a rescisão de ${d.nome_funcionario}?\n\nGera Conta a Pagar de ${brl(r.total_liquido)} no Financeiro.`)) return;

    setAcaoId(d.id);
    try {
      const { data, error } = await supabase.rpc('processar_rescisao', { p_rescisao_id: r.id });
      if (error) throw error;
      const res = data as any;
      showToast(`Conta a Pagar de ${brl(res?.valor)} gerada em ${res?.filial}.`, 'success');
      await reloadResc();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao processar.', 'error', true);
    } finally {
      setAcaoId(null);
    }
  };

  if (loadingFn || loadingD) return <LoadingSpinner />;

  // `status` só existe a partir da migr. 318. Enquanto ela não roda na turma a
  // coluna vem undefined — tratamos como 'Aprovado' para a tela não esvaziar.
  const statusDe = (d: any) => d.status ?? 'Aprovado';
  const pendentes = (demissoes ?? []).filter((d: any) => d.ativo && statusDe(d) === 'Solicitado');
  const ativas = (demissoes ?? []).filter((d: any) => d.ativo && statusDe(d) === 'Aprovado');
  const readmitidos = (demissoes ?? []).filter((d: any) => !d.ativo && statusDe(d) !== 'Recusado');
  const recusados = (demissoes ?? []).filter((d: any) => !d.ativo && statusDe(d) === 'Recusado');
  const aProcessar = ativas.filter((d: any) => rescisaoDe(d.id)?.status === 'Pendente').length;

  const ABAS: { id: AbaDesl; label: string; cor: CorAba; n: number; icon: any }[] = [
    { id: 'pendentes',   label: 'Aguardando decisão', cor: 'amarelo', n: pendentes.length,   icon: Hourglass },
    { id: 'desligados',  label: 'Desligados',         cor: 'vermelho', n: ativas.length,     icon: UserMinus },
    { id: 'readmitidos', label: 'Readmitidos',        cor: 'verde',   n: readmitidos.length, icon: RotateCcw },
    { id: 'recusados',   label: 'Recusadas',          cor: 'cinza',   n: recusados.length,   icon: Ban },
  ];
  // Sem escolha do usuário, abre onde há trabalho: a fila, se tiver alguém nela.
  const abaAtiva: AbaDesl = aba ?? (pendentes.length > 0 ? 'pendentes' : 'desligados');

  const fecharForm = () => { setFormAberto(false); setForm({ ...EMPTY, data_desligamento: todayBR() }); setPreview(null); };

  const TipoBadge = ({ tipo }: { tipo: string }) => (
    <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${TIPO_SOLIDO[tipo] ?? 'bg-zinc-600 text-white'}`}>
      {tipo}
    </span>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Desligamento</h2>
        {podeMontarProcesso && (
          <button type="button" onClick={() => setFormAberto(true)} className="btn-solido btn-solido--vermelho !py-2.5 !px-5 !text-sm">
            <UserMinus size={15} /> {podeDecidir ? 'Registrar desligamento' : 'Solicitar desligamento'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CardContador label="Aguardando decisão" value={pendentes.length} tom="amarelo" onClick={() => setAba('pendentes')} ativo={abaAtiva === 'pendentes'} />
        <CardContador label="Desligados" value={ativas.length} tom="vermelho" onClick={() => setAba('desligados')} ativo={abaAtiva === 'desligados'} />
        <CardContador label="Rescisões a processar" value={aProcessar} tom="laranja" onClick={() => setAba('desligados')} />
        <CardContador label="Readmitidos" value={readmitidos.length} tom="verde" onClick={() => setAba('readmitidos')} ativo={abaAtiva === 'readmitidos'} />
      </div>

      <div className="flex gap-3 flex-wrap" role="tablist">
        {ABAS.map(a => (
          <AbaComContador key={a.id} label={a.label} n={a.n} cor={a.cor} icon={a.icon}
            ativa={abaAtiva === a.id} onClick={() => setAba(a.id)} alerta={a.id === 'pendentes' && podeDecidir && a.n > 0} />
        ))}
      </div>

      {/* ── Fila de aprovação ──────────────────────────────────────────── */}
      {abaAtiva === 'pendentes' && (
        pendentes.length === 0 ? <EmptyState message="Nenhuma solicitação aguardando a Matriz." /> : (
          <div className="neu-flat rounded-2xl p-4 sm:p-5 border border-white/5 overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse min-w-[860px]">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="text-center">Colaborador</th>
                  <th className="text-center w-40">Tipo</th>
                  <th className="text-center w-28">Data</th>
                  <th className="text-center w-28">Aviso</th>
                  <th className="text-center">Motivo</th>
                  <th className="text-center w-px">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pendentes.map((d: any) => {
                  const busy = acaoId === d.id;
                  return (
                    <tr key={d.id} className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                      <td className="py-3 px-3 min-w-[12rem]">
                        <span className="block text-sm font-semibold text-gray-100">{d.nome_funcionario ?? '—'}</span>
                        <span className="block text-[11px] text-gray-500">pedido por {d.solicitado_por_nome ?? '—'}</span>
                      </td>
                      <td className="py-3 px-3 text-center"><TipoBadge tipo={d.tipo} /></td>
                      <td className="py-3 px-3 text-center text-xs font-mono text-gray-300">{fmtData(d.data_desligamento)}</td>
                      <td className="py-3 px-3 text-center text-xs text-gray-300">{d.aviso_previo}</td>
                      <td className="py-3 px-3 text-center">
                        <span className="text-xs text-gray-400 line-clamp-2 max-w-[22rem] mx-auto" title={d.motivo}>{d.motivo}</span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                          {podeDecidir ? (
                            <>
                              <button onClick={() => handleDecidir(d, true)} disabled={busy}
                                title="Aprovar — calcula a rescisão e encerra o acesso" aria-label="Aprovar desligamento"
                                className="action-btn-verde disabled:opacity-50">
                                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                              </button>
                              <button onClick={() => handleDecidir(d, false)} disabled={busy}
                                title="Recusar — o colaborador segue ativo" aria-label="Recusar desligamento"
                                className="action-btn-vermelho disabled:opacity-50">
                                <Ban size={13} />
                              </button>
                            </>
                          ) : <StatusBadge status="Pendente" />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Desligados ─────────────────────────────────────────────────── */}
      {abaAtiva === 'desligados' && (
        ativas.length === 0 ? <EmptyState message="Nenhum colaborador desligado nesta unidade." /> : (
          <div className="neu-flat rounded-2xl p-4 sm:p-5 border border-white/5 overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="text-center">Colaborador</th>
                  <th className="text-center w-40">Tipo</th>
                  <th className="text-center w-28">Data</th>
                  <th className="text-center">Motivo</th>
                  <th className="text-center w-36">Líquido</th>
                  <th className="text-center w-32">Rescisão</th>
                  <th className="text-center w-px">Ações</th>
                </tr>
              </thead>
              <tbody>
                {ativas.map((d: any) => {
                  const r = rescisaoDe(d.id);
                  const busy = acaoId === d.id;
                  return (
                    <tr key={d.id} className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                      <td className="py-3 px-3 min-w-[12rem]">
                        <span className="block text-sm font-semibold text-gray-100">{d.nome_funcionario ?? '—'}</span>
                        <span className="block text-[11px] text-gray-500">decidido por {d.decidido_por_nome ?? '—'}</span>
                      </td>
                      <td className="py-3 px-3 text-center"><TipoBadge tipo={d.tipo} /></td>
                      <td className="py-3 px-3 text-center text-xs font-mono text-gray-300">{fmtData(d.data_desligamento)}</td>
                      <td className="py-3 px-3 text-center">
                        <span className="text-xs text-gray-400 line-clamp-2 max-w-[18rem] mx-auto" title={d.motivo}>{d.motivo}</span>
                      </td>
                      <td className="py-3 px-3 text-center text-sm font-bold text-green-400 tabular-nums whitespace-nowrap">{r ? brl(r.total_liquido) : '—'}</td>
                      <td className="py-3 px-3 text-center">{r ? <StatusBadge status={r.status} /> : <span className="text-gray-600 text-xs">—</span>}</td>
                      <td className="py-3 px-3">
                        <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                          {r && (
                            <button onClick={() => setDetalhe({ nome: d.nome_funcionario, r })}
                              title="Ver demonstrativo" aria-label="Ver demonstrativo" className="action-btn-neutral">
                              <FileText size={13} />
                            </button>
                          )}
                          {r?.status === 'Pendente' && podeProcessar && (
                            <button onClick={() => handleProcessar(d)} disabled={busy}
                              title="Processar — gera a conta a pagar no Financeiro" aria-label="Processar rescisão"
                              className="action-btn-purple disabled:opacity-50">
                              {busy ? <Loader2 size={13} className="animate-spin" /> : <DollarSign size={13} />}
                            </button>
                          )}
                          {podeDecidir && (
                            <MenuMais>
                              {fechar => (
                                <ItemMenu onClick={() => { fechar(); handleReadmitir(d); }} disabled={busy}
                                  cor="text-emerald-400 hover:bg-emerald-500/10" icon={RotateCcw}>
                                  Readmitir
                                </ItemMenu>
                              )}
                            </MenuMais>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {(abaAtiva === 'readmitidos' || abaAtiva === 'recusados') && (() => {
        const lista = abaAtiva === 'readmitidos' ? readmitidos : recusados;
        if (lista.length === 0) {
          return <EmptyState message={abaAtiva === 'readmitidos' ? 'Ninguém readmitido nesta unidade.' : 'Nenhuma solicitação recusada.'} />;
        }
        return (
          <div className="neu-flat rounded-2xl p-4 sm:p-5 border border-white/5 overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="text-center">Colaborador</th>
                  <th className="text-center w-40">Tipo</th>
                  <th className="text-center w-28">Desligamento</th>
                  <th className="text-center">{abaAtiva === 'readmitidos' ? 'Observação' : 'Motivo da solicitação'}</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((d: any) => (
                  <tr key={d.id} className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                    <td className="py-3 px-3 text-sm font-semibold text-gray-100">{d.nome_funcionario ?? '—'}</td>
                    <td className="py-3 px-3 text-center"><TipoBadge tipo={d.tipo} /></td>
                    <td className="py-3 px-3 text-center text-xs font-mono text-gray-300">{fmtData(d.data_desligamento)}</td>
                    <td className="py-3 px-3 text-center">
                      <span className="text-xs text-gray-400 line-clamp-2 max-w-[28rem] mx-auto" title={d.observacao ?? d.motivo}>{d.observacao ?? d.motivo}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ── Formulário ─────────────────────────────────────────────────── */}
      <ModalFormulario
        aberto={formAberto && podeMontarProcesso}
        largura="xl"
        titulo={podeDecidir ? 'Registrar desligamento' : 'Solicitar desligamento'}
        subtitulo={podeDecidir ? 'efetiva na hora' : 'vai para a decisão da Matriz'}
        onCancelar={fecharForm}
        cancelarDesabilitado={salvando}
        acoes={
          <button type="button" onClick={handleDesligar} disabled={salvando || !form.funcionario_id || !form.motivo.trim()}
            className="btn-solido btn-solido--vermelho">
            {podeDecidir ? <UserMinus size={14} /> : <Send size={14} />}
            {salvando ? (podeDecidir ? 'Registrando…' : 'Enviando…') : podeDecidir ? 'Registrar desligamento' : 'Enviar à Matriz'}
          </button>
        }
        lateral={
          <SecaoFormulario titulo="Demonstrativo" icon={Calculator} cor="verde"
            extra={calculando ? <Loader2 size={12} className="animate-spin" /> : undefined}>
            {preview ? <Demonstrativo r={preview} /> : (
              <p className="text-xs text-gray-500 text-center py-6">Escolha o colaborador e a data para ver o cálculo.</p>
            )}
          </SecaoFormulario>
        }
      >
        <SecaoFormulario titulo="Colaborador" icon={UserMinus} cor="vermelho">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Colaborador *">
              <SelectBusca
                value={form.funcionario_id}
                onChange={v => setForm(f => ({ ...f, funcionario_id: v }))}
                placeholder="Escolha o colaborador"
                opcoes={ativos.map((f: any) => opcaoFuncionario(f))}
              />
            </FormField>
            <FormField label="Data do desligamento *">
              <input type="date" value={form.data_desligamento} max={todayBR()}
                onChange={e => setForm(f => ({ ...f, data_desligamento: e.target.value }))}
                className="neu-input px-3 py-2.5 rounded-xl text-sm" />
            </FormField>
          </div>
        </SecaoFormulario>

        <SecaoFormulario titulo="Tipo e aviso prévio" icon={FileText} cor="azul">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {TIPOS.map(t => (
                <button key={t} type="button" onClick={() => setTipo(t)} aria-pressed={form.tipo === t}
                  title={TIPO_RESUMO[t]}
                  className={`btn-solido justify-center !py-3 ${TIPO_BOTAO[t]} ${form.tipo === t ? 'aba-ativa' : 'opacity-45 hover:opacity-75'}`}>
                  {t}
                </button>
              ))}
            </div>
            <FormField label="Aviso prévio">
              <div className="flex flex-wrap gap-2">
                {AVISOS_POR_TIPO[form.tipo].map(a => (
                  <button key={a} type="button" onClick={() => setForm(f => ({ ...f, aviso_previo: a }))} aria-pressed={form.aviso_previo === a}
                    className={`py-2 px-4 rounded-xl text-xs font-bold border transition-colors ${form.aviso_previo === a
                      ? 'bg-accent border-accent text-black' : 'neu-button border-transparent text-gray-400 hover:text-gray-200'}`}>
                    {a}
                  </button>
                ))}
              </div>
            </FormField>
          </div>
        </SecaoFormulario>

        <SecaoFormulario titulo="Motivo" icon={MessageSquareText} cor="laranja">
          <textarea
            value={form.motivo}
            onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
            placeholder="Descreva o motivo do desligamento"
            className="neu-input w-full px-3 py-2.5 rounded-xl text-sm resize-none campo-cresce"
          />
        </SecaoFormulario>
      </ModalFormulario>

      {/* ── Modal do demonstrativo ─────────────────────────────────────── */}
      <AnimatePresence>
        {detalhe && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setDetalhe(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="neu-flat rounded-3xl p-6 border border-white/10 max-w-md w-full max-h-[85vh] overflow-y-auto sem-barra"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-accent">Demonstrativo de Rescisão</h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">{detalhe.nome}</p>
                </div>
                <button onClick={() => setDetalhe(null)} className="modal-close-btn">
                  <X size={16} />
                </button>
              </div>
              <Demonstrativo r={detalhe.r} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/** Extrato das verbas. Usado no preview do formulário e no modal da lista. */
function Demonstrativo({ r }: { r: any }) {
  return (
    <div className="space-y-2 text-xs">
      <Linha label="Salário base" value={brl(r.salario_base)} muted />
      {/* Média de variáveis (migr. 321): horas extras dos últimos 12 meses.
          Sem esta linha, férias e 13º não reconciliariam com o salário base. */}
      {Number(r.media_variaveis) > 0 && (
        <>
          <Linha label="Média de variáveis (12 meses)" value={brl(r.media_variaveis)} colorClass="text-blue-400" />
          <Linha label="Remuneração (base + média)" value={brl(Number(r.salario_base) + Number(r.media_variaveis))} />
        </>
      )}
      {r.meses_trabalhados != null && (
        <Linha label="Tempo de casa" value={`${r.meses_trabalhados} meses`} muted />
      )}
      {r.dias_aviso > 0 && <Linha label="Dias de aviso prévio" value={`${r.dias_aviso} dias`} muted />}
      {/* Aviso indenizado integra o tempo de serviço (art. 487 §1º). */}
      {r.data_projetada && r.data_projetada !== r.data_desligamento && (
        <Linha label="Saída projetada pelo aviso" value={fmtData(r.data_projetada)} colorClass="text-blue-400" />
      )}

      <div className="border-t border-white/5 my-3" />
      <Linha label="Saldo de salário" value={brl(r.saldo_salario)} />
      <Linha label="Aviso prévio" value={brl(r.aviso_previo_valor)} />
      <Linha label="13º proporcional" value={brl(r.decimo_terceiro)} />
      <Linha
        label={Number(r.ferias_periodos_dobro) > 0
          ? `Férias vencidas (${r.ferias_periodos_dobro} em dobro)`
          : 'Férias vencidas'}
        value={brl(r.ferias_vencidas)}
      />
      <Linha label="Férias proporcionais" value={brl(r.ferias_proporcionais)} />
      <Linha label="1/3 constitucional" value={brl(r.terco_ferias)} />
      <Linha label="Multa do FGTS" value={brl(r.multa_fgts)} colorClass="text-blue-400" />
      <Linha label="Total bruto" value={brl(r.total_bruto)} bold />

      <div className="border-t border-white/5 my-3" />
      {/* 13º tem tributação exclusiva na fonte: a parte dele vai no título. */}
      <Linha label="INSS" value={`- ${brl(r.desconto_inss)}`} colorClass="text-red-400"
        title={Number(r.desconto_inss_13) > 0 ? `Inclui ${brl(r.desconto_inss_13)} sobre o 13º, em base separada.` : undefined} />
      <Linha label="IRRF" value={`- ${brl(r.desconto_irrf)}`} colorClass="text-red-400"
        title={Number(r.desconto_irrf_13) > 0 ? `Inclui ${brl(r.desconto_irrf_13)} sobre o 13º, em base separada.` : undefined} />
      {Number(r.desconto_aviso) > 0 && (
        <Linha label="Aviso não cumprido" value={`- ${brl(r.desconto_aviso)}`} colorClass="text-red-400" />
      )}
      <Linha label="Total de descontos" value={`- ${brl(r.total_descontos)}`} colorClass="text-red-400" />

      <div className="rounded-xl bg-green-600 text-white px-3 py-2.5 mt-3 flex items-center justify-between gap-3">
        <span className="text-[11px] font-black uppercase tracking-widest">Líquido a receber</span>
        <span className="text-base font-black tabular-nums">{brl(r.total_liquido)}</span>
      </div>

      {/* FGTS não entra no líquido: é saque na Caixa. `fgts_origem` diz se veio
          da folha (migr. 321) ou do fallback simulado da 306. */}
      <Linha label={`FGTS depositado (${r.fgts_origem === 'real' ? 'folha' : 'simulado'}, fora do líquido)`}
        value={brl(r.fgts_depositado)} muted />
      {r.vigencia_tabela && (
        <Linha label="Tabelas INSS/IRRF" value={`vigência ${r.vigencia_tabela}${(r.dependentes ?? 0) > 0 ? ` · ${r.dependentes} dep.` : ''}`} muted />
      )}
    </div>
  );
}

function Linha({ label, value, colorClass, muted, bold, title }: {
  label: string; value: string; colorClass?: string; muted?: boolean; bold?: boolean; title?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3" title={title}>
      <span className={`${muted ? 'text-gray-500' : 'text-gray-400'} ${bold ? 'font-bold' : ''}`}>{label}</span>
      <span className={`font-mono tabular-nums ${colorClass ?? (muted ? 'text-gray-500' : 'text-gray-200')} ${bold ? 'font-bold' : ''}`}>
        {value}
      </span>
    </div>
  );
}

export const DesligamentosView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <DesligamentosViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
