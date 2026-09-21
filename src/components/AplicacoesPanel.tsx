import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PiggyBank, Plus, X, TrendingUp, Lock, CalendarClock, Landmark, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NeuButtonAccent } from './ui';
import { useFetchData } from '../hooks/useSupabaseData';
import { formatBRL, parseBRL } from '../lib/viewUtils';
import { projetarResgate, calcularResgate } from '../lib/aplicacoes';
import type { UserProfile } from '../hooks/useUserProfile';

// Painel de aplicações da migr. 604, compartilhado pela Matriz e pela filial:
// a holding aplica o capital próprio exatamente como a loja aplica o caixa
// dela, e duplicar a tela daria duas versões da mesma regra para manter.
//
// O que a unidade decide aqui é a troca liquidez × retorno — quem paga mais
// prende o dinheiro (carência) e prazo curto paga mais IR. Por isso a tela
// mostra a projeção ANTES do clique: sem ela, escolher banco vira sorteio.

export type BancoInvestimento = {
  id: string;
  nome: string;
  produto: string;
  taxa_mensal: number;
  pct_cdi: number | null;
  carencia_meses: number;
  isento_ir: boolean;
  ativo: boolean;
  ordem: number;
};

export type Aplicacao = {
  id: string;
  filial: string;
  banco_investimento_id: string;
  banco_nome: string;
  produto: string;
  conta_id: string | null;
  conta_nome: string | null;
  valor_aplicado: number;
  taxa_mensal: number;
  carencia_meses: number;
  isento_ir: boolean;
  meses_rendidos: number;
  rendimento_bruto: number;
  status: 'Aplicada' | 'Resgatada';
  resgatado_em: string | null;
  ir_retido: number | null;
  valor_resgatado: number | null;
  observacao: string | null;
  aplicado_por_nome: string | null;
  created_at: string;
};

type Conta = { id: string; banco: string; conta: string; filial: string | null; saldo: number | null };

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// 0.86 -> '0,86'. Espelho do public.pct_br() do banco: a mesma taxa não pode
// aparecer com ponto numa tela e com vírgula na mensagem da RPC.
const PCT = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
// Taxa de banco se escreve com duas casas ('0,80% a.m.', não '0,8%'); alíquota
// de IR, não ('22,5%').
const TAXA = (v: number) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AplicacoesPanel({
  filial, profile, showToast, onMovimentou,
}: {
  filial: string;
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
  // A tela de cima recarrega saldo/capital: aplicar e resgatar mexem no caixa.
  onMovimentou?: () => void;
}) {
  const [modalAplicar, setModalAplicar] = useState(false);
  const [resgateAlvo, setResgateAlvo] = useState<Aplicacao | null>(null);

  const { data: bancosRaw = [] } =
    useFetchData<BancoInvestimento>('bancos_investimento', { ativo: true }, false);
  // `useFetchData` ordena por created_at desc e a semente da 604 grava os 5
  // no mesmo instante — a ordem viria embaralhada. `ordem` é a coluna que
  // existe justamente para a praça aparecer sempre igual.
  const bancos = useMemo(
    () => [...bancosRaw].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)),
    [bancosRaw],
  );
  const { data: aplicacoes = [], reload } =
    useFetchData<Aplicacao>('aplicacoes_financeiras', { filial }, false);
  const { data: contas = [], reload: reloadContas } =
    useFetchData<Conta>('caixa_bancos', { status: 'Ativo' }, false);

  // Conta sem filial é global/legada e serve a qualquer unidade (régua da 325).
  const contasDaUnidade = contas.filter(c => !c.filial || c.filial === filial);

  // `role === 'admin'` literal, o mesmo que a RPC cobra: ceo e conselheiro são
  // alunos, e destravar carência é ato de professor.
  const ehProfessor = profile?.role === 'admin';

  const vivas = aplicacoes.filter(a => a.status === 'Aplicada');
  const resgatadas = aplicacoes.filter(a => a.status === 'Resgatada');
  const totalAplicado = vivas.reduce((s, a) => s + Number(a.valor_aplicado), 0);
  const totalRendendo = vivas.reduce((s, a) => s + Number(a.rendimento_bruto), 0);

  const recarregar = () => { reload(); reloadContas(); onMovimentou?.(); };

  return (
    <div className="flex flex-col gap-4">
      <div className="neu-flat rounded-3xl p-5 border border-accent/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <PiggyBank size={15} className="text-accent" />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Aplicações — {filial}
            </span>
          </div>
          <button
            onClick={() => setModalAplicar(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
          >
            <Plus size={12} /> Aplicar
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[10px] uppercase tracking-widest text-gray-500">Aplicado</span>
            <p className="text-2xl font-black text-accent tabular-nums mt-0.5">{BRL(totalAplicado)}</p>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-widest text-gray-500">Rendimento acumulado</span>
            <p className="text-2xl font-black text-green-400 tabular-nums mt-0.5">{BRL(totalRendendo)}</p>
          </div>
        </div>

        {/* O fluxo inteiro em quatro passos. Sem isto a tela vira um formulário
            sem história: o aluno aplica, não vê número nenhum aparecer (o mês
            não fechou) e conclui que está quebrado. */}
        <ol className="text-[11px] text-gray-500 mt-4 leading-relaxed flex flex-col gap-1 list-decimal list-inside">
          <li>A Matriz define a taxa e a carência de cada banco.</li>
          <li>A unidade aplica: o valor <strong className="text-gray-400">sai do caixa</strong> e fica preso — não paga fornecedor nem folha.</li>
          <li>A direção fecha o mês; o rendimento só cresce nesses fechamentos.</li>
          <li>No resgate volta o principal + o rendimento, já <strong className="text-gray-400">descontado o IR</strong>, e o rendimento entra como receita financeira.</li>
        </ol>
      </div>

      {/* A praça: o que cada banco oferece hoje */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
          Onde aplicar
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
          {bancos.map(b => (
            <div key={b.id} className="neu-pressed rounded-2xl p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-gray-100">{b.nome}</span>
                <span className="text-sm font-black text-green-400 tabular-nums">
                  {TAXA(b.taxa_mensal)}% a.m.
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-500">
                <span className="px-1.5 py-0.5 rounded-full bg-white/5">{b.produto}</span>
                {b.pct_cdi != null && <span>{Number(b.pct_cdi).toFixed(0)}% do CDI</span>}
                {b.carencia_meses > 0
                  ? <span className="flex items-center gap-0.5 text-amber-400">
                      <Lock size={9} /> carência {b.carencia_meses}m
                    </span>
                  : <span className="text-sky-400">resgate imediato</span>}
                {b.isento_ir && <span className="text-green-400">isento de IR</span>}
              </div>
            </div>
          ))}
          {bancos.length === 0 && (
            <p className="text-sm text-gray-500">
              Nenhum banco cadastrado. A Matriz define a praça em Capital &gt; Configuração.
            </p>
          )}
        </div>
      </div>

      {/* Contratos vivos */}
      {vivas.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Aplicado agora ({vivas.length})
          </span>
          {vivas.map(a => {
            const preso = a.meses_rendidos < a.carencia_meses;
            const r = calcularResgate(
              Number(a.valor_aplicado), Number(a.rendimento_bruto),
              a.meses_rendidos, a.isento_ir,
            );
            return (
              <div key={a.id} className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-100">{a.banco_nome}</p>
                    <p className="text-[11px] text-gray-500">
                      {a.produto} · {TAXA(a.taxa_mensal)}% a.m. ·{' '}
                      {a.meses_rendidos} mês(es) fechado(s)
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-black text-gray-100 tabular-nums">
                      {BRL(Number(a.valor_aplicado))}
                    </p>
                    <p className="text-[11px] font-bold text-green-400 tabular-nums">
                      + {BRL(Number(a.rendimento_bruto))}
                    </p>
                  </div>
                </div>
                {a.meses_rendidos === 0 && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1">
                    <CalendarClock size={10} className="shrink-0" />
                    Ainda não rendeu: o rendimento aparece quando a direção fechar o mês.
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-500">
                    {preso
                      ? `Preso por mais ${a.carencia_meses - a.meses_rendidos} fechamento(s) de mês`
                      : a.isento_ir
                        ? `Resgate livre · isento de IR · volta ${BRL(r.creditado)}`
                        : `Resgate livre · IR ${PCT(r.irPct)}% · volta ${BRL(r.creditado)}`}
                  </span>
                  {/* O professor destrava a carência (a RPC aceita role='admin'
                      literal). Para todo mundo o botão fica travado, e o motivo
                      está escrito ao lado — botão morto sem explicação é o que
                      faz o aluno achar que o sistema quebrou. */}
                  <button
                    onClick={() => setResgateAlvo(a)}
                    disabled={preso && !ehProfessor}
                    className={`text-xs px-3 py-1.5 rounded-xl border transition-colors ${
                      preso && !ehProfessor
                        ? 'text-gray-600 border-white/5 cursor-not-allowed'
                        : preso
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                          : 'bg-accent/10 text-accent border-accent/20 hover:bg-accent/20'
                    }`}
                  >
                    {preso
                      ? ehProfessor
                        ? <span className="flex items-center gap-1"><Lock size={11} /> Resgatar antecipado</span>
                        : <span className="flex items-center gap-1"><Lock size={11} /> Em carência</span>
                      : 'Resgatar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {vivas.length === 0 && (
        <div className="neu-pressed rounded-2xl p-5 text-center">
          <p className="text-sm text-gray-500">
            Nada aplicado. Caixa parado não rende — mas dinheiro aplicado não paga conta.
          </p>
        </div>
      )}

      {/* Histórico */}
      {resgatadas.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Resgatadas ({resgatadas.length})
          </span>
          {resgatadas.map(a => (
            <div key={a.id} className="neu-flat rounded-2xl p-3 border border-white/5 flex items-center justify-between gap-3 opacity-70">
              <div>
                <p className="text-xs font-bold text-gray-300">{a.banco_nome}</p>
                <p className="text-[10px] text-gray-500">
                  {BRL(Number(a.valor_aplicado))} por {a.meses_rendidos} mês(es)
                  {a.ir_retido != null && Number(a.ir_retido) > 0
                    ? ` · IR R$ ${Number(a.ir_retido).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                    : ' · isento de IR'}
                </p>
              </div>
              <p className="text-sm font-bold text-green-400 tabular-nums">
                {a.valor_resgatado != null ? BRL(Number(a.valor_resgatado)) : '—'}
              </p>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {modalAplicar && (
          <ModalAplicar
            filial={filial} bancos={bancos} contas={contasDaUnidade} profile={profile}
            onClose={() => setModalAplicar(false)}
            onSaved={recarregar} showToast={showToast}
          />
        )}
        {resgateAlvo && (
          <ModalResgatar
            aplicacao={resgateAlvo} contas={contasDaUnidade}
            onClose={() => setResgateAlvo(null)}
            onSaved={recarregar} showToast={showToast}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Modal: aplicar ─────────────────────────────────────────────────────────
function ModalAplicar({
  filial, bancos, contas, onClose, onSaved, showToast,
}: {
  filial: string; bancos: BancoInvestimento[]; contas: Conta[];
  profile: UserProfile | null;
  onClose: () => void; onSaved: () => void; showToast: (m: string, t?: string) => void;
}) {
  const [bancoId, setBancoId] = useState(bancos[0]?.id ?? '');
  const [contaId, setContaId] = useState(contas[0]?.id ?? '');

  // As duas listas chegam por fetch, e o modal pode abrir antes delas. O
  // inicializador do useState roda UMA vez: sem isto o select mostraria a
  // primeira opção (o navegador faz isso quando o value não casa com nenhuma)
  // enquanto o estado seguia vazio — o usuário via o banco escolhido e levava
  // "Escolha o banco." ao clicar em Aplicar.
  useEffect(() => {
    if (!bancoId && bancos.length > 0) setBancoId(bancos[0].id);
  }, [bancos, bancoId]);
  useEffect(() => {
    if (!contaId && contas.length > 0) setContaId(contas[0].id);
  }, [contas, contaId]);
  const [valorStr, setValorStr] = useState('');
  const [meses, setMeses] = useState('6');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);

  const banco = bancos.find(b => b.id === bancoId) ?? null;
  const conta = contas.find(c => c.id === contaId) ?? null;
  const valor = parseBRL(valorStr);
  const saldo = Number(conta?.saldo ?? 0);
  const semSaldo = valor > 0 && valor > saldo;

  const projecao = useMemo(() => {
    if (!banco || valor <= 0) return null;
    return projetarResgate(valor, Number(banco.taxa_mensal), parseInt(meses) || 0, banco.isento_ir);
  }, [banco, valor, meses]);

  const handleSalvar = async () => {
    if (!supabase) return;
    if (!banco) { showToast('Escolha o banco.', 'error'); return; }
    if (!contaId) { showToast('Escolha a conta de onde sai o dinheiro.', 'error'); return; }
    if (valor <= 0) { showToast('Informe um valor válido.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('aplicar_em_banco', {
        p_filial: filial,
        p_banco_investimento_id: bancoId,
        p_conta_id: contaId,
        p_valor: valor,
        p_observacao: obs.trim() || null,
      });
      if (error) throw error;
      showToast(`Aplicado em ${banco.nome}. O valor saiu do caixa e passa a render a cada fechamento de mês.`, 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao aplicar.', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-100">Aplicar — {filial}</h2>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Banco *</label>
          <select
            value={bancoId} onChange={e => setBancoId(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
          >
            {bancos.map(b => (
              <option key={b.id} value={b.id} className="bg-gray-900">
                {b.nome} — {b.produto} · {TAXA(b.taxa_mensal)}% a.m.
                {b.carencia_meses > 0 ? ` · carência ${b.carencia_meses}m` : ''}
                {b.isento_ir ? ' · isento' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Sai da conta *</label>
          <select
            value={contaId} onChange={e => setContaId(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
          >
            <option value="" className="bg-gray-900">Selecione…</option>
            {contas.map(c => (
              <option key={c.id} value={c.id} className="bg-gray-900">
                {c.banco} — {c.conta} ({BRL(Number(c.saldo ?? 0))})
              </option>
            ))}
          </select>
          {contas.length === 0 && (
            <p className="text-[11px] text-amber-400 mt-1">
              Esta unidade não tem conta ativa. Cadastre uma em Caixa / Bancos.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Valor (R$) *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-bold">R$</span>
            <input
              type="text" inputMode="numeric" value={valorStr}
              onChange={e => setValorStr(formatBRL(e.target.value))}
              className="neu-pressed rounded-xl pl-9 pr-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none w-full tabular-nums"
              placeholder="0,00"
            />
          </div>
          {semSaldo && (
            <p className="text-[11px] text-red-400 mt-1">
              A conta tem {BRL(saldo)} — aplicar não cria dinheiro.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Simular quantos meses?
          </label>
          <input
            type="number" min="0" max="60" value={meses}
            onChange={e => setMeses(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
          />
        </div>

        {projecao && banco && (
          <div className="neu-pressed rounded-2xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <TrendingUp size={12} className="text-accent" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Se resgatar em {parseInt(meses) || 0} mês(es)
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="text-gray-500">Rendimento bruto</span>
              <span className="text-right font-bold text-gray-200 tabular-nums">{BRL(projecao.bruto)}</span>
              <span className="text-gray-500">
                {banco.isento_ir ? 'IR (isento)' : `IR (${PCT(projecao.irPct)}%)`}
              </span>
              <span className="text-right font-bold text-red-300 tabular-nums">− {BRL(projecao.ir)}</span>
              <span className="text-gray-500">Volta para a conta</span>
              <span className="text-right font-black text-green-400 tabular-nums">{BRL(projecao.creditado)}</span>
            </div>
            {banco.carencia_meses > 0 && (
              <p className="text-[10px] text-amber-400 flex items-center gap-1">
                <Lock size={9} /> {banco.nome} só libera resgate depois de {banco.carencia_meses} mês(es).
              </p>
            )}
            <p className="text-[10px] text-gray-500 flex items-start gap-1">
              <CalendarClock size={10} className="shrink-0 mt-0.5" />
              O mês só passa quando a direção fecha o mês das aplicações.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Observação</label>
          <textarea
            value={obs} onChange={e => setObs(e.target.value)} rows={2}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="Ex.: sobra de caixa do mês, reserva para a reforma…"
          />
        </div>

        <NeuButtonAccent onClick={handleSalvar} isLoading={saving} disabled={semSaldo || !contaId}>
          <Landmark size={15} /> Aplicar
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Modal: resgatar ────────────────────────────────────────────────────────
function ModalResgatar({
  aplicacao, contas, onClose, onSaved, showToast,
}: {
  aplicacao: Aplicacao; contas: Conta[];
  onClose: () => void; onSaved: () => void; showToast: (m: string, t?: string) => void;
}) {
  const [contaId, setContaId] = useState(aplicacao.conta_id ?? contas[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  const r = calcularResgate(
    Number(aplicacao.valor_aplicado), Number(aplicacao.rendimento_bruto),
    aplicacao.meses_rendidos, aplicacao.isento_ir,
  );
  const antecipado = aplicacao.meses_rendidos < aplicacao.carencia_meses;

  const handleResgatar = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('resgatar_aplicacao', {
        p_aplicacao_id: aplicacao.id,
        p_conta_destino_id: contaId || null,
      });
      if (error) throw error;
      showToast(`Resgatado: ${BRL(r.creditado)} de volta no caixa.`, 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao resgatar.', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-sm border border-accent/20 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-100">Resgatar de {aplicacao.banco_nome}</h2>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        {antecipado && (
          <div className="neu-pressed rounded-xl p-3 flex items-start gap-2 text-[11px] text-amber-300 border border-amber-500/30">
            <Lock size={12} className="shrink-0 mt-0.5" />
            Resgate antecipado: {aplicacao.banco_nome} pede {aplicacao.carencia_meses} mês(es)
            e este contrato tem {aplicacao.meses_rendidos}. Só a direção destrava, e o
            histórico registra que foi antecipado.
          </div>
        )}

        <div className="neu-pressed rounded-2xl p-4 grid grid-cols-2 gap-2 text-xs">
          <span className="text-gray-500">Principal</span>
          <span className="text-right font-bold text-gray-200 tabular-nums">
            {BRL(Number(aplicacao.valor_aplicado))}
          </span>
          <span className="text-gray-500">Rendimento em {aplicacao.meses_rendidos} mês(es)</span>
          <span className="text-right font-bold text-green-300 tabular-nums">{BRL(r.bruto)}</span>
          <span className="text-gray-500">
            {aplicacao.isento_ir ? 'IR (isento)' : `IR (${PCT(r.irPct)}%)`}
          </span>
          <span className="text-right font-bold text-red-300 tabular-nums">− {BRL(r.ir)}</span>
          <span className="text-gray-500 font-bold">Vai para a conta</span>
          <span className="text-right font-black text-accent tabular-nums">{BRL(r.creditado)}</span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Conta de destino</label>
          <select
            value={contaId} onChange={e => setContaId(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
          >
            {contas.map(c => (
              <option key={c.id} value={c.id} className="bg-gray-900">{c.banco} — {c.conta}</option>
            ))}
          </select>
        </div>

        <div className="neu-pressed rounded-xl p-3 flex items-start gap-2 text-[11px] text-gray-400">
          <Info size={12} className="shrink-0 text-accent mt-0.5" />
          O principal volta como saldo; o rendimento entra como receita financeira em
          Contas a Receber, já líquido de IR. Resgate é do contrato inteiro.
        </div>

        <NeuButtonAccent onClick={handleResgatar} isLoading={saving}>Resgatar</NeuButtonAccent>
      </motion.div>
    </div>
  );
}
