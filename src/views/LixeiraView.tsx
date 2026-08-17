import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, RotateCcw, Search, ShieldAlert, Link2, Flame } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FilialBadge } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useAIContext } from '../contexts/AIAssistantContext';

// Lixeira de cadastros (migr. 451). Só `role === 'admin'` literal — CEO e
// conselheiro são alunos, e restaurar cadastro alheio não é jogada da
// competição. O guard existe aqui e, de novo, dentro de cada RPC: a tela é
// conveniência, a regra é do banco.

// `satelite` (migr. 452): relação 1:1 em cascata — a ficha de custo do produto,
// por exemplo. É parte do registro, vai junto no DELETE e não impede nada.
// Contá-la como vínculo deixava o botão "apagar de vez" travado para sempre.
type Vinculo = { tabela: string; linhas: number; satelite?: boolean };
type Item = {
  tabela: string;
  id: string;
  nome: string | null;
  filial: string | null;
  excluido_em: string | null;
  excluido_por: string | null;
  vinculos: Vinculo[];
};

// Rótulo por tabela. Uma régua só: a lista de tabelas vive em
// `_lixeira_tabelas()` no banco, e o que falta aqui cai no próprio nome da
// tabela em vez de sumir da tela.
const ROTULO: Record<string, string> = {
  produtos:              'Produto',
  fornecedores:          'Fornecedor',
  clientes:              'Cliente',
  categorias_produto:    'Categoria',
  subcategorias_produto: 'Subcategoria',
  servicos:              'Serviço',
};

const rotulo = (t: string) => ROTULO[t] ?? t;

/** Só o que é fato de terceiro segura o expurgo. */
const bloqueantes = (v: Vinculo[]) => v.filter(x => !x.satelite);

// A tabela de vínculo aparece para o admin com o nome que ela tem no banco —
// quem abre esta tela é quem lê migração.
const descreveVinculos = (v: Vinculo[]) =>
  v.map(x => `${x.tabela} (${x.linhas})`).join(', ');

const dataBR = (iso: string | null) => {
  if (!iso) return 'data desconhecida';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export const LixeiraView = ({ showToast, profile }: { showToast: any; profile?: any }) => {
  const confirm = useConfirm();
  const [itens, setItens] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const buscaDeb = useDebouncedValue(busca, 300);
  const [agindo, setAgindo] = useState<string | null>(null);

  const ehAdmin = profile?.role === 'admin';

  const carregar = useCallback(async () => {
    if (!supabase || !ehAdmin) { setLoading(false); return; }
    setLoading(true);
    setErro(null);
    const { data, error } = await supabase.rpc('lixeira_listar');
    if (error) {
      setErro(error.message);
      setItens([]);
    } else {
      setItens((data ?? []) as Item[]);
    }
    setLoading(false);
  }, [ehAdmin]);

  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() => {
    const q = buscaDeb.trim().toLowerCase();
    if (!q) return itens;
    return itens.filter(i =>
      (i.nome ?? '').toLowerCase().includes(q) ||
      rotulo(i.tabela).toLowerCase().includes(q) ||
      (i.filial ?? '').toLowerCase().includes(q));
  }, [itens, buscaDeb]);

  useAIContext(useMemo(() => ({
    label: 'Lixeira de cadastros',
    data: {
      total: itens.length,
      // O que trava o expurgo é a pergunta que o admin faz aqui.
      presos: itens.filter(i => bloqueantes(i.vinculos).length > 0).length,
      itens: filtrados.slice(0, 20).map(i => ({
        tipo: rotulo(i.tabela), nome: i.nome, filial: i.filial,
        apagado_em: i.excluido_em, vinculos: descreveVinculos(bloqueantes(i.vinculos)),
      })),
    },
  }), [itens, filtrados]));

  const restaurar = async (item: Item) => {
    if (!supabase) return;
    if (!await confirm(`Restaurar "${item.nome ?? rotulo(item.tabela)}"? Ele volta a aparecer na operação.`)) return;
    setAgindo(item.id);
    const { error } = await supabase.rpc('lixeira_restaurar', {
      p_tabela: item.tabela, p_id: item.id,
    });
    setAgindo(null);
    if (error) { showToast(error.message, 'error', true); return; }
    showToast(`"${item.nome}" restaurado.`, 'success', true);
    carregar();
  };

  const expurgar = async (item: Item) => {
    if (!supabase) return;
    // A confirmação diz o que não volta. "Tem certeza?" não informa nada.
    const ok = await confirm(
      `Apagar "${item.nome ?? rotulo(item.tabela)}" DE VEZ do banco de dados? ` +
      `Esta ação não tem volta — não existe restaurar depois dela.`);
    if (!ok) return;
    setAgindo(item.id);
    const { error } = await supabase.rpc('lixeira_expurgar', {
      p_tabela: item.tabela, p_id: item.id,
    });
    setAgindo(null);
    if (error) { showToast(error.message, 'error', true); return; }
    showToast(`"${item.nome}" apagado de vez.`, 'success', true);
    carregar();
  };

  if (!ehAdmin) {
    return (
      <div className="p-6">
        <div className="neu-flat border border-white/5 rounded-xl p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 text-amber-500" size={32} />
          <div className="font-black text-lg mb-1">Lixeira do administrador</div>
          <p className="text-sm opacity-70 max-w-md mx-auto">
            Restaurar e apagar cadastros em definitivo é do administrador do sistema.
          </p>
        </div>
      </div>
    );
  }

  const presos = itens.filter(i => bloqueantes(i.vinculos).length > 0).length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-black flex items-center gap-2">
            <Trash2 size={22} /> Lixeira
          </h1>
          <p className="text-xs opacity-70 mt-1">
            Cadastros apagados do catálogo. Restaurar traz de volta; apagar de vez remove do banco.
          </p>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, tipo ou unidade"
            className="neu-input pl-9 pr-3 py-2 text-sm w-full md:w-72 rounded-xl"
          />
        </div>
      </div>

      {presos > 0 && (
        <div className="neu-flat border border-white/5 rounded-xl p-3 text-xs flex items-start gap-2">
          <Link2 size={16} className="mt-0.5 shrink-0 opacity-70" />
          <span>
            <b>{presos}</b> {presos === 1 ? 'registro tem' : 'registros têm'} histórico ligado e não
            {presos === 1 ? ' pode' : ' podem'} ser apagado{presos === 1 ? '' : 's'} de vez.
            Apagar levaria esse histórico junto e mudaria resultado de mês já fechado — a linha mostra o que segura.
          </span>
        </div>
      )}

      {loading ? <LoadingSpinner /> : filtrados.length === 0 ? (
        <EmptyState
          message={busca ? 'Nenhum cadastro apagado bate com a busca.' : 'A lixeira está vazia.'}
          error={erro}
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtrados.map(item => {
              const trava = bloqueantes(item.vinculos);
              const travado = trava.length > 0;
              const ocupado = agindo === item.id;
              return (
                <motion.div
                  key={`${item.tabela}:${item.id}`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="neu-flat border border-white/5 rounded-xl p-3 md:p-4 flex flex-wrap items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wide font-black opacity-60">
                        {rotulo(item.tabela)}
                      </span>
                      {item.filial && <FilialBadge filial={item.filial} />}
                    </div>
                    <div className="font-bold truncate">{item.nome ?? '(sem nome)'}</div>
                    <div className="text-[11px] opacity-60">
                      Apagado em {dataBR(item.excluido_em)}
                      {item.excluido_por ? ` por ${item.excluido_por}` : ''}
                    </div>
                    {travado && (
                      <div className="text-[11px] mt-1 flex items-start gap-1.5 opacity-80">
                        <Link2 size={13} className="mt-0.5 shrink-0" />
                        <span>Preso por: {descreveVinculos(trava)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => restaurar(item)}
                      disabled={ocupado}
                      className="neu-button px-3 py-2 text-xs font-bold flex items-center gap-1.5 rounded-xl disabled:opacity-50"
                    >
                      <RotateCcw size={14} /> Restaurar
                    </button>
                    <button
                      onClick={() => expurgar(item)}
                      disabled={ocupado || travado}
                      title={travado
                        ? 'Tem histórico ligado — apagar de vez mudaria resultado já fechado.'
                        : 'Remove do banco de dados. Não tem volta.'}
                      className="neu-button px-3 py-2 text-xs font-bold flex items-center gap-1.5 rounded-xl text-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Flame size={14} /> Apagar de vez
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
