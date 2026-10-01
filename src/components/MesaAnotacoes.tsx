import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, ChevronLeft, ChevronRight, Pencil, Check, X, StickyNote } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';

// Mesa do Gestor, Fase 2 (migr. 668): as anotações do gestor.
//
// Único lugar da mesa onde se escreve. Cartão livre e PRIVADO (RLS: só a
// própria linha) — "cobrar fornecedor X", "conversar com fulano". Não é
// tarefa para os outros: atribuir trabalho continua em Tarefas e Demandas.
//
// Arrasta entre as três colunas (mouse) ou usa as setas do cartão (toque e
// teclado). O banco carimba dono, data de conclusão e hora da mudança.

type ColunaAnot = 'a_fazer' | 'fazendo' | 'feito';
type Anotacao = { id: string; texto: string; coluna: ColunaAnot; ordem: number; prazo: string | null; concluida_em: string | null };

const COLUNAS: { id: ColunaAnot; titulo: string; cor: string }[] = [
  { id: 'a_fazer', titulo: 'A fazer', cor: 'text-amber-300' },
  { id: 'fazendo', titulo: 'Fazendo', cor: 'text-sky-300' },
  { id: 'feito', titulo: 'Feito', cor: 'text-green-300' },
];
const LIMITE_FEITO = 15;

const hojeAcre = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Rio_Branco' });
const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

export function MesaAnotacoes({ showToast }: { showToast: any }) {
  const confirm = useConfirm();
  const [itens, setItens] = useState<Anotacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState('');
  const [prazo, setPrazo] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<ColunaAnot | null>(null);
  const [todosFeitos, setTodosFeitos] = useState(false);

  const carregar = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('mesa_anotacoes')
      .select('id,texto,coluna,ordem,prazo,concluida_em').order('ordem', { ascending: true });
    setCarregando(false);
    if (error) { showToast?.(`Anotações: ${error.message}`, 'error'); return; }
    setItens((data ?? []) as Anotacao[]);
  }, [showToast]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Atualiza na tela antes do banco; se o banco recusar, relê.
  const gravar = async (id: string, patch: Partial<Anotacao>) => {
    setItens(l => l.map(a => a.id === id ? { ...a, ...patch } : a));
    const { error } = await supabase!.from('mesa_anotacoes').update(patch).eq('id', id);
    if (error) { showToast?.(`Não salvou: ${error.message}`, 'error'); void carregar(); }
  };

  const adicionar = async () => {
    const t = texto.trim();
    if (!t || !supabase) return;
    const { data, error } = await supabase.from('mesa_anotacoes')
      .insert({ texto: t.slice(0, 500), prazo: prazo || null })
      .select('id,texto,coluna,ordem,prazo,concluida_em').single();
    if (error) { showToast?.(`Não salvou: ${error.message}`, 'error'); return; }
    setItens(l => [...l, data as Anotacao]);
    setTexto(''); setPrazo('');
  };

  const mover = (a: Anotacao, para: ColunaAnot) => {
    if (a.coluna === para) return;
    // Vai para o fim da coluna de destino.
    const ultimo = Math.max(0, ...itens.filter(x => x.coluna === para).map(x => x.ordem));
    void gravar(a.id, { coluna: para, ordem: ultimo + 1 });
  };

  const excluir = async (a: Anotacao) => {
    if (!await confirm('Excluir esta anotação?')) return;
    setItens(l => l.filter(x => x.id !== a.id));
    const { error } = await supabase!.from('mesa_anotacoes').delete().eq('id', a.id);
    if (error) { showToast?.(`Não excluiu: ${error.message}`, 'error'); void carregar(); }
  };

  const limparFeitas = async () => {
    const feitas = itens.filter(a => a.coluna === 'feito');
    if (feitas.length === 0 || !await confirm(`Excluir as ${feitas.length} anotações feitas?`)) return;
    setItens(l => l.filter(a => a.coluna !== 'feito'));
    const { error } = await supabase!.from('mesa_anotacoes').delete().in('id', feitas.map(a => a.id));
    if (error) { showToast?.(`Não excluiu: ${error.message}`, 'error'); void carregar(); }
  };

  const salvarEdicao = (a: Anotacao) => {
    const t = rascunho.trim();
    setEditando(null);
    if (t && t !== a.texto) void gravar(a.id, { texto: t.slice(0, 500) });
  };

  const hoje = hojeAcre();

  return (
    // Vive dentro da aba "Minhas anotações" da Mesa: o título é a própria aba.
    <section className="flex flex-col gap-3">
      <p className="text-xs text-gray-500 flex items-center gap-1.5">
        <StickyNote size={13} className="text-accent" />
        Lembretes seus, para organizar o dia. Só você vê — não é tarefa para a equipe.
      </p>

      <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void adicionar(); }}>
        <input type="text" value={texto} onChange={e => setTexto(e.target.value)} maxLength={500}
          placeholder="Anotar algo para fazer… (ex.: cobrar o fornecedor da TechMax)"
          className="neu-input py-2 px-3 rounded-xl text-sm flex-1 min-w-[200px]" />
        <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} title="Prazo (opcional)"
          className="neu-input py-2 px-3 rounded-xl text-sm" />
        <button type="submit" disabled={!texto.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white text-gray-900 hover:bg-gray-100 px-3 py-2 text-xs font-bold disabled:opacity-50">
          <Plus size={13} /> Anotar
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {COLUNAS.map((col, ci) => {
          const daColuna = itens.filter(a => a.coluna === col.id)
            .sort((a, b) => col.id === 'feito'
              ? String(b.concluida_em ?? '').localeCompare(String(a.concluida_em ?? ''))
              : a.ordem - b.ordem);
          const visiveis = col.id === 'feito' && !todosFeitos ? daColuna.slice(0, LIMITE_FEITO) : daColuna;
          return (
            <div key={col.id}
              onDragOver={e => { if (arrastando) { e.preventDefault(); setSobre(col.id); } }}
              onDragLeave={() => setSobre(s => s === col.id ? null : s)}
              onDrop={e => {
                e.preventDefault();
                const a = itens.find(x => x.id === arrastando);
                if (a) mover(a, col.id);
                setArrastando(null); setSobre(null);
              }}
              className={`rounded-2xl border p-2.5 flex flex-col gap-2 min-h-[120px] transition-colors ${sobre === col.id ? 'border-accent/60 bg-white/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}>
              <div className="flex items-center gap-2 px-1">
                <span className={`text-[11px] font-black uppercase tracking-widest ${col.cor}`}>{col.titulo}</span>
                <span className="text-[11px] text-gray-500 tabular-nums">{daColuna.length}</span>
                {col.id === 'feito' && daColuna.length > 0 && (
                  <button type="button" onClick={limparFeitas} className="ml-auto text-[11px] text-gray-500 hover:text-red-400 underline-offset-2 hover:underline">
                    limpar
                  </button>
                )}
              </div>
              {carregando ? null : visiveis.length === 0 ? (
                <p className="text-[11px] text-gray-600 text-center py-4">
                  {col.id === 'a_fazer' ? 'Nada anotado.' : 'Arraste uma anotação para cá.'}
                </p>
              ) : visiveis.map(a => {
                const atrasada = a.coluna !== 'feito' && a.prazo && a.prazo < hoje;
                return (
                  <div key={a.id} draggable={editando !== a.id}
                    onDragStart={e => { setArrastando(a.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setArrastando(null); setSobre(null); }}
                    className={`group rounded-xl border border-white/10 bg-black/30 p-2.5 flex flex-col gap-1.5 ${editando === a.id ? '' : 'cursor-grab active:cursor-grabbing'} ${arrastando === a.id ? 'opacity-40' : ''}`}>
                    {editando === a.id ? (
                      <div className="flex flex-col gap-1.5">
                        <textarea value={rascunho} onChange={e => setRascunho(e.target.value)} maxLength={500} rows={3} autoFocus
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); salvarEdicao(a); } if (e.key === 'Escape') setEditando(null); }}
                          className="neu-input py-1.5 px-2 rounded-lg text-xs w-full resize-y" />
                        <div className="flex gap-1 justify-end">
                          <button type="button" onClick={() => setEditando(null)} title="Cancelar" aria-label="Cancelar" className="action-btn-neutral"><X size={13} /></button>
                          <button type="button" onClick={() => salvarEdicao(a)} title="Salvar" aria-label="Salvar" className="action-btn-success"><Check size={13} /></button>
                        </div>
                      </div>
                    ) : (
                      <p className={`text-xs leading-snug whitespace-pre-wrap break-words ${a.coluna === 'feito' ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{a.texto}</p>
                    )}
                    <div className="flex items-center gap-1">
                      {a.prazo && (
                        <span className={`text-[10px] font-semibold ${atrasada ? 'text-red-400' : 'text-gray-500'}`}>
                          {atrasada ? 'venceu ' : 'até '}{dataBR(a.prazo)}
                        </span>
                      )}
                      {a.coluna === 'feito' && a.concluida_em && (
                        <span className="text-[10px] text-gray-600">feito em {dataBR(new Date(a.concluida_em).toLocaleDateString('en-CA', { timeZone: 'America/Rio_Branco' }))}</span>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        <button type="button" onClick={() => mover(a, COLUNAS[ci - 1].id)} disabled={ci === 0}
                          title={ci > 0 ? `Mover para ${COLUNAS[ci - 1].titulo}` : undefined} aria-label="Mover para a esquerda"
                          className="action-btn-neutral disabled:invisible"><ChevronLeft size={13} /></button>
                        <button type="button" onClick={() => mover(a, COLUNAS[ci + 1].id)} disabled={ci === COLUNAS.length - 1}
                          title={ci < COLUNAS.length - 1 ? `Mover para ${COLUNAS[ci + 1].titulo}` : undefined} aria-label="Mover para a direita"
                          className="action-btn-neutral disabled:invisible"><ChevronRight size={13} /></button>
                        <button type="button" onClick={() => { setEditando(a.id); setRascunho(a.texto); }} title="Editar" aria-label="Editar"
                          className="action-btn-edit"><Pencil size={12} /></button>
                        <button type="button" onClick={() => excluir(a)} title="Excluir" aria-label="Excluir"
                          className="action-btn-delete"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {col.id === 'feito' && daColuna.length > LIMITE_FEITO && (
                <button type="button" onClick={() => setTodosFeitos(t => !t)} className="text-[11px] text-accent font-semibold py-1 hover:underline">
                  {todosFeitos ? 'Mostrar menos' : `Mostrar mais ${daColuna.length - LIMITE_FEITO}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
