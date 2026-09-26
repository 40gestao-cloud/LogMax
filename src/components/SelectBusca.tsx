import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, AlertCircle } from 'lucide-react';

// Lista de escolha do app para tudo que vem de cadastro (requisição, produto,
// fornecedor, cliente, funcionário, conta). Substitui o <select> nativo nessas
// listas porque o nativo só desenha UMA linha de texto por opção: a situação,
// a quantidade e o motivo de estar indisponível viravam uma frase comprida
// ("Café 500 g (3 CAIXAS — 60 UN) — 1 proposta · aprovada, gere o pedido"),
// sem busca e sem cor. Listas curtas e fixas (status, tipo, unidade)
// continuam nativas — ali o nativo é melhor.
//
// O que cada opção pode ter:
//   label   — o nome, em destaque
//   sub     — uma segunda linha menor (quantidade, documento, cargo…)
//   tag     — selo colorido à direita (situação)
//   motivo  — por que está indisponível, no lugar de só apagar a linha
//   hint    — texto a mais que a busca encontra, mas não aparece
//
// O painel abre num portal com posição fixa: dentro de modal ou card com
// overflow escondido ele não é cortado.

export type TomTag = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'roxo' | 'laranja' | 'cinza' | 'dourado';

const COR_TAG: Record<TomTag, string> = {
  verde: 'bg-green-600 text-white',
  amarelo: 'bg-yellow-400 text-black',
  vermelho: 'bg-red-600 text-white',
  azul: 'bg-blue-600 text-white',
  roxo: 'bg-purple-600 text-white',
  laranja: 'bg-orange-600 text-white',
  cinza: 'bg-zinc-600 text-white',
  dourado: 'btn-solido--dourado',
};

export type SelectBuscaOpcao = {
  value: string;
  label: string;
  sub?: string | null;
  tag?: { texto: string; tom?: TomTag } | null;
  /** Texto extra pesquisável (não aparece na régua principal da opção). */
  hint?: string;
  disabled?: boolean;
  /** Por que a opção está indisponível — aparece embaixo do nome. */
  motivo?: string | null;
};

export type SelectBuscaGrupo = {
  label: string;
  opcoes: SelectBuscaOpcao[];
  /** Cor do cabeçalho do grupo — quando o grupo TEM um significado próprio
   *  (aprovado = verde, ainda falta = vermelho). Sem isto, cai na cor de
   *  destaque do tema (o padrão neutro, "isto é um título"). */
  tom?: TomTag;
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
  /** Com grupo (cabeçalho + contagem) ou lista simples. */
  grupos?: SelectBuscaGrupo[];
  opcoes?: SelectBuscaOpcao[];
  placeholder?: string;
  /** Texto mostrado quando a busca não acha nada (ou quando não há opções). */
  vazioTexto?: string;
  error?: string;
  id?: string;
  disabled?: boolean;
  abrirAoMontar?: boolean;
  /** Acima de quantas opções o campo de busca aparece. */
  buscaAPartirDe?: number;
  /** Mostra "— Nenhum —" no topo, para campo opcional. */
  permitirVazio?: string;
  className?: string;
  /** Chamados ao abrir/fechar — ex.: congelar a lista enquanto está aberta. */
  onAbrir?: () => void;
  onFechar?: () => void;
  /** Campo menor, para linha de tabela ou barra compacta. */
  compacto?: boolean;
  'aria-label'?: string;
};

const LARGURA_MIN = 340;

export const SelectBusca = ({
  value, onChange, grupos, opcoes, placeholder = 'Selecione...', vazioTexto = 'Nada encontrado.',
  error, id, disabled, abrirAoMontar, buscaAPartirDe = 8, permitirVazio, className = '',
  onAbrir, onFechar, compacto = false, 'aria-label': ariaLabel,
}: Props) => {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [destacado, setDestacado] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number; acima: boolean } | null>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const gruposBase = useMemo<SelectBuscaGrupo[]>(() => {
    const base = grupos ?? [{ label: '', opcoes: opcoes ?? [] }];
    return permitirVazio ? [{ label: '', opcoes: [{ value: '', label: permitirVazio }] }, ...base] : base;
  }, [grupos, opcoes, permitirVazio]);

  // Todas as opções achatadas, na ordem em que aparecem na tela — é sobre essa
  // lista que ↑/↓/Enter navegam, sem se importar com o agrupamento.
  const todasOpcoes = useMemo(() => gruposBase.flatMap(g => g.opcoes), [gruposBase]);
  const selecionada = todasOpcoes.find(o => o.value === value && (o.value !== '' || !!permitirVazio)) ?? null;
  const mostraBusca = todasOpcoes.length > buscaAPartirDe;

  const gruposFiltrados = useMemo(() => {
    const q = chaveBusca(busca);
    if (!q) return gruposBase;
    return gruposBase
      .map(g => ({
        ...g,
        opcoes: g.opcoes.filter(o =>
          chaveBusca(o.label).includes(q)
          || (o.sub ? chaveBusca(o.sub).includes(q) : false)
          || (o.hint ? chaveBusca(o.hint).includes(q) : false)),
      }))
      .filter(g => g.opcoes.length > 0);
  }, [gruposBase, busca]);
  const opcoesFiltradas = useMemo(() => gruposFiltrados.flatMap(g => g.opcoes), [gruposFiltrados]);

  useEffect(() => {
    // Destaque começa na selecionada (ou na primeira disponível).
    const idx = opcoesFiltradas.findIndex(o => o.value === value);
    setDestacado(idx >= 0 ? idx : Math.max(0, opcoesFiltradas.findIndex(o => !o.disabled)));
  }, [busca, aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Posição do painel a partir do gatilho: abaixo, ou acima se não couber.
  const posicionar = () => {
    const el = gatilhoRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const width = Math.min(Math.max(r.width, LARGURA_MIN), vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const abaixo = vh - r.bottom - 12;
    const acimaEsp = r.top - 12;
    const acima = abaixo < 240 && acimaEsp > abaixo;
    const maxH = Math.min(380, Math.max(160, acima ? acimaEsp : abaixo));
    setPos({ top: acima ? r.top - 6 : r.bottom + 6, left, width, maxH, acima });
  };

  useLayoutEffect(() => { if (aberto) posicionar(); }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: MouseEvent) => {
      const t = e.target as Node;
      if (gatilhoRef.current?.contains(t) || painelRef.current?.contains(t)) return;
      fechar();
    };
    // Rolagem de fora do painel reposiciona (o gatilho andou); a do próprio
    // painel não conta.
    const aoRolar = (e: Event) => {
      if (painelRef.current?.contains(e.target as Node)) return;
      posicionar();
    };
    document.addEventListener('mousedown', aoClicarFora);
    window.addEventListener('resize', posicionar);
    window.addEventListener('scroll', aoRolar, true);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      window.removeEventListener('resize', posicionar);
      window.removeEventListener('scroll', aoRolar, true);
    };
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mantém a opção destacada à vista ao navegar pelo teclado.
  useEffect(() => {
    if (!aberto) return;
    listaRef.current?.querySelector<HTMLElement>(`[data-idx="${destacado}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [destacado, aberto]);

  const abrir = () => {
    if (disabled) return;
    onAbrir?.();
    setBusca('');
    setAberto(true);
    requestAnimationFrame(() => (mostraBusca ? inputRef.current : listaRef.current)?.focus());
  };

  function fechar() {
    setAberto(false);
    setBusca('');
    onFechar?.();
  }

  useEffect(() => { if (abrirAoMontar) abrir(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const escolher = (opcao: SelectBuscaOpcao) => {
    if (opcao.disabled) return;
    onChange(opcao.value);
    fechar();
    gatilhoRef.current?.focus();
  };

  const aoTeclar = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); fechar(); gatilhoRef.current?.focus(); return; }
    if (e.key === 'Tab') { fechar(); return; }
    const mover = (passo: number) => {
      e.preventDefault();
      setDestacado(i => {
        let j = i;
        for (let n = 0; n < opcoesFiltradas.length; n++) {
          j = Math.min(Math.max(j + passo, 0), opcoesFiltradas.length - 1);
          if (!opcoesFiltradas[j]?.disabled) return j;
        }
        return i;
      });
    };
    if (e.key === 'ArrowDown') return mover(1);
    if (e.key === 'ArrowUp') return mover(-1);
    if (e.key === 'Enter') {
      e.preventDefault();
      const alvo = opcoesFiltradas[destacado];
      if (alvo) escolher(alvo);
    }
  };

  const Tag = ({ t }: { t: NonNullable<SelectBuscaOpcao['tag']> }) => (
    <span className={`shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded whitespace-nowrap ${COR_TAG[t.tom ?? 'cinza']}`}>{t.texto}</span>
  );

  const painel = aberto && pos && createPortal(
    <div
      ref={painelRef}
      onKeyDown={aoTeclar}
      className="fixed z-[70] neu-flat rounded-xl border border-white/10 shadow-2xl overflow-hidden flex flex-col"
      style={{
        left: pos.left, width: pos.width, maxHeight: pos.maxH,
        background: 'var(--color-bg-base)',
        ...(pos.acima ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
      }}
    >
      {mostraBusca && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5 shrink-0">
          <Search size={14} className="text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder={`Buscar entre ${todasOpcoes.length}…`}
            aria-label="Buscar"
            data-trava-atualizacao="nao"
            className="bg-transparent outline-none text-sm text-gray-200 w-full placeholder:text-gray-600"
          />
        </div>
      )}
      <div ref={listaRef} tabIndex={-1} role="listbox" className="overflow-y-auto main-scrollbar py-1 outline-none">
        {opcoesFiltradas.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-500 text-center">{vazioTexto}</p>
        ) : (
          gruposFiltrados.map((g, gi) => (
            <div key={`${g.label}-${gi}`}>
              {g.label && (
                // Fundo sólido (não só texto cinza): numa lista de grupos
                // rolando, o cabeçalho cinza-sobre-cinza se perdia igual às
                // opções — a cor separa "isto é título" de "isto é opção"
                // antes mesmo de ler a palavra. Grupo com `tom` (aprovado,
                // ainda falta) usa a cor do próprio significado; sem `tom`
                // cai na cor de destaque do tema.
                <div className={`sticky top-0 z-10 px-3 py-1.5 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-widest ${
                  g.tom ? COR_TAG[g.tom] : ''}`}
                  style={g.tom ? undefined : { background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}>
                  <span className="truncate">{g.label}</span>
                  <span className="tabular-nums opacity-70">{g.opcoes.length}</span>
                </div>
              )}
              {g.opcoes.map(o => {
                const idx = opcoesFiltradas.indexOf(o);
                const ativa = idx === destacado;
                const escolhida = o.value === value && (o.value !== '' || !!permitirVazio);
                return (
                  <button
                    type="button"
                    key={`${o.value}-${idx}`}
                    data-idx={idx}
                    role="option"
                    aria-selected={escolhida}
                    aria-disabled={o.disabled || undefined}
                    tabIndex={-1}
                    onMouseEnter={() => !o.disabled && setDestacado(idx)}
                    onClick={() => escolher(o)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 border-l-2 transition-colors ${
                      o.disabled ? 'cursor-not-allowed border-transparent'
                      : ativa ? 'bg-accent/10 border-accent' : 'border-transparent hover:bg-white/[0.04]'}`}
                  >
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className={`text-sm leading-snug line-clamp-2 break-words ${
                        o.disabled ? 'text-gray-500' : escolhida ? 'text-accent font-bold' : ativa ? 'text-gray-100' : 'text-gray-200'}`}>
                        {o.label}
                      </span>
                      {o.sub && <span className="text-[11px] text-gray-500 truncate">{o.sub}</span>}
                      {o.disabled && o.motivo && <span className="text-[11px] text-amber-500/90 truncate">{o.motivo}</span>}
                    </span>
                    {o.tag && <Tag t={o.tag} />}
                    {escolhida && <Check size={14} className="shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className={`relative ${className}`}>
      <button
        ref={gatilhoRef}
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={e => {
          if (!aberto && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrir(); }
          else if (aberto) aoTeclar(e);
        }}
        className={`neu-input w-full flex items-center ${compacto ? 'py-1.5 px-2.5 rounded-lg text-xs min-h-[32px]' : 'py-2 px-3 rounded-xl text-sm min-h-[42px]'} justify-between gap-2 text-left disabled:opacity-50 disabled:cursor-not-allowed ${
          error ? 'border border-red-500/40' : ''} ${aberto ? 'ring-1 ring-accent/40' : ''}`}
      >
        <span className="min-w-0 flex-1 flex items-center gap-2">
          {selecionada ? (
            <>
              <span className="text-gray-100 truncate">{selecionada.label}</span>
              {selecionada.sub && <span className="text-[11px] text-gray-500 truncate shrink-[2]">{selecionada.sub}</span>}
            </>
          ) : (
            <span className="text-gray-500 truncate">{placeholder}</span>
          )}
        </span>
        {selecionada?.tag && <Tag t={selecionada.tag} />}
        <ChevronDown size={15} className={`shrink-0 text-gray-500 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {painel}

      {error && (
        <span className="flex items-center gap-1 text-[10px] text-red-500 font-semibold mt-1.5">
          <AlertCircle size={10} /> {error}
        </span>
      )}
    </div>
  );
};
