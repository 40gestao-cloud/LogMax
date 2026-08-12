import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GraduationCap, Save, RotateCcw, Check, Users, Layers, Lock, ChevronDown, Filter, AlertTriangle, Workflow, ClipboardCheck, RefreshCw, ShieldAlert, Circle, ClipboardList, Presentation, History } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAulaConfig, type AulaConfig } from '../hooks/useAulaConfig';
import { useBlackout } from '../hooks/useBlackout';
import { useConfirm } from '../contexts/ConfirmContext';
import { AULA_MODULOS, AULA_PRESETS, AULA_ROLES_ALVO, AULA_SUBMENUS, AULA_MODULO_SETORES, aulaSubmenuId } from '../lib/aulaModulos';
import {
  AULA_FLUXOS, analisarCadeias, etapaCoberta, configDoFluxo, completarComFluxo,
  etapasObrigatorias,
} from '../lib/aulaFluxos';
import { useAulaPreRequisitos } from '../hooks/useAulaPreRequisitos';
import { AulaAtividadeModal } from './AulaAtividadeModal';
import { AulaAtividadesPublicadas } from './AulaAtividadesPublicadas';
import { AulaFluxoProjecao } from './AulaFluxoProjecao';
import { AulaPainelControle } from './AulaPainelControle';
import { AulaHistorico } from './AulaHistorico';
import type { UserProfile } from '../hooks/useUserProfile';
import { NeuButtonAccent, LoadingSpinner } from '../components/ui';

interface Props {
  showToast: (msg: string, type?: string) => void;
  profile: UserProfile;
}

const arraysIguais = (a: string[], b: string[]) =>
  a.length === b.length && a.every(x => b.includes(x));

// As três coisas que esta tela faz, na ordem em que a aula acontece: montar o
// recorte, enviar o enunciado, acompanhar quem fez.
type AbaId = 'montagem' | 'atividades' | 'controle' | 'historico';
const ABAS: { id: AbaId; label: string; icone: any }[] = [
  { id: 'montagem',   label: 'Montagem',   icone: Workflow },
  { id: 'atividades', label: 'Atividades', icone: ClipboardList },
  { id: 'controle',   label: 'Controle',   icone: ClipboardCheck },
  { id: 'historico',  label: 'Histórico',  icone: History },
];

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
    const sujo = base !== null && (
      local.ativo !== base.ativo ||
      !arraysIguais(local.modulos, base.modulos_ativos) ||
      !arraysIguais(local.submenus, base.submenus_ativos) ||
      !arraysIguais(local.roles, base.roles_afetados)
    );
    // Convergiu: o que chegou do servidor é exatamente o que está na tela.
    // Sem esta saída, salvar de outro lugar uma config IGUAL à editada aqui
    // levantava o aviso de conflito apontando para uma barra de ações que a
    // própria convergência tinha acabado de esconder (`dirty` vira false).
    const igualAoServidor =
      local.ativo === config.ativo &&
      arraysIguais(local.modulos, config.modulos_ativos) &&
      arraysIguais(local.submenus, config.submenus_ativos) &&
      arraysIguais(local.roles, config.roles_afetados);

    // Sobrescrever aqui apagava, sem uma palavra, a whitelist que o professor
    // acabou de montar — junto com a faixa "Alterações não salvas", que some e
    // leva embora a única pista de que havia algo para salvar.
    if (sujo && !igualAoServidor) {
      setConflito(config.atualizado_em ?? new Date().toISOString());
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

  const irPara = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

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
    ativo !== config.ativo ||
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

  const toggleRole = (id: string) =>
    setRoles(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const aplicarPreset = (mods: string[]) => {
    setModulos(mods);
    setSubmenus([]);
  };

  // Descartar volta ao que está NO SERVIDOR agora — inclusive quando quem
  // salvou por último foi outra pessoa.
  const resetar = adotarDoServidor;

  const salvar = async () => {
    if (!supabase) { showToast('Supabase não configurado', 'error'); return; }
    setSalvando(true);
    try {
      const { error } = await supabase
        .from('aula_config')
        .update({
          ativo,
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
      showToast(ativo ? 'Modo Aula ativado' : 'Modo Aula desligado', 'success');
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error');
    } finally {
      setSalvando(false);
    }
  };

  const grupos = Array.from(new Set(AULA_MODULOS.map(m => m.grupo)));

  return (
    // pb-24 reserva o espaço da barra sticky de ações. Sem isso ela cobre
    // permanentemente a última faixa de conteúdo — no fim da rolagem os
    // módulos do último grupo ficam atrás dela e não há como alcançá-los.
    <div className="flex flex-col gap-6 pb-24">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 neu-pressed rounded-2xl flex items-center justify-center shrink-0">
          <GraduationCap size={22} className="text-accent" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-100">Modo Aula</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Habilite apenas os módulos que a turma vai trabalhar hoje. O restante fica oculto pra
            todos os usuários selecionados (admin fica sempre com acesso total pra destravar).
          </p>
        </div>
      </div>

      {/* Outra pessoa salvou enquanto esta tela tinha trabalho pendente. As duas
          versões continuam de pé: a do servidor está valendo para a turma, a
          desta tela está na barra de ações esperando o Salvar. Quem decide qual
          fica é quem está aqui. */}
      {conflito && (
        <div className="neu-flat rounded-3xl p-5 border border-yellow-500/40 flex items-start gap-3 flex-wrap">
          <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-gray-200">
              Outra pessoa alterou o Modo Aula agora
            </h3>
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
              A config do servidor mudou{' '}
              {new Date(conflito).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' })}
              {' '}e é ela que a turma está vendo. O que está nesta tela são as suas alterações,
              ainda não salvas — <strong className="text-gray-400">Salvar</strong> sobrescreve a
              do servidor, <strong className="text-gray-400">Descartar</strong> abandona a sua.
            </p>
          </div>
          <button type="button" onClick={adotarDoServidor}
            className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 shrink-0">
            Carregar a do servidor
          </button>
        </div>
      )}

      {/* Abas. A tela juntava tres trabalhos que acontecem em momentos
          diferentes da aula -- montar, enviar, acompanhar -- num scroll unico
          de oito cards. A barra de acoes fica FORA das abas: alteracao nao
          salva nao pode sumir porque o professor foi conferir outra coisa. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {ABAS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAba(t.id)}
            className={`px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all flex items-center gap-2 ${
              aba === t.id
                ? 'bg-accent/15 text-accent border-accent/30'
                : 'neu-button border-white/5 text-gray-500 hover:text-gray-300'}`}
          >
            <t.icone size={13} /> {t.label}
          </button>
        ))}
      </div>

      {aba === 'montagem' && (<>
      {/* Toggle mestre + estado da aula. Os dois juntos porque é a mesma
          pergunta: "o que está valendo agora?". A tela é longa, e os avisos que
          respondem isso ficam espalhados por ela — as pastilhas abaixo dizem
          quantos são e levam até eles. */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setAtivo(v => !v)}
            className={`relative w-14 h-8 rounded-full transition-colors ${ativo ? 'bg-accent' : 'bg-gray-700'}`}
            aria-pressed={ativo}
          >
            <motion.span
              layout
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="absolute top-1 w-6 h-6 rounded-full bg-white shadow"
              style={{ left: ativo ? 28 : 4 }}
            />
          </button>
          <div>
            <div className="text-sm font-bold text-gray-100">
              {ativo ? 'Modo Aula ativado' : 'Modo Aula desligado'}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {ativo
                ? `${modulos.length} módulo${modulos.length === 1 ? '' : 's'} liberado${modulos.length === 1 ? '' : 's'}`
                : 'Sidebar segue o comportamento normal (RBAC por setor)'}
            </div>
            {/* O desligar deixou de ser só "devolver o menu": é ele que fecha a
                sessão no histórico (migr. 406). Sem essa frase, o professor não
                tem como saber que deixar ligado funde a aula de hoje com a de
                amanhã numa linha só. */}
            {ativo && (
              <div className="text-[10px] text-gray-600 mt-1">
                Desligue ao fim da aula: é o que fecha esta sessão no histórico.
                Esquecida ligada, ela é encerrada automaticamente às 22h.
              </div>
            )}
          </div>
        </div>
        {config.atualizado_em && (
          <div className="text-[10px] text-gray-600 text-right hidden sm:block">
            Última alteração<br />
            <span className="text-gray-500">
              {new Date(config.atualizado_em).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' })}
            </span>
          </div>
        )}
      </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {fluxosCompletos.length > 0 ? (
            fluxosCompletos.map(f => (
              <span key={f.id} title="Todas as etapas obrigatórias deste fluxo estão na whitelist"
                className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-accent/15 text-accent border border-accent/30 flex items-center gap-1.5">
                <Workflow size={10} /> {f.nome.split('—')[0].trim()}
              </span>
            ))
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full text-gray-500 border border-white/10">
              Nenhum fluxo completo
            </span>
          )}
          {/* Contadores que levam ao aviso. Um número sem caminho até ele
              obrigaria a varrer a tela inteira atrás do card correspondente. */}
          {cadeiasQuebradas.length > 0 && (
            <button type="button" onClick={() => irPara('alerta-cadeia')}
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full text-yellow-300 border border-yellow-500/40 hover:bg-yellow-500/10 transition-colors flex items-center gap-1.5">
              <AlertTriangle size={10} /> {cadeiasQuebradas.length} cadeia{cadeiasQuebradas.length === 1 ? '' : 's'} incompleta{cadeiasQuebradas.length === 1 ? '' : 's'}
            </button>
          )}
          {preFaltando.length > 0 && (
            <button type="button" onClick={() => irPara('alerta-prereq')}
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full text-yellow-300 border border-yellow-500/40 hover:bg-yellow-500/10 transition-colors flex items-center gap-1.5">
              <ClipboardCheck size={10} /> {preFaltando.length} pré-requisito{preFaltando.length === 1 ? '' : 's'}
            </button>
          )}
          {setoresConcedidos.length >= 2 && (
            <button type="button" onClick={() => irPara('alerta-setores')}
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full text-gray-400 border border-white/15 hover:bg-white/5 transition-colors flex items-center gap-1.5">
              <ShieldAlert size={10} /> {setoresConcedidos.length} setores
            </button>
          )}
        </div>
      </div>

      {/* Fluxos de operação — a seção principal desta tela.
          Marcar módulo a módulo obrigava o professor a saber de cor que a
          cotação morre sem o Financeiro. Aqui ele escolhe a OPERAÇÃO e a
          whitelist sai pronta, com o diagrama que ele projeta para a turma. */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Workflow size={14} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Fluxos de operação</h3>
          </div>
          <p className="text-[11px] text-gray-500 mt-1 max-w-2xl">
            A operação real atravessa vários módulos e mais de um papel. Escolha o fluxo
            que a turma vai percorrer hoje e o Modo Aula liga exatamente as telas dele —
            inclusive as dos outros setores, que são as que costumam faltar.
          </p>
        </div>

        {!ativo && (
          <p className="text-[11px] text-yellow-300/90 rounded-xl border border-yellow-500/30 px-3 py-2">
            O Modo Aula está desligado. Montar um fluxo prepara a whitelist, mas nada muda
            para a turma até você ligar o interruptor acima e salvar.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {AULA_FLUXOS.map(f => {
            // Cobertura conta só o que é obrigatório: uma etapa opcional
            // desligada não deixa o fluxo incompleto.
            const obrig = etapasObrigatorias(f);
            const cobertas = obrig.filter(e => etapaCoberta(e, modulos, submenus)).length;
            const completo = cobertas === obrig.length;
            const aberto = fluxoAberto === f.id;
            return (
              <div key={f.id}
                className={`rounded-2xl border overflow-hidden ${
                  completo ? 'border-accent/30 bg-accent/5'
                  : cobertas > 0 ? 'border-yellow-500/30' : 'border-white/5'}`}>
                <div className="flex items-start gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold ${completo ? 'text-accent' : 'text-gray-200'}`}>
                        {f.nome}
                      </span>
                      <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${
                        completo ? 'bg-accent/20 text-accent border-accent/30'
                        : cobertas > 0 ? 'text-yellow-300 border-yellow-500/40'
                        : 'text-gray-600 border-white/10'}`}>
                        {cobertas}/{obrig.length} etapas
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{f.resumo}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => void montarFluxo(f.id)}
                      title="Substitui a whitelist pelos módulos e submenus deste fluxo"
                      className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5">
                      Montar
                    </button>
                    {/* Liberar as telas é metade: sem enunciado o aluno abre a
                        tela certa e não sabe o que fazer nela. */}
                    <button type="button" onClick={() => setFluxoAtividade(f.id)}
                      title="Montar a atividade deste fluxo, baixar em PDF e enviar às filiais"
                      className="neu-button w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent">
                      <ClipboardList size={13} />
                    </button>
                    {/* O diagrama do card é para conferir montando; este é o
                        mesmo conteúdo do tamanho que a parede da sala exige. */}
                    <button type="button" onClick={() => setFluxoProjetado(f.id)}
                      title="Projetar o fluxo para a turma (tela cheia)"
                      className="neu-button w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent">
                      <Presentation size={13} />
                    </button>
                    <button type="button" onClick={() => setFluxoAberto(aberto ? null : f.id)}
                      title="Ver as etapas e quem faz cada uma"
                      className="neu-button w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent">
                      <ChevronDown size={13} className={`transition-transform ${aberto ? 'rotate-180 text-accent' : ''}`} />
                    </button>
                  </div>
                </div>

                {aberto && (
                  <div className="border-t border-white/5 bg-black/20 px-3 py-3 flex flex-col gap-0">
                    {f.etapas.map((etapa, i) => {
                      const ok = etapaCoberta(etapa, modulos, submenus);
                      const ultima = i === f.etapas.length - 1;
                      return (
                        <div key={`${etapa.view}-${i}`} className="flex gap-3">
                          {/* Trilho: bolinha + linha que liga à etapa seguinte.
                              É o que faz a lista ler como cadeia e não como
                              checklist solto quando projetada. */}
                          <div className="flex flex-col items-center shrink-0 pt-1">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black border ${
                              ok ? 'bg-accent border-accent text-black' : 'border-white/20 text-gray-600'}`}>
                              {i + 1}
                            </div>
                            {!ultima && <div className={`w-px flex-1 my-1 ${ok ? 'bg-accent/40' : 'bg-white/10'}`} />}
                          </div>
                          <div className={`min-w-0 flex-1 ${ultima ? 'pb-0' : 'pb-3'}`}>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[11px] font-bold ${ok ? 'text-gray-200' : 'text-gray-500'}`}>
                                {etapa.titulo}
                              </span>
                              {etapa.opcional && (
                                <span className="text-[9px] font-black uppercase tracking-widest text-gray-600 border border-white/10 rounded-full px-1.5 py-0.5">
                                  Opcional
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-accent/80 mt-0.5">{etapa.quem}</div>
                            <div className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{etapa.detalhe}</div>
                            {!ok && !etapa.opcional && (
                              <div className="text-[10px] text-yellow-300/90 mt-1 leading-relaxed">
                                Fora da aula: {etapa.seQuebra}
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
          })}
        </div>
      </div>

      {/* Cadeia quebrada: o fluxo foi começado e não fecha.
          Não depende de `ativo`: o momento em que este aviso vale alguma coisa
          é a PREPARAÇÃO — quem monta a aula na véspera, com o interruptor
          desligado, era justamente quem não o via. */}
      {cadeiasQuebradas.length > 0 && (
        <div id="alerta-cadeia" className="neu-flat rounded-3xl p-5 border border-yellow-500/30 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-yellow-400" />
            <h3 className="text-sm font-bold text-gray-200">Cadeia incompleta</h3>
          </div>
          <p className="text-[11px] text-gray-500">
            Estes fluxos têm etapas ligadas e etapas faltando. A turma chega até certo
            ponto e para — e quem descobre é você, na frente deles.
          </p>
          {cadeiasQuebradas.map(c => (
            <div key={c.fluxo.id} className="rounded-2xl border border-white/5 bg-black/20 p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-gray-200">{c.fluxo.nome}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {c.cobertas} de {c.total} etapas ligadas
                  </div>
                </div>
                <button type="button" onClick={() => completarCadeia(c.fluxo.id)}
                  className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-yellow-300 hover:text-accent transition-colors border border-yellow-500/30 shrink-0">
                  Completar
                </button>
              </div>
              {/* Só a primeira etapa faltante: é onde a turma vai parar de fato,
                  e listar as sete seguintes esconderia justamente essa. */}
              <div className="text-[11px] text-gray-400 leading-relaxed">
                Para em <span className="text-gray-200 font-bold">{c.faltando[0].titulo}</span>
                {' '}({c.faltando[0].quem}). {c.faltando[0].seQuebra}
                {c.faltando.length > 1 && (
                  <span className="text-gray-600"> +{c.faltando.length - 1} etapa(s) depois dessa.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pré-requisitos de dado: o que trava a aula depois que os módulos já
          estão certos. Consultado ao vivo no banco desta turma. */}
      {fluxosRelevantes.length > 0 && preStatus.length > 0 && (
        <div id="alerta-prereq" className={`neu-flat rounded-3xl p-5 border flex flex-col gap-3 ${
          preFaltando.length > 0 ? 'border-yellow-500/30' : 'border-white/5'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={14} className="text-accent" />
              <h3 className="text-sm font-bold text-gray-200">Pré-requisitos da turma</h3>
            </div>
            <button type="button" onClick={() => void reverificarPre()} disabled={preLoading}
              title="Verificar de novo"
              className="neu-button w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent disabled:opacity-50">
              <RefreshCw size={12} className={preLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-[11px] text-gray-500">
            Módulo liberado não basta: sem estes dados no banco desta turma, o fluxo não anda.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {preStatus.map(p => (
              <div key={p.id} className="flex items-start gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                {p.indefinido
                  ? <AlertTriangle size={13} className="text-gray-500 shrink-0 mt-0.5" />
                  : p.ok
                    ? <Check size={13} className="text-accent shrink-0 mt-0.5" />
                    : <Circle size={13} className="text-yellow-400 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <div className={`text-[11px] font-bold ${
                    p.indefinido ? 'text-gray-400' : p.ok ? 'text-gray-300' : 'text-yellow-300'}`}>
                    {p.label}
                    {p.quantidade >= 0 && <span className="text-gray-600 font-normal"> · {p.quantidade}</span>}
                  </div>
                  {p.indefinido && (
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      Não foi possível verificar nesta turma — confira à mão em {p.onde}.
                    </div>
                  )}
                  {/* Filial vazia é o caso que o total esconde: o aluno só vê
                      o catálogo da unidade dele. */}
                  {!p.indefinido && p.filiaisVazias && p.filiaisVazias.length > 0 && (
                    <div className="text-[10px] text-yellow-300/90 mt-0.5">
                      Nada em {p.filiaisVazias.join(', ')} — a turma dessa unidade fica sem material.
                    </div>
                  )}
                  {!p.indefinido && !p.ok && !p.filiaisVazias?.length && (
                    <div className="text-[10px] text-gray-500 mt-0.5">Resolva em {p.onde}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Segregação de funções: a aula CONCEDE setor (migr. 317), não filtra.
          Um fluxo largo entrega vários setores ao mesmo aluno e dissolve a
          lição que o próprio fluxo existe para ensinar. */}
      {/* Também sem `ativo`: decidir quantos setores a aula concede é escolha
          de montagem, e depois de ligar o interruptor já é tarde. */}
      {setoresConcedidos.length >= 2 && (
        <div id="alerta-setores" className="neu-flat rounded-3xl p-5 border border-white/5 flex items-start gap-3">
          <ShieldAlert size={16} className="text-gray-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-200">
              Esta aula concede {setoresConcedidos.length} setores de uma vez
            </h3>
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
              <span className="text-gray-400">{setoresConcedidos.join(', ')}</span> — cada aluno
              afetado recebe todos. As travas de papel do banco continuam de pé (quem abre uma
              requisição segue sem poder aprová-la), mas os setores se somam dentro do mesmo
              aluno. Se a aula for justamente sobre segregação de funções, ligue menos módulos
              e distribua os papéis entre eles.
            </p>
          </div>
        </div>
      )}


      {/* Roles alvo */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-200">Quem cai no Modo Aula</h3>
        </div>
        <p className="text-[11px] text-gray-500">
          Admin nunca é filtrado (pra não travar você mesmo). Escolha quais roles seguem a whitelist.
          «Conselheiro» vale para a role pura; quem é gerente com o selo de conselheiro entra por «Gerente».
        </p>
        <div className="flex flex-wrap gap-2">
          {AULA_ROLES_ALVO.map(r => {
            const active = roles.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggleRole(r.id)}
                title={r.hint}
                className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all
                  ${active
                    ? 'bg-accent/15 text-accent border-accent/30'
                    : 'neu-button border-white/5 text-gray-500 hover:text-gray-300'}`}
              >
                {active && <Check size={11} className="inline mr-1 -mt-0.5" />}
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Presets */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-200">Atalhos por módulo</h3>
        </div>
        <p className="text-[11px] text-gray-500">
          Recorte por área, sem a cadeia. Servem para mostrar uma tela específica — para
          ensinar a operação inteira, use os fluxos acima.
        </p>
        <div className="flex flex-wrap gap-2">
          {AULA_PRESETS.map(p => (
            <button
              key={p.nome}
              type="button"
              onClick={() => aplicarPreset(p.modulos)}
              className="neu-button px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5"
            >
              {p.nome}
            </button>
          ))}
        </div>
      </div>

      <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-bold text-gray-200">Módulos disponíveis na aula</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Clique no ícone <Filter size={10} className="inline mx-0.5" /> pra restringir também
            os submenus do módulo (sem restrição = todos os submenus liberados).
          </p>
        </div>
        {grupos.map(g => (
          <div key={g} className="flex flex-col gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 pl-1">{g}</div>
            {/* items-start: sem isso o card expandido estica a linha inteira e os
                vizinhos viram caixas vazias do mesmo tamanho. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 items-start">
              {AULA_MODULOS.filter(m => m.grupo === g).map(m => {
                const active = modulos.includes(m.id);
                const temSubmenus = AULA_SUBMENUS[m.id]?.length > 0;
                const subsDoMod = temSubmenus
                  ? AULA_SUBMENUS[m.id].map(l => aulaSubmenuId(m.id, l))
                  : [];
                const subsSelecionados = submenus.filter(s => s.startsWith(`${m.id}-`));
                const restrito = active && temSubmenus && subsSelecionados.length > 0;
                const isOpen = !!expandido[m.id];
                return (
                  <div key={m.id} className={`rounded-xl border ${active ? 'border-accent/30 bg-accent/5' : 'border-white/5'} overflow-hidden`}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleModulo(m.id)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      >
                        <div className={`w-4 h-4 rounded flex items-center justify-center border shrink-0
                          ${active ? 'bg-accent border-accent' : 'border-white/20'}`}>
                          {active && <Check size={11} className="text-black" />}
                        </div>
                        <span className={`text-xs font-semibold truncate ${active ? 'text-accent' : 'text-gray-400'}`}>
                          {m.label}
                        </span>
                        {restrito && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30 shrink-0">
                            {subsSelecionados.length}/{subsDoMod.length}
                          </span>
                        )}
                      </button>
                      {active && temSubmenus && (
                        <button
                          type="button"
                          onClick={() => setExpandido(e => ({ ...e, [m.id]: !e[m.id] }))}
                          title="Restringir submenus"
                          className="neu-button w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent shrink-0"
                        >
                          <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180 text-accent' : ''}`} />
                        </button>
                      )}
                    </div>
                    {/* Sem animação de altura de propósito. `height: 'auto'` no
                        motion exige medir o conteúdo, e como marcar um submenu
                        re-renderiza este bloco (setSubmenus), a medição voltava
                        a rodar sobre um item de grid de altura livre e a altura
                        crescia sem parar — a página ganhava milhares de pixels
                        vazios a cada clique. Abrir/fechar não precisa animar. */}
                    <>
                      {active && temSubmenus && isOpen && (
                        <div className="overflow-hidden border-t border-white/5">
                          <div className="flex items-center justify-between px-3 py-2 bg-black/20">
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Submenus</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setSubmenus(prev => [
                                  ...prev.filter(s => !s.startsWith(`${m.id}-`)),
                                  ...subsDoMod,
                                ])}
                                className="text-[9px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent"
                              >
                                Todos
                              </button>
                              <span className="text-gray-700">·</span>
                              <button
                                type="button"
                                onClick={() => limparSubmenusDoModulo(m.id)}
                                className="text-[9px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent"
                              >
                                Limpar
                              </button>
                            </div>
                          </div>
                          <div className="px-3 py-2 flex flex-col gap-1">
                            {AULA_SUBMENUS[m.id].map(label => {
                              const sid = aulaSubmenuId(m.id, label);
                              const on = submenus.includes(sid);
                              return (
                                // `relative` é obrigatório: o input abaixo usa
                                // `sr-only`, que é `position: absolute`. Sem um
                                // ancestral posicionado o bloco contêiner dele
                                // vira o documento — ele escapa do
                                // `overflow-hidden` da raiz e estica o scroll da
                                // página em centenas de pixels por submenu.
                                <label key={sid} className="relative flex items-center gap-2 py-1 cursor-pointer group">
                                  <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0
                                    ${on ? 'bg-accent border-accent' : 'border-white/20 group-hover:border-white/40'}`}>
                                    {on && <Check size={9} className="text-black" />}
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => toggleSubmenu(sid)}
                                    className="sr-only"
                                  />
                                  <span className={`text-[11px] ${on ? 'text-accent' : 'text-gray-500 group-hover:text-gray-300'}`}>
                                    {label}
                                  </span>
                                </label>
                              );
                            })}
                            <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">
                              {subsSelecionados.length === 0
                                ? 'Nenhum submenu selecionado — todos ficam liberados.'
                                : `${subsSelecionados.length} submenu(s) na whitelist — só esses aparecem.`}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Simulação de perda de dados — separada do Modo Aula de propósito: uma
          esconde módulos para focar a aula, a outra tira o chão para ensinar por
          que os dados importam. Confundir as duas seria fácil e caro. */}
      <div className={`neu-flat rounded-3xl p-5 border ${blackout.ativo ? 'border-red-500/40' : 'border-white/5'} flex flex-col gap-3`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-red-500/10">
              <AlertTriangle size={18} className="text-red-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-100">Simulação de perda de dados</h2>
              <p className="text-[11px] text-gray-500 leading-relaxed max-w-xl mt-0.5">
                Deixa a turma sem ver nem lançar movimento — pedidos, vendas, contas, estoque —
                para mostrar, sentindo, o que é depender do sistema e não ter os dados.
                <strong className="text-gray-400"> Nada é apagado</strong>: o bloqueio é de leitura e
                escrita, e desligar devolve tudo na hora. Cadastros, login e esta tela continuam de pé.
                A tela deles, porém, lê como falha real — e não diz que é exercício. Quem revela é você,
                na hora que escolher.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => alternarSimulacao(!blackout.ativo)}
            disabled={simSalvando}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border transition-colors disabled:opacity-50 shrink-0 ${
              blackout.ativo
                ? 'text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10'
                : 'text-red-300 border-red-500/40 hover:bg-red-500/10'
            }`}
          >
            {simSalvando ? '…' : blackout.ativo ? 'Devolver os dados' : 'Ligar simulação'}
          </button>
        </div>

        {blackout.ativo ? (
          <p className="text-[11px] text-red-300/90">
            Ativa{blackout.iniciado_nome ? ` por ${blackout.iniciado_nome}` : ''}
            {blackout.iniciado_em ? ` desde ${new Date(blackout.iniciado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' })}` : ''}.
            Enquanto durar, aproveite para perguntar o que eles conseguem responder sem o sistema.
          </p>
        ) : (
          <input
            type="text"
            value={simMensagem}
            onChange={e => setSimMensagem(e.target.value)}
            maxLength={200}
            placeholder="O que a turma vai ler (opcional) — ex.: Todos os dados foram apagados por um erro no sistema."
            className="neu-input rounded-xl px-3 py-2.5 text-sm"
          />
        )}
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

      {/* Footer sticky de ações */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            // A barra flutua sobre a grade enquanto se rola. Sem sombra e sem
            // fundo opaco ela lia como uma linha cortando o card ao meio, em
            // vez de uma faixa por cima dele.
            // `bg-base` é utility do projeto (index.css), não cor do Tailwind:
            // não aceita modificador de opacidade, tem que ser sólido.
            className="sticky bottom-4 z-10 flex items-center justify-between gap-3 neu-flat rounded-2xl px-5 py-3 border border-accent/20 bg-base shadow-lg shadow-black/40"
          >
            <span className="text-xs text-accent font-bold">Alterações não salvas</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetar}
                disabled={salvando}
                className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw size={13} /> Descartar
              </button>
              <NeuButtonAccent onClick={salvar} isLoading={salvando}>
                <Save size={14} /> Salvar
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
