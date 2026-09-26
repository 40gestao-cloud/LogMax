import { useRolarAteFormulario } from '../hooks/useRolarAteFormulario';
import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Upload, X, Lock, Unlock, ShieldAlert, ShieldCheck, PiggyBank, Landmark, Wallet, ArrowLeftRight, Ban, RotateCcw } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, BancoThumb } from '../components/ui';
import {
  BANCO_LOGO_ACCEPT,
  BANCO_LOGO_MAX_LABEL,
  removerLogoAntiga,
  uploadLogoBanco,
  validarLogoBanco,
} from '../lib/bancoLogo';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import { bancoDaUnidade } from '../lib/filiais';
import type { UserProfile } from '../hooks/useUserProfile';
import { SelectBusca } from '../components/SelectBusca';
import { opcaoBanco } from '../lib/opcoesSelect';

const ENDPOINT = '/api/caixabancosview';
const TIPOS = ['Conta Corrente', 'Conta Poupança', 'Caixa', 'Investimento'];
const STATUS_OPCOES = ['Ativo', 'Inativo'];
const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;

// Sem `saldo`: ele não é campo de formulário desde a migr. 327 — só se move
// por lançamento (aporte, empréstimo, conta paga ou recebida). O privilégio
// de coluna no banco recusa qualquer INSERT/UPDATE que o mencione.
interface FormState {
  conta: string;
  banco: string;
  agencia: string;
  tipo: string;
  status: string;
  filial: string;
  is_reserva: boolean;
}

const EMPTY_FORM: FormState = {
  conta: '',
  banco: '',
  agencia: '',
  tipo: TIPOS[0],
  status: STATUS_OPCOES[0],
  // Só usado em modo Matriz — em modo filial a unidade vem da filial ativa.
  filial: 'Matriz',
  is_reserva: false,
};

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type SaldoCapital = {
  capital_total: number;
  saldo_livre: number;
  reserva_valor: number;
  reserva_pct: number;
};

type FilialCaixaConfig = {
  filial: string;
  bloqueado: boolean;
  updated_by_nome: string | null;
  updated_at: string;
};

function podeGerenciar(profile: UserProfile | null) {
  return profile?.role === 'admin' || profile?.role === 'ceo';
}

export const CaixaBancosView = ({
  showToast,
  profile,
}: {
  showToast: any;
  profile: UserProfile | null;
}) => {
  const { filialAtiva } = useFilial();
  const matrizMode = !filialAtiva;
  const confirm = useConfirm();

  // Unidade dona das contas nesta sessão. Sem filial ativa é a holding, que
  // desde a migr. 325 tem caixa/banco próprio gravado com filial='Matriz'.
  const unidade = filialAtiva ?? 'Matriz';

  // Em modo filial filtramos pelo filial do usuário
  const filialFiltro = filialAtiva ?? undefined;
  const extraFilter = filialFiltro ? { filial: filialFiltro } : undefined;

  const { data: dataAll, setData, isLoading } = useFetchData<any>(ENDPOINT, extraFilter);
  // `orderBy: 'filial'` porque a tabela não tem `created_at` — o default do
  // hook devolveria 400 e o painel de bloqueio ficaria vazio de novo.
  const { data: configs = [], reload: reloadConfigs } = useFetchData<FilialCaixaConfig>(
    'filial_caixa_config', undefined, false, { orderBy: 'filial', ascending: true },
  );

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [imagemUrl, setImagemUrl] = useState<string>('');
  const [imagemUrlAnterior, setImagemUrlAnterior] = useState<string>('');
  const [imagemUploading, setImagemUploading] = useState(false);
  const [togglingFilial, setTogglingFilial] = useState<string | null>(null);
  const imagemInputRef = useRef<HTMLInputElement | null>(null);

  // Transferência interna (migr. 328). Sem ela o dinheiro entra na unidade
  // pelo aporte e não sai do lugar — era o campo "Saldo" que fazia esse
  // remanejamento antes da 327.
  const [showTransf, setShowTransf] = useState(false);
  const [transfOrigem, setTransfOrigem] = useState('');
  const [transfDestino, setTransfDestino] = useState('');
  const [transfValor, setTransfValor] = useState('');
  const [transfSaving, setTransfSaving] = useState(false);

  // Config de bloqueio da filial ativa (modo filial)
  const configFilialAtiva = filialAtiva
    ? configs.find(c => c.filial === filialAtiva)
    : null;
  const bloqueado = configFilialAtiva?.bloqueado ?? false;

  // Em modo filial, filtramos no frontend também (RLS já filtra, mas garante).
  // Em modo Matriz a tabela mostra tudo — é a visão consolidada da holding —,
  // mas o resumo de capital abaixo olha só o que é da própria Matriz.
  const data = matrizMode
    ? dataAll
    : dataAll.filter((i: any) => bancoDaUnidade(i, unidade));
  const dataUnidade = dataAll.filter((i: any) => bancoDaUnidade(i, unidade));

  // Saldo capital da unidade. Usa a mesma RPC que a FilialCapitalView pra
  // evitar cálculo divergente — e ela aceita 'Matriz' desde a migr. 323, então
  // a holding também vê quanto do capital próprio já está distribuído.
  const [saldoCapital, setSaldoCapital] = useState<SaldoCapital | null>(null);
  useEffect(() => {
    if (!supabase) { setSaldoCapital(null); return; }
    let cancelled = false;
    supabase.rpc('calcular_saldo_capital', { p_filial: unidade }).then(({ data, error }) => {
      if (cancelled) return;
      if (!error && data?.[0]) setSaldoCapital(data[0]);
      else setSaldoCapital(null);
    });
    return () => { cancelled = true; };
  }, [unidade]);

  // Só contas ativas contam pro resumo (soft-delete respeitado), e só as da
  // unidade — em modo Matriz a tabela lista as três filiais junto.
  const ativasDaUnidade = dataUnidade.filter((i: any) => i.ativo !== false && i.status !== 'Inativo');
  const distribuidoTotal = ativasDaUnidade.reduce((s: number, i: any) => s + Number(i.saldo ?? 0), 0);
  const reservaTotal = ativasDaUnidade
    .filter((i: any) => i.is_reserva)
    .reduce((s: number, i: any) => s + Number(i.saldo ?? 0), 0);
  const disponivelOperacao = distribuidoTotal - reservaTotal;
  const capitalTotal = saldoCapital?.capital_total ?? 0;
  const sobraDistribuir = capitalTotal - distribuidoTotal;

  const filtered = data.filter((item: any) =>
    [item.conta, item.banco, item.agencia, item.tipo, item.filial].some(v =>
      String(v ?? '').toLowerCase().includes(search.toLowerCase()),
    ),
  );

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setImagemUrl('');
    setImagemUrlAnterior('');
    if (imagemInputRef.current) imagemInputRef.current.value = '';
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({
      conta: String(item.conta ?? ''),
      banco: String(item.banco ?? ''),
      agencia: String(item.agencia ?? ''),
      tipo: item.tipo ?? TIPOS[0],
      status: item.status ?? STATUS_OPCOES[0],
      filial: item.filial ?? '',
      is_reserva: !!item.is_reserva,
    });
    setImagemUrl(item.imagem_url ?? '');
    setImagemUrlAnterior(item.imagem_url ?? '');
    setErrors({});
    setShowForm(false);
  };

  const handleImagemChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validacao = validarLogoBanco(file);
    if (!validacao.ok) {
      showToast(validacao.motivo, 'error', true);
      e.target.value = '';
      return;
    }
    setImagemUploading(true);
    try {
      const url = await uploadLogoBanco(file, editItem?.id);
      setImagemUrl(url);
      showToast('Logo carregada!', 'success', true);
    } catch (err: any) {
      showToast(err?.message ?? 'Falha ao enviar logo.', 'error', true);
    } finally {
      setImagemUploading(false);
      e.target.value = '';
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.conta.trim()) e.conta = 'Obrigatório';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);

    // Filial do registro: em modo filial usa a filial ativa; em modo Matriz usa
    // o campo do form. String vazia só sobrevive ao editar uma conta legada
    // (filial NULL = global, de antes da coluna existir) — nesse caso a conta
    // continua global em vez de ser silenciosamente adotada pela holding, o
    // que a esconderia das filiais que a usam hoje. Ver migr. 325.
    const filialRegistro = matrizMode ? (form.filial || null) : filialAtiva;

    const payload: Record<string, any> = {
      conta: form.conta,
      banco: form.banco || null,
      agencia: form.agencia || null,
      tipo: form.tipo || null,
      status: form.status || 'Ativo',
      imagem_url: imagemUrl || null,
      filial: filialRegistro,
      is_reserva: form.is_reserva,
    };
    try {
      if (editItem) {
        const updated = await dbUpdate(ENDPOINT, editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        if (imagemUrlAnterior && imagemUrlAnterior !== imagemUrl) removerLogoAntiga(imagemUrlAnterior);
        showToast('Conta atualizada!', 'success', true);
      } else {
        const saved = await dbInsert(ENDPOINT, payload);
        setData((prev: any[]) => [saved ?? { id: Date.now(), ...payload }, ...prev]);
        showToast('Conta criada!', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const alternarStatus = async (item: any) => {
    const novo = item.status === 'Inativo' ? 'Ativo' : 'Inativo';
    try {
      const updated = await dbUpdate(ENDPOINT, item.id, { status: novo });
      setData((prev: any[]) => prev.map(d => d.id === item.id ? (updated ?? { ...d, status: novo }) : d));
      showToast(novo === 'Ativo' ? 'Conta reativada.' : 'Conta inativada — sai das listas de pagamento e transferência.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'não foi possível mudar o status'}`, 'error', true);
    }
  };

  const handleDelete = async (item: any) => {
    if (!await confirm('Excluir esta conta bancária?')) return;
    try {
      await dbDelete(ENDPOINT, item.id);
      setData((prev: any[]) => prev.filter(d => d.id !== item.id));
      if (item.imagem_url) removerLogoAntiga(item.imagem_url);
      showToast('Conta excluída.', 'success', true);
    } catch (err: any) {
      showToast(`Erro ao excluir: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  // Destino só entre contas da mesma unidade — a RPC recusa o resto, aqui é
  // só pra não oferecer o que vai dar erro. `IS DISTINCT FROM` do lado do
  // banco vira esta comparação com `??` porque a filial global é null.
  const contaOrigem = dataAll.find((b: any) => b.id === transfOrigem);
  const destinosPossiveis = dataAll.filter((b: any) =>
    b.id !== transfOrigem
    && b.ativo !== false && b.status !== 'Inativo'
    && contaOrigem && (b.filial ?? null) === (contaOrigem.filial ?? null),
  );
  const contasTransferiveis = dataAll.filter((b: any) => b.ativo !== false && b.status !== 'Inativo');
  const saldoOrigem = Number(contaOrigem?.saldo ?? 0);
  const transfValorNum = parseBRL(transfValor);
  const transfSemSaldo = !!transfOrigem && transfValorNum > saldoOrigem;

  const closeTransf = () => {
    setShowTransf(false);
    setTransfOrigem(''); setTransfDestino(''); setTransfValor('');
  };

  const handleTransferir = async () => {
    if (!supabase) return;
    if (!transfOrigem || !transfDestino) { showToast('Escolha origem e destino.', 'error', true); return; }
    if (transfValorNum <= 0) { showToast('Informe um valor maior que zero.', 'error', true); return; }
    setTransfSaving(true);
    try {
      const { data: res, error } = await supabase.rpc('transferir_entre_contas', {
        p_origem_id: transfOrigem,
        p_destino_id: transfDestino,
        p_valor: transfValorNum,
      });
      if (error) throw new Error(error.message);
      setData((prev: any[]) => prev.map((b: any) => {
        if (b.id === transfOrigem)  return { ...b, saldo: Number(b.saldo ?? 0) - transfValorNum };
        if (b.id === transfDestino) return { ...b, saldo: Number(b.saldo ?? 0) + transfValorNum };
        return b;
      }));
      const r = res as any;
      showToast(`R$ ${transfValorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de ${r?.origem ?? 'origem'} para ${r?.destino ?? 'destino'}.`, 'success', true);
      closeTransf();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao transferir.', 'error', true);
    } finally {
      setTransfSaving(false);
    }
  };

  const handleToggleBloqueio = async (filial: string, atual: boolean) => {
    if (!supabase) return;
    setTogglingFilial(filial);
    const { error } = await supabase.from('filial_caixa_config').update({
      bloqueado: !atual,
      updated_by: profile?.id ?? null,
      updated_by_nome: profile?.nome ?? null,
      updated_at: new Date().toISOString(),
    }).eq('filial', filial);
    if (error) showToast(error.message, 'error');
    else showToast(`${filial} ${!atual ? 'bloqueada' : 'desbloqueada'}.`, 'success');
    reloadConfigs();
    setTogglingFilial(null);
  };

  // Em modo Matriz a policy `caixa_bancos_insert` (migr. 196) só deixa passar
  // admin/CEO — conselheiro chega na tela mas o INSERT voltaria como erro de
  // RLS. Melhor não oferecer o botão do que oferecer e falhar.
  const canEdit = matrizMode ? podeGerenciar(profile) : (podeGerenciar(profile) || !bloqueado);
  const isFormOpen = showForm || !!editItem;

  const formEdicaoRef = useRolarAteFormulario(isFormOpen && canEdit, editItem?.id);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">

      {/* Banner de bloqueio (modo filial, não-admin) */}
      {!matrizMode && bloqueado && !podeGerenciar(profile) && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/30">
          <ShieldAlert size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-300">Caixa/Bancos bloqueado pela Matriz</p>
            <p className="text-xs text-red-400/70 mt-0.5">
              Apenas visualização. Para adicionar ou editar, solicite desbloqueio ao administrador.
            </p>
          </div>
        </div>
      )}

      {/* Painéis de bloqueio por filial (modo Matriz, admin/CEO) */}
      {matrizMode && podeGerenciar(profile) && (
        <div className="neu-flat rounded-2xl p-4 border border-accent/10 flex flex-col gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Bloqueio por Filial</span>
          <div className="grid grid-cols-3 gap-3">
            {FILIAIS.map(f => {
              const cfg = configs.find(c => c.filial === f);
              const est = cfg?.bloqueado ?? false;
              return (
                <button
                  key={f}
                  onClick={() => handleToggleBloqueio(f, est)}
                  disabled={togglingFilial === f}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors text-xs font-bold
                    ${est
                      ? 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                      : 'border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20'
                    } disabled:opacity-50`}
                >
                  <span>{f}</span>
                  {est ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-600">Bloqueado = filial só visualiza. Desbloqueado = filial pode adicionar/editar.</p>
        </div>
      )}

      {/* Card resumo — só em modo filial. Confronta o Capital Total aportado
          pela Matriz com o que já foi distribuido nas contas e o que está
          em reserva. Zerado se a Matriz ainda nao aportou nada. */}
      {saldoCapital && capitalTotal > 0 && (
        <div className="neu-flat rounded-2xl border border-accent/20 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Landmark size={14} className="text-accent" />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Distribuição do Capital — {unidade}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Capital Total</div>
              <p className="text-lg font-black text-accent tabular-nums">{fmtBRL(capitalTotal)}</p>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 flex items-center gap-1">
                <Wallet size={10} /> Distribuído
              </div>
              <p className="text-lg font-black text-gray-200 tabular-nums">{fmtBRL(distribuidoTotal)}</p>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 flex items-center gap-1">
                <PiggyBank size={10} /> Em Reserva
              </div>
              <p className="text-lg font-black text-yellow-300 tabular-nums">{fmtBRL(reservaTotal)}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">
                Disponível pra operar: <span className="text-gray-300 font-semibold tabular-nums">{fmtBRL(disponivelOperacao)}</span>
              </p>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                {sobraDistribuir >= 0 ? 'Sobra a distribuir' : 'Estouro'}
              </div>
              <p className={`text-lg font-black tabular-nums ${sobraDistribuir >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {fmtBRL(sobraDistribuir)}
              </p>
              {sobraDistribuir < 0 && (
                <p className="text-[10px] text-red-400/70 mt-0.5">Contas somam mais que o capital aportado.</p>
              )}
            </div>
          </div>
        </div>
      )}
      {saldoCapital && capitalTotal === 0 && (
        <div className="neu-flat rounded-2xl border border-white/5 p-4 flex items-start gap-3 text-xs text-gray-500">
          <Landmark size={14} className="text-gray-600 shrink-0 mt-0.5" />
          <span>
            {matrizMode
              ? <>A Matriz ainda não tem capital próprio registrado — lance o aporte da holding em <span className="text-accent font-semibold">Capital</span> pra ver aqui quanto dele já está nas contas.</>
              : <>Nenhum capital aportado pela Matriz pra <span className="text-gray-300 font-semibold">{filialAtiva}</span> ainda —
                  peça ao admin/CEO pra registrar o capital inicial em <span className="text-accent font-semibold">Matriz → Capital</span> pra ver a distribuição aqui.</>}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Caixa / Bancos</h2>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {canEdit && (
            <>
              <button
                onClick={() => { closeForm(); setShowTransf(v => !v); }}
                className="neu-button py-2.5 px-4 rounded-xl text-sm font-bold flex items-center gap-2 hover:text-accent transition-colors whitespace-nowrap"
              >
                <ArrowLeftRight size={15} /> Transferir
              </button>
              <NeuButtonAccent onClick={() => { closeTransf(); closeForm(); setShowForm(v => !v); }}>
                <Plus size={16} /> Nova
              </NeuButtonAccent>
            </>
          )}
        </div>
      </div>

      {/* Transferência interna — remaneja dinheiro entre contas da MESMA
          unidade. Entre unidades é aporte ou empréstimo, cada um com sua
          alçada, e a RPC recusa a tentativa. */}
      <AnimatePresence>
        {showTransf && canEdit && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-accent/20 flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                  <ArrowLeftRight size={14} className="text-accent" /> Transferir entre contas
                </h3>
                <p className="text-[11px] text-gray-500 mt-1">Entre contas da mesma unidade.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Sai de *">
                  <SelectBusca
                    value={transfOrigem}
                    onChange={v => { setTransfOrigem(v); setTransfDestino(''); }}
                    placeholder="Escolha a conta de origem"
                    opcoes={contasTransferiveis.map((b: any) => opcaoBanco(b, { saldo: true, filial: matrizMode }))}
                  />
                </FormField>
                <FormField label="Entra em *">
                  <SelectBusca
                    value={transfDestino}
                    onChange={setTransfDestino}
                    disabled={!transfOrigem}
                    placeholder={transfOrigem ? 'Escolha o destino' : 'Escolha a origem primeiro'}
                    opcoes={destinosPossiveis.map((b: any) => opcaoBanco(b, { filial: matrizMode }))}
                  />
                  {!!transfOrigem && destinosPossiveis.length === 0 && (
                    <span className="text-[10px] text-yellow-400 mt-1">
                      Esta unidade só tem uma conta ativa. Cadastre outra para poder remanejar.
                    </span>
                  )}
                </FormField>
                <FormField label="Valor (R$) *">
                  <input type="text" inputMode="numeric"
                    className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                    value={transfValor}
                    onChange={e => setTransfValor(formatBRL(e.target.value))}
                    onKeyDown={handleMoneyKeyDown}
                    placeholder="0,00" />
                  {transfSemSaldo && (
                    <span className="text-[10px] text-red-400 mt-1">
                      Saldo insuficiente: a conta tem {fmtBRL(saldoOrigem)}.
                    </span>
                  )}
                </FormField>
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={closeTransf} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleTransferir} isLoading={transfSaving}
                  disabled={transfSemSaldo || !transfOrigem || !transfDestino}>
                  <ArrowLeftRight size={14} /> Transferir
                </NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Formulário */}
      <AnimatePresence>
        {isFormOpen && canEdit && (
          <motion.div ref={formEdicaoRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Conta' : 'Nova Conta'}</h3>
              <p className="text-[11px] text-gray-500 -mt-2">Conta nova nasce com saldo R$ 0,00.</p>

              <div className="flex items-start gap-4 flex-wrap">
                <BancoThumb url={imagemUrl} size="lg" alt={form.banco || 'Banco'} />
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Logo do banco</label>
                  <div className="flex gap-2 items-center">
                    <input
                      ref={imagemInputRef}
                      type="file"
                      accept={BANCO_LOGO_ACCEPT}
                      onChange={handleImagemChange}
                      className="hidden"
                      id="logo-input"
                    />
                    <label htmlFor="logo-input" className="neu-button py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer hover:text-accent transition-colors">
                      <Upload size={12} /> {imagemUploading ? 'Enviando...' : 'Escolher logo'}
                    </label>
                    {imagemUrl && (
                      <button onClick={() => setImagemUrl('')} className="neu-button py-2 px-3 rounded-xl text-xs text-gray-500 flex items-center gap-1 hover:text-red-400 transition-colors">
                        <X size={11} /> Remover
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600">JPG, PNG, WEBP ou SVG · até {BANCO_LOGO_MAX_LABEL} · comprime auto para WebP 512 px (SVG sobe inalterado)</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Conta *" error={errors.conta}>
                  <input type="text" className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.conta ? 'border border-red-500/40' : ''}`}
                    value={form.conta}
                    onChange={e => { setForm(s => ({ ...s, conta: e.target.value })); setErrors(ev => { const n = { ...ev }; delete n.conta; return n; }); }}
                    placeholder="Ex: 12345-6" />
                </FormField>
                <FormField label="Banco">
                  <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.banco} onChange={e => setForm(s => ({ ...s, banco: e.target.value }))} placeholder="Ex: Banco do Brasil" />
                </FormField>
                <FormField label="Agência">
                  <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.agencia} onChange={e => setForm(s => ({ ...s, agencia: e.target.value }))} placeholder="Ex: 0001" />
                </FormField>
                <FormField label="Tipo">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.tipo} onChange={e => setForm(s => ({ ...s, tipo: e.target.value }))}>
                    {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FormField>
                <FormField label="Status">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.status} onChange={e => setForm(s => ({ ...s, status: e.target.value }))}>
                    {STATUS_OPCOES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </FormField>
                {/* Selector de unidade: só aparece em modo Matriz */}
                {matrizMode && (
                  <FormField label="Unidade dona da conta">
                    <select className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={form.filial} onChange={e => setForm(s => ({ ...s, filial: e.target.value }))}>
                      <option value="Matriz">Matriz (holding)</option>
                      {FILIAIS.map(f => <option key={f} value={f}>{f}</option>)}
                      {/* Só some quem já é global: conta anterior à coluna filial. */}
                      {editItem && !editItem.filial && (
                        <option value="">Global (legado — visível a todas)</option>
                      )}
                    </select>
                  </FormField>
                )}
              </div>

              {/* Flag reserva de emergencia — soma no card resumo do topo. */}
              <label className="flex items-start gap-3 neu-pressed rounded-xl p-3 cursor-pointer hover:bg-white/5 transition-colors">
                <input
                  type="checkbox"
                  checked={form.is_reserva}
                  onChange={e => setForm(s => ({ ...s, is_reserva: e.target.checked }))}
                  className="mt-0.5 accent-yellow-400 w-4 h-4"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-bold text-gray-200">
                    <PiggyBank size={14} className="text-yellow-300" />
                    Reserva de emergência
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5">Conta como "Em Reserva", fora do disponível.</p>
                </div>
              </label>

              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabela */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="tabela col-guia w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Logo</th>
                <th className="pb-4 font-bold px-4">Banco</th>
                <th className="pb-4 font-bold px-4">Conta</th>
                <th className="pb-4 font-bold px-4">Agência</th>
                <th className="pb-4 font-bold px-4">Tipo</th>
                {matrizMode && <th className="pb-4 font-bold px-4">Filial</th>}
                <th className="pb-4 font-bold px-4 text-right">Saldo</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? <tr><td colSpan={matrizMode ? 8 : 7}><LoadingSpinner /></td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={matrizMode ? 8 : 7}><EmptyState message="Nenhuma conta bancária cadastrada" /></td></tr>
                  : (
                    <AnimatePresence>
                      {filtered.map((item: any) => {
                        const itemBloqueado = item.filial
                          ? (configs.find(c => c.filial === item.filial)?.bloqueado ?? false)
                          : false;
                        const podeEditar = podeGerenciar(profile) || !itemBloqueado;
                        return (
                          <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                            className={`border-b border-white/5 hover:bg-white/5 transition-colors group ${item.status === 'Inativo' ? 'opacity-55' : ''}`}>
                            <td className="py-3 px-4">
                              <BancoThumb url={item.imagem_url} size="xs" alt={item.banco ?? item.conta ?? 'Banco'} />
                            </td>
                            <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                              {item.banco ?? '—'}
                              {/* Ativo/inativo não tem coluna: só o inativo se anuncia, e a troca mora no "⋯". */}
                              {item.status === 'Inativo' && (
                                <span className="ml-2 align-middle px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-zinc-600 text-white">Inativa</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.conta ?? '—'}</td>
                            <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.agencia ?? '—'}</td>
                            <td className="py-3 px-4 text-xs text-gray-400">
                              <div className="flex items-center gap-1.5">
                                {item.tipo ?? '—'}
                                {item.is_reserva && (
                                  <span title="Conta em reserva de emergência"
                                    className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded-full">
                                    <PiggyBank size={9} /> Reserva
                                  </span>
                                )}
                              </div>
                            </td>
                            {matrizMode && (
                              <td className="py-3 px-4">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  item.filial
                                    ? 'bg-accent/10 text-accent'
                                    : 'bg-white/5 text-gray-500'
                                }`}>
                                  {item.filial ?? 'Global'}
                                  {item.filial && itemBloqueado && (
                                    <Lock size={9} className="inline ml-1 text-red-400" />
                                  )}
                                </span>
                              </td>
                            )}
                            <td className={`py-3 px-4 text-xs font-mono text-right tabular-nums ${Number(item.saldo) < 0 ? 'text-red-500' : 'text-gray-200'}`}>
                              R$ {Number(item.saldo ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex justify-center items-center gap-1.5">
                                {podeEditar && (
                                  <button onClick={() => openEdit(item)} title="Editar" className="action-btn-edit"><Edit2 size={12} /></button>
                                )}
                                <MenuMais>
                                  {fechar => (
                                    <>
                                      <p className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-widest font-bold text-gray-500">
                                        Situação: <span className={item.status === 'Inativo' ? 'text-gray-300' : 'text-green-400'}>{item.status === 'Inativo' ? 'Inativa' : 'Ativa'}</span>
                                      </p>
                                      {podeEditar && (
                                        <ItemMenu onClick={() => { fechar(); alternarStatus(item); }}
                                          cor={item.status === 'Inativo' ? 'text-green-400 hover:bg-green-500/10' : 'text-gray-300 hover:bg-white/5'}
                                          icon={item.status === 'Inativo' ? RotateCcw : Ban}>
                                          {item.status === 'Inativo' ? 'Reativar conta' : 'Inativar conta'}
                                        </ItemMenu>
                                      )}
                                      <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="caixa_bancos" entidadeId={item.id} titulo={`${item.banco ?? 'Conta'} · ${item.conta ?? ''}`} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                                      {podeEditar && (
                                        <ItemMenu onClick={() => { fechar(); handleDelete(item); }}
                                          cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                                          Excluir
                                        </ItemMenu>
                                      )}
                                    </>
                                  )}
                                </MenuMais>
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};
