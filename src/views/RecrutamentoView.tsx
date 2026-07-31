import React, { useEffect, useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import {
  Briefcase, Plus, X, Users, CheckCircle, XCircle, ChevronDown, ChevronRight,
  UserPlus, ArrowRight, Loader2, Ban, AlertTriangle, KeyRound, Send, Paperclip,
} from 'lucide-react';
import { freshToken } from '../lib/authFetch';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, NeuButtonAccent } from '../components/ui';
import { hasSetor } from '../lib/rbac';
import { formatBRL, parseBRL } from '../lib/viewUtils';
import { todayBR } from '../lib/dates';
import { useConfirm } from '../contexts/ConfirmContext';
import type { UserProfile } from '../hooks/useUserProfile';

/**
 * Recrutamento & Seleção (migração 311, Fase 1).
 *
 * O ciclo de entrada do colaborador não tinha vaga nem candidato — era um
 * INSERT direto em Funcionários. Aqui: RH da filial pede headcount (vaga
 * nasce 'Aguardando Matriz'), só admin/CEO aprova ou nega — nunca quem pediu
 * —, e só depois de Aprovada é que a filial pode registrar candidaturas e
 * levá-las pelo funil até contratar. `efetivar_contratacao` é quem cria o
 * `funcionarios`, então esta tela NUNCA escreve na tabela de funcionários
 * diretamente.
 *
 * Fase 1 só cobre vaga Externa. Interno (promoção) muda role/filial de quem
 * já está no sistema e é decisão de Matriz por definição — fica para a Fase 2.
 */

const OUTRO = '__outro__';

const ETAPAS = ['Triagem', 'Entrevista', 'Teste', 'Aprovado', 'Reprovado'] as const;

const VAGA_STATUS_CLS: Record<string, string> = {
  'Aguardando Matriz': 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Aprovada':          'bg-accent/10 text-accent border-accent/20',
  'Negada':            'bg-red-500/10 text-red-500 border-red-500/20',
  'Preenchida':        'bg-green-500/10 text-green-400 border-green-500/20',
  'Cancelada':         'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

const CONVITE_CLS: Record<string, string> = {
  'Pendente':  'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Aceito':    'bg-green-500/10 text-green-400 border-green-500/20',
  'Recusado':  'bg-red-500/10 text-red-500 border-red-500/20',
  'Cancelado': 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

const ETAPA_CLS: Record<string, string> = {
  'Triagem':    'bg-gray-500/10 text-gray-400',
  'Entrevista': 'bg-blue-500/10 text-blue-400',
  'Teste':      'bg-purple-500/10 text-purple-400',
  'Aprovado':   'bg-accent/10 text-accent',
  'Reprovado':  'bg-red-500/10 text-red-500',
  'Contratado': 'bg-green-500/10 text-green-400',
  'Promovido':  'bg-indigo-500/10 text-indigo-400',
};

const Badge = ({ label, cls }: { label: string; cls?: string }) => (
  <span className={`px-2.5 py-1 rounded-md text-[10px] uppercase tracking-widest border ${cls ?? 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
    {label}
  </span>
);

const brl = (n: any) =>
  `R$ ${Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Vazio de seção — uma linha, não o `EmptyState` de p-10.
 *
 * Esta tela tem três listas que passam a maior parte do tempo vazias (fila de
 * decisão, decididas, vagas). Três caixas tracejadas gigantes empurravam o que
 * importa para fora da dobra; aqui o vazio ocupa o tamanho da informação que
 * ele carrega.
 */
const Vazio = ({ message }: { message: string }) => (
  <p className="text-xs text-gray-600 px-1 py-3">{message}</p>
);

type Aba = 'vagas' | 'pendentes' | 'decididas';

// ════════════════════════════════════════════════════════════════════════════
// PENDÊNCIA DE ACESSO — usada na filial E na Matriz
//
// Uma transferência efetivada muda `funcionarios.filial` na hora, mas o login
// (`user_profiles.filial`) só muda por service_role — o trigger da migr. 258
// barra qualquer outro caminho, e está certo. Enquanto as duas pontas não se
// encontram, a pessoa está numa unidade no cadastro e em outra no acesso.
//
// Por isso isto é um bloco fixo no topo da tela, e não um toast que some.
// ════════════════════════════════════════════════════════════════════════════

const PendenciasAcesso = ({ showToast, podeAjustar, nonce }: {
  showToast: any; podeAjustar: boolean; nonce: number;
}) => {
  const { data: movimentacoes, reload } = useFetchData<any>('/api/movimentacoescarreiraview');
  const [acaoId, setAcaoId] = useState<string | null>(null);

  useEffect(() => { if (nonce > 0) reload(); }, [nonce]);

  const pendencias = (movimentacoes ?? []).filter((m: any) => m.acesso_pendente);
  if (pendencias.length === 0) return null;

  const ajustar = async (m: any) => {
    if (!supabase) return;
    setAcaoId(m.id);
    try {
      const token = await freshToken();
      if (!token) { showToast('Sessão expirada. Faça login novamente.', 'error'); setAcaoId(null); return; }

      // O acesso vai por /api/users (service_role); a RPC só CONFERE depois.
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'update', userId: m.user_profile_id, filial: m.filial_nova }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao mover o acesso.');

      const { error } = await supabase.rpc('marcar_acesso_ajustado', { p_movimentacao_id: m.id });
      if (error) throw error;

      showToast(`Acesso de ${m.nome_funcionario} movido para ${m.filial_nova}.`, 'success');
      await reload();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao ajustar acesso.', 'error', true);
    }
    setAcaoId(null);
  };

  return (
    <div className="neu-flat rounded-2xl p-4 border border-yellow-400/20 shrink-0 flex flex-col gap-3">
      <p className="text-xs font-bold text-yellow-400 flex items-center gap-2">
        <AlertTriangle size={14} /> Acesso pendente ({pendencias.length})
      </p>
      {pendencias.map((m: any) => (
        <div key={m.id} className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400">
            <span className="text-gray-200 font-semibold">{m.nome_funcionario}</span> passou para {m.filial_nova},
            mas o login continua em {m.filial_anterior}.
          </p>
          {podeAjustar && (
            <button onClick={() => ajustar(m)} disabled={acaoId === m.id}
              className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-yellow-400 border border-yellow-400/20 hover:bg-yellow-400/10 flex items-center gap-1.5 disabled:opacity-50">
              {acaoId === m.id ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
              Mover acesso para {m.filial_nova}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// FILIAL — abrir vaga, acompanhar aprovação e conduzir o funil
// ════════════════════════════════════════════════════════════════════════════

const EMPTY_VAGA = {
  cargo: '', departamento: '', quantidade: '1', salario_min: '', salario_max: '',
  justificativa: '', tipo: 'Externa', escopo: 'Filial', filialDestino: '', nota_minima: '',
};
const EMPTY_CAND = { nome: '', cpf: '', email: '', telefone: '', link_curriculo: '' };

const UNIDADES: FilialOp[] = ['SuperMax', 'MaxLook', 'TechMax'];

/**
 * Uma tela só para os dois contextos.
 *
 * `filial === null` é modo Matriz: os fetches largam o filtro de unidade (a
 * RLS já confina — admin/CEO veem tudo), o formulário ganha um seletor de
 * unidade de destino, e a fila de aprovação de headcount entra no topo.
 *
 * O funil — inscrever, mover entre etapas, contratar, promover — é
 * exatamente o mesmo nos dois. Duplicá-lo numa view separada da Matriz seria
 * manter dois funis que precisam concordar para sempre, e a Matriz é
 * justamente quem conduz o processo interno inter-filiais.
 */
const RecrutamentoInner = ({ showToast, profile, filial }: {
  showToast: any; profile: UserProfile; filial: FilialOp | null;
}) => {
  const emMatriz = filial === null;
  const escopoFetch = emMatriz ? undefined : { filial };

  const { data: vagas, isLoading: loadingVagas, reload: reloadVagas } =
    useFetchData<any>('/api/vagasview', escopoFetch);
  const { data: candidaturas, reload: reloadCand } =
    useFetchData<any>('/api/candidaturasview', escopoFetch);
  const { data: cargos } = useFetchData<any>('/api/cargosview', escopoFetch);
  const { data: departamentos } = useFetchData<any>('/api/departamentosview', escopoFetch);
  // Histórico do funil. A RLS de candidatura_etapas já confina por filial via
  // EXISTS na candidatura, então não há extraFilter aqui — a tabela não tem
  // coluna `filial` própria de propósito (o dono do escopo é a candidatura).
  const { data: etapas, reload: reloadEtapas } = useFetchData<any>('/api/candidaturaetapasview');
  // Sem extraFilter de propósito: a RLS de `funcionarios` já confina (RH da
  // unidade vê a própria, admin/CEO veem todas). É isso que faz o mesmo hook
  // servir a vaga de escopo Filial e a Interfilial sem um segundo fetch.
  const { data: funcionarios, reload: reloadFunc } = useFetchData<any>('/api/funcionariosview');
  // Convocações (migr. 314). Sem extraFilter pelo mesmo motivo das etapas: a
  // RLS já confina, e em Matriz o escopo é a rede toda.
  const { data: convites, reload: reloadConvites } = useFetchData<any>('/api/vagaconvitesview');
  // Incrementado após cada promoção para o bloco de pendências se recarregar.
  const [movNonce, setMovNonce] = useState(0);

  // Desempenho vem por RPC, não por tabela: a RLS de `avaliacoes` (migr. 091)
  // confina o gerente ao próprio setor, e a tela precisa do mesmo recorte de
  // `funcionarios` para não mostrar candidato sem nota por acidente de RLS.
  const [desempenho, setDesempenho] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!supabase) return;
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase.rpc('desempenho_funcionarios');
      if (cancelado || error) return;
      const mapa: Record<string, any> = {};
      for (const d of (data ?? [])) mapa[d.funcionario_id] = d;
      setDesempenho(mapa);
    })();
    return () => { cancelado = true; };
  }, [movNonce]);

  const confirm = useConfirm();

  // Mesma régua da RPC `_assert_recrutamento` e da policy `afast_rh_all`:
  // RH da unidade ou gerente dela (que opera a filial inteira). Sem o
  // `|| gerente` a tela abriria com o botão escondido para quem tem
  // permissão no banco; sem o `hasSetor` ela ofereceria um botão que
  // devolveria 42501.
  const podeOperar = hasSetor(profile, 'rh') || profile?.role === 'gerente';
  // Escopo Interfilial e qualquer troca de unidade são decisão de holding
  // (`_assert_interfilial`, migr. 312). Mesma régua de `decidir_vaga`.
  const podeInterfilial = profile?.role === 'admin' || profile?.role === 'ceo';

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_VAGA);
  const [cargoSel, setCargoSel] = useState('');
  const [deptoSel, setDeptoSel] = useState('');
  const [salvandoVaga, setSalvandoVaga] = useState(false);

  const [aba, setAba] = useState<Aba>('vagas');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [candForm, setCandForm] = useState<Record<string, any>>({});
  const [acaoId, setAcaoId] = useState<string | null>(null);
  const [contratarDe, setContratarDe] = useState<any | null>(null);
  const [salarioContratacao, setSalarioContratacao] = useState('');
  const [dataAdmissao, setDataAdmissao] = useState(todayBR());
  const [historicoDe, setHistoricoDe] = useState<string | null>(null);
  const [convocarDe, setConvocarDe] = useState<any | null>(null);
  const [convocarSel, setConvocarSel] = useState<Set<string>>(new Set());
  const [convocarPrazo, setConvocarPrazo] = useState('');
  const [criarAcessoDe, setCriarAcessoDe] = useState<any | null>(null);
  const [acessoForm, setAcessoForm] = useState({ nome: '', email: '', password: '', role: 'colaborador', setor: 'vendas' });

  // A unidade da vaga: fixa quando se opera dentro de uma filial, escolhida no
  // formulário quando é a Matriz abrindo.
  const filialAlvo: FilialOp | null = emMatriz ? ((form.filialDestino || null) as FilialOp | null) : filial;

  // Em Matriz os catálogos vêm das 3 unidades juntos, e aqui eles NÃO são
  // filtrados pela unidade de destino: `cargos`/`departamentos` têm coluna
  // `filial` (migr. 145) mas as telas que os cadastram não são filialScoped,
  // então quase tudo ficou no default 'SuperMax'. Filtrar deixaria o select
  // vazio ao escolher MaxLook ou TechMax. O rótulo mostra a unidade de origem
  // do cargo e quem abre a vaga decide — e `cargo` é texto livre no
  // funcionário de qualquer forma.
  const rotuloFilial = (x: any) => (emMatriz && x.filial ? ` (${x.filial})` : '');
  const cargosAtivos = (cargos ?? []).filter((c: any) => (c.status ?? 'Ativo') === 'Ativo');
  const deptosAtivos = (departamentos ?? []).filter((d: any) => (d.status ?? 'Ativo') === 'Ativo');

  const candidaturasDe = (vagaId: string) =>
    (candidaturas ?? []).filter((c: any) => c.vaga_id === vagaId);

  const historicoDeCandidatura = (candId: string) =>
    (etapas ?? [])
      .filter((e: any) => e.candidatura_id === candId)
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const handleCargoChange = (value: string) => {
    setCargoSel(value);
    setForm(p => ({ ...p, cargo: value === OUTRO || value === '' ? '' : (cargosAtivos.find((c: any) => c.id === value)?.nome ?? '') }));
  };
  const handleDeptoChange = (value: string) => {
    setDeptoSel(value);
    setForm(p => ({ ...p, departamento: value === OUTRO || value === '' ? '' : (deptosAtivos.find((d: any) => d.id === value)?.nome ?? '') }));
  };

  const closeForm = () => { setShowForm(false); setForm(EMPTY_VAGA); setCargoSel(''); setDeptoSel(''); };

  const handleAbrirVaga = async () => {
    if (!supabase) return;
    if (!filialAlvo)                { showToast('Escolha a unidade de destino.', 'error'); return; }
    if (!form.cargo.trim())         { showToast('Selecione ou informe o cargo.', 'error'); return; }
    if (!form.justificativa.trim()) { showToast('Justifique o pedido de headcount.', 'error'); return; }
    setSalvandoVaga(true);
    try {
      // Duas RPCs distintas em vez de uma com parâmetros opcionais: o
      // PostgREST recusa chamar função sobrecarregada (PGRST203), e a
      // `abrir_vaga` da 311 já está em produção nas 4 turmas.
      const base = {
        p_filial:        filialAlvo,
        p_cargo:         form.cargo.trim(),
        p_justificativa: form.justificativa.trim(),
        p_departamento:  form.departamento || null,
        p_quantidade:    Number(form.quantidade) || 1,
        p_salario_min:   form.salario_min ? parseBRL(form.salario_min) : null,
        p_salario_max:   form.salario_max ? parseBRL(form.salario_max) : null,
      };
      const { error } = form.tipo === 'Interna'
        ? await supabase.rpc('abrir_vaga_interna', {
            ...base,
            p_escopo:      form.escopo,
            p_nota_minima: form.nota_minima ? Number(form.nota_minima) : null,
          })
        : await supabase.rpc('abrir_vaga', base);
      if (error) throw error;
      showToast('Vaga enviada — aguardando aprovação da Matriz.', 'success');
      closeForm();
      await reloadVagas();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao abrir vaga.', 'error', true);
    }
    setSalvandoVaga(false);
  };

  const handleCancelarVaga = async (v: any) => {
    if (!supabase) return;
    if (!await confirm(`Cancelar a vaga de ${v.cargo}?\n\nO pedido de headcount é encerrado.`)) return;
    setAcaoId(v.id);
    try {
      const { error } = await supabase.rpc('cancelar_vaga', { p_vaga_id: v.id });
      if (error) throw error;
      showToast('Vaga cancelada.', 'success');
      await reloadVagas();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao cancelar.', 'error', true);
    }
    setAcaoId(null);
  };

  const handleRegistrarCandidatura = async (vagaId: string) => {
    if (!supabase) return;
    const c = candForm[vagaId] ?? EMPTY_CAND;
    if (!c.nome?.trim()) { showToast('Informe o nome do candidato.', 'error'); return; }
    setAcaoId(vagaId);
    try {
      const { error } = await supabase.rpc('registrar_candidatura', {
        p_vaga_id:        vagaId,
        p_nome:           c.nome.trim(),
        p_cpf:            c.cpf || null,
        p_email:          c.email || null,
        p_telefone:       c.telefone || null,
        p_link_curriculo: c.link_curriculo || null,
      });
      if (error) throw error;
      showToast('Candidatura registrada.', 'success');
      setCandForm(p => ({ ...p, [vagaId]: EMPTY_CAND }));
      await Promise.all([reloadCand(), reloadEtapas()]);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao registrar candidatura.', 'error', true);
    }
    setAcaoId(null);
  };

  const handleInscreverInterno = async (vagaId: string, funcionarioId: string) => {
    if (!supabase || !funcionarioId) return;
    setAcaoId(vagaId);
    try {
      const { error } = await supabase.rpc('registrar_candidatura_interna', {
        p_vaga_id: vagaId, p_funcionario_id: funcionarioId,
      });
      if (error) throw error;
      showToast('Candidato interno inscrito.', 'success');
      setCandForm(p => ({ ...p, [vagaId]: EMPTY_CAND }));
      await Promise.all([reloadCand(), reloadEtapas()]);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao inscrever.', 'error', true);
    }
    setAcaoId(null);
  };

  const convitesDe = (vagaId: string) =>
    (convites ?? []).filter((c: any) => c.vaga_id === vagaId);

  /**
   * Convoca os selecionados.
   *
   * O prazo é uma data, gravada como fim do dia no fuso do Acre (UTC-5, sem
   * DST — [[project_timezone_acre]]). Mandar a data crua faria o convite
   * vencer à meia-noite UTC, que aqui é 19h do dia anterior.
   */
  const handleConvocar = async () => {
    if (!supabase || !convocarDe) return;
    if (convocarSel.size === 0) { showToast('Selecione quem convocar.', 'error'); return; }
    if (!convocarPrazo)         { showToast('Defina o prazo para responder.', 'error'); return; }
    setAcaoId(convocarDe.id);
    try {
      const { data, error } = await supabase.rpc('convocar_para_vaga', {
        p_vaga_id: convocarDe.id,
        p_funcionario_ids: Array.from(convocarSel),
        p_prazo: `${convocarPrazo}T23:59:59-05:00`,
      });
      if (error) throw error;

      const res = data as any;
      const recusados = (res?.recusados ?? []) as any[];
      showToast(
        `${res?.convocados ?? 0} convocado(s).` +
        (recusados.length
          ? ` Fora: ${recusados.map(r => `${r.nome ?? 'funcionário'} (${r.motivo})`).join(' · ')}`
          : ''),
        recusados.length ? 'info' : 'success',
        recusados.length > 0,
      );
      setConvocarDe(null);
      setConvocarSel(new Set());
      await reloadConvites();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao convocar.', 'error', true);
    }
    setAcaoId(null);
  };

  const handleCancelarConvite = async (c: any) => {
    if (!supabase) return;
    if (!await confirm(`Cancelar a convocação de ${c.nome_snapshot}?`)) return;
    setAcaoId(c.id);
    try {
      const { error } = await supabase.rpc('cancelar_convite_vaga', { p_convite_id: c.id });
      if (error) throw error;
      showToast('Convocação cancelada.', 'success');
      await reloadConvites();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao cancelar convocação.', 'error', true);
    }
    setAcaoId(null);
  };

  /**
   * Abre o currículo. O bucket é privado, então a URL é assinada na hora e
   * vale 60s — guardar link de currículo em lugar nenhum é o ponto.
   */
  const abrirCurriculo = async (path: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from('curriculos').createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      showToast(error?.message ?? 'Não foi possível abrir o currículo.', 'error', true);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  /**
   * Cria o login do recém-contratado.
   *
   * A conta vai por `/api/users` (service_role) — criar usuário no Auth não é
   * coisa que RPC de PostgREST faça, e o RBAC de quem pode criar já vive lá.
   * Depois `vincular_acesso_funcionario` amarra `funcionarios.user_profile_id`,
   * que o trigger da migr. 151 não resolve sozinho quando o perfil nasce
   * DEPOIS do funcionário.
   */
  const handleCriarAcesso = async () => {
    if (!supabase || !criarAcessoDe) return;
    const f = criarAcessoDe;
    if (!acessoForm.email.trim())          { showToast('Informe o e-mail.', 'error'); return; }
    if (acessoForm.password.length < 6)    { showToast('Senha deve ter ao menos 6 caracteres.', 'error'); return; }

    setAcaoId(f.id);
    try {
      const token = await freshToken();
      if (!token) { showToast('Sessão expirada. Faça login novamente.', 'error'); setAcaoId(null); return; }

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          action: 'create',
          nome: acessoForm.nome.trim(), email: acessoForm.email.trim(),
          password: acessoForm.password, role: acessoForm.role,
          setor: acessoForm.setor, filial: f.filial,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao criar o acesso.');

      const { error } = await supabase.rpc('vincular_acesso_funcionario', {
        p_funcionario_id: f.id, p_user_profile_id: json.userId,
      });
      if (error) {
        // A conta existe; só o vínculo falhou. Dizer isso evita que alguém
        // tente criar de novo e esbarre em "e-mail já cadastrado".
        throw new Error(`Acesso criado, mas o vínculo falhou: ${error.message}. Vincule em Usuários.`);
      }

      showToast(`Acesso criado para ${f.nome}.`, 'success');
      setCriarAcessoDe(null);
      await reloadFunc();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao criar acesso.', 'error', true);
    }
    setAcaoId(null);
  };

  const handleMover = async (candidaturaId: string, etapa: string) => {
    if (!supabase) return;
    setAcaoId(candidaturaId);
    try {
      const { error } = await supabase.rpc('mover_candidatura', { p_candidatura_id: candidaturaId, p_etapa: etapa });
      if (error) throw error;
      await Promise.all([reloadCand(), reloadEtapas()]);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao mover candidatura.', 'error', true);
    }
    setAcaoId(null);
  };

  const handleEfetivar = async () => {
    if (!supabase || !contratarDe) return;
    const interna = !!contratarDe.funcionario_origem_id;
    const salario = parseBRL(salarioContratacao);
    if (!salario || salario <= 0) {
      showToast(interna ? 'Informe o novo salário.' : 'Informe o salário de admissão.', 'error');
      return;
    }
    setAcaoId(contratarDe.id);
    try {
      const { data, error } = interna
        ? await supabase.rpc('efetivar_promocao', {
            p_candidatura_id: contratarDe.id, p_salario: salario, p_data_efeito: dataAdmissao || null,
          })
        : await supabase.rpc('efetivar_contratacao', {
            p_candidatura_id: contratarDe.id, p_salario: salario, p_data_admissao: dataAdmissao || null,
          });
      if (error) throw error;

      const res = data as any;
      showToast(
        interna
          ? `${contratarDe.nome}: ${res?.tipo ?? 'Promoção'} registrada.` +
            (res?.acesso_pendente ? ' O acesso ainda precisa ser movido de unidade.' : '')
          : `${contratarDe.nome} contratado(a) — já aparece em Funcionários.`,
        interna && res?.acesso_pendente ? 'info' : 'success',
      );
      setContratarDe(null);
      setSalarioContratacao('');
      setMovNonce(n => n + 1);
      await Promise.all([reloadCand(), reloadVagas(), reloadEtapas(), reloadFunc()]);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao efetivar.', 'error', true);
    }
    setAcaoId(null);
  };

  if (loadingVagas) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const vagasAtivas = (vagas ?? []).slice().sort((a: any, b: any) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const nPendentes = vagasAtivas.filter((v: any) => v.status === 'Aguardando Matriz').length;
  const nDecididas = vagasAtivas.length - nPendentes;

  const kpis = [
    { label: 'Aguardando Matriz', value: nPendentes },
    { label: 'Aprovadas',         value: vagasAtivas.filter((v: any) => v.status === 'Aprovada').length },
    { label: 'Candidatos ativos', value: (candidaturas ?? []).filter((c: any) => !['Contratado', 'Promovido', 'Reprovado'].includes(c.etapa)).length },
    { label: 'Preenchidas',       value: vagasAtivas.filter((v: any) => v.status === 'Preenchida').length },
  ];

  // As três listas da Matriz dividem a mesma área em vez de empilhar. A aba
  // inicial é Vagas (a lista completa, que serve nas duas pontas); a fila de
  // decisão é o que trava o resto, então o contador dela vai destacado — quem
  // abre a tela vê que há algo a decidir sem precisar rolar nem trocar de aba.
  const abas: { k: Aba; label: string; count: number }[] = emMatriz
    ? [
        { k: 'vagas',     label: 'Vagas',              count: vagasAtivas.length },
        { k: 'pendentes', label: 'Aguardando decisão', count: nPendentes },
        { k: 'decididas', label: 'Decididas',          count: nDecididas },
      ]
    : [];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            Recrutamento & Seleção{emMatriz ? '' : ` — ${filial}`}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {emMatriz
              ? 'Decida o headcount das 3 unidades e conduza a promoção inter-filiais, que só a Matriz pode fazer.'
              : 'Peça headcount, acompanhe a aprovação da Matriz e conduza o funil até contratar.'}
          </p>
        </div>
        {podeOperar && (
          <NeuButtonAccent onClick={() => setShowForm(true)}><Plus size={16} />Abrir vaga</NeuButtonAccent>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map(k => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">{k.label}</p>
            <p className="text-2xl font-black text-gray-100">{k.value}</p>
          </div>
        ))}
      </div>

      <PendenciasAcesso showToast={showToast} podeAjustar={podeInterfilial} nonce={movNonce} />

      {/* Nova vaga é modal, não bloco na tela: o formulário abria no meio da
          página e o botão que o chama fica no topo, então quem clicava não via
          nada acontecer sem rolar. */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
            onClick={closeForm}>
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} onClick={e => e.stopPropagation()}
            className="neu-flat rounded-2xl p-5 sm:p-6 w-full max-w-3xl my-auto border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2"><Briefcase size={16} className="text-accent" />Nova vaga</h3>
              <button onClick={closeForm} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {emMatriz && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Unidade de destino</label>
                  <select value={form.filialDestino}
                    onChange={e => { setForm(p => ({ ...p, filialDestino: e.target.value, cargo: '', departamento: '' })); setCargoSel(''); setDeptoSel(''); }}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm">
                    <option value="">Selecionar...</option>
                    {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Tipo</label>
                <select value={form.tipo}
                  onChange={e => setForm(p => ({ ...p, tipo: e.target.value, escopo: 'Filial' }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="Externa">Externa — contrata de fora</option>
                  <option value="Interna">Interna — promove quem já está aqui</option>
                </select>
              </div>
              {form.tipo === 'Interna' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nota mínima</label>
                  <select value={form.nota_minima}
                    onChange={e => setForm(p => ({ ...p, nota_minima: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm">
                    <option value="">Sem exigência</option>
                    {['3', '3.5', '4', '4.5'].map(n => (
                      <option key={n} value={n}>{n.replace('.', ',')} ou mais</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-600">
                    Média da última avaliação (1 a 5). Quem não tem avaliação não entra.
                  </p>
                </div>
              )}
              {form.tipo === 'Interna' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Escopo</label>
                  <select value={form.escopo} onChange={e => setForm(p => ({ ...p, escopo: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" disabled={!podeInterfilial}>
                    <option value="Filial">Só desta unidade</option>
                    <option value="Interfilial">Toda a rede (inter-filiais)</option>
                  </select>
                  {!podeInterfilial && (
                    <p className="text-[10px] text-gray-600">Buscar candidato em outra unidade é decisão da Matriz.</p>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Cargo</label>
                <select value={cargoSel} onChange={e => handleCargoChange(e.target.value)} className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecionar...</option>
                  {cargosAtivos.map((c: any) => <option key={c.id} value={c.id}>{c.nome}{rotuloFilial(c)}</option>)}
                  <option value={OUTRO}>Outro (digitar)</option>
                </select>
                {cargoSel === OUTRO && (
                  <input type="text" value={form.cargo} placeholder="Cargo fora do catálogo"
                    onChange={e => setForm(p => ({ ...p, cargo: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Departamento</label>
                <select value={deptoSel} onChange={e => handleDeptoChange(e.target.value)} className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecionar...</option>
                  {deptosAtivos.map((d: any) => <option key={d.id} value={d.id}>{d.nome}{rotuloFilial(d)}</option>)}
                  <option value={OUTRO}>Outro (digitar)</option>
                </select>
                {deptoSel === OUTRO && (
                  <input type="text" value={form.departamento} placeholder="Departamento fora do catálogo"
                    onChange={e => setForm(p => ({ ...p, departamento: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Quantidade</label>
                <input type="number" min={1} value={form.quantidade}
                  onChange={e => setForm(p => ({ ...p, quantidade: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm font-mono tabular-nums" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Salário mín.</label>
                <input type="text" inputMode="numeric" value={form.salario_min}
                  onChange={e => setForm(p => ({ ...p, salario_min: formatBRL(e.target.value) }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm font-mono tabular-nums" placeholder="Opcional" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Salário máx.</label>
                <input type="text" inputMode="numeric" value={form.salario_max}
                  onChange={e => setForm(p => ({ ...p, salario_max: formatBRL(e.target.value) }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm font-mono tabular-nums" placeholder="Opcional" />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Justificativa</label>
                <textarea rows={2} value={form.justificativa}
                  onChange={e => setForm(p => ({ ...p, justificativa: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none"
                  placeholder="Por que esse headcount é necessário agora?" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={closeForm} className="text-sm text-gray-400 hover:text-gray-300 px-4">Cancelar</button>
              <NeuButtonAccent onClick={handleAbrirVaga} isLoading={salvandoVaga}>Enviar para aprovação</NeuButtonAccent>
            </div>
          </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {emMatriz && (
        <div className="flex flex-wrap gap-2 shrink-0 border-b border-white/5 pb-px">
          {abas.map(a => (
            <button key={a.k} onClick={() => setAba(a.k)}
              className={`px-4 py-2.5 rounded-t-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2 border-b-2 transition-colors ${
                aba === a.k
                  ? 'text-accent border-accent bg-accent/[0.06]'
                  : 'text-gray-500 border-transparent hover:text-gray-300'}`}>
              {a.k === 'pendentes' && <Users size={13} />}
              {a.label}
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black tabular-nums ${
                a.k === 'pendentes' && a.count > 0
                  ? 'bg-yellow-400/15 text-yellow-400'
                  : 'bg-white/5 text-gray-500'}`}>
                {a.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {emMatriz && aba !== 'vagas' && (
        <FilaAprovacaoMatriz secao={aba} showToast={showToast} profile={profile} vagas={vagas} reload={reloadVagas} />
      )}

      <div className={`flex-1 flex-col gap-3 ${aba === 'vagas' ? 'flex' : 'hidden'}`}>
        {vagasAtivas.length === 0 ? (
          <Vazio message="Nenhuma vaga registrada ainda. Use “Abrir vaga” para pedir headcount." />
        ) : vagasAtivas.map((v: any) => {
          const cands = candidaturasDe(v.id);
          const aberto = expandido === v.id;
          const cf = candForm[v.id] ?? EMPTY_CAND;
          return (
            <div key={v.id} className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
              <button onClick={() => setExpandido(aberto ? null : v.id)}
                className="w-full flex items-center justify-between gap-3 p-4 text-left">
                <div className="flex items-center gap-3 min-w-0">
                  {aberto ? <ChevronDown size={16} className="text-gray-500 shrink-0" /> : <ChevronRight size={16} className="text-gray-500 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-100 truncate">{v.quantidade}x {v.cargo}{v.departamento ? ` · ${v.departamento}` : ''}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {v.salario_min || v.salario_max ? `${brl(v.salario_min ?? 0)} – ${brl(v.salario_max ?? 0)} · ` : ''}
                      {cands.length} candidatura{cands.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {v.tipo === 'Interna' && (
                    <Badge label={v.escopo === 'Interfilial' ? 'Interna · rede' : 'Interna'}
                      cls="bg-indigo-500/10 text-indigo-400 border-indigo-500/20" />
                  )}
                  <Badge label={v.status} cls={VAGA_STATUS_CLS[v.status]} />
                </div>
              </button>

              <AnimatePresence>
                {aberto && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden border-t border-white/5">
                    <div className="p-4 flex flex-col gap-4">
                      <p className="text-xs text-gray-500">{v.justificativa}</p>
                      {v.status === 'Negada' && v.motivo_decisao && (
                        <p className="text-xs text-red-400">Motivo da negativa: {v.motivo_decisao}</p>
                      )}

                      {v.status === 'Aguardando Matriz' && podeOperar && (
                        <div className="flex justify-end">
                          <button onClick={() => handleCancelarVaga(v)} disabled={acaoId === v.id}
                            className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1.5 disabled:opacity-50">
                            {acaoId === v.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} Cancelar pedido
                          </button>
                        </div>
                      )}

                      {/* Convocação (migr. 314) — é o que faz o funcionário
                          ficar sabendo da vaga. Vem antes da inscrição direta
                          de propósito: inscrever alguém sem convocar é o
                          atalho, não o caminho. */}
                      {v.status === 'Aprovada' && podeOperar && v.tipo === 'Interna' && (() => {
                        const cvs = convitesDe(v.id);
                        const pend = cvs.filter((c: any) => c.status === 'Pendente');
                        return (
                          <div className="neu-pressed rounded-xl p-4 flex flex-col gap-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                                <Send size={14} className="text-indigo-400" />
                                Convocação{cvs.length > 0 ? ` — ${pend.length} aguardando resposta` : ''}
                              </p>
                              <button onClick={() => {
                                setConvocarDe(v);
                                setConvocarSel(new Set());
                                const d = new Date(Date.now() + 7 * 864e5);
                                setConvocarPrazo(d.toISOString().slice(0, 10));
                              }}
                                className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-indigo-300 border border-indigo-400/30 hover:bg-indigo-400/10 flex items-center gap-1.5">
                                <Send size={12} /> Convocar funcionários
                              </button>
                            </div>
                            {cvs.length === 0 ? (
                              <p className="text-[11px] text-gray-600">
                                Ninguém foi convocado ainda — enquanto isso, esta vaga é invisível para os funcionários.
                              </p>
                            ) : (
                              <div className="flex flex-col gap-1.5">
                                {cvs.map((c: any) => (
                                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                    <span className="text-gray-300">
                                      {c.nome_snapshot}
                                      <span className="text-gray-600"> · prazo {String(c.prazo).slice(8, 10)}/{String(c.prazo).slice(5, 7)}</span>
                                    </span>
                                    <span className="flex items-center gap-2">
                                      <Badge label={c.status} cls={CONVITE_CLS[c.status]} />
                                      {c.status === 'Pendente' && (
                                        <button onClick={() => handleCancelarConvite(c)} disabled={acaoId === c.id}
                                          className="text-gray-600 hover:text-red-400 disabled:opacity-50">
                                          <Ban size={12} />
                                        </button>
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {v.status === 'Aprovada' && podeOperar && v.tipo === 'Interna' && (
                        <div className="neu-pressed rounded-xl p-4 flex flex-col gap-3">
                          <p className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                            <UserPlus size={14} className="text-accent" />Inscrever candidato interno
                            <span className="font-normal text-gray-600">— sem convocar</span>
                          </p>
                          {(() => {
                            // Escopo Filial: só a unidade da vaga. Interfilial: a rede
                            // toda — o que o fetch já traz é o que a RLS permite ver.
                            const jaInscritos = new Set(cands.map((c: any) => c.funcionario_origem_id).filter(Boolean));
                            const elegiveis = (funcionarios ?? [])
                              .filter((f: any) => (f.status ?? 'Ativo') === 'Ativo')
                              .filter((f: any) => v.escopo === 'Interfilial' || f.filial === v.filial)
                              .filter((f: any) => !jaInscritos.has(f.id))
                              .sort((a: any, b: any) => (a.nome ?? '').localeCompare((b.nome ?? ''), 'pt-BR', { sensitivity: 'base' }));
                            // A nota mínima é aplicada no banco; aqui ela só
                            // antecipa a recusa em vez de deixar o RH descobrir
                            // pelo erro depois de escolher.
                            const atende = (f: any) => {
                              if (!v.nota_minima) return true;
                              const m = desempenho[f.id]?.media;
                              return m != null && Number(m) >= Number(v.nota_minima);
                            };
                            const selecionado = elegiveis.find((f: any) => f.id === cf.funcionario_id);
                            return elegiveis.length === 0 ? (
                              <p className="text-[11px] text-gray-500">Nenhum funcionário elegível disponível.</p>
                            ) : (
                              <>
                                {v.nota_minima && (
                                  <p className="text-[11px] text-gray-500">
                                    Esta vaga exige média mínima de <span className="text-accent font-semibold">{String(v.nota_minima).replace('.', ',')}</span> na última avaliação.
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-3">
                                  <select value={cf.funcionario_id ?? ''}
                                    onChange={e => setCandForm(p => ({ ...p, [v.id]: { ...cf, funcionario_id: e.target.value } }))}
                                    className="neu-input rounded-xl px-3 py-2 text-sm flex-1 min-w-[220px]">
                                    <option value="">Selecionar funcionário...</option>
                                    {elegiveis.map((f: any) => {
                                      const d = desempenho[f.id];
                                      const nota = d?.media != null ? `★ ${Number(d.media).toFixed(1)}` : 'sem avaliação';
                                      return (
                                        <option key={f.id} value={f.id} disabled={!atende(f)}>
                                          {f.nome} — {f.cargo || 'sem cargo'}
                                          {v.escopo === 'Interfilial' ? ` (${f.filial})` : ''} · {nota}
                                          {!atende(f) ? ' — não atende' : ''}
                                        </option>
                                      );
                                    })}
                                  </select>
                                  <NeuButtonAccent onClick={() => handleInscreverInterno(v.id, cf.funcionario_id)}
                                    isLoading={acaoId === v.id} disabled={!cf.funcionario_id}>Inscrever</NeuButtonAccent>
                                </div>
                                {selecionado && desempenho[selecionado.id] && (
                                  <p className="text-[10px] text-gray-600">
                                    Última avaliação: {desempenho[selecionado.id].ciclo ?? '—'} · média {Number(desempenho[selecionado.id].media).toFixed(2)}
                                    {desempenho[selecionado.id].pdi_total > 0 &&
                                      ` · PDI ${desempenho[selecionado.id].pdi_concluidos}/${desempenho[selecionado.id].pdi_total} concluído`}
                                  </p>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {v.status === 'Aprovada' && podeOperar && v.tipo !== 'Interna' && (
                        <div className="neu-pressed rounded-xl p-4 flex flex-col gap-3">
                          <p className="text-xs font-bold text-gray-300 flex items-center gap-1.5"><UserPlus size={14} className="text-accent" />Registrar candidatura</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input type="text" placeholder="Nome *" value={cf.nome}
                              onChange={e => setCandForm(p => ({ ...p, [v.id]: { ...cf, nome: e.target.value } }))}
                              className="neu-input rounded-xl px-3 py-2 text-sm" />
                            <input type="text" placeholder="CPF" value={cf.cpf}
                              onChange={e => setCandForm(p => ({ ...p, [v.id]: { ...cf, cpf: e.target.value } }))}
                              className="neu-input rounded-xl px-3 py-2 text-sm" />
                            <input type="text" placeholder="E-mail" value={cf.email}
                              onChange={e => setCandForm(p => ({ ...p, [v.id]: { ...cf, email: e.target.value } }))}
                              className="neu-input rounded-xl px-3 py-2 text-sm" />
                            <input type="text" placeholder="Telefone" value={cf.telefone}
                              onChange={e => setCandForm(p => ({ ...p, [v.id]: { ...cf, telefone: e.target.value } }))}
                              className="neu-input rounded-xl px-3 py-2 text-sm" />
                            <input type="text" placeholder="Link do currículo" value={cf.link_curriculo}
                              onChange={e => setCandForm(p => ({ ...p, [v.id]: { ...cf, link_curriculo: e.target.value } }))}
                              className="neu-input rounded-xl px-3 py-2 text-sm sm:col-span-2" />
                          </div>
                          <div className="flex justify-end">
                            <NeuButtonAccent onClick={() => handleRegistrarCandidatura(v.id)} isLoading={acaoId === v.id}>Registrar</NeuButtonAccent>
                          </div>
                        </div>
                      )}

                      {cands.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {cands.map((c: any) => (
                            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                              <div className="min-w-0">
                                <button onClick={() => setHistoricoDe(historicoDe === c.id ? null : c.id)}
                                  className="text-sm text-gray-200 font-semibold truncate hover:text-accent text-left">
                                  {c.nome}
                                </button>
                                <p className="text-[11px] text-gray-500 truncate">{[c.email, c.telefone].filter(Boolean).join(' · ') || '—'}</p>
                                {c.link_curriculo && (
                                  <a href={c.link_curriculo} target="_blank" rel="noopener noreferrer"
                                    className="text-[11px] text-accent hover:brightness-110">Currículo</a>
                                )}
                                {/* Anexo do bucket privado: abre por URL
                                    assinada, não por href fixo. */}
                                {c.curriculo_path && (
                                  <button onClick={() => abrirCurriculo(c.curriculo_path)}
                                    className="text-[11px] text-accent hover:brightness-110 flex items-center gap-1">
                                    <Paperclip size={11} /> Currículo (PDF)
                                  </button>
                                )}
                                {c.origem === 'Autocandidatura' && (
                                  <span className="text-[10px] text-indigo-400/80 block">Candidatou-se por conta própria</span>
                                )}
                                {historicoDe === c.id && (
                                  <div className="mt-2 flex flex-col gap-1 border-l border-white/10 pl-3">
                                    {historicoDeCandidatura(c.id).map((h: any) => (
                                      <p key={h.id} className="text-[10px] text-gray-500">
                                        {h.etapa_anterior ? `${h.etapa_anterior} → ` : ''}
                                        <span className="text-gray-400">{h.etapa_nova}</span>
                                        {h.registrado_por_nome ? ` · ${h.registrado_por_nome}` : ''}
                                        {h.observacao ? ` · ${h.observacao}` : ''}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge label={c.etapa} cls={ETAPA_CLS[c.etapa]} />
                                {podeOperar && !['Contratado', 'Promovido', 'Reprovado'].includes(c.etapa) && (
                                  <select value="" onChange={e => e.target.value && handleMover(c.id, e.target.value)}
                                    disabled={acaoId === c.id} className="neu-input rounded-lg px-2 py-1 text-[11px]">
                                    <option value="">Mover para...</option>
                                    {ETAPAS.filter(e => e !== c.etapa).map(e => <option key={e} value={e}>{e}</option>)}
                                  </select>
                                )}
                                {podeOperar && c.etapa === 'Aprovado' && (
                                  <button onClick={() => {
                                    setContratarDe({ ...c, _vaga: v });
                                    // Promoção parte do salário atual; admissão parte do zero.
                                    const atual = c.funcionario_origem_id
                                      ? (funcionarios ?? []).find((f: any) => f.id === c.funcionario_origem_id)?.salario
                                      : null;
                                    setSalarioContratacao(atual ? formatBRL(Number(atual)) : '');
                                    setDataAdmissao(todayBR());
                                  }}
                                    className="text-[11px] text-accent hover:brightness-110 flex items-center gap-1 font-semibold">
                                    <ArrowRight size={12} /> {c.funcionario_origem_id ? 'Promover' : 'Contratar'}
                                  </button>
                                )}
                                {/* Contratado que ainda não tem login. Some
                                    assim que o vínculo existe. */}
                                {podeOperar && c.etapa === 'Contratado' && (() => {
                                  const novo = (funcionarios ?? []).find((f: any) => f.id === c.funcionario_id);
                                  if (!novo || novo.user_profile_id) return null;
                                  return (
                                    <button onClick={() => {
                                      setCriarAcessoDe(novo);
                                      setAcessoForm({
                                        nome: novo.nome ?? '', email: novo.email ?? '',
                                        password: '', role: 'colaborador', setor: 'vendas',
                                      });
                                    }}
                                      className="text-[11px] text-accent hover:brightness-110 flex items-center gap-1 font-semibold">
                                      <KeyRound size={12} /> Criar acesso
                                    </button>
                                  );
                                })()}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Convocação em lote. A RPC devolve quem entrou e quem ficou de fora
          com o motivo, em vez de abortar tudo no primeiro inelegível. */}
      <AnimatePresence>
        {convocarDe && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setConvocarDe(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} onClick={e => e.stopPropagation()}
              className="neu-flat rounded-2xl p-6 w-full max-w-lg max-h-[85vh] flex flex-col border border-white/10">
              <h3 className="text-lg font-bold text-gray-100 mb-1">Convocar para {convocarDe.cargo}</h3>
              <p className="text-xs text-gray-500 mb-4">
                Quem for convocado passa a enxergar esta vaga, anexa currículo e decide se concorre.
                Você é avisado no sino quando alguém responde.
              </p>

              <div className="flex flex-col gap-1.5 mb-4">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Prazo para responder</label>
                <input type="date" value={convocarPrazo} min={todayBR()}
                  onChange={e => setConvocarPrazo(e.target.value)}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>

              <div className="flex-1 overflow-y-auto main-scrollbar flex flex-col gap-1.5 -mx-1 px-1">
                {(() => {
                  const jaNoFunil = new Set(
                    candidaturasDe(convocarDe.id).map((c: any) => c.funcionario_origem_id).filter(Boolean));
                  const jaConvocados = new Set(
                    convitesDe(convocarDe.id).filter((c: any) => c.ativo).map((c: any) => c.funcionario_id));
                  const elegiveis = (funcionarios ?? [])
                    .filter((f: any) => (f.status ?? 'Ativo') === 'Ativo')
                    .filter((f: any) => convocarDe.escopo === 'Interfilial' || f.filial === convocarDe.filial)
                    .filter((f: any) => !jaNoFunil.has(f.id) && !jaConvocados.has(f.id))
                    .sort((a: any, b: any) => (a.nome ?? '').localeCompare((b.nome ?? ''), 'pt-BR', { sensitivity: 'base' }));

                  if (elegiveis.length === 0) {
                    return <p className="text-xs text-gray-600 py-3">Ninguém elegível sobrou para convocar nesta vaga.</p>;
                  }

                  const atende = (f: any) => {
                    if (!convocarDe.nota_minima) return true;
                    const m = desempenho[f.id]?.media;
                    return m != null && Number(m) >= Number(convocarDe.nota_minima);
                  };

                  return elegiveis.map((f: any) => {
                    const d = desempenho[f.id];
                    const ok = atende(f);
                    const semAcesso = !f.user_profile_id;
                    // Sem login não há FAB — a RPC recusa, e a tela diz por quê
                    // antes de o RH marcar e levar erro.
                    const bloqueado = !ok || semAcesso;
                    return (
                      <label key={f.id}
                        className={`flex items-center gap-3 p-2.5 rounded-xl border text-xs ${
                          bloqueado ? 'border-white/5 opacity-50' : 'border-white/5 hover:border-accent/30 cursor-pointer'}`}>
                        <input type="checkbox" disabled={bloqueado}
                          checked={convocarSel.has(f.id)}
                          onChange={e => setConvocarSel(prev => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(f.id); else n.delete(f.id);
                            return n;
                          })}
                          className="accent-[var(--color-accent)] w-4 h-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="text-gray-200 font-semibold">{f.nome}</span>
                          <span className="text-gray-500"> — {f.cargo || 'sem cargo'}</span>
                          {convocarDe.escopo === 'Interfilial' && <span className="text-gray-600"> ({f.filial})</span>}
                        </span>
                        <span className="text-[10px] text-gray-500 shrink-0 text-right">
                          {d?.media != null ? `★ ${Number(d.media).toFixed(1)}` : 'sem avaliação'}
                          {semAcesso && <span className="block text-yellow-500/80">sem login</span>}
                          {!ok && !semAcesso && <span className="block text-red-500/80">não atende</span>}
                        </span>
                      </label>
                    );
                  });
                })()}
              </div>

              <div className="flex justify-end gap-3 mt-5 shrink-0">
                <button onClick={() => setConvocarDe(null)} className="text-sm text-gray-400 hover:text-gray-300 px-4">Cancelar</button>
                <NeuButtonAccent onClick={handleConvocar} isLoading={acaoId === convocarDe.id} disabled={convocarSel.size === 0}>
                  Convocar {convocarSel.size > 0 ? `(${convocarSel.size})` : ''}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {criarAcessoDe && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setCriarAcessoDe(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} onClick={e => e.stopPropagation()}
              className="neu-flat rounded-2xl p-6 w-full max-w-md border border-white/10">
              <h3 className="text-lg font-bold text-gray-100 mb-1">Criar acesso — {criarAcessoDe.nome}</h3>
              <p className="text-xs text-gray-500 mb-4">
                Cria o login em {criarAcessoDe.filial} e o vincula a este funcionário.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nome</label>
                  <input type="text" value={acessoForm.nome}
                    onChange={e => setAcessoForm(p => ({ ...p, nome: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">E-mail</label>
                  <input type="email" value={acessoForm.email}
                    onChange={e => setAcessoForm(p => ({ ...p, email: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Senha inicial</label>
                  <input type="password" value={acessoForm.password} autoComplete="new-password"
                    onChange={e => setAcessoForm(p => ({ ...p, password: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Mínimo 6 caracteres" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Cargo no sistema</label>
                    <select value={acessoForm.role}
                      onChange={e => setAcessoForm(p => ({ ...p, role: e.target.value }))}
                      className="neu-input rounded-xl px-3 py-2.5 text-sm" disabled={!podeInterfilial}>
                      <option value="colaborador">Colaborador</option>
                      <option value="gerente">Gerente</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setor</label>
                    <select value={acessoForm.setor}
                      onChange={e => setAcessoForm(p => ({ ...p, setor: e.target.value }))}
                      className="neu-input rounded-xl px-3 py-2.5 text-sm">
                      {['vendas', 'financeiro', 'rh', 'marketing', 'logistica', 'ti', 'gerencia'].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* O cargo de RH e o papel de RBAC são coisas diferentes — a
                    tela diz isso porque a confusão é o erro esperado aqui. */}
                <p className="text-[10px] text-gray-600 leading-relaxed">
                  O cargo <span className="text-gray-400">{criarAcessoDe.cargo || '—'}</span> é o de RH.
                  O que se escolhe acima é o nível de acesso no sistema, que é outra coisa e pode ser
                  ajustado depois em Usuários.
                </p>
              </div>
              <div className="flex justify-end gap-3 mt-5">
                <button onClick={() => setCriarAcessoDe(null)} className="text-sm text-gray-400 hover:text-gray-300 px-4">Cancelar</button>
                <NeuButtonAccent onClick={handleCriarAcesso} isLoading={acaoId === criarAcessoDe.id}>Criar acesso</NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contratarDe && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setContratarDe(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} onClick={e => e.stopPropagation()}
              className="neu-flat rounded-2xl p-6 w-full max-w-md border border-white/10">
              {(() => {
                const interna = !!contratarDe.funcionario_origem_id;
                const atual = interna
                  ? (funcionarios ?? []).find((f: any) => f.id === contratarDe.funcionario_origem_id)
                  : null;
                const vagaDaCand = contratarDe._vaga;
                const trocaFilial = !!atual && atual.filial !== vagaDaCand?.filial;
                return (
                  <>
                    <h3 className="text-lg font-bold text-gray-100 mb-1">
                      {interna ? 'Promover' : 'Contratar'} {contratarDe.nome}
                    </h3>
                    <p className="text-xs text-gray-500 mb-4">
                      {interna
                        ? 'Isso altera o cargo, o salário e o histórico de carreira do funcionário.'
                        : 'Isso cria o registro em Funcionários e fecha a candidatura.'}
                    </p>

                    {interna && atual && (
                      <div className="neu-pressed rounded-xl p-3 mb-4 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-gray-500">Cargo</span>
                          <span className="text-gray-300 text-right">
                            {atual.cargo || '—'} <span className="text-accent">→ {vagaDaCand?.cargo}</span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-gray-500">Salário</span>
                          <span className="font-mono tabular-nums text-gray-300 text-right">
                            {brl(atual.salario)} <span className="text-accent">→ {brl(parseBRL(salarioContratacao))}</span>
                          </span>
                        </div>
                        {trocaFilial && (
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-gray-500">Unidade</span>
                            <span className="text-gray-300 text-right">
                              {atual.filial} <span className="text-accent">→ {vagaDaCand?.filial}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {interna && trocaFilial && (
                      <p className="text-[11px] text-yellow-400 mb-4 leading-relaxed">
                        Transferência entre unidades: o cadastro de RH muda agora, mas o
                        <strong> login continua em {atual?.filial}</strong> até ser ajustado em Usuários.
                        A pendência aparece aqui em cima assim que você confirmar.
                      </p>
                    )}

                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                          {interna ? 'Novo salário' : 'Salário de admissão'}
                        </label>
                        <input type="text" inputMode="numeric" value={salarioContratacao}
                          onChange={e => setSalarioContratacao(formatBRL(e.target.value))}
                          className="neu-input rounded-xl px-3 py-2.5 text-sm font-mono tabular-nums" />
                        {(vagaDaCand?.salario_min || vagaDaCand?.salario_max) && (
                          <p className="text-[10px] text-gray-600">
                            Faixa aprovada: {brl(vagaDaCand.salario_min ?? 0)} – {brl(vagaDaCand.salario_max ?? 0)}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                          {interna ? 'Data de efeito' : 'Data de admissão'}
                        </label>
                        <input type="date" value={dataAdmissao} onChange={e => setDataAdmissao(e.target.value)}
                          className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-5">
                      <button onClick={() => setContratarDe(null)} className="text-sm text-gray-400 hover:text-gray-300 px-4">Cancelar</button>
                      <NeuButtonAccent onClick={handleEfetivar} isLoading={acaoId === contratarDe.id}>
                        {interna ? 'Confirmar promoção' : 'Confirmar contratação'}
                      </NeuButtonAccent>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// MATRIZ — fila de aprovação de headcount, consolidada das 3 unidades
//
// Recebe `vagas` por prop em vez de buscar de novo: é a mesma lista que a tela
// já carregou, e um segundo fetch faria as duas divergirem entre reloads.
// ════════════════════════════════════════════════════════════════════════════

const FilaAprovacaoMatriz = ({ secao, showToast, profile, vagas, reload }: {
  secao: 'pendentes' | 'decididas';
  showToast: any; profile: UserProfile; vagas: any[]; reload: () => Promise<any> | void;
}) => {
  const confirm = useConfirm();
  const [acaoId, setAcaoId] = useState<string | null>(null);
  const [negarDe, setNegarDe] = useState<any | null>(null);
  const [motivoNegativa, setMotivoNegativa] = useState('');

  const podeDecidir = profile?.role === 'admin' || profile?.role === 'ceo';

  const pendentes = (vagas ?? []).filter((v: any) => v.status === 'Aguardando Matriz')
    .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const decididas = (vagas ?? []).filter((v: any) => v.status !== 'Aguardando Matriz')
    .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 20);

  const handleAprovar = async (v: any) => {
    if (!supabase) return;
    if (!await confirm(`Aprovar ${v.quantidade}x ${v.cargo} para ${v.filial}?`)) return;
    setAcaoId(v.id);
    try {
      const { error } = await supabase.rpc('decidir_vaga', { p_vaga_id: v.id, p_aprovar: true });
      if (error) throw error;
      showToast('Vaga aprovada.', 'success');
      await reload();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao aprovar.', 'error', true);
    }
    setAcaoId(null);
  };

  const handleNegar = async () => {
    if (!supabase || !negarDe) return;
    if (!motivoNegativa.trim()) { showToast('Explique o motivo da negativa.', 'error'); return; }
    setAcaoId(negarDe.id);
    try {
      const { error } = await supabase.rpc('decidir_vaga', { p_vaga_id: negarDe.id, p_aprovar: false, p_motivo: motivoNegativa.trim() });
      if (error) throw error;
      showToast('Vaga negada.', 'success');
      setNegarDe(null);
      setMotivoNegativa('');
      await reload();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao negar.', 'error', true);
    }
    setAcaoId(null);
  };

  return (
    <div className="flex flex-col gap-6 shrink-0">
      {/* O título de cada seção é a própria aba — repeti-lo aqui era a metade
          do peso visual que fazia a tela parecer três telas empilhadas. */}
      {secao === 'pendentes' && (
        <div>
        {pendentes.length === 0 ? (
          <Vazio message="Nenhuma vaga aguardando aprovação." />
        ) : (
          <div className="flex flex-col gap-2">
            {pendentes.map((v: any) => (
              <div key={v.id} className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-100 flex flex-wrap items-center gap-2">
                    {v.quantidade}x {v.cargo}{v.departamento ? ` · ${v.departamento}` : ''} — {v.filial}
                    {v.tipo === 'Interna' && (
                      <Badge label={v.escopo === 'Interfilial' ? 'Interna · rede' : 'Interna'}
                        cls="bg-indigo-500/10 text-indigo-400 border-indigo-500/20" />
                    )}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{v.justificativa}</p>
                  {(v.salario_min || v.salario_max) && (
                    <p className="text-[11px] text-gray-600 mt-0.5">Faixa: {brl(v.salario_min ?? 0)} – {brl(v.salario_max ?? 0)}</p>
                  )}
                  <p className="text-[10px] text-gray-600 mt-0.5">Pedido por {v.criado_por_nome ?? '—'}</p>
                </div>
                {podeDecidir && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setNegarDe(v)} disabled={acaoId === v.id}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold text-red-400 border border-red-500/20 hover:bg-red-500/10 flex items-center gap-1.5 disabled:opacity-50">
                      <XCircle size={14} /> Negar
                    </button>
                    <button onClick={() => handleAprovar(v)} disabled={acaoId === v.id}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold text-accent border border-accent/20 hover:bg-accent/10 flex items-center gap-1.5 disabled:opacity-50">
                      {acaoId === v.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Aprovar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {secao === 'decididas' && (
        <div>
        {decididas.length === 0 ? (
          <Vazio message="Nenhuma decisão registrada ainda." />
        ) : (
          <div className="flex flex-col gap-2">
            {decididas.map((v: any) => (
              <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 truncate">{v.quantidade}x {v.cargo} — {v.filial}</p>
                  <p className="text-[11px] text-gray-500 truncate">{v.decidido_por_nome ? `Decidido por ${v.decidido_por_nome}` : ''}</p>
                </div>
                <Badge label={v.status} cls={VAGA_STATUS_CLS[v.status]} />
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      <AnimatePresence>
        {negarDe && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setNegarDe(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} onClick={e => e.stopPropagation()}
              className="neu-flat rounded-2xl p-6 w-full max-w-md border border-white/10">
              <h3 className="text-lg font-bold text-gray-100 mb-4">Negar vaga de {negarDe.cargo}?</h3>
              <textarea rows={3} value={motivoNegativa} onChange={e => setMotivoNegativa(e.target.value)}
                placeholder="Motivo da negativa (obrigatório)"
                className="neu-input rounded-xl px-3 py-2.5 text-sm w-full resize-none" />
              <div className="flex justify-end gap-3 mt-5">
                <button onClick={() => setNegarDe(null)} className="text-sm text-gray-400 hover:text-gray-300 px-4">Cancelar</button>
                <NeuButtonAccent onClick={handleNegar} isLoading={acaoId === negarDe.id}>Confirmar negativa</NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const RecrutamentoView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  // `filialAtiva === null` é modo Matriz — a própria view trata o caso.
  return <RecrutamentoInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
