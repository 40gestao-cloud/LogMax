import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, Check, AlertCircle } from 'lucide-react';

// Combobox com busca — não existia nenhum no projeto (os selects de origem em
// Cadastros > Produtos e Cotações são `<select>` nativos, e a lista de
// requisições/produtos passou de uma dúzia para várias dezenas por turma).
// Um `<select>` com 46 opções não é pesquisável; este componente é.
//
// Fica fora de `ui.tsx` de propósito: é o único combobox do projeto até agora,
// e `ui.tsx` já é grande. Se nascer um segundo uso, migrar os dois para lá.

export type SelectBuscaOpcao = {
  value: string;
  label: string;
  /** Texto extra pesquisável (não aparece na régua principal da opção). */
  hint?: string;
  disabled?: boolean;
};

export type SelectBuscaGrupo = {
  label: string;
  opcoes: SelectBuscaOpcao[];
};

/** Remove acento e caixa — mesma normalização usada em RecebimentosView para
 *  ordenar o catálogo (produtosOrdenados). */
const chaveBusca = (s: string): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

type Props = {
  value: string;
  onChange: (value: string) => void;
  grupos: SelectBuscaGrupo[];
  placeholder?: string;
  /** Texto mostrado quando a busca não acha nada (ou quando `grupos` está vazio). */
  vazioTexto?: string;
  error?: string;
  id?: string;
  disabled?: boolean;
  abrirAoMontar?: boolean;
};

export const SelectBusca = ({
  value, onChange, grupos, placeholder = 'Selecione...', vazioTexto = 'Nada encontrado.',
  error, id, disabled, abrirAoMontar,
}: Props) => {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [destacado, setDestacado] = useState(0);
  const raizRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Todas as opções achatadas, na ordem em que aparecem na tela — é sobre essa
  // lista que ↑/↓/Enter navegam, sem se importar com o agrupamento.
  const todasOpcoes = useMemo(() => grupos.flatMap(g => g.opcoes), [grupos]);
  const selecionada = todasOpcoes.find(o => o.value === value) ?? null;

  const gruposFiltrados = useMemo(() => {
    const q = chaveBusca(busca);
    if (!q) return grupos;
    return grupos
      .map(g => ({
        ...g,
        opcoes: g.opcoes.filter(o =>
          chaveBusca(o.label).includes(q) || (o.hint ? chaveBusca(o.hint).includes(q) : false)),
      }))
      .filter(g => g.opcoes.length > 0);
  }, [grupos, busca]);
  const opcoesFiltradas = useMemo(() => gruposFiltrados.flatMap(g => g.opcoes), [gruposFiltrados]);

  useEffect(() => { setDestacado(0); }, [busca, aberto]);

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: MouseEvent) => {
      if (raizRef.current && !raizRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [aberto]);

  const abrir = () => {
    if (disabled) return;
    setBusca('');
    setAberto(true);
    // Foco no input de busca no próximo tick — o painel ainda não existe no DOM
    // no clique que o disparou.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => { if (abrirAoMontar) abrir(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const escolher = (opcao: SelectBuscaOpcao) => {
    if (opcao.disabled) return;
    onChange(opcao.value);
    setAberto(false);
    setBusca('');
  };

  const aoTeclar = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setAberto(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDestacado(i => Math.min(i + 1, Math.max(opcoesFiltradas.length - 1, 0)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDestacado(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const alvo = opcoesFiltradas[destacado];
      if (alvo) escolher(alvo);
    }
  };

  return (
    <div ref={raizRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-expanded={aberto}
        aria-haspopup="listbox"
        onClick={() => (aberto ? setAberto(false) : abrir())}
        className={`neu-input py-2 px-3 rounded-xl text-sm w-full flex items-center justify-between gap-2 text-left disabled:opacity-50 disabled:cursor-not-allowed ${
          error ? 'border border-red-500/40' : ''}`}
      >
        <span className={selecionada ? 'text-gray-200 truncate' : 'text-gray-500 truncate'}>
          {selecionada ? selecionada.label : placeholder}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-gray-500 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && (
        <div className="absolute z-30 mt-1.5 w-full neu-flat rounded-xl border border-white/10 shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
            <Search size={13} className="text-gray-500 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder="Buscar..."
              aria-label="Buscar"
              className="bg-transparent outline-none text-sm text-gray-200 w-full placeholder:text-gray-600"
            />
          </div>
          <div role="listbox" className="max-h-64 overflow-y-auto py-1">
            {opcoesFiltradas.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-gray-500 leading-snug">{vazioTexto}</p>
            ) : (
              gruposFiltrados.map(g => (
                <div key={g.label}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-bold text-gray-500 uppercase tracking-widest sticky top-0 neu-flat">
                    {g.label}
                  </p>
                  {g.opcoes.map(o => {
                    const idx = opcoesFiltradas.indexOf(o);
                    const ativa = idx === destacado;
                    return (
                      <button
                        type="button"
                        key={o.value}
                        role="option"
                        aria-selected={o.value === value}
                        disabled={o.disabled}
                        onMouseEnter={() => setDestacado(idx)}
                        onClick={() => escolher(o)}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                          ativa ? 'bg-accent/10 text-accent' : 'text-gray-300 hover:bg-white/5'}`}
                      >
                        <span className="truncate">{o.label}</span>
                        {o.value === value && <Check size={13} className="shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {error && (
        <span className="flex items-center gap-1 text-[10px] text-red-500 font-semibold mt-1.5">
          <AlertCircle size={10} /> {error}
        </span>
      )}
    </div>
  );
};
