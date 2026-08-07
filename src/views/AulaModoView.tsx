import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GraduationCap, Save, RotateCcw, Check, Users, Layers, Lock, ChevronDown, Filter, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAulaConfig } from '../hooks/useAulaConfig';
import { useBlackout } from '../hooks/useBlackout';
import { useConfirm } from '../contexts/ConfirmContext';
import { AULA_MODULOS, AULA_PRESETS, AULA_ROLES_ALVO, AULA_SUBMENUS, aulaSubmenuId } from '../lib/aulaModulos';
import type { UserProfile } from '../hooks/useUserProfile';
import { NeuButtonAccent, LoadingSpinner } from '../components/ui';

interface Props {
  showToast: (msg: string, type?: string) => void;
  profile: UserProfile;
}

const arraysIguais = (a: string[], b: string[]) =>
  a.length === b.length && a.every(x => b.includes(x));

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

  useEffect(() => {
    if (!loaded) return;
    setAtivo(config.ativo);
    setModulos(config.modulos_ativos);
    setSubmenus(config.submenus_ativos);
    setRoles(config.roles_afetados);
  }, [loaded, config.ativo, config.atualizado_em]);

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

  const resetar = () => {
    setAtivo(config.ativo);
    setModulos(config.modulos_ativos);
    setSubmenus(config.submenus_ativos);
    setRoles(config.roles_afetados);
  };

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

      {/* Toggle mestre */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5 flex items-center justify-between gap-4">
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
          <h3 className="text-sm font-bold text-gray-200">Atalhos</h3>
        </div>
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

      {/* Grid de módulos + accordion de submenus */}
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
