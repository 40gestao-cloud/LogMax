import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GraduationCap, Save, RotateCcw, Check, Users, Layers, Lock, ChevronDown, Filter, AlertTriangle, Workflow, ClipboardCheck, RefreshCw, ShieldAlert, Circle, ClipboardList, Presentation, History, FolderPlus, FileWarning, Hourglass } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAulaConfig, type AulaConfig } from '../hooks/useAulaConfig';
import { useBlackout } from '../hooks/useBlackout';
import { useConfirm } from '../contexts/ConfirmContext';
import { AULA_MODULOS, AULA_PRESETS, AULA_ROLES_ALVO, AULA_SUBMENUS, AULA_MODULO_SETORES, aulaSubmenuId, rotuloDaView } from '../lib/aulaModulos';
import {
  AULA_FLUXOS, analisarCadeias, etapaCoberta, configDoFluxo, completarComFluxo,
  etapasObrigatorias, apoioDoFluxo, apoioCoberto,
} from '../lib/aulaFluxos';
import { useAulaPreRequisitos } from '../hooks/useAulaPreRequisitos';
import { AulaAtividadeModal } from './AulaAtividadeModal';
import { AulaAtividadesPublicadas } from './AulaAtividadesPublicadas';
import { AulaFluxoProjecao } from './AulaFluxoProjecao';
import { AulaPainelControle } from './AulaPainelControle';
import { AulaConferenciaFluxo } from './AulaConferenciaFluxo';
import { PendenciasView } from './PendenciasView';
import { AulaHistorico } from './AulaHistorico';
import type { UserProfile } from '../hooks/useUserProfile';
import { NeuButtonAccent, LoadingSpinner, CardContador } from '../components/ui';
import { BotaoRecarregarTurma } from '../components/BotaoRecarregarTurma';

interface Props {
  showToast: (msg: string, type?: string) => void;
  profile: UserProfile;
}

const arraysIguais = (a: string[], b: string[]) =>
  a.length === b.length && a.every(x => b.includes(x));

// As três coisas que esta tela faz, na ordem em que a aula acontece: montar o
// recorte, enviar o enunciado, acompanhar quem fez.
type AbaId = 'montagem' | 'atividades' | 'controle' | 'conferencia' | 'pendencias' | 'historico';
const ABAS: { id: AbaId; label: string; icone: any }[] = [
  { id: 'montagem',   label: 'Montagem',   icone: Workflow },
  { id: 'atividades', label: 'Atividades', icone: ClipboardList },
  { id: 'controle',   label: 'Controle',   icone: ClipboardCheck },
  // Controle conta quem FEZ; Conferência conta COMO foi feito. Separadas de
  // propósito: juntar "o Joel parou na etapa 3" com "o valor do pedido não bate
  // com a cotação" faria uma tela responder mal as duas perguntas.
  { id: 'conferencia', label: 'Conferência', icone: FileWarning },
  // Pendências é a terceira pergunta e a única que NÃO se recorta por sessão:
  // "o que ficou para trás" atravessa aulas, e o dado é há quantos dias o
  // documento está parado. Enfiá-la dentro da Conferência misturaria dois
  // recortes de tempo na mesma tela.
  { id: 'pendencias', label: 'Pendências', icone: Hourglass },
  { id: 'historico',  label: 'Histórico',  icone: History },
];

// Fluxos por área, para achar o da aula sem ler seis nomes longos.
const AREA_DO_FLUXO: Record<string, string> = {
  'compra': 'Compras e estoque', 'material': 'Compras e estoque',
  'venda-pdv': 'Vendas', 'venda-pedido': 'Vendas', 'marketing-promo': 'Vendas',
  'rh-folha': 'Pessoas',
};
const AREAS_FLUXO = ['Compras e estoque', 'Vendas', 'Pessoas', 'Outros'];

export const AulaModoView: React.FC<Props> = ({ showToast, profile }) => {
  // Simulação de perda de dados (migr. 339). Mora aqui porque é o painel de
  // condução da aula, e porque quem liga é a mesma pessoa que liga o Modo Aula.
  const { blackout } = useBlackout();
  const [simSalvando, setSimSalvando] = useState(false);
  const [simMensagem, setSimMensagem] = useState('');
  const confirmar = useConfirm();

  const alternarSimulacao = async (ligar: boolean) => {
    if (!supabase) { showToast('Supabase não configurado', 'error'); return; }
    if (ligar && !await confirmar(
      'Ligar a simulação de perda de dados?\n\n' +
      'Os alunos deixam de ver e de lançar qualquer movimento — pedidos, vendas, contas, estoque. ' +
      'NADA é apagado: o bloqueio é só de leitura e escrita, e desligar devolve tudo na hora.\n\n' +
      'Você e a direção continuam vendo normalmente.')) return;

    setSimSalvando(true);
    try {
      const { error } = await supabase.rpc('alternar_simulacao_perda', {
        p_ativo: ligar,
        p_mensagem: ligar ? (simMensagem.trim() || null) : null,
      });
      if (error) throw error;
      showToast(ligar
        ? 'Simulação ligada — as telas da turma estão vazias.'
        : 'Simulação desligada — os dados voltaram.', 'success');
    } catch (err: any) {
      showToast(err?.message ?? 'Falha ao alternar a simulação.', 'error');
    } finally {
      setSimSalvando(false);
    }
  };

  const { config, loaded } = useAulaConfig();

  const [ativo, setAtivo] = useState(false);
  const [modulos, setModulos] = useState<string[]>([]);
  const [submenus, setSubmenus] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>(['colaborador', 'gerente']);
  const [salvando, setSalvando] = useState(false);
  // Painel de submenus expandido por módulo (só UI local, não persiste).
  const [expandido, setExpandido] = useState<Record<string, boolean>>({});
  // Fluxo com o diagrama de etapas aberto (um por vez — é material de projeção).
  const [fluxoAberto, setFluxoAberto] = useState<string | null>(null);
  // Fluxo cuja atividade está sendo montada (modal). Null = fechado.
  const [fluxoAtividade, setFluxoAtividade] = useState<string | null>(null);
  // Fluxo em projeção (tela cheia). Independente do `fluxoAberto`: o professor
  // projeta um e continua conferindo outro no card.
  const [fluxoProjetado, setFluxoProjetado] = useState<string | null>(null);
  // Incrementa a cada publicação: é o que faz a atividade recém-enviada
  // aparecer no painel de acompanhamento sem o professor ter que recarregar.
  const [atividadesVersao, setAtividadesVersao] = useState(0);
  const [aba, setAba] = useState<AbaId>('montagem');
  const [modoMontagem, setModoMontagem] = useState<'fluxos' | 'manual'>('fluxos');
  const [alternando, setAlternando] = useState(false);
  const [verTodosDados, setVerTodosDados] = useState(false);

  // Config em que a edição local se apoia. Comparar contra ela — e não contra
  // `config`, que o realtime troca por baixo — é o que separa "ainda não mexi"
  // de "mexi e alguém salvou".
  const baseRef = useRef<AulaConfig | null>(null);
  // Espelho do estado local para o efeito de sincronia poder consultá-lo sem
  // virar dependência: com os arrays na lista de deps, cada submenu marcado
  // reexecutaria a sincronia e desfaria a própria marcação.
  const localRef = useRef({ ativo, modulos, submenus, roles });
  localRef.current = { ativo, modulos, submenus, roles };
  // Quando preenchido: chegou config nova do servidor e havia trabalho local
  // não salvo. Guarda o `atualizado_em` de quem salvou, para datar o aviso.
  const [conflito, setConflito] = useState<string | null>(null);

  /** Adota a config do servidor, descartando a edição local. */
  const adotarDoServidor = () => {
    baseRef.current = config;
    setAtivo(config.ativo);
    setModulos(config.modulos_ativos);
    setSubmenus(config.submenus_ativos);
    setRoles(config.roles_afetados);
    setConflito(null);
  };

  useEffect(() => {
    if (!loaded) return;
    const base = baseRef.current;
    const local = localRef.current;
    // Só a montagem é edição local: o interruptor grava sozinho (`alternarAtivo`).
    const sujo = base !== null && (
      !arraysIguais(local.modulos, base.modulos_ativos) ||
      !arraysIguais(local.submenus, base.submenus_ativos) ||
      !arraysIguais(local.roles, base.roles_afetados)
    );
    // Convergiu: o que chegou do servidor é exatamente o que está na tela.
    const igualAoServidor =
      arraysIguais(local.modulos, config.modulos_ativos) &&
      arraysIguais(local.submenus, config.submenus_ativos) &&
      arraysIguais(local.roles, config.roles_afetados);

    // Sobrescrever aqui apagaria, sem uma palavra, a montagem ainda não salva.
    if (sujo && !igualAoServidor) {
      const servidorMexeuNaMontagem =
        !arraysIguais(config.modulos_ativos, base!.modulos_ativos) ||
        !arraysIguais(config.submenus_ativos, base!.submenus_ativos) ||
        !arraysIguais(config.roles_afetados, base!.roles_afetados);
      // Ligar/desligar (daqui ou de outra máquina) não conflita com a montagem pendente.
      setAtivo(config.ativo);
      baseRef.current = { ...base!, ativo: config.ativo, atualizado_em: config.atualizado_em };
      if (servidorMexeuNaMontagem) setConflito(config.atualizado_em ?? new Date().toISOString());
      return;
    }
    adotarDoServidor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, config.ativo, config.atualizado_em]);

  // Fluxos que esta config encostou. Um fluxo sem nenhuma etapa ligada não é
  // "quebrado" — é só um assunto que não é o de hoje, e checar pré-requisito
  // dele seria ruído.
  // Mesmo critério do alerta: só conta como "encostado" o fluxo que a turma
  // consegue começar. Sem isso, ligar um módulo compartilhado puxava o
  // pré-requisito de meia dúzia de fluxos que não são o assunto da aula.
  const fluxosRelevantes = AULA_FLUXOS.filter(f => {
    const obrig = etapasObrigatorias(f);
    return obrig.length > 0 && etapaCoberta(obrig[0], modulos, submenus);
  });
  const cadeiasQuebradas = analisarCadeias(modulos, submenus);
  const { status: preStatus, loading: preLoading, verificar: reverificarPre } =
    useAulaPreRequisitos(fluxosRelevantes.flatMap(f => f.prerequisitos));
  const preFaltando = preStatus.filter(p => !p.ok);

  // Contagem das abas: o professor vê onde há algo a olhar sem abrir cada uma.
  // Uma leitura ao abrir (e a cada publicação), sem realtime — aqui é só um sinal.
  const [contagem, setContagem] = useState<Partial<Record<AbaId, number>>>({});
  useEffect(() => {
    if (!supabase || (profile.role !== 'admin' && profile.role !== 'ceo')) return;
    let cancelado = false;
    supabase.from('aula_atividades').select('id', { count: 'exact', head: true })
      .eq('ativo', true)
      .or(`expira_em.is.null,expira_em.gt.${new Date().toISOString()}`)
      .then(({ count }) => { if (!cancelado) setContagem(c => ({ ...c, atividades: count ?? 0 })); });
    if (profile.role === 'admin') {
      supabase.rpc('listar_pendencias', { p_filial: null })
        .then(({ data }) => { if (!cancelado && Array.isArray(data)) setContagem(c => ({ ...c, pendencias: data.length })); });
    }
    return () => { cancelado = true; };
  }, [atividadesVersao, profile.role]);

  // Setores que a whitelist concede a todo aluno afetado (migr. 317).
  const setoresConcedidos = Array.from(new Set(
    modulos.flatMap(m => AULA_MODULO_SETORES[m] ?? []),
  ));

  // Fluxos que a whitelist atual fecha inteiros. É a resposta curta para "que
  // aula está montada aqui?" — ler isso do grid de módulos exigia saber de cor
  // qual combinação forma qual cadeia.
  const fluxosCompletos = AULA_FLUXOS.filter(f => {
    const obrig = etapasObrigatorias(f);
    return obrig.length > 0 && obrig.every(e => etapaCoberta(e, modulos, submenus));
  });

  // «Montar» SUBSTITUI a whitelist; «Completar», ao lado, só acrescenta. Só o
  // title distinguia os dois, e o clique errado levava junto o recorte de
  // submenus que o professor montou à mão — sem desfazer, porque «Descartar»
  // volta ao que está salvo, não ao que estava um clique atrás.
  const montarFluxo = async (fluxoId: string) => {
    const f = AULA_FLUXOS.find(x => x.id === fluxoId);
    if (!f) return;
    const cfg = configDoFluxo(f);
    const temSelecao = modulos.length > 0 || submenus.length > 0;
    const mudaAlgo = !arraysIguais(cfg.modulos, modulos) || !arraysIguais(cfg.submenus, submenus);
    if (temSelecao && mudaAlgo && !await confirmar({
      message: `Montar "${f.nome}" substitui a seleção atual`
        + `${modulos.length > 0 ? ` (${modulos.length} módulo${modulos.length === 1 ? '' : 's'}` : ''}`
        + `${submenus.length > 0 ? `${modulos.length > 0 ? ', ' : ' ('}${submenus.length} submenu${submenus.length === 1 ? '' : 's'}` : ''}`
        + `${temSelecao ? ')' : ''} pela whitelist deste fluxo.\n\n`
        + 'Para somar este fluxo ao que já está marcado, sem tirar nada, use «Completar» '
        + 'no aviso de cadeia incompleta.',
      confirmLabel: 'Substituir',
    })) return;
    setModulos(cfg.modulos);
    setSubmenus(cfg.submenus);
    setFluxoAberto(fluxoId);
  };

  const completarCadeia = (fluxoId: string) => {
    const f = AULA_FLUXOS.find(x => x.id === fluxoId);
    if (!f) return;
    const cfg = completarComFluxo(f, modulos, submenus);
    setModulos(cfg.modulos);
    setSubmenus(cfg.submenus);
  };

  if (profile.role !== 'admin' && profile.role !== 'ceo') {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-3 text-center">
        <Lock size={32} className="text-gray-600" />
        <h2 className="text-lg font-bold text-gray-300">Acesso restrito</h2>
        <p className="text-sm text-gray-500 max-w-sm">Apenas admin/CEO podem configurar o Modo Aula.</p>
      </div>
    );
  }

  if (!loaded) return <LoadingSpinner />;

  const dirty =
    !arraysIguais(modulos, config.modulos_ativos) ||
    !arraysIguais(submenus, config.submenus_ativos) ||
    !arraysIguais(roles, config.roles_afetados);

  const toggleModulo = (id: string) =>
    setModulos(prev => {
      if (prev.includes(id)) {
        // Ao desmarcar módulo, remove submenus dele pra não ficarem órfãos.
        setSubmenus(s => s.filter(sv => !sv.startsWith(`${id}-`)));
        return prev.filter(x => x !== id);
      }
      return [...prev, id];
    });

  const toggleSubmenu = (viewId: string) =>
    setSubmenus(prev => prev.includes(viewId) ? prev.filter(x => x !== viewId) : [...prev, viewId]);

  const limparSubmenusDoModulo = (modId: string) =>
    setSubmenus(prev => prev.filter(s => !s.startsWith(`${modId}-`)));

  // Módulo ligado que esconde ao menos um submenu (todos marcados = sem recorte).
  const modulosRecortados = modulos.filter(id => {
    const total = AULA_SUBMENUS[id]?.length ?? 0;
    const marcados = submenus.filter(s => s.startsWith(`${id}-`)).length;
    return marcados > 0 && marcados < total;
  }).length;

  // Liga/desliga a área inteira; desligar leva junto os submenus recortados.
  const alternarGrupo = (ids: string[], ligar: boolean) => {
    setModulos(prev => ligar ? Array.from(new Set([...prev, ...ids])) : prev.filter(x => !ids.includes(x)));
    if (!ligar) setSubmenus(prev => prev.filter(s => !ids.some(id => s.startsWith(`${id}-`))));
  };

  // Chip de submenu = "a turma vê isto". Sem recorte, todos aparecem ligados;
  // o primeiro clique esconde aquele, e voltar a mostrar todos limpa o recorte.
  const alternarSubmenuVisivel = (modId: string, sid: string) => {
    const doMod = (AULA_SUBMENUS[modId] ?? []).map(l => aulaSubmenuId(modId, l));
    setSubmenus(prev => {
      const atuais = prev.filter(s => s.startsWith(`${modId}-`));
      const resto = prev.filter(s => !s.startsWith(`${modId}-`));
      const base = atuais.length === 0 ? doMod : atuais;
      const prox = base.includes(sid) ? base.filter(x => x !== sid) : [...base, sid];
      return prox.length === 0 || prox.length === doMod.length ? resto : [...resto, ...prox];
    });
  };

  const toggleRole = (id: string) =>
    setRoles(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const aplicarPreset = (mods: string[]) => {
    setModulos(mods);
    setSubmenus([]);
  };

  // Aula livre: todos os módulos, nenhum submenu recortado (vazio = todos).
  const tudoAplicado = AULA_MODULOS.every(m => modulos.includes(m.id)) && modulosRecortados === 0;
  const aplicarTudo = () => aplicarPreset(AULA_MODULOS.map(m => m.id));

  // Descartar volta ao que está NO SERVIDOR agora — inclusive quando quem
  // salvou por último foi outra pessoa.
  const resetar = adotarDoServidor;

  // O interruptor vale na hora, sem passar pelo Salvar: era fácil ligar e
  // esquecer de salvar. A montagem pendente continua pendente.
  const alternarAtivo = async () => {
    if (!supabase) { showToast('Supabase não configurado', 'error'); return; }
    const novo = !ativo;
    setAlternando(true);
    try {
      const { error } = await supabase
        .from('aula_config')
        .update({ ativo: novo, atualizado_por: profile.id, atualizado_em: new Date().toISOString() })
        .eq('id', 1);
      if (error) throw error;
      setAtivo(novo);
      if (baseRef.current) baseRef.current = { ...baseRef.current, ativo: novo };
      showToast(novo
        ? (dirty ? 'Modo Aula ligado. Salve a montagem para ela valer.' : 'Modo Aula ligado para a turma.')
        : 'Modo Aula desligado. Sessão encerrada no histórico.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error');
    } finally {
      setAlternando(false);
    }
  };

  const salvar = async () => {
    if (!supabase) { showToast('Supabase não configurado', 'error'); return; }
    setSalvando(true);
    try {
      const { error } = await supabase
        .from('aula_config')
        .update({
          modulos_ativos: modulos,
          submenus_ativos: submenus,
          roles_afetados: roles,
          atualizado_por: profile.id,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', 1);
      if (error) throw error;
      // O que acabou de ser gravado passa a ser a base. Sem isto, o eco do
      // próprio save chega pelo realtime, não bate com a base antiga e a tela
      // acusaria conflito com ela mesma.
      baseRef.current = {
        ativo,
        modulos_ativos: modulos,
        submenus_ativos: submenus,
        roles_afetados: roles,
        atualizado_em: null,
      };
      setConflito(null);
      showToast(ativo ? 'Montagem salva — já vale para a turma.' : 'Montagem salva. Ligue o Modo Aula para valer.', 'success');
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error');
    } finally {
      setSalvando(false);
    }
  };

  const grupos = Array.from(new Set(AULA_MODULOS.map(m => m.grupo)));

  const totalAlertas = cadeiasQuebradas.length + preFaltando.length + (setoresConcedidos.length >= 2 ? 1 : 0);

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <GraduationCap size={26} /> Modo Aula
        </h1>
        {/* Conferência e Pendências só para o professor: o CEO é aluno e um dos auditados. */}
        <div className="flex gap-1 neu-pressed rounded-xl p-1 border border-white/5 flex-wrap" role="tablist">
          {ABAS.filter(t => !['conferencia', 'pendencias'].includes(t.id) || profile?.role === 'admin').map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={aba === t.id} onClick={() => setAba(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                aba === t.id ? 'bg-accent text-[var(--color-accent-text)]' : 'text-gray-400 hover:text-gray-200'}`}>
              <t.icone size={13} /> {t.label}
              {(contagem[t.id] ?? 0) > 0 && (
                <span className={`min-w-5 h-5 px-1.5 rounded-full text-[10px] font-black tabular-nums flex items-center justify-center ${
                  aba === t.id ? 'bg-black/25 text-current'
                  : t.id === 'pendencias' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white'}`}>
                  {contagem[t.id]}
                </span>
              )}
              {/* Montagem não salva continua visível de qualquer aba. */}
              {t.id === 'montagem' && dirty && <span className="w-2 h-2 rounded-full bg-amber-400" title="Montagem não salva" />}
            </button>
          ))}
        </div>
      </div>

      {/* Outra pessoa salvou enquanto esta tela tinha trabalho pendente. */}
      {conflito && (
        <div className="rounded-2xl px-4 py-3 bg-amber-500/10 border border-amber-500/40 flex items-center gap-3 flex-wrap">
          <AlertTriangle size={16} className="text-amber-400 shrink-0" />
          <p className="flex-1 min-w-0 text-sm text-amber-100">
            Outra pessoa alterou o Modo Aula às{' '}
            {new Date(conflito).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' })}.
            {' '}Salvar sobrescreve; descartar fica com a dela.
          </p>
          <button type="button" onClick={adotarDoServidor} className="btn-solido btn-solido--laranja shrink-0">
            Carregar a do servidor
          </button>
        </div>
      )}

      {aba === 'montagem' && (<>
      {/* Situação: o interruptor e o que está valendo, numa faixa só. */}
      <div className="grid grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-4">
        <button type="button" onClick={() => void alternarAtivo()} disabled={alternando} aria-pressed={ativo}
          title={ativo ? 'Desligar agora (fecha a sessão no histórico; sozinho às 22h)' : 'Ligar agora para a turma'}
          className={`contador ${ativo ? 'contador--verde' : 'contador--neutro'} rounded-2xl px-4 py-4 flex items-center justify-center gap-3 text-left disabled:opacity-60`}>
          <span className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${ativo ? 'bg-green-500' : 'bg-zinc-600'}`}>
            <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="absolute top-1 w-5 h-5 rounded-full bg-white shadow" style={{ left: ativo ? 24 : 4 }} />
          </span>
          <span className="flex flex-col">
            <span className="contador-rotulo text-[10px] uppercase tracking-widest font-bold">Modo Aula</span>
            <span className="contador-valor text-xl font-black leading-tight">{ativo ? 'Ligado' : 'Desligado'}</span>
          </span>
        </button>
        <CardContador label="Módulos aplicados" value={`${modulos.length}/${AULA_MODULOS.length}`} tom="azul"
          sub={tudoAplicado ? 'Tudo aplicado' : modulosRecortados > 0 ? `${modulosRecortados} com submenus escondidos` : 'Todos os submenus'} />
        <CardContador label="Fluxos completos" value={fluxosCompletos.length} tom="verde"
          sub={`de ${AULA_FLUXOS.length} fluxos`} />
        <CardContador label="Alertas" value={totalAlertas} tom="amarelo"
          sub={totalAlertas > 0 ? 'Veja ao lado' : 'Tudo certo'} />
        {/* Salvar mora aqui, ao lado do que está valendo — a barra flutuante cobria os fluxos. */}
        <div className={`col-span-2 lg:col-span-1 rounded-2xl px-4 py-3 flex lg:flex-col items-center justify-center gap-2 border ${
          dirty ? 'border-amber-500/60 bg-amber-500/10' : 'border-white/5'}`}>
          <span className={`text-[10px] uppercase tracking-widest font-bold ${dirty ? 'text-amber-300' : 'text-gray-500'} mr-auto lg:mr-0`}>
            {dirty ? 'Não salvo' : 'Montagem salva'}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={resetar} disabled={!dirty || salvando} title="Voltar ao que está salvo"
              className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-200 disabled:opacity-30">
              <RotateCcw size={15} />
            </button>
            <NeuButtonAccent onClick={salvar} isLoading={salvando} disabled={!dirty}>
              <Save size={14} /> Salvar
            </NeuButtonAccent>
          </div>
        </div>
      </div>

      {dirty && ativo && (
        <p className="text-xs text-amber-300 -mt-1">A turma ainda vê a montagem anterior até você salvar.</p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        {/* Estrutura da aula: pelos fluxos de operação ou módulo a módulo. */}
        <section className="xl:col-span-2 neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Duas formas de estruturar a aula; a montagem é uma só e vale nas duas. */}
            <div className="flex gap-1 neu-pressed rounded-xl p-1 border border-white/5" role="radiogroup" aria-label="Estruturar a aula">
              {([['fluxos', 'Pelos fluxos', Workflow], ['manual', 'À mão', Layers]] as const).map(([id, rotulo, Icone]) => (
                <button key={id} type="button" role="radio" aria-checked={modoMontagem === id}
                  onClick={() => setModoMontagem(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    modoMontagem === id ? 'bg-accent text-[var(--color-accent-text)]' : 'text-gray-400 hover:text-gray-200'}`}>
                  <Icone size={13} /> {rotulo}
                </button>
              ))}
            </div>
            <button type="button" onClick={aplicarTudo} disabled={tudoAplicado}
              title="Aplica todos os módulos e submenus à turma"
              className="btn-solido btn-solido--verde disabled:opacity-60 disabled:cursor-default">
              <Check size={15} /> {tudoAplicado ? 'Tudo aplicado' : 'Aplicar tudo'}
            </button>
          </div>
          {modoMontagem === 'fluxos' ? (
          <div className="flex flex-col gap-4">
            {AREAS_FLUXO.map(area => {
              const doGrupo = AULA_FLUXOS.filter(f => (AREA_DO_FLUXO[f.id] ?? 'Outros') === area);
              if (doGrupo.length === 0) return null;
              return (
            <div key={area} className="flex flex-col gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{area}</p>
            {doGrupo.map(f => {
              const obrig = etapasObrigatorias(f);
              const cobertas = obrig.filter(e => etapaCoberta(e, modulos, submenus)).length;
              const completo = cobertas === obrig.length;
              const parcial = !completo && cobertas > 0;
              const aberto = fluxoAberto === f.id;
              return (
                <div key={f.id} className={`rounded-xl border overflow-hidden ${
                  completo ? 'border-green-600/60 bg-green-500/5' : parcial ? 'border-amber-500/40' : 'border-white/5'}`}>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className={`shrink-0 min-w-[3.25rem] text-center px-2 py-1 rounded-lg text-[11px] font-black tabular-nums ${
                      completo ? 'bg-green-600 text-white' : parcial ? 'bg-amber-500 text-black' : 'bg-zinc-700 text-zinc-300'}`}>
                      {cobertas}/{obrig.length}
                    </span>
                    <button type="button" onClick={() => setFluxoAberto(aberto ? null : f.id)} title={f.resumo}
                      className="flex-1 min-w-0 text-left">
                      <p className={`text-sm font-bold truncate ${completo ? 'text-green-400' : 'text-gray-200'}`}>{f.nome}</p>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button type="button" onClick={() => void montarFluxo(f.id)}
                        title="Substitui a seleção pelos módulos deste fluxo"
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                          completo ? 'bg-white/5 text-gray-400 hover:text-gray-200' : 'bg-accent text-[var(--color-accent-text)] hover:brightness-110'}`}>
                        Montar
                      </button>
                      <button type="button" onClick={() => setFluxoAtividade(f.id)} title="Atividade deste fluxo"
                        className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                        <ClipboardList size={14} />
                      </button>
                      <button type="button" onClick={() => setFluxoProjetado(f.id)} title="Projetar para a turma"
                        className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                        <Presentation size={14} />
                      </button>
                      <button type="button" onClick={() => setFluxoAberto(aberto ? null : f.id)} title="Etapas"
                        className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                        <ChevronDown size={14} className={`transition-transform ${aberto ? 'rotate-180 text-accent' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {aberto && (
                    <div className="border-t border-white/5 bg-black/20 px-4 py-3 flex flex-col">
                      <p className="text-xs text-gray-400 mb-3">{f.resumo}</p>
                      {f.etapas.map((etapa, i) => {
                        const ok = etapaCoberta(etapa, modulos, submenus);
                        const ultima = i === f.etapas.length - 1 && !apoioDoFluxo(f);
                        return (
                          <div key={`${etapa.view}-${i}`} className="flex gap-3">
                            <div className="flex flex-col items-center shrink-0">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
                                ok ? 'bg-green-600 text-white' : etapa.opcional ? 'border border-white/20 text-gray-500' : 'bg-amber-500 text-black'}`}>
                                {i + 1}
                              </div>
                              {!ultima && <div className={`w-px flex-1 my-1 ${ok ? 'bg-green-600/50' : 'bg-white/10'}`} />}
                            </div>
                            <div className={`min-w-0 flex-1 ${ultima ? '' : 'pb-3'}`}>
                              <p className={`text-xs font-bold ${ok ? 'text-gray-100' : 'text-gray-400'}`}>
                                {etapa.titulo}
                                {etapa.opcional && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-widest text-gray-500">opcional</span>}
                              </p>
                              <p className="text-[11px] text-accent/80">{etapa.quem}</p>
                              {!ok && !etapa.opcional && (
                                <p className="text-[11px] text-amber-300 mt-0.5">{etapa.seQuebra}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {(() => {
                        const apoio = apoioDoFluxo(f);
                        if (!apoio) return null;
                        return (
                          <div className="flex gap-3">
                            <div className="w-6 h-6 rounded-full border border-dashed border-white/25 flex items-center justify-center text-gray-500 shrink-0">
                              <FolderPlus size={11} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-gray-300" title={apoio.nota}>Apoio</p>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {apoio.views.map(v => {
                                  const okApoio = apoioCoberto(v, modulos, submenus);
                                  return (
                                    <span key={v} className={`text-[10px] font-semibold rounded-md px-2 py-0.5 ${
                                      okApoio ? 'bg-green-600/20 text-green-300' : 'bg-amber-500/15 text-amber-300'}`}>
                                      {rotuloDaView(v)}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
              );
            })}
          </div>
          ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mr-1">Atalhos</span>
              {AULA_PRESETS.map(p => (
                <button key={p.nome} type="button" onClick={() => aplicarPreset(p.modulos)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10 text-gray-300 hover:border-accent hover:text-accent transition-colors">
                  {p.nome}
                </button>
              ))}
            </div>

            {/* Um cartão por área, módulos em lista: a grade antiga deixava linhas tortas
                quando um módulo abria os submenus. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              {grupos.map(g => {
                const doGrupo = AULA_MODULOS.filter(m => m.grupo === g);
                const marcados = doGrupo.filter(m => modulos.includes(m.id)).length;
                const todosMarcados = marcados === doGrupo.length;
                return (
                  <div key={g} className="rounded-xl border border-white/10 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.04] border-b border-white/5">
                      <p className="flex-1 text-[11px] font-black uppercase tracking-widest text-gray-300">{g}</p>
                      <span className={`text-[11px] font-black tabular-nums px-1.5 py-0.5 rounded-md ${
                        marcados === 0 ? 'text-gray-500' : 'bg-accent text-[var(--color-accent-text)]'}`}>
                        {marcados}/{doGrupo.length}
                      </span>
                      <button type="button" onClick={() => alternarGrupo(doGrupo.map(m => m.id), !todosMarcados)}
                        className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent w-14 text-right">
                        {todosMarcados ? 'Nenhum' : 'Todos'}
                      </button>
                    </div>
                    <div className="flex flex-col divide-y divide-white/5">
                      {doGrupo.map(m => {
                        const active = modulos.includes(m.id);
                        const temSubmenus = AULA_SUBMENUS[m.id]?.length > 0;
                        const subsDoMod = temSubmenus ? AULA_SUBMENUS[m.id].map(l => aulaSubmenuId(m.id, l)) : [];
                        const subsSelecionados = submenus.filter(s => s.startsWith(`${m.id}-`));
                        // Todos marcados um a um é o mesmo que nenhum recorte.
                        const restrito = active && subsSelecionados.length > 0 && subsSelecionados.length < subsDoMod.length;
                        const isOpen = active && temSubmenus && !!expandido[m.id];
                        return (
                          <div key={m.id} className={active ? 'bg-accent/[0.06]' : ''}>
                            <div className="flex items-center gap-2 px-3 py-2">
                              <button type="button" onClick={() => toggleModulo(m.id)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                                <span className={`w-[18px] h-[18px] rounded-md flex items-center justify-center shrink-0 transition-colors ${
                                  active ? 'bg-accent' : 'border-2 border-white/20'}`}>
                                  {active && <Check size={12} strokeWidth={3} className="text-black" />}
                                </span>
                                <span className={`text-sm truncate ${active ? 'text-gray-100 font-semibold' : 'text-gray-400'}`}>{m.label}</span>
                              </button>
                              {active && temSubmenus && (
                                <button type="button" onClick={() => setExpandido(e => ({ ...e, [m.id]: !e[m.id] }))}
                                  title="Escolher quais submenus a turma vê"
                                  className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${
                                    restrito ? 'bg-amber-500 text-black' : 'bg-white/5 text-gray-400 hover:text-gray-200'}`}>
                                  {restrito ? `${subsSelecionados.length} de ${subsDoMod.length}` : 'Todos os submenus'}
                                  <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                </button>
                              )}
                            </div>
                            {/* Sem animação de altura: medir aqui fazia a página crescer a cada clique. */}
                            {isOpen && (
                              <div className="px-3 pb-3 pl-10 flex flex-wrap gap-1.5">
                                {AULA_SUBMENUS[m.id].map(label => {
                                  const sid = aulaSubmenuId(m.id, label);
                                  const visivel = !restrito || submenus.includes(sid);
                                  return (
                                    <button key={sid} type="button" onClick={() => alternarSubmenuVisivel(m.id, sid)}
                                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                                        visivel ? 'bg-accent/20 text-accent border border-accent/40' : 'text-gray-500 border border-white/10 line-through'}`}>
                                      {label}
                                    </button>
                                  );
                                })}
                                {restrito && (
                                  <button type="button" onClick={() => limparSubmenusDoModulo(m.id)}
                                    className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent">
                                    Mostrar todos
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          )}
        </section>

        <div className="flex flex-col gap-5">
          {/* Alertas da montagem, juntos: cadeia que não fecha, dado que falta, setores somados. */}
          <section id="alertas-aula" className={`neu-flat rounded-2xl p-5 border flex flex-col gap-3 ${
            totalAlertas > 0 ? 'border-amber-500/40' : 'border-white/5'}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                <AlertTriangle size={15} className={totalAlertas > 0 ? 'text-amber-400' : 'text-gray-500'} /> Alertas
              </h3>
              {fluxosRelevantes.length > 0 && (
                <button type="button" onClick={() => void reverificarPre()} disabled={preLoading} title="Verificar os dados de novo"
                  className="neu-button w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent disabled:opacity-50">
                  <RefreshCw size={12} className={preLoading ? 'animate-spin' : ''} />
                </button>
              )}
            </div>

            {totalAlertas === 0 && (
              <p className="text-xs text-gray-500 flex items-center gap-1.5"><Check size={13} className="text-green-500" /> Nada travando a aula.</p>
            )}

            {cadeiasQuebradas.map(c => (
              <div key={c.fluxo.id} className="rounded-xl bg-amber-500/10 px-3 py-2.5 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-amber-200">{c.fluxo.nome.split('—')[0].trim()} · {c.cobertas}/{c.total}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Para em <b className="text-gray-200">{c.faltando[0].titulo}</b>
                    {c.faltando.length > 1 && ` +${c.faltando.length - 1}`}
                  </p>
                </div>
                <button type="button" onClick={() => completarCadeia(c.fluxo.id)} title="Acrescenta as etapas que faltam, sem tirar nada"
                  className="btn-solido btn-solido--amarelo !py-1 !px-2.5 !text-[11px] shrink-0">
                  Completar
                </button>
              </div>
            ))}

            {fluxosRelevantes.length > 0 && preStatus.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Dados da turma</p>
                  {preStatus.some(p => p.ok && !p.indefinido) && (
                    <button type="button" onClick={() => setVerTodosDados(v => !v)}
                      className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent">
                      {verTodosDados ? 'Só pendentes' : `Ver todos (${preStatus.length})`}
                    </button>
                  )}
                </div>
                {preStatus.every(p => p.ok && !p.indefinido) && !verTodosDados && (
                  <p className="text-xs text-gray-500 flex items-center gap-1.5">
                    <Check size={13} className="text-green-500" /> Tudo cadastrado
                  </p>
                )}
                {preStatus.filter(p => verTodosDados || !p.ok || p.indefinido).map(p => (
                  <div key={p.id} className="flex items-center gap-2 py-0.5"
                    title={p.indefinido ? `Não verificado — confira em ${p.onde}` : !p.ok ? `Resolva em ${p.onde}` : undefined}>
                    {p.indefinido
                      ? <AlertTriangle size={13} className="text-gray-500 shrink-0" />
                      : p.ok ? <Check size={13} className="text-green-500 shrink-0" />
                      : <Circle size={13} className="text-amber-400 shrink-0" />}
                    <span className={`text-xs flex-1 min-w-0 truncate ${p.ok && !p.indefinido ? 'text-gray-300' : 'text-amber-200'}`}>{p.label}</span>
                    {p.quantidade >= 0 && <span className="text-[11px] tabular-nums text-gray-500">{p.quantidade}</span>}
                  </div>
                ))}
                {preStatus.some(p => !p.indefinido && p.filiaisVazias?.length) && (
                  <p className="text-[11px] text-amber-300 mt-1">
                    Sem material em {Array.from(new Set(preStatus.flatMap(p => p.filiaisVazias ?? []))).join(', ')}.
                  </p>
                )}
              </div>
            )}

            {setoresConcedidos.length >= 2 && (
              <p className="text-[11px] text-gray-400 flex items-start gap-1.5"
                title="Cada aluno afetado recebe todos esses setores; as travas de papel do banco continuam valendo.">
                <ShieldAlert size={13} className="text-gray-500 shrink-0 mt-px" />
                <span>Concede <b className="text-gray-200">{setoresConcedidos.length} setores</b> a cada aluno: {setoresConcedidos.join(', ')}.</span>
              </p>
            )}
          </section>

          <section className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-3">
            <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
              <Users size={15} className="text-accent" /> Quem segue o Modo Aula
            </h3>
            {/* O professor (admin) nunca é filtrado. */}
            <div className="flex flex-wrap gap-2">
              {AULA_ROLES_ALVO.map(r => {
                const on = roles.includes(r.id);
                return (
                  <button key={r.id} type="button" onClick={() => toggleRole(r.id)} title={r.hint}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                      on ? 'bg-accent text-[var(--color-accent-text)]' : 'bg-white/5 text-gray-400 hover:text-gray-200'}`}>
                    {on && <Check size={12} />} {r.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Ferramentas da sala: agem na turma na hora, sem Salvar. */}
          <section className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">
            <h3 className="text-sm font-bold text-gray-200">Ferramentas da turma</h3>
            {profile?.role === 'admin' && (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0">
                  <RefreshCw size={16} className="text-sky-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-gray-200">Recarregar máquinas</p>
                  <p className="text-[11px] text-gray-500">Cache limpo em 10 s, inclusive a sua</p>
                </div>
                <BotaoRecarregarTurma profile={profile} showToast={showToast}
                  className="btn-solido btn-solido--azul !py-1.5 !px-3 !text-[11px] shrink-0 disabled:opacity-50" />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-red-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-gray-200">Simulação de perda de dados</p>
                  <p className={`text-[11px] ${blackout.ativo ? 'text-red-300' : 'text-gray-500'}`}>
                    {blackout.ativo
                      ? `Ativa${blackout.iniciado_em ? ` desde ${new Date(blackout.iniciado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' })}` : ''}`
                      : 'Nada é apagado; desligar devolve tudo'}
                  </p>
                </div>
                <button type="button" onClick={() => alternarSimulacao(!blackout.ativo)} disabled={simSalvando}
                  className={`btn-solido ${blackout.ativo ? 'btn-solido--verde' : 'btn-solido--vermelho'} !py-1.5 !px-3 !text-[11px] shrink-0 disabled:opacity-50`}>
                  {simSalvando ? '…' : blackout.ativo ? 'Devolver' : 'Ligar'}
                </button>
              </div>
              {!blackout.ativo && (
                <input type="text" value={simMensagem} onChange={e => setSimMensagem(e.target.value)} maxLength={200}
                  placeholder="Mensagem para a turma (opcional)"
                  className="neu-input rounded-xl px-3 py-2 text-xs" />
              )}
            </div>
          </section>
        </div>
      </div>

      </>)}

      {aba === 'atividades' && (<>
      {/* O que já foi enviado e onde caiu. Conta quem ABRIU o enunciado; quem
          FEZ é a aba «Controle» — as duas perguntas são diferentes e juntá-las
          num painel só desfaria a distinção. */}
      <AulaAtividadesPublicadas showToast={showToast} profile={profile} recarregarEm={atividadesVersao} />
      </>)}

      {aba === 'controle' && (
        <AulaPainelControle showToast={showToast} recarregarEm={atividadesVersao} />
      )}

      {aba === 'conferencia' && profile?.role === 'admin' && (
        <AulaConferenciaFluxo showToast={showToast} />
      )}

      {aba === 'pendencias' && profile?.role === 'admin' && (
        <PendenciasView showToast={showToast} profile={profile} />
      )}

      {aba === 'historico' && <AulaHistorico showToast={showToast} />}

      {/* Projeção do fluxo. Recebe a whitelist EM EDIÇÃO, não a salva: projetar
          o que está no banco enquanto o professor monta outra coisa mostraria à
          turma um fluxo diferente do que ele está preparando. */}
      {fluxoProjetado && (() => {
        const f = AULA_FLUXOS.find(x => x.id === fluxoProjetado);
        if (!f) return null;
        return (
          <AulaFluxoProjecao
            fluxo={f}
            modulos={modulos}
            submenus={submenus}
            onClose={() => setFluxoProjetado(null)}
          />
        );
      })()}

      {/* Atividade do fluxo. O modal vive fora da lista para não remontar a
          cada re-render dos cards — o professor perderia o texto que digitou. */}
      {fluxoAtividade && (() => {
        const f = AULA_FLUXOS.find(x => x.id === fluxoAtividade);
        if (!f) return null;
        const obrig = etapasObrigatorias(f);
        return (
          <AulaAtividadeModal
            fluxo={f}
            profile={profile}
            showToast={showToast}
            onClose={() => setFluxoAtividade(null)}
            // Publicou: a aba de acompanhamento é o próximo lugar em que o
            // professor olha — deixá-lo na Montagem obrigaria a procurar a
            // confirmação de que a atividade saiu.
            onPublicado={() => { setAtividadesVersao(v => v + 1); setAba('atividades'); }}
            coberturaCompleta={obrig.every(e => etapaCoberta(e, modulos, submenus))}
            aulaAtiva={config.ativo}
          />
        );
      })()}

    </div>
  );
};
