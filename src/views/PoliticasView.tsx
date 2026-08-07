import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BookMarked, Check, FileStack, Plus, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, LoadingSpinner } from '../components/ui';
import { isConselheiro } from '../lib/rbac';
import { formatDataHoraBR, todayBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';

// Políticas com versão (migração 384) — a ciência caduca quando a regra muda.
//
// A assinatura é dada à VERSÃO, nunca à política. Publicar a v2 não apaga
// nada: as ciências da v1 continuam provando quem leu o quê. Quem já tinha
// assinado simplesmente volta a dever assinatura, porque a devida é a da
// versão vigente. A reciência sai do modelo de dados, não de um UPDATE.

const CATEGORIAS = ['Conduta', 'Compras', 'Financeiro', 'Pessoas', 'Segurança da Informação', 'Operação', 'Outra'] as const;

type Vigente = {
  politica_id: string; titulo: string; categoria: string; descricao: string | null;
  exige_ciencia: boolean; versao_id: string; versao: number; conteudo: string;
  resumo_mudanca: string | null; vigencia_inicio: string; publicada_em: string;
  publicada_por_nome: string | null; cientes: number; eu_ciente: boolean; elegiveis: number;
};

type Versao = {
  id: string; politica_id: string; versao: number; resumo_mudanca: string | null;
  vigencia_inicio: string; publicada_em: string; publicada_por_nome: string | null;
};

export function PoliticasView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const conselho = profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);

  const [vigentes, setVigentes] = useState<Vigente[]>([]);
  const [versoes, setVersoes]   = useState<Versao[]>([]);
  const [loading, setLoading]   = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aberta, setAberta]     = useState<string | null>(null);

  const [nova, setNova] = useState(false);
  const [pol, setPol] = useState({ titulo: '', categoria: 'Conduta', descricao: '', exige_ciencia: true });

  // Publicação de versão, aberta por política.
  const [publicando, setPublicando] = useState<string | null>(null);
  const [ver, setVer] = useState({ conteudo: '', resumo_mudanca: '', vigencia_inicio: todayBR() });

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [{ data: vig }, { data: hist }] = await Promise.all([
      supabase.from('politicas_vigentes').select('*').order('categoria').order('titulo'),
      supabase.from('politica_versoes')
        .select('id, politica_id, versao, resumo_mudanca, vigencia_inicio, publicada_em, publicada_por_nome')
        .eq('ativo', true).order('versao', { ascending: false }),
    ]);
    setVigentes((vig ?? []) as Vigente[]);
    setVersoes((hist ?? []) as Versao[]);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const criarPolitica = async () => {
    if (!supabase) return;
    if (!pol.titulo.trim()) { showToast('Dê um título à política.', 'error'); return; }
    setSalvando(true);
    const { error } = await supabase.from('politicas').insert({
      ...pol, criado_por: profile?.id ?? null, criado_por_nome: profile?.nome ?? null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast('Política criada. Publique a versão 1 para que passe a valer.', 'success');
    setNova(false);
    setPol({ titulo: '', categoria: 'Conduta', descricao: '', exige_ciencia: true });
    carregar();
  };

  const publicar = async (politicaId: string) => {
    if (!supabase) return;
    if (!ver.conteudo.trim()) { showToast('A versão precisa do texto da política.', 'error'); return; }
    setSalvando(true);
    const { data, error } = await supabase.rpc('publicar_politica_versao', {
      p_politica_id: politicaId,
      p_conteudo: ver.conteudo,
      p_resumo_mudanca: ver.resumo_mudanca || null,
      p_vigencia_inicio: ver.vigencia_inicio,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast(`Versão ${(data as any)?.versao ?? ''} publicada. A ciência anterior deixou de valer.`, 'success');
    setPublicando(null);
    setVer({ conteudo: '', resumo_mudanca: '', vigencia_inicio: todayBR() });
    carregar();
  };

  const darCiencia = async (versaoId: string) => {
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.rpc('dar_ciencia_politica', { p_versao_id: versaoId });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast('Ciência registrada.', 'success');
    carregar();
  };

  if (loading) return <LoadingSpinner />;

  const pendentes = vigentes.filter(v => v.exige_ciencia && !v.eu_ciente).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Políticas</h1>
        <p className="text-sm text-gray-400 mt-1">
          Documento que vale hoje, com versão e data. Quando sai versão nova, a
          ciência da anterior deixa de valer — e a assinatura antiga continua
          arquivada, provando quem leu o quê e quando.
        </p>
        {pendentes > 0 && (
          <p className="text-xs text-orange-400 mt-2">
            {pendentes} política(s) aguardando sua ciência.
          </p>
        )}
      </div>

      {conselho && (
        <div className="neu-card p-4 space-y-3">
          <button onClick={() => setNova(v => !v)}
            className="neu-button px-3 py-1.5 rounded-xl text-xs text-accent flex items-center gap-2">
            <Plus size={13} /> Nova política
          </button>
          {nova && (
            <div className="grid sm:grid-cols-2 gap-3 bg-black/20 rounded-xl p-3">
              <Campo rotulo="Título">
                <input value={pol.titulo} onChange={e => setPol(p => ({ ...p, titulo: e.target.value }))}
                  className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
              </Campo>
              <Campo rotulo="Categoria">
                <select value={pol.categoria} onChange={e => setPol(p => ({ ...p, categoria: e.target.value }))}
                  className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Campo>
              <div className="sm:col-span-2">
                <Campo rotulo="Do que trata (uma linha)">
                  <input value={pol.descricao} onChange={e => setPol(p => ({ ...p, descricao: e.target.value }))}
                    className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                </Campo>
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 text-xs text-gray-400">
                <input type="checkbox" checked={pol.exige_ciencia}
                  onChange={e => setPol(p => ({ ...p, exige_ciencia: e.target.checked }))} />
                Exigir ciência de todo mundo a cada versão
              </label>
              <div className="sm:col-span-2">
                <button onClick={criarPolitica} disabled={salvando}
                  className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium disabled:opacity-50">
                  Criar
                </button>
                <p className="text-xs text-gray-500 mt-2">
                  A política só passa a valer quando a versão 1 for publicada.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {vigentes.length === 0 ? (
        <EmptyState message="Nenhuma política em vigor hoje." />
      ) : (
        <div className="space-y-3">
          {vigentes.map(v => {
            const hist = versoes.filter(x => x.politica_id === v.politica_id);
            const pendente = v.exige_ciencia && !v.eu_ciente;
            return (
              <div key={v.politica_id} className="neu-card overflow-hidden">
                <button onClick={() => setAberta(a => a === v.politica_id ? null : v.politica_id)}
                  className="w-full p-4 flex items-start gap-3 text-left">
                  <BookMarked size={16} className="text-accent shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-100 truncate">{v.titulo}</div>
                    <div className="text-xs text-gray-500">
                      {v.categoria} · v{v.versao} · em vigor desde{' '}
                      {v.vigencia_inicio.split('-').reverse().join('/')}
                      {conselho && v.exige_ciencia && <> · adesão {v.cientes}/{v.elegiveis}</>}
                    </div>
                  </div>
                  {pendente && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
                      Ler
                    </span>
                  )}
                  {v.exige_ciencia && v.eu_ciente && (
                    <Check size={16} className="text-green-400 shrink-0 mt-0.5" />
                  )}
                </button>

                {aberta === v.politica_id && (
                  <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
                    {v.descricao && <p className="text-xs text-gray-400">{v.descricao}</p>}
                    {v.resumo_mudanca && (
                      <p className="text-xs text-gray-400">
                        <span className="text-gray-500">Mudou nesta versão:</span> {v.resumo_mudanca}
                      </p>
                    )}
                    <div className="text-sm text-gray-300 whitespace-pre-wrap bg-black/20 rounded-xl p-3">
                      {v.conteudo}
                    </div>
                    <div className="text-xs text-gray-500">
                      Publicada por {v.publicada_por_nome ?? '—'} em {formatDataHoraBR(v.publicada_em)}
                    </div>

                    {v.exige_ciencia && (
                      v.eu_ciente ? (
                        <div className="text-xs text-green-400 flex items-center gap-2">
                          <Check size={13} /> Você já deu ciência nesta versão.
                        </div>
                      ) : (
                        <button onClick={() => darCiencia(v.versao_id)} disabled={salvando}
                          className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium flex items-center gap-2 disabled:opacity-50">
                          <Check size={14} /> Li e estou ciente
                        </button>
                      )
                    )}

                    {hist.length > 1 && (
                      <div className="space-y-1">
                        <div className="text-xs text-gray-500 flex items-center gap-2">
                          <FileStack size={12} /> Versões anteriores
                        </div>
                        {hist.filter(x => x.versao !== v.versao).map(x => (
                          <div key={x.id} className="text-xs text-gray-500">
                            v{x.versao} · desde {x.vigencia_inicio.split('-').reverse().join('/')}
                            {x.resumo_mudanca ? ` · ${x.resumo_mudanca}` : ''}
                          </div>
                        ))}
                      </div>
                    )}

                    {conselho && (
                      <div className="space-y-3">
                        <button onClick={() => setPublicando(p => p === v.politica_id ? null : v.politica_id)}
                          className="neu-button px-3 py-1.5 rounded-xl text-xs text-gray-100 flex items-center gap-2">
                          <Upload size={12} /> Publicar nova versão
                        </button>
                        {publicando === v.politica_id && (
                          <div className="grid gap-3 bg-black/20 rounded-xl p-3">
                            <Campo rotulo="Texto da versão">
                              <textarea value={ver.conteudo} rows={8}
                                onChange={e => setVer(s => ({ ...s, conteudo: e.target.value }))}
                                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                            </Campo>
                            <Campo rotulo="O que mudou">
                              <input value={ver.resumo_mudanca}
                                onChange={e => setVer(s => ({ ...s, resumo_mudanca: e.target.value }))}
                                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                            </Campo>
                            <Campo rotulo="Passa a valer em">
                              <input type="date" value={ver.vigencia_inicio}
                                onChange={e => setVer(s => ({ ...s, vigencia_inicio: e.target.value }))}
                                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                            </Campo>
                            <div>
                              <button onClick={() => publicar(v.politica_id)} disabled={salvando}
                                className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium disabled:opacity-50">
                                Publicar v{v.versao + 1}
                              </button>
                              <p className="text-xs text-gray-500 mt-2">
                                Versão publicada é imutável. Corrigir vírgula é publicar outra —
                                documento que muda embaixo de quem assinou não prova nada.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Políticas criadas mas ainda sem versão em vigor: só o Conselho vê,
          porque é ele quem tem de publicar a primeira. */}
      {conselho && <PoliticasSemVersao onPublicado={carregar} showToast={showToast} salvando={salvando} />}
    </div>
  );
}

function PoliticasSemVersao({
  onPublicado, showToast, salvando,
}: {
  onPublicado: () => void;
  showToast: (msg: string, t?: string) => void;
  salvando: boolean;
}) {
  const [pendentes, setPendentes] = useState<{ id: string; titulo: string }[]>([]);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [conteudo, setConteudo] = useState('');

  const carregar = useCallback(async () => {
    if (!supabase) return;
    const [{ data: pols }, { data: vers }] = await Promise.all([
      supabase.from('politicas').select('id, titulo').eq('ativo', true),
      supabase.from('politica_versoes').select('politica_id').eq('ativo', true),
    ]);
    const comVersao = new Set((vers ?? []).map((v: any) => v.politica_id));
    setPendentes((pols ?? []).filter((p: any) => !comVersao.has(p.id)) as any);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const publicarPrimeira = async (id: string) => {
    if (!supabase) return;
    if (!conteudo.trim()) { showToast('A versão precisa do texto.', 'error'); return; }
    const { error } = await supabase.rpc('publicar_politica_versao', {
      p_politica_id: id, p_conteudo: conteudo, p_resumo_mudanca: 'Versão inicial.',
      p_vigencia_inicio: todayBR(),
    });
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast('Versão 1 publicada.', 'success');
    setAlvo(null); setConteudo('');
    carregar(); onPublicado();
  };

  if (pendentes.length === 0) return null;

  return (
    <div className="neu-card p-4 space-y-3">
      <div className="text-sm font-medium text-gray-300">Aguardando a versão 1</div>
      {pendentes.map(p => (
        <div key={p.id} className="bg-black/20 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-200">{p.titulo}</span>
            <button onClick={() => setAlvo(a => a === p.id ? null : p.id)}
              className="neu-button px-3 py-1.5 rounded-xl text-xs text-accent">
              Publicar v1
            </button>
          </div>
          {alvo === p.id && (
            <>
              <textarea value={conteudo} rows={6} onChange={e => setConteudo(e.target.value)}
                placeholder="Texto da política…"
                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
              <button onClick={() => publicarPrimeira(p.id)} disabled={salvando}
                className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium disabled:opacity-50">
                Publicar
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{rotulo}</label>
      {children}
    </div>
  );
}
