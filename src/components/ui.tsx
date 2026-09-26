import React from 'react';
import { Search, Loader2, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Package, Landmark } from 'lucide-react';
import { diasDesde } from '../lib/dates';
import { urlMiniatura } from '../lib/produtoImagem';

// Situação em cor cheia, sem transparência, com uma régua de SIGNIFICADO
// única no app (Pedidos, Cotações, Requisições, Contas…): verde = deu certo,
// azul = andando, amarelo = esperando alguém decidir, laranja = voltou para
// ajuste ou está pela metade, vermelho = parou/deu errado, cinza = fora de
// cena. O translúcido lia apagado e "Em Entrega" dourado se confundia com
// "Aprovado".
const VERDE = 'bg-green-600 text-white';
const AZUL = 'bg-blue-600 text-white';
const AMARELO = 'bg-yellow-400 text-black';
const LARANJA = 'bg-orange-600 text-white';
const VERMELHO = 'bg-red-600 text-white';
const ROXO = 'bg-purple-600 text-white';
const CINZA = 'bg-zinc-600 text-white';
const COR_STATUS: Record<string, string> = {
  // deu certo
  'Aprovado': VERDE, 'Aprovada': VERDE, 'Recebido': VERDE, 'Pago': VERDE, 'Paga': VERDE, 'Entregue': VERDE,
  'Autorizado': VERDE, 'Vinculada': VERDE, 'Atendida': VERDE, 'Concluído': VERDE, 'Concluída': VERDE,
  'Conciliado': VERDE, 'Despachado': VERDE, 'Expedido': VERDE, 'Ativo': VERDE, 'Ativa': VERDE,
  'Confirmado': VERDE, 'Processada': VERDE, 'Processado': VERDE, 'Homologado': VERDE, 'Publicado': VERDE,
  'Presente': VERDE, 'Preenchida': VERDE, 'Convertido em Pedido': VERDE, 'Aprovado Cliente': VERDE,
  'Aprovado Financeiro': VERDE, 'Aceito': VERDE, 'vigente': VERDE,
  // andando
  'Em Entrega': AZUL, 'Em Andamento': AZUL, 'Em Cotação': AZUL, 'Em Faturamento': AZUL, 'Emitida': AZUL,
  'Aberto': AZUL, 'Em Produção': AZUL, 'Agendado': AZUL, 'Enviado ao Cliente': AZUL, 'Em Análise': AZUL,
  'Novo': AZUL, 'Hora Extra': AZUL, 'Em Atendimento': AZUL,
  // esperando decisão
  'Pendente': AMARELO, 'Aguardando Financeiro': AMARELO, 'Aguardando Matriz': AMARELO,
  'Aguardando Aprovação': AMARELO, 'Aguardando Confirmação': AMARELO, 'Solicitada': AMARELO, 'Próximo': AMARELO,
  'Justificado': AMARELO, 'Justificada': AMARELO, 'aguardando': AMARELO,
  // voltou para ajuste / pela metade
  'Em correção': LARANJA, 'Parcial': LARANJA, 'Parcialmente Aprovado': LARANJA, 'Presente com Atraso': LARANJA, 'Pausada': LARANJA, 'Suspenso': LARANJA,
  // parou / deu errado
  'Cancelado': VERMELHO, 'Cancelada': VERMELHO, 'Negado': VERMELHO, 'Negada': VERMELHO, 'Reprovado': VERMELHO,
  'Divergente': VERMELHO, 'Atrasado': VERMELHO, 'Vencido': VERMELHO, 'Erro': VERMELHO, 'Falta': VERMELHO,
  'Desligado': VERMELHO, 'Expirada': VERMELHO, 'Não Vinculada': VERMELHO, 'Recusado': VERMELHO,
  'recusado': VERMELHO, 'rescindido': VERMELHO,
  // afastado é situação própria
  'Afastado': ROXO,
};

// `solido` ficou sem efeito (tudo é cheio agora); mantido para não quebrar
// quem ainda passa a prop.
/** Só a cor (fundo cheio + texto), para quem desenha o próprio chip. */
export const corDoStatus = (status: string | null | undefined): string =>
  `${COR_STATUS[status ?? ''] ?? CINZA} border-transparent`;

export const StatusBadge = ({ status }: { status: string; solido?: boolean }) => {
  const colorClass = COR_STATUS[status] ?? CINZA;

  // "Atendida" é feminino no meio de uma régua masculina (Aprovado/Negado/
  // Aberto); o valor gravado no banco continua 'Atendida' — trocar exigiria
  // migração de dados em toda comparação `=== 'Atendida'` espalhada pelo
  // front. Aqui é só rótulo (plano de requisições, item 21).
  const rotulo = status === 'Atendida' ? 'Atendido' : status;

  return (
    <span
      className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${colorClass}`}
    >
      {rotulo}
    </span>
  );
};

/** "parada há N dias" — idade de um documento numa fila de decisão (plano de
 *  requisições, item 18/3.3). Âmbar a partir de 2 dias parado. `null` some
 *  em silêncio: sem data de referência não há o que mostrar. */
export const IdadeBadge = ({ iso }: { iso: string | null | undefined }) => {
  const dias = diasDesde(iso);
  if (dias === null) return null;
  const label = dias <= 0 ? 'hoje' : dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
  const alerta = dias >= 2;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums ${
      alerta ? 'bg-amber-400/15 text-amber-400' : 'text-gray-500'
    }`}>
      {label}
    </span>
  );
};

export const NeuButtonAccent = ({ children, onClick, isLoading, type = 'button', disabled = false, variant }: any) => (
  <button
    type={type}
    onClick={onClick}
    disabled={isLoading || disabled}
    className={`${variant === 'yellow' ? 'bg-yellow-400 hover:bg-yellow-300 active:bg-yellow-500 text-[#0A0A0A]' : 'neu-button-accent'} btn-shimmer py-2 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${(isLoading || disabled) ? 'opacity-60 scale-95 cursor-not-allowed' : ''}`}
  >
    {isLoading ? <Loader2 size={16} className="animate-spin" /> : null}
    {children}
  </button>
);

export const Toast = ({ message, visible, type = 'info' }: any) => (
  <AnimatePresence>
    {visible && (
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 z-50 neu-flat rounded-2xl px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 border border-white/5 max-w-[calc(100vw-2rem)]"
      >
        {type === 'error'
          ? <AlertCircle size={18} className="text-red-500" />
          : type === 'success'
          ? <CheckCircle size={18} className="text-accent" />
          : <div className="w-3 h-3 rounded-full bg-accent animate-pulse shadow-[0_0_8px_var(--color-accent)]" />
        }
        <span className="text-sm font-semibold text-gray-200 tracking-wide">{message}</span>
      </motion.div>
    )}
  </AnimatePresence>
);

export const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center p-12 w-full text-center">
    <Loader2 size={32} className="text-accent animate-spin mb-4" />
    <span className="text-xs text-gray-400 font-bold tracking-widest uppercase">Carregando dados...</span>
  </div>
);

// O spinner so aparece depois de 150ms — e a diferenca entre "trocou de tela"
// e "piscou um spinner no meio do caminho". Chunk que resolve rapido (tela ja
// visitada, ou prefetch do menu que chegou a tempo) desmonta este componente
// antes do delay e nada chega a ser pintado. O atraso e CSS puro
// (`animation-delay`), sem timer nem estado.
export const PageLoadingFallback = () => (
  <div className="page-loading-fallback flex flex-col items-center justify-center w-full h-full min-h-[300px] gap-4">
    <Loader2 size={36} className="animate-spin" style={{ color: '#FACC15' }} />
    <span className="text-xs font-bold tracking-widest uppercase" style={{ color: '#FACC15', opacity: 0.65 }}>
      Carregando módulo...
    </span>
  </div>
);

export const Pagination = ({
  page,
  totalCount,
  pageSize = 50,
  isLoading,
  onPrev,
  onNext,
  onReload,
}: {
  page: number;
  totalCount: number | null;
  pageSize?: number;
  isLoading?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onReload?: () => void;
}) => {
  const hasNext = totalCount !== null && (page + 1) * pageSize < totalCount;
  const hasPrev = page > 0;
  // Em mobile, mostra sempre o botão de refresh mesmo quando há só uma página.
  if (!hasPrev && !hasNext && !onReload) return null;
  const from = totalCount ? page * pageSize + 1 : 0;
  const to   = totalCount ? Math.min((page + 1) * pageSize, totalCount) : 0;
  return (
    <div className="flex items-center justify-between gap-2 pt-4 border-t border-white/5 mt-2 flex-wrap">
      <span className="text-xs text-gray-500">
        {totalCount !== null ? `${from}–${to} de ${totalCount} registros` : `Página ${page + 1}`}
      </span>
      <div className="flex gap-2 items-center">
        {onReload && (
          <button
            onClick={onReload}
            disabled={isLoading}
            title="Atualizar"
            className="neu-button w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        )}
        <button
          onClick={onPrev}
          disabled={!hasPrev || isLoading}
          className="neu-button px-3 sm:px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← <span className="hidden sm:inline">Anterior</span>
        </button>
        <button
          onClick={onNext}
          disabled={!hasNext || isLoading}
          className="neu-button px-3 sm:px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <span className="hidden sm:inline">Próximo</span> →
        </button>
      </div>
    </div>
  );
};

// Mostra "nada encontrado" OU, se `error` for passado, um banner vermelho
// com a mensagem do PostgREST/Supabase. Sem `error`, comporta-se igual ao
// antigo (back-compat). Views que destructuram `error` do useFetchData
// devem repassar aqui — caso contrário, problemas de RLS/coluna/4xx ficam
// indistinguíveis de "tabela realmente vazia" (foi o que mascarou o bug
// das artes promocionais por dois passos).
export const EmptyState = ({ message = 'Nenhum registro encontrado', error }: { message?: string; error?: string | null }) => {
  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center p-10 w-full text-center rounded-2xl border-dashed border-2"
        style={{
          borderColor: 'rgba(239, 68, 68, 0.45)',         // red-500 @ 45%
          background:  'rgba(239, 68, 68, 0.06)',          // red-500 @ 6%
        }}
      >
        <AlertCircle size={32} className="text-red-500 mb-3" />
        <span className="text-sm font-bold text-red-400 mb-1">Erro ao carregar dados</span>
        <span className="text-xs text-gray-400 max-w-md break-words">{error}</span>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col items-center justify-center p-12 w-full text-center rounded-2xl border-dashed border-2"
      style={{
        borderColor: 'var(--color-border-md)',
        background: 'var(--color-surface)',
      }}
    >
      <Search size={32} className="text-gray-600 mb-4" />
      <span className="text-sm font-semibold text-gray-400">{message}</span>
    </div>
  );
};

// Tela operacional aberta em modo Matriz. Todas as telas do fluxo de compras
// devolviam `null` aqui: a área de conteúdo ficava vazia, sem uma palavra.
// O menu da holding não leva a elas, mas as notificações levam — o sino aponta
// para 'compras-cotações' e 'estoque-recebimentos', e quem clicasse a partir da
// Matriz recebia uma tela em branco no lugar da cotação que o avisou.
export const SelecioneUnidade = ({ oQue }: { oQue: string }) => (
  <div className="flex-1 flex items-center justify-center p-6">
    <div
      className="flex flex-col items-center justify-center p-12 w-full max-w-lg text-center rounded-2xl border-dashed border-2"
      style={{ borderColor: 'var(--color-border-md)', background: 'var(--color-surface)' }}
    >
      <Landmark size={32} className="text-gray-600 mb-4" />
      <span className="text-sm font-semibold text-gray-300 mb-1">Esta tela é de cada unidade</span>
      <span className="text-xs text-gray-500 max-w-sm leading-relaxed">
        {oQue} pertence à filial que compra, recebe e paga. Escolha SuperMax, MaxLook ou TechMax
        no seletor de unidade, no topo, para continuar.
      </span>
    </div>
  </div>
);

// Faixa de "há trabalho seu parado aqui". Cada item é um contador com o que
// fazer a seguir; a faixa some quando não há nada — fila vazia não merece
// destaque, e um aviso que aparece sempre para de ser lido.
export const FilaDeTrabalho = ({ itens }: { itens: { label: string; count: number; hint?: string }[] }) => {
  const vivos = itens.filter(i => i.count > 0);
  if (vivos.length === 0) return null;
  return (
    <div className="neu-flat rounded-2xl p-4 border border-accent/25 shrink-0 flex flex-wrap gap-x-8 gap-y-3">
      {vivos.map(i => (
        <div key={i.label} className="flex items-center gap-3">
          <span className="text-2xl font-black text-accent tabular-nums leading-none">{i.count}</span>
          <div className="leading-tight">
            <p className="text-xs font-bold text-gray-200">{i.label}</p>
            {i.hint && <p className="text-[10px] text-gray-500">{i.hint}</p>}
          </div>
        </div>
      ))}
    </div>
  );
};

export const FormField = ({ label, error, children, className = '' }: { label: string; error?: string; children: React.ReactNode; className?: string }) => (
  <div className={`flex flex-col gap-1.5 ${className}`}>
    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{label}</label>
    {children}
    {error && (
      <span className="flex items-center gap-1 text-[10px] text-red-500 font-semibold">
        <AlertCircle size={10} /> {error}
      </span>
    )}
  </div>
);

// Cor pela FUNÇÃO, em cor sólida (.btn-solido, index.css): PDF é vermelho,
// Excel é verde, etiqueta é o dourado. Com todos no mesmo cinza, a barra de ferramentas era
// uma fileira de botões iguais e ninguém achava o que queria. Sem `variante`,
// PDF e Excel se reconhecem pelo rótulo — é assim nas telas que já usam.
const VARIANTE_EXPORT = {
  pdf: 'btn-solido--vermelho',
  excel: 'btn-solido--verde',
  etiqueta: 'btn-solido--dourado',
} as const;
export const ExportButton = ({ label, onClick, icon: Icon, variante }: {
  label: string; onClick: () => void; icon: any; variante?: keyof typeof VARIANTE_EXPORT;
}) => {
  const v = variante ?? (label === 'PDF' ? 'pdf' : label === 'Excel' ? 'excel' : undefined);
  return (
    <button
      onClick={onClick}
      className={v
        ? `btn-solido ${VARIANTE_EXPORT[v]}`
        : 'neu-button py-2 px-4 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors flex items-center gap-1.5'}
    >
      <Icon size={13} />
      {label}
    </button>
  );
};

// Card de contador do topo das telas (Funcionários, Relatórios, Marketing…).
// A cor diz a situação (paleta em .contador--*, index.css) e o número vem
// centralizado. Tom de alerta (amarelo, laranja, vermelho) com contagem zero
// fica mais suave, mas mantém a cor: "0 desligados" não é notícia, só que
// virar cinza fazia a fileira inteira parecer igual (Promoções tinha quatro
// cards cinza lado a lado) e a cor é a legenda de cada card.
export type TomContador = 'neutro' | 'verde' | 'amarelo' | 'laranja' | 'vermelho' | 'azul' | 'roxo' | 'dourado';
const TONS_ALERTA = new Set<TomContador>(['amarelo', 'laranja', 'vermelho']);

export const CardContador = ({ label, value, sub, tom = 'neutro', onClick, ativo = false, corFixa = false }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tom?: TomContador;
  /** Com onClick o card vira botão (ex.: abre o detalhe no Dashboard). */
  onClick?: () => void; ativo?: boolean;
  /** Mantém a cor mesmo com zero — quando a cor é a legenda da categoria
   *  (Faltas vermelho, igual ao botão Falta da linha), e não um alerta. */
  corFixa?: boolean;
}) => {
  const zero = value === 0 || value === '0';
  const suave = zero && TONS_ALERTA.has(tom) && !corFixa;
  // O card é container: valor comprido (R$ 106.096,37) encolhe até caber numa
  // linha só, em vez de estourar a borda ou quebrar o "-" do "R$".
  const texto = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const fonte = texto.length > 4 ? `min(1.875rem, calc(100cqi / ${(texto.length * 0.64).toFixed(2)}))` : undefined;
  const cls = `contador contador--${tom}${suave ? ' opacity-60' : ''} @container min-w-0 rounded-2xl px-4 py-5 flex flex-col items-center justify-center text-center gap-1.5`;
  const miolo = (
    <>
      <p className="contador-rotulo text-[10px] uppercase tracking-widest font-bold leading-tight">{label}</p>
      <p className="contador-valor text-2xl sm:text-3xl font-black tabular-nums leading-none whitespace-nowrap max-w-full"
        style={fonte ? { fontSize: fonte } : undefined}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 leading-tight">{sub}</p>}
    </>
  );
  if (!onClick) return <div className={cls}>{miolo}</div>;
  return (
    <button type="button" onClick={onClick} aria-expanded={ativo}
      className={`${cls} transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--contador-rotulo)] ${
        ativo ? 'ring-2 ring-[var(--contador-rotulo)] ring-offset-2 ring-offset-[var(--color-bg-base)]' : ''}`}>
      {miolo}
    </button>
  );
};

// Aba com contador — o padrão das abas de fila (Cotações, Requisições,
// Aprovações, Pedidos).
//
// Cada aba tem a cor do que ela SIGNIFICA (amarelo pede ação, verde é
// aprovado, vermelho é negado…), em cor cheia e parada (.btn-solido) — o vidro
// translúcido com brilho lia apagado e fazia a fileira piscar. A quantidade vai
// num card ao lado: dentro do botão, em fonte miúda, ninguém via. A ativa ganha
// um anel e um traço embaixo.
export const COR_ABA = {
  amarelo:  { botao: 'btn-solido--amarelo',    numero: 'text-yellow-300' },
  azul:     { botao: 'btn-solido--azul',       numero: 'text-blue-300' },
  roxo:     { botao: 'btn-solido--roxo',       numero: 'text-purple-300' },
  verde:    { botao: 'btn-solido--verde',      numero: 'text-green-400' },
  cinza:    { botao: 'btn-solido--cinza',      numero: 'text-gray-300' },
  vermelho: { botao: 'btn-solido--vermelho',   numero: 'text-red-300' },
  laranja:  { botao: 'btn-solido--laranja',    numero: 'text-orange-400' },
  navy:     { botao: 'btn-solido--navy',       numero: 'text-blue-300' },
  verdeEscuro: { botao: 'btn-solido--verde-escuro', numero: 'text-green-400' },
  dourado:  { botao: 'btn-solido--dourado',    numero: 'text-accent' },
  preto:    { botao: 'btn-solido--preto-ouro', numero: 'text-accent' },
} as const;
export type CorAba = keyof typeof COR_ABA;

export const AbaComContador = ({ label, n, cor, ativa, onClick, icon: Icon, title, alerta }: {
  label: string; n: number; cor: CorAba; ativa: boolean; onClick: () => void;
  icon?: any; title?: string; alerta?: boolean;
}) => (
  <div className="flex items-stretch gap-1.5">
    <div className="relative flex">
      <button type="button" role="tab" aria-selected={ativa} title={title} onClick={onClick}
        className={`btn-solido ${COR_ABA[cor].botao} !py-2.5 !text-[11px] uppercase tracking-widest ${ativa ? 'aba-ativa' : ''}`}>
        {Icon && <Icon size={13} />}
        {label}
        {alerta && <span className="w-2 h-2 rounded-full bg-red-500 ring-2 ring-white/80 shrink-0" />}
      </button>
      {ativa && <span aria-hidden className="absolute left-3 right-3 -bottom-2 h-0.5 rounded-full bg-accent" />}
    </div>
    <div title={title}
      className="min-w-[2.75rem] px-3 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center">
      <span className={`text-base font-black tabular-nums ${COR_ABA[cor].numero}`}>{n}</span>
    </div>
  </div>
);

// Seção de formulário longo: caixa própria com faixa de título em cor cheia
// (mesma paleta das abas). Título cinza miúdo solto no fluxo não separava uma
// área da outra — o aluno não via onde terminava Identificação e começava
// Preços. Cada seção com uma cor diferente para ser achada de relance.
export const SecaoFormulario = ({ titulo, icon: Icon, cor, extra, children }: {
  titulo: React.ReactNode; icon?: any; cor: CorAba; extra?: React.ReactNode; children: React.ReactNode;
}) => (
  <section className="rounded-2xl border border-white/10 overflow-hidden">
    <header className={`${COR_ABA[cor].botao} flex items-center justify-between gap-3 px-4 py-2`}>
      <h4 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest">
        {Icon && <Icon size={14} className="shrink-0" />}
        {titulo}
      </h4>
      {extra && <span className="text-[10px] font-bold opacity-90 text-right">{extra}</span>}
    </header>
    <div className="p-4 sm:p-5">{children}</div>
  </section>
);

// Aba colorida sem contador — mesma régua da AbaComContador (cor cheia e
// parada, nunca cinza), para menus de aba que não têm uma quantidade para
// mostrar (Central de Avaliação, Demandas). Antes essas abas só ganhavam
// destaque quando ativas; as outras ficavam cinza-sobre-cinza, sem
// distinção nem organização visual entre elas.
export const AbaColorida = ({ label, cor, ativa, onClick, icon: Icon, title }: {
  label: string; cor: CorAba; ativa: boolean; onClick: () => void;
  icon?: any; title?: string;
}) => (
  <div className="relative flex">
    <button type="button" role="tab" aria-selected={ativa} title={title} onClick={onClick}
      className={`btn-solido ${COR_ABA[cor].botao} !py-1.5 !px-3 !text-[11px] uppercase tracking-widest ${ativa ? 'aba-ativa' : ''}`}>
      {Icon && <Icon size={12} />}
      {label}
    </button>
    {ativa && <span aria-hidden className="absolute left-3 right-3 -bottom-2 h-0.5 rounded-full bg-accent" />}
  </div>
);

export const UrgenciaBadge =({ urgencia }: { urgencia: string }) => {
  const cls: Record<string, string> = {
    'Normal':  'text-gray-400',
    'Alta':    'bg-yellow-500/15 text-yellow-500',
    'Urgente': 'bg-red-500/15 text-red-500',
  };
  const style: React.CSSProperties =
    urgencia === 'Normal' ? { background: 'var(--color-badge-neutral-bg)' } : {};

  return (
    <span
      className={`px-2 py-1 rounded text-[10px] uppercase tracking-widest font-bold ${cls[urgencia] ?? cls['Normal']}`}
      style={style}
    >
      {urgencia}
    </span>
  );
};

// Badge da unidade de negócio (Holding). Aceita string livre — se for um valor
// conhecido (SuperMax/MaxLook/TechMax/Matriz), aplica a cor estável; caso
// contrário cai num cinza neutro.
export const FilialBadge = ({ filial }: { filial?: string | null }) => {
  // Classes CSS dedicadas (.filial-badge--*) com variantes claro/escuro em
  // index.css. No light mode os tons ficam mais escuros para garantir contraste.
  const f = (filial ?? '').toString().trim();
  if (!f) return <span className="text-gray-700 text-xs">—</span>;
  const variantMap: Record<string, string> = {
    SuperMax: 'supermax',
    MaxLook:  'maxlook',
    TechMax:  'techmax',
    Matriz:   'matriz',
  };
  const variant = variantMap[f] ?? 'unknown';
  return <span className={`filial-badge filial-badge--${variant}`}>{f}</span>;
};

// Miniatura/imagem de produto com fallback amigável quando não há imagem.
// Aceita tamanhos pré-definidos (`xs` 40px → tabela, `sm` 56px → mobile,
// `md` 72px → cards PDV, `lg` 96px → preview no formulário). Mantém aspecto
// quadrado e canto arredondado consistentes com o resto da UI neumorfa.
// Miniaturas que já falharam nesta sessão (foto antiga, de antes da miniatura
// existir). Guardar evita pagar o 400 de novo a cada remontagem do card.
const miniaturaAusente = new Set<string>();

// <img> que tenta a miniatura irmã e cai na original se ela não existir.
// `original` força a foto grande (zoom do modal).
export const ImagemProduto = ({ url, alt, className, original = false }: {
  url: string; alt?: string; className?: string; original?: boolean;
}) => {
  const mini = original ? null : urlMiniatura(url);
  const inicial = mini && !miniaturaAusente.has(mini) ? mini : url;
  const [src, setSrc] = React.useState(inicial);
  const [falhou, setFalhou] = React.useState(false);
  React.useEffect(() => { setSrc(inicial); setFalhou(false); }, [inicial]);
  if (falhou) return null;
  return (
    <img
      src={src}
      alt={alt ?? 'Imagem do produto'}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => {
        if (mini && src === mini) { miniaturaAusente.add(mini); setSrc(url); return; }
        // Se a URL quebrar, some a <img> e o fundo de fallback aparece.
        setFalhou(true);
      }}
    />
  );
};

export const ProdutoThumb = ({
  url,
  alt,
  size = 'sm',
  rounded = 'rounded-xl',
}: {
  url?: string | null;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  rounded?: string;
}) => {
  const dim: Record<string, string> = {
    xs: 'w-10 h-10',
    sm: 'w-14 h-14',
    md: 'w-20 h-20',
    lg: 'w-24 h-24',
  };
  const iconSize: Record<string, number> = { xs: 16, sm: 20, md: 26, lg: 32 };
  const base = `${dim[size]} ${rounded} shrink-0 overflow-hidden flex items-center justify-center neu-pressed border border-white/5`;
  if (url) {
    return (
      <div className={`${base} text-gray-600`}>
        <ImagemProduto url={url} alt={alt} className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`${base} text-gray-600`}>
      <Package size={iconSize[size]} strokeWidth={1.5} />
    </div>
  );
};

// Miniatura/logo de banco. Mesmas dimensões e cantos da ProdutoThumb;
// fallback usa Landmark (ícone bancário) e tem object-contain em vez de
// object-cover porque logos costumam ter espaço em branco em volta.
export const BancoThumb = ({
  url,
  alt,
  size = 'sm',
  rounded = 'rounded-xl',
}: {
  url?: string | null;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  rounded?: string;
}) => {
  const dim: Record<string, string> = {
    xs: 'w-10 h-10',
    sm: 'w-14 h-14',
    md: 'w-20 h-20',
    lg: 'w-24 h-24',
  };
  const iconSize: Record<string, number> = { xs: 16, sm: 20, md: 26, lg: 32 };
  const base = `${dim[size]} ${rounded} shrink-0 overflow-hidden flex items-center justify-center neu-pressed border border-white/5 bg-white/5`;
  if (url) {
    return (
      <div className={base}>
        <img
          src={url}
          alt={alt ?? 'Logo do banco'}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-contain p-1.5"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }
  return (
    <div className={`${base} text-gray-500`}>
      <Landmark size={iconSize[size]} strokeWidth={1.5} />
    </div>
  );
};

export const PlaceholderView = ({ title, desc }: { title: string; desc?: string }) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
    <div>
      <h2 className="text-3xl font-bold text-accent tracking-tight">{title}</h2>
      {desc && <p className="text-sm text-gray-400 mt-1">{desc}</p>}
    </div>
    <div className="flex h-full items-center justify-center flex-col gap-4 text-center">
      <div className="neu-pressed w-20 h-20 rounded-full flex items-center justify-center shadow-inner">
        <Package size={28} className="text-gray-600" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-gray-300">Módulo em Desenvolvimento</h2>
        <p className="text-sm text-gray-500 mt-2 max-w-sm">
          Esta visualização estará disponível em breve. Continue navegando pela plataforma.
        </p>
      </div>
    </div>
  </motion.div>
);

/**
 * Modal de leitura — texto que o usuário só precisa LER.
 *
 * Existe porque o caso não tem componente: `useConfirm` faz pergunta (dois
 * botões, e o "Cancelar" não quer dizer nada quando não há o que cancelar) e
 * o toast some sozinho, o que é péssimo para o feedback do Financeiro, que
 * costuma ser um parágrafo. Antes disso, os dois lugares chamavam o `alert()`
 * do navegador — diálogo cinza, fora do tema, com o domínio no título.
 *
 * `whitespace-pre-line` preserva as quebras de linha de quem escreveu o
 * feedback; `overflow-y-auto` segura texto longo sem esticar a página.
 */
export const TextoModal = ({ titulo, texto, onClose }: {
  titulo: string; texto: string; onClose: () => void;
}) => (
  <AnimatePresence>
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 10 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-md"
        style={{
          background: 'rgba(10,10,10,0.82)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: '1rem',
          padding: '1.5rem',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset',
        }}
      >
        <h3 className="text-sm font-bold text-accent uppercase tracking-widest mb-3">{titulo}</h3>
        <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line max-h-[60vh] overflow-y-auto main-scrollbar">
          {texto}
        </p>
        <div className="flex justify-end mt-5">
          <button
            onClick={onClose}
            autoFocus
            className="px-5 py-2 rounded-lg text-sm font-semibold neu-button text-gray-300 hover:text-accent transition-colors"
          >
            Fechar
          </button>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
);
