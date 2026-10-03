import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, EyeOff, HeartHandshake, Search, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AULA_MODULOS, AULA_SUBMENUS, aulaSubmenuId } from '../lib/aulaModulos';
import { useConfirm } from '../contexts/ConfirmContext';
import { LoadingSpinner } from '../components/ui';
import type { AulaConfig } from '../hooks/useAulaConfig';
import type { UserProfile } from '../hooks/useUserProfile';

// Aba "Grupo de apoio" do Modo Aula (migr. 669). Plano em
// `docs/Plano_Grupo_de_Apoio.md`.
//
// Uma segunda config da aula para um grupo pequeno — alunos que rendem mais
// quando o professor explica a etapa antes, só para eles, e as mediadoras
// deles. A turma segue na config de sempre. Desligar o grupo = juntá-los às
// equipes: na hora passam a seguir a config da turma.
//
// Quem está no grupo é dado de saúde: esta aba é só do admin e a RLS esconde a
// lista de todo o resto. Para o integrante, a tela é igual à de qualquer aluno
// em Modo Aula.

type Papel = 'aluno' | 'mediador';
type Integrante = { user_id: string; papel: Papel; nome: string; email: string | null };
type Pessoa = { id: string; nome: string | null; email: string | null; role: string; filial: string | null };
type Config = { ativo: boolean; modulos_ativos: string[]; submenus_ativos: string[] };

const VAZIA: Config = { ativo: false, modulos_ativos: [], submenus_ativos: [] };
const iguais = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
const PAPEL_ROTULO: Record<Papel, string> = { aluno: 'Aluno', mediador: 'Mediadora' };

export function AulaGrupoApoio({ profile, showToast, configTurma }: {
  profile: UserProfile;
  showToast: (msg: string, type?: string) => void;
  configTurma: AulaConfig;
}) {
  const confirmar = useConfirm();
  const [carregado, setCarregado] = useState(false);
  const [salvo, setSalvo] = useState<Config>(VAZIA);
  const [modulos, setModulos] = useState<string[]>([]);
  const [submenus, setSubmenus] = useState<string[]>([]);
  const [expandido, setExpandido] = useState<Record<string, boolean>>({});
  const [integrantes, setIntegrantes] = useState<Integrante[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [busca, setBusca] = useState('');
  const [papelNovo, setPapelNovo] = useState<Papel>('aluno');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    if (!supabase) return;
    const [c, m, p] = await Promise.all([
      supabase.from('aula_grupo_apoio_config').select('ativo, modulos_ativos, submenus_ativos').eq('id', 1).maybeSingle(),
      supabase.from('aula_grupo_apoio').select('user_id, papel').order('created_at'),
      supabase.from('user_profiles').select('id, nome, email, role, filial')
        .neq('role', 'admin').is('desligado_em', null).order('nome'),
    ]);
    if (c.error || m.error || p.error) {
      showToast(`Erro ao carregar o grupo de apoio: ${(c.error ?? m.error ?? p.error)?.message}`, 'error');
      setCarregado(true);
      return;
    }
    // Linha ausente (o Reset geral esvazia a tabela) vale "desligado"; o
    // próximo salvar recria.
    const cfg: Config = c.data
      ? { ativo: !!c.data.ativo, modulos_ativos: c.data.modulos_ativos ?? [], submenus_ativos: c.data.submenus_ativos ?? [] }
      : VAZIA;
    const porId = new Map((p.data ?? []).map((x: Pessoa) => [x.id, x]));
    setSalvo(cfg);
    setModulos(cfg.modulos_ativos);
    setSubmenus(cfg.submenus_ativos);
    setPessoas((p.data ?? []) as Pessoa[]);
    setIntegrantes((m.data ?? []).map((x: any) => ({
      user_id: x.user_id,
      papel: x.papel as Papel,
      nome: porId.get(x.user_id)?.nome ?? 'Conta desligada',
      email: porId.get(x.user_id)?.email ?? null,
    })));
    setCarregado(true);
  }, [showToast]);

  useEffect(() => { void carregar(); }, [carregar]);

  const gravarConfig = async (campos: Partial<Config>) => {
    if (!supabase) return false;
    const { error } = await supabase.from('aula_grupo_apoio_config').upsert({
      id: 1,
      ativo: salvo.ativo,
      modulos_ativos: salvo.modulos_ativos,
      submenus_ativos: salvo.submenus_ativos,
      ...campos,
      atualizado_por: profile.id,
      atualizado_em: new Date().toISOString(),
    });
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return false; }
    return true;
  };

  const dirty = !iguais(modulos, salvo.modulos_ativos) || !iguais(submenus, salvo.submenus_ativos);

  const salvar = async () => {
    setOcupado(true);
    if (await gravarConfig({ modulos_ativos: modulos, submenus_ativos: submenus })) {
      setSalvo(s => ({ ...s, modulos_ativos: modulos, submenus_ativos: submenus }));
      showToast(salvo.ativo ? 'Telas do grupo salvas — já valem para ele.' : 'Telas do grupo salvas. Ligue o grupo para valer.', 'success');
    }
    setOcupado(false);
  };

  const alternarAtivo = async () => {
    const ligar = !salvo.ativo;
    if (ligar && dirty && !await confirmar('Há telas marcadas e não salvas. Ligar com o que está salvo?')) return;
    setOcupado(true);
    if (await gravarConfig({ ativo: ligar })) {
      setSalvo(s => ({ ...s, ativo: ligar }));
      showToast(ligar
        ? 'Grupo de apoio ligado — os integrantes seguem as telas do grupo.'
        : 'Grupo de apoio desligado — os integrantes voltam a seguir a turma.', 'success');
    }
    setOcupado(false);
  };

  const incluir = async (pessoa: Pessoa) => {
    if (!supabase) return;
    setOcupado(true);
    const { error } = await supabase.from('aula_grupo_apoio')
      .insert({ user_id: pessoa.id, papel: papelNovo, incluido_por: profile.id });
    if (error) showToast(`Erro: ${error.message}`, 'error');
    else { setBusca(''); await carregar(); }
    setOcupado(false);
  };

  const remover = async (i: Integrante) => {
    if (!supabase) return;
    if (!await confirmar(`Tirar ${i.nome} do grupo de apoio?${salvo.ativo ? ' Na hora, passa a seguir a turma.' : ''}`)) return;
    setOcupado(true);
    const { error } = await supabase.from('aula_grupo_apoio').delete().eq('user_id', i.user_id);
    if (error) showToast(`Erro: ${error.message}`, 'error');
    else await carregar();
    setOcupado(false);
  };

  const trocarPapel = async (i: Integrante, papel: Papel) => {
    if (!supabase) return;
    const { error } = await supabase.from('aula_grupo_apoio').update({ papel }).eq('user_id', i.user_id);
    if (error) showToast(`Erro: ${error.message}`, 'error');
    else setIntegrantes(xs => xs.map(x => x.user_id === i.user_id ? { ...x, papel } : x));
  };

  const candidatos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return [];
    const dentro = new Set(integrantes.map(i => i.user_id));
    return pessoas
      .filter(p => !dentro.has(p.id))
      .filter(p => (p.nome ?? '').toLowerCase().includes(termo) || (p.email ?? '').toLowerCase().includes(termo))
      .slice(0, 8);
  }, [busca, pessoas, integrantes]);

  // Mesmas regras da montagem da turma: desmarcar o módulo leva os submenus
  // dele; chip = "o grupo vê isto"; todos marcados = sem recorte.
  const toggleModulo = (id: string) => setModulos(prev => {
    if (prev.includes(id)) {
      setSubmenus(s => s.filter(sv => !sv.startsWith(`${id}-`)));
      return prev.filter(x => x !== id);
    }
    return [...prev, id];
  });
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
  const copiarDaTurma = () => {
    setModulos(configTurma.modulos_ativos);
    setSubmenus(configTurma.submenus_ativos);
  };

  if (!carregado) return <LoadingSpinner />;

  const grupos = Array.from(new Set(AULA_MODULOS.map(m => m.grupo)));
  const podeLigar = integrantes.length > 0 && salvo.modulos_ativos.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Situação + interruptor */}
      <section className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-wrap items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
          <HeartHandshake size={20} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-200">
            Grupo de apoio {salvo.ativo ? <span className="text-accent">ligado</span> : <span className="text-gray-500">desligado</span>}
          </p>
          <p className="text-[11px] text-gray-500">
            {salvo.ativo
              ? 'Os integrantes seguem as telas do grupo. Desligue para juntá-los às equipes.'
              : 'Os integrantes seguem o Modo Aula da turma, como todo mundo.'}
          </p>
        </div>
        <button type="button" onClick={alternarAtivo} disabled={ocupado || (!salvo.ativo && !podeLigar)}
          title={!salvo.ativo && !podeLigar ? 'Inclua integrantes e salve as telas do grupo antes de ligar' : undefined}
          className={`btn-solido ${salvo.ativo ? 'btn-solido--vermelho' : 'btn-solido--verde'} shrink-0 disabled:opacity-50`}>
          {ocupado ? '…' : salvo.ativo ? 'Desligar e juntar à turma' : 'Ligar o grupo'}
        </button>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5 items-start">
        {/* Integrantes */}
        <section className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-bold text-gray-200">Integrantes</h3>
            <p className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-0.5">
              <EyeOff size={12} className="shrink-0" /> Só você vê esta lista. Os colegas não ficam sabendo quem está no grupo.
            </p>
          </div>

          {integrantes.length === 0 ? (
            <p className="text-xs text-gray-500">Ninguém no grupo ainda.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10">
              {integrantes.map(i => (
                <li key={i.user_id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-200 truncate">{i.nome}</p>
                    {i.email && <p className="text-[11px] text-gray-500 truncate">{i.email}</p>}
                  </div>
                  <select value={i.papel} onChange={e => trocarPapel(i, e.target.value as Papel)}
                    className="neu-input rounded-lg px-2 py-1 text-xs shrink-0" aria-label={`Papel de ${i.nome}`}>
                    <option value="aluno">{PAPEL_ROTULO.aluno}</option>
                    <option value="mediador">{PAPEL_ROTULO.mediador}</option>
                  </select>
                  <button type="button" onClick={() => remover(i)} disabled={ocupado} title="Tirar do grupo"
                    className="action-btn-delete shrink-0">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar pessoa para incluir…" data-trava-atualizacao="nao"
                  className="neu-input rounded-xl pl-9 pr-3 py-2 text-xs w-full" />
              </div>
              <select value={papelNovo} onChange={e => setPapelNovo(e.target.value as Papel)}
                className="neu-input rounded-xl px-2 py-2 text-xs shrink-0" aria-label="Papel de quem vai entrar">
                <option value="aluno">{PAPEL_ROTULO.aluno}</option>
                <option value="mediador">{PAPEL_ROTULO.mediador}</option>
              </select>
            </div>
            {candidatos.length > 0 && (
              <ul className="flex flex-col rounded-xl border border-white/10 divide-y divide-white/5">
                {candidatos.map(p => (
                  <li key={p.id}>
                    <button type="button" onClick={() => incluir(p)} disabled={ocupado}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5 disabled:opacity-50">
                      <UserPlus size={14} className="text-accent shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-gray-200 truncate">{p.nome ?? p.email}</span>
                        <span className="block text-[11px] text-gray-500 truncate">{p.email}{p.filial ? ` · ${p.filial}` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {busca.trim() && candidatos.length === 0 && (
              <p className="text-[11px] text-gray-500">Ninguém encontrado fora do grupo.</p>
            )}
          </div>
        </section>

        {/* Telas do grupo */}
        <section className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-gray-200">Telas do grupo</h3>
              <p className="text-[11px] text-gray-500">O que os integrantes veem enquanto o grupo está ligado.</p>
            </div>
            <button type="button" onClick={copiarDaTurma}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10 text-gray-300 hover:border-accent hover:text-accent transition-colors">
              Copiar da turma
            </button>
            <button type="button" onClick={salvar} disabled={!dirty || ocupado}
              className="btn-solido btn-solido--azul !py-1.5 !px-3 !text-[11px] disabled:opacity-40">
              Salvar telas
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            {grupos.map(g => {
              const doGrupo = AULA_MODULOS.filter(m => m.grupo === g);
              return (
                <div key={g} className="rounded-xl border border-white/10 overflow-hidden">
                  <p className="px-3 py-2 bg-white/[0.04] border-b border-white/5 text-[11px] font-black uppercase tracking-widest text-gray-300">{g}</p>
                  <div className="flex flex-col divide-y divide-white/5">
                    {doGrupo.map(m => {
                      const active = modulos.includes(m.id);
                      const temSubmenus = AULA_SUBMENUS[m.id]?.length > 0;
                      const subsDoMod = temSubmenus ? AULA_SUBMENUS[m.id].map(l => aulaSubmenuId(m.id, l)) : [];
                      const subsSelecionados = submenus.filter(s => s.startsWith(`${m.id}-`));
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
                                title="Escolher quais submenus o grupo vê"
                                className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${
                                  restrito ? 'bg-amber-500 text-black' : 'bg-white/5 text-gray-400 hover:text-gray-200'}`}>
                                {restrito ? `${subsSelecionados.length} de ${subsDoMod.length}` : 'Todos os submenus'}
                                <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                              </button>
                            )}
                          </div>
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
        </section>
      </div>
    </div>
  );
}
