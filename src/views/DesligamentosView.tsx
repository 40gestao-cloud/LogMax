import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useMemo, useState, useEffect } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import {
  UserMinus, X, Calculator, RotateCcw, FileText, Loader2, AlertTriangle, DollarSign, CheckCircle, Clock,
  Check, Ban, Send, Hourglass,
} from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { hasSetor } from '../lib/rbac';
import { useConfirm } from '../contexts/ConfirmContext';
import type { UserProfile } from '../hooks/useUserProfile';

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

const TIPO_BADGE: Record<string, string> = {
  'Sem justa causa':    'bg-blue-500/10   text-blue-400   border-blue-500/20',
  'Com justa causa':    'bg-red-500/10    text-red-400    border-red-500/20',
  'Pedido de demissão': 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Acordo':             'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

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

const statusCls = (s: string) =>
  s === 'Paga' ? 'text-green-400' : s === 'Processada' ? 'text-blue-400' : 'text-yellow-400';

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

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Desligamento</h2>
      </div>

      {/* ── Formulário ─────────────────────────────────────────────────── */}
      {podeMontarProcesso ? (
        <div className="neu-flat rounded-3xl p-5 sm:p-6 border border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <UserMinus size={16} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-300">
              {podeDecidir ? 'Registrar desligamento' : 'Solicitar desligamento'}
            </h3>
          </div>
          <p className="text-[11px] text-gray-500 mb-5 leading-relaxed">
            {podeDecidir
              ? 'Como Matriz, o registro é efetivado na hora — sem passar pela fila de aprovação.'
              : 'A unidade monta o processo e a Matriz decide. Até a aprovação de admin/CEO nada muda para o colaborador: ele segue ativo e com acesso normal.'}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Colaborador</label>
              <select
                value={form.funcionario_id}
                onChange={e => setForm(f => ({ ...f, funcionario_id: e.target.value }))}
                className="neu-input w-full px-3 py-2.5 rounded-xl text-sm"
              >
                <option value="">Selecione…</option>
                {ativos.map((f: any) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}{f.cargo ? ` — ${f.cargo}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Data do desligamento</label>
              <input
                type="date"
                value={form.data_desligamento}
                max={todayBR()}
                onChange={e => setForm(f => ({ ...f, data_desligamento: e.target.value }))}
                className="neu-input w-full px-3 py-2.5 rounded-xl text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Tipo de desligamento</label>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {TIPOS.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipo(t)}
                    className={`px-3 py-2 rounded-xl text-[11px] font-bold border transition text-left ${
                      form.tipo === t
                        ? TIPO_BADGE[t] + ' ring-1 ring-inset ring-white/10'
                        : 'border-white/5 text-gray-500 hover:text-gray-300 hover:border-white/15'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {/* A explicação é metade do conteúdo: o aluno precisa ver POR QUE
                  um tipo rende menos que o outro, não só o total no fim. */}
              <p className="text-[11px] text-gray-500 leading-relaxed mt-2">{TIPO_RESUMO[form.tipo]}</p>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">Aviso prévio</label>
              <select
                value={form.aviso_previo}
                onChange={e => setForm(f => ({ ...f, aviso_previo: e.target.value }))}
                className="neu-input w-full px-3 py-2.5 rounded-xl text-sm"
              >
                {AVISOS_POR_TIPO[form.tipo].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">
                Motivo <span className="text-accent">*</span>
              </label>
              <textarea
                rows={3}
                value={form.motivo}
                onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                placeholder="Descreva o motivo. Fica registrado com seu nome e a data."
                className="neu-input w-full px-3 py-2.5 rounded-xl text-sm resize-none"
              />
            </div>
          </div>

          {/* Preview do cálculo */}
          {(calculando || preview) && (
            <div className="mt-5 rounded-2xl border border-white/5 p-4 bg-white/[0.02]">
              <div className="flex items-center gap-2 mb-3">
                <Calculator size={13} className="text-accent" />
                <h4 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Demonstrativo da rescisão</h4>
                {calculando && <Loader2 size={12} className="animate-spin text-gray-500" />}
              </div>
              {preview && <Demonstrativo r={preview} />}
            </div>
          )}

          <div className="flex justify-end mt-5">
            <NeuButtonAccent variant="" onClick={handleDesligar} disabled={salvando || !form.funcionario_id || !form.motivo.trim()}>
              {salvando
                ? (podeDecidir ? 'Registrando…' : 'Enviando…')
                : podeDecidir
                  ? 'Registrar desligamento'
                  : <><Send size={13} /> Enviar para aprovação da Matriz</>}
            </NeuButtonAccent>
          </div>
        </div>
      ) : (
        <div className="neu-flat rounded-2xl p-4 border border-white/5 flex items-start gap-3">
          <AlertTriangle size={15} className="text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400 leading-relaxed">
            O processo de desligamento é montado pelo RH ou pela gerência da unidade e decidido por admin/CEO —
            a mesma régua de "quem instrui não decide" que vale para afastamentos e compras. Você pode
            acompanhar e processar as rescisões abaixo.
          </p>
        </div>
      )}

      {/* ── Fila de aprovação ──────────────────────────────────────────── */}
      {pendentes.length > 0 && (
        <div className="neu-flat rounded-3xl p-5 sm:p-6 border border-yellow-400/20">
          <div className="flex items-center gap-2 mb-1">
            <Hourglass size={15} className="text-yellow-400" />
            <h3 className="text-sm font-bold text-gray-300">Aguardando decisão da Matriz</h3>
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
              {pendentes.length}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mb-4">
            {podeDecidir
              ? 'Aprovar calcula e grava a rescisão e encerra o acesso. Recusar encerra a solicitação sem nenhum efeito.'
              : 'Enquanto está aqui, o colaborador segue ativo e com acesso normal.'}
          </p>
          <div className="flex flex-col gap-2">
            {pendentes.map((d: any) => {
              const busy = acaoId === d.id;
              return (
                <div key={d.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-200">{d.nome_funcionario ?? '—'}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${TIPO_BADGE[d.tipo] ?? ''}`}>{d.tipo}</span>
                      <span className="text-[10px] font-mono text-gray-500">{fmtData(d.data_desligamento)}</span>
                      <span className="text-[10px] text-gray-500">aviso: {d.aviso_previo}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 leading-snug">{d.motivo}</p>
                    <p className="text-[10px] text-gray-600 mt-1">
                      Solicitado por {d.solicitado_por_nome ?? '—'} · {d.filial}
                    </p>
                  </div>
                  {podeDecidir && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleDecidir(d, true)} disabled={busy}
                        className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-500/30 hover:ring-emerald-500 flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />} Aprovar
                      </button>
                      <button
                        onClick={() => handleDecidir(d, false)} disabled={busy}
                        className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-red-300 ring-1 ring-red-500/30 hover:ring-red-500 flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Ban size={12} /> Recusar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Desligados ─────────────────────────────────────────────────── */}
      <div className="neu-flat rounded-3xl p-5 sm:p-6 border border-white/5">
        <h3 className="text-sm font-bold text-gray-300 mb-4">Desligados</h3>
        {ativas.length === 0 ? (
          <EmptyState message="Nenhum colaborador desligado nesta unidade." />
        ) : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse min-w-[820px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-3 font-bold px-3">Colaborador</th>
                  <th className="pb-3 font-bold px-3">Tipo</th>
                  <th className="pb-3 font-bold px-3">Data</th>
                  <th className="pb-3 font-bold px-3">Motivo</th>
                  <th className="pb-3 font-bold px-3 text-right">Líquido</th>
                  <th className="pb-3 font-bold px-3 text-center">Rescisão</th>
                  <th className="pb-3 font-bold px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {ativas.map((d: any) => {
                  const r = rescisaoDe(d.id);
                  const busy = acaoId === d.id;
                  return (
                    <tr key={d.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-3">
                        <div className="text-sm font-semibold text-gray-200">{d.nome_funcionario ?? '—'}</div>
                        <div className="text-[10px] text-gray-600">por {d.decidido_por_nome ?? '—'}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${TIPO_BADGE[d.tipo] ?? ''}`}>
                          {d.tipo}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs font-mono text-gray-400">{fmtData(d.data_desligamento)}</td>
                      <td className="py-3 px-3 text-xs text-gray-400 max-w-[240px] truncate" title={d.motivo}>{d.motivo}</td>
                      <td className="py-3 px-3 text-xs font-mono text-green-400 text-right">{r ? brl(r.total_liquido) : '—'}</td>
                      <td className="py-3 px-3 text-center">
                        {r ? (
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase ${statusCls(r.status)}`}>
                            {r.status === 'Paga' ? <CheckCircle size={11} /> : r.status === 'Processada' ? <DollarSign size={11} /> : <Clock size={11} />}
                            {r.status}
                          </span>
                        ) : <span className="text-gray-700 text-xs">—</span>}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex justify-center items-center gap-1.5">
                          {(r || podeDecidir) && (
                            <MenuMais>
                              {fechar => (
                                <>
                                  {r && (
                                    <ItemMenu onClick={() => { fechar(); setDetalhe({ nome: d.nome_funcionario, r }); }}
                                      cor="text-gray-200 hover:bg-white/5" icon={FileText}>
                                      Ver demonstrativo
                                    </ItemMenu>
                                  )}
                                  {r?.status === 'Pendente' && podeProcessar && (
                                    <ItemMenu onClick={() => { fechar(); handleProcessar(d); }} disabled={busy}
                                      cor="text-purple-300 hover:bg-purple-500/10" icon={DollarSign}>
                                      Processar (gera conta a pagar)
                                    </ItemMenu>
                                  )}
                                  {podeDecidir && (
                                    <ItemMenu onClick={() => { fechar(); handleReadmitir(d); }} disabled={busy}
                                      cor="text-emerald-400 hover:bg-emerald-500/10" icon={RotateCcw}>
                                      Readmitir
                                    </ItemMenu>
                                  )}
                                </>
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
        )}

        {readmitidos.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2">Readmitidos</p>
            <div className="flex flex-col gap-1">
              {readmitidos.map((d: any) => (
                <div key={d.id} className="flex items-center gap-3 text-xs text-gray-500 px-2 py-1.5 rounded-lg hover:bg-white/5">
                  <RotateCcw size={11} className="text-emerald-500 shrink-0" />
                  <span className="text-gray-400 font-semibold">{d.nome_funcionario}</span>
                  <span className="font-mono">{fmtData(d.data_desligamento)}</span>
                  <span className="truncate flex-1">{d.observacao ?? d.motivo}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {recusados.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2">Solicitações recusadas</p>
            <div className="flex flex-col gap-1">
              {recusados.map((d: any) => (
                <div key={d.id} className="flex items-center gap-3 text-xs text-gray-500 px-2 py-1.5 rounded-lg hover:bg-white/5">
                  <Ban size={11} className="text-red-500 shrink-0" />
                  <span className="text-gray-400 font-semibold">{d.nome_funcionario}</span>
                  <span className="font-mono">{fmtData(d.data_desligamento)}</span>
                  <span className="truncate flex-1">{d.observacao ?? d.motivo}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="neu-flat rounded-2xl p-4 border border-white/5">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">O que o desligamento faz</p>
        <p className="text-xs text-gray-400 leading-relaxed mb-2">
          A unidade instrui o processo (RH ou gerência) e a Matriz decide (admin/CEO). Solicitação pendente não
          tem efeito nenhum: o colaborador segue ativo. Tudo abaixo só acontece na aprovação.
        </p>
        <p className="text-xs text-gray-400 leading-relaxed">
          O acesso não é revogado: o colaborador continua entrando e vê um aviso de encerramento de vínculo.
          O que ele perde é a escrita — as funções de RBAC deixam de reconhecer o perfil, então nenhuma tela
          aceita lançamento ou edição dele. Processar a rescisão gera Conta a Pagar no Financeiro; quando o
          Financeiro quita, a carteira MaxBank é creditada e a rescisão vira Paga.
        </p>
        <p className="text-xs text-gray-500 leading-relaxed mt-2">
          O cálculo das verbas é didático e simplificado — FGTS é simulado a 8% ao mês e as tabelas de
          INSS/IRRF são fixas. Não serve para rescisão real.
        </p>
      </div>

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
              className="neu-flat rounded-3xl p-6 border border-white/10 max-w-md w-full max-h-[85vh] overflow-y-auto main-scrollbar"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-accent">Demonstrativo de Rescisão</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">{detalhe.nome}</p>
                </div>
                <button onClick={() => setDetalhe(null)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
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
      {/* Aviso indenizado integra o tempo de serviço: a saída projeta e pode
          render mais um avo de 13º e de férias (art. 487 §1º). */}
      {r.data_projetada && r.data_projetada !== r.data_desligamento && (
        <Linha label="Saída projetada pelo aviso" value={fmtData(r.data_projetada)} colorClass="text-blue-400" />
      )}

      <div className="border-t border-white/5 my-3" />
      <Linha label="Saldo de salário" value={brl(r.saldo_salario)} />
      <Linha label="Aviso prévio" value={brl(r.aviso_previo_valor)} />
      <Linha label="13º proporcional" value={brl(r.decimo_terceiro)} />
      <Linha
        label={Number(r.ferias_periodos_dobro) > 0
          ? `Férias vencidas (${r.ferias_periodos_dobro} período(s) em dobro)`
          : 'Férias vencidas'}
        value={brl(r.ferias_vencidas)}
      />
      <Linha label="Férias proporcionais" value={brl(r.ferias_proporcionais)} />
      <Linha label="1/3 constitucional" value={brl(r.terco_ferias)} />
      <Linha label="Multa do FGTS" value={brl(r.multa_fgts)} colorClass="text-blue-400" />
      <Linha label="Total bruto" value={brl(r.total_bruto)} bold />

      <div className="border-t border-white/5 my-3" />
      <Linha label="INSS" value={`- ${brl(r.desconto_inss)}`} colorClass="text-red-400" />
      <Linha label="IRRF" value={`- ${brl(r.desconto_irrf)}`} colorClass="text-red-400" />
      {/* 13º tem tributação exclusiva na fonte: base própria, INSS e IRRF
          próprios. Mostrar a parcela dele explica por que o total não bate
          com uma conta feita sobre saldo + 13º somados. */}
      {(Number(r.desconto_inss_13) > 0 || Number(r.desconto_irrf_13) > 0) && (
        <p className="text-[10px] text-gray-600 leading-relaxed">
          Do total acima, {brl(r.desconto_inss_13)} de INSS e {brl(r.desconto_irrf_13)} de IRRF incidiram
          sobre o 13º, em base separada do saldo de salário (tributação exclusiva na fonte).
        </p>
      )}
      {Number(r.desconto_aviso) > 0 && (
        <Linha label="Aviso não cumprido" value={`- ${brl(r.desconto_aviso)}`} colorClass="text-red-400" />
      )}
      <Linha label="Total de descontos" value={`- ${brl(r.total_descontos)}`} colorClass="text-red-400" />

      <div className="border-t border-white/5 my-3" />
      <Linha label="Líquido a receber" value={brl(r.total_liquido)} colorClass="text-green-400" bold />

      {/* FGTS não entra no líquido: é saque na Caixa, não pagamento da empresa.
          Mostrar sem somar evita a leitura de que o valor está faltando. */}
      {/* `fgts_origem` = 'real' quando somado das competências da folha
          (migr. 321); 'simulado' é o fallback da 306, para funcionário sem
          folha recalculada. Dizer qual foi evita a pergunta "esse número veio
          de onde?" seis meses depois. */}
      <p className="text-[10px] text-gray-600 leading-relaxed pt-2">
        FGTS depositado no período: {brl(r.fgts_depositado)} —{' '}
        {r.fgts_origem === 'real'
          ? 'somado das competências da folha'
          : 'valor simulado (sem folha recalculada para este colaborador)'}
        , sacado na Caixa e fora do líquido acima. A multa, essa sim, é paga pela empresa e já está somada.
      </p>
      {/* Vigência vem da migr. 319: as faixas saem de `rh_faixas` pela data do
          desligamento, não mais escritas no corpo da função. */}
      {r.vigencia_tabela && (
        <p className="text-[10px] text-gray-600 leading-relaxed">
          Tabelas de INSS e IRRF da vigência {r.vigencia_tabela}, escolhida pela data do desligamento
          {(r.dependentes ?? 0) > 0 ? ` · ${r.dependentes} dependente(s) deduzido(s) no IRRF` : ''}.
        </p>
      )}
    </div>
  );
}

function Linha({ label, value, colorClass, muted, bold }: {
  label: string; value: string; colorClass?: string; muted?: boolean; bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`${muted ? 'text-gray-600' : 'text-gray-400'} ${bold ? 'font-bold' : ''}`}>{label}</span>
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
