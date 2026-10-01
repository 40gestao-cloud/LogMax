import { useCallback, useEffect, useRef, useState } from 'react';
import { MousePointer2, Pencil, Highlighter, Eraser, Undo2, Trash2, Type, Sigma, Search, X } from 'lucide-react';
import { FORMULAS_SHOW, GRUPOS_FORMULAS, filtrarFormulas, type FormulaShow } from '../lib/maxShowFormulas';

// =================================================================
// Max Show — anotações por cima do PDF (pincel, marca-texto, texto, borracha)
// =================================================================
// Uma camada <canvas> transparente sobre cada página; o PDF embaixo não é
// tocado. O traço é guardado em coordenadas da PÁGINA (0–1), não da tela:
// acompanha zoom, tela cheia e redimensionamento sem se desalinhar.
//
// Vive só enquanto a apresentação está aberta (quadro branco): nada vai ao
// banco. Borracha apaga o traço (ou a caixa de texto) inteiro em que encosta.
//
// Caixa de texto: com a ferramenta Texto, clicar no vazio abre o campo;
// clicar numa caixa reabre para editar; arrastar uma caixa a move. As
// fórmulas da biblioteca são caixas de texto que já nascem preenchidas.
// =================================================================

export type Ferramenta = 'seta' | 'pincel' | 'marca' | 'texto' | 'borracha';

export type TracoLinha = {
  id: number;
  tipo: 'pincel' | 'marca';
  cor: string;
  /** Espessura em fração da largura da página. */
  espessura: number;
  pontos: [number, number][];
};

export type TracoTexto = {
  id: number;
  tipo: 'texto';
  cor: string;
  /** Altura da letra em fração da largura da página. */
  tamanho: number;
  /** Canto de cima à esquerda da caixa, em fração da página. */
  x: number;
  y: number;
  texto: string;
  /** Cartão branco atrás do texto — fórmula sobre slide colorido. */
  fundo?: boolean;
};

export type Traco = TracoLinha | TracoTexto;
type NovoTraco = Omit<TracoLinha, 'id'> | Omit<TracoTexto, 'id'>;

/** Traços por número de página (1-based; 0 é o quadro branco). */
export type TracosPorPagina = Record<number, Traco[]>;
export const PAGINA_QUADRO = 0;
export type FundoQuadro = 'branco' | 'preto';

type Acao =
  | { tipo: 'add'; pagina: number; traco: Traco }
  | { tipo: 'del'; pagina: number; traco: Traco; indice: number }
  | { tipo: 'troca'; pagina: number; antes: Traco }
  | { tipo: 'limpar'; pagina: number; tracos: Traco[] };

const COR_ESCURA = '#111827';
const COR_CLARA = '#ffffff';
export const CORES_PINCEL = ['#ef4444', '#2563eb', '#16a34a', '#f97316', '#9333ea', '#facc15', COR_ESCURA, COR_CLARA];
export const CORES_MARCA = ['#facc15', '#4ade80', '#f472b6', '#38bdf8'];
export const ESPESSURAS_PINCEL = [0.003, 0.006, 0.012];
export const TAMANHOS_TEXTO = [0.018, 0.026, 0.038, 0.056];
const TAMANHO_FORMULA = 0.03;
const ESPESSURA_MARCA = 0.025;
const OPACIDADE_MARCA = 0.38;
const ALTURA_LINHA = 1.3;
/** Respiro do cartão branco, em múltiplos da altura da letra. */
const RESPIRO_FUNDO = 0.5;
const fonte = (px: number) => `700 ${px}px Montserrat, system-ui, sans-serif`;

let proximoId = 1;

/** Estado das anotações de uma apresentação: traços, ferramenta e desfazer. */
export function useAnotacoes() {
  const [ferramenta, setFerramenta] = useState<Ferramenta>('seta');
  const [corPincel, setCorPincel] = useState(CORES_PINCEL[0]);
  const [corMarca, setCorMarca] = useState(CORES_MARCA[0]);
  const [espessura, setEspessura] = useState(ESPESSURAS_PINCEL[1]);
  const [tamanhoTexto, setTamanhoTexto] = useState(TAMANHOS_TEXTO[1]);
  const [tracos, setTracosState] = useState<TracosPorPagina>({});
  // Espelho síncrono: a borracha apaga vários traços no mesmo arraste, antes
  // de o React renderizar — ler do estado apagaria o mesmo traço duas vezes
  // e empilharia o desfazer em dobro.
  const tracosRef = useRef<TracosPorPagina>({});
  // Uma pilha de desfazer POR página (0 = quadro): Ctrl+Z no slide 5 não pode
  // mexer no que foi riscado no slide 2, que o professor não está vendo.
  const historico = useRef<Record<number, Acao[]>>({});
  const anotar = (pagina: number, a: Acao) => { (historico.current[pagina] ??= []).push(a); };
  const gravar = (pagina: number, lista: Traco[]) => {
    tracosRef.current = { ...tracosRef.current, [pagina]: lista };
    setTracosState(tracosRef.current);
  };

  const adicionar = useCallback((pagina: number, t: NovoTraco) => {
    const traco = { ...t, id: proximoId++ } as Traco;
    anotar(pagina, { tipo: 'add', pagina, traco });
    gravar(pagina, [...(tracosRef.current[pagina] ?? []), traco]);
  }, []);

  const apagar = useCallback((pagina: number, id: number) => {
    const lista = tracosRef.current[pagina] ?? [];
    const indice = lista.findIndex(t => t.id === id);
    if (indice < 0) return;
    anotar(pagina, { tipo: 'del', pagina, traco: lista[indice], indice });
    gravar(pagina, lista.filter(t => t.id !== id));
  }, []);

  /** Substitui o traço de mesmo id (caixa de texto movida ou reescrita). */
  const trocar = useCallback((pagina: number, depois: Traco) => {
    const lista = tracosRef.current[pagina] ?? [];
    const antes = lista.find(t => t.id === depois.id);
    if (!antes) return;
    anotar(pagina, { tipo: 'troca', pagina, antes });
    gravar(pagina, lista.map(t => t.id === depois.id ? depois : t));
  }, []);

  const limparPagina = useCallback((pagina: number) => {
    const lista = tracosRef.current[pagina] ?? [];
    if (lista.length === 0) return;
    anotar(pagina, { tipo: 'limpar', pagina, tracos: lista });
    gravar(pagina, []);
  }, []);

  /** Desfaz o último ato DESTA página (o quadro tem a sua própria pilha). */
  const desfazer = useCallback((pagina: number) => {
    const a = historico.current[pagina]?.pop();
    if (!a) return;
    const lista = tracosRef.current[pagina] ?? [];
    if (a.tipo === 'add') gravar(pagina, lista.filter(t => t.id !== a.traco.id));
    else if (a.tipo === 'del') {
      const nova = [...lista];
      nova.splice(Math.min(a.indice, nova.length), 0, a.traco);
      gravar(pagina, nova);
    } else if (a.tipo === 'troca') gravar(pagina, lista.map(t => t.id === a.antes.id ? a.antes : t));
    else gravar(pagina, a.tracos);
  }, []);

  const cor = ferramenta === 'marca' ? corMarca : corPincel;
  return {
    ferramenta, setFerramenta, cor, corPincel, setCorPincel, corMarca, setCorMarca,
    espessura, setEspessura, tamanhoTexto, setTamanhoTexto,
    tracos, adicionar, apagar, trocar, limparPagina, desfazer,
  };
}

export type Anotacoes = ReturnType<typeof useAnotacoes>;

function desenharTraco(ctx: CanvasRenderingContext2D, t: TracoLinha | Omit<TracoLinha, 'id'>, w: number, h: number) {
  const pts = t.pontos;
  if (pts.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = t.cor;
  ctx.fillStyle = t.cor;
  ctx.globalAlpha = t.tipo === 'marca' ? OPACIDADE_MARCA : 1;
  const lw = Math.max(1, t.espessura * w);
  ctx.lineWidth = lw;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * w, pts[0][1] * h, lw / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Curva pelos pontos médios: o traço sai liso mesmo com o mouse rápido.
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0] * w, pts[i][1] * h, mx * w, my * h);
    }
    const u = pts[pts.length - 1];
    ctx.lineTo(u[0] * w, u[1] * h);
    ctx.stroke();
  }
  ctx.restore();
}

// Medida numa página de referência: a letra é fração da largura, então a
// caixa inteira escala junto e a conta vale para qualquer tamanho de tela.
const LARGURA_REF = 1000;
let ctxMedida: CanvasRenderingContext2D | null = null;

/** Até onde a caixa pode ir à direita, em fração da largura da página. */
const LIMITE_DIR = 0.97;

type MedidaTexto = Pick<TracoTexto, 'texto' | 'tamanho' | 'fundo'> & { x?: number };

/** Largura disponível para a caixa que começa em `x` (fração da largura). */
const limiteDe = (t: MedidaTexto) => Math.max(0.15, LIMITE_DIR - (t.x ?? 0));

/**
 * Mede a caixa e devolve o texto JÁ QUEBRADO nas linhas em que ele vai ser
 * desenhado. Sem isto a frase crescia numa linha só e passava da página.
 * Quebra por palavra; palavra que sozinha não cabe é partida por letra.
 * `wf` e `hf` saem as duas em fração da LARGURA da página — a caixa inteira
 * escala com ela, então a conta vale para qualquer tamanho de tela.
 */
function medirTexto(t: MedidaTexto, limite = limiteDe(t)) {
  ctxMedida ??= document.createElement('canvas').getContext('2d');
  const respiro = t.fundo ? t.tamanho * RESPIRO_FUNDO : 0;
  const maxPx = Math.max(0, limite - 2 * respiro) * LARGURA_REF;
  const linhas: string[] = [];
  let larg = 0;
  if (!ctxMedida) {
    linhas.push(...t.texto.split('\n'));
  } else {
    ctxMedida.font = fonte(t.tamanho * LARGURA_REF);
    const larguraDe = (str: string) => ctxMedida!.measureText(str).width;
    for (const paragrafo of t.texto.split('\n')) {
      let linha = '';
      const empurrar = () => { linhas.push(linha); larg = Math.max(larg, larguraDe(linha)); linha = ''; };
      for (const palavra of paragrafo.split(' ')) {
        let p = palavra;
        while (larguraDe(p) > maxPx && p.length > 1) {
          let corte = 1;
          while (corte < p.length && larguraDe(p.slice(0, corte + 1)) <= maxPx) corte++;
          if (linha) empurrar();
          linha = p.slice(0, corte);
          empurrar();
          p = p.slice(corte);
        }
        const juntas = linha ? `${linha} ${p}` : p;
        if (linha && larguraDe(juntas) > maxPx) { empurrar(); linha = p; }
        else linha = juntas;
      }
      empurrar();
    }
  }
  return {
    linhas,
    wf: larg / LARGURA_REF + 2 * respiro,
    hf: linhas.length * ALTURA_LINHA * t.tamanho + 2 * respiro,
  };
}

const corClara = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170;
};

function desenharTexto(ctx: CanvasRenderingContext2D, t: TracoTexto, w: number, h: number, halo: boolean) {
  const px = t.tamanho * w;
  const respiro = t.fundo ? px * RESPIRO_FUNDO : 0;
  const { wf, hf, linhas } = medirTexto(t);
  const x = t.x * w, y = t.y * h;
  ctx.save();
  if (t.fundo) {
    ctx.beginPath();
    ctx.roundRect(x, y, wf * w, hf * w, px * 0.4);
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = px * 0.5;
    ctx.shadowOffsetY = px * 0.1;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  ctx.font = fonte(px);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.fillStyle = t.cor;
  linhas.forEach((linha, i) => {
    const ly = y + respiro + (i + 0.5) * px * ALTURA_LINHA;
    // Contorno: o texto solto precisa se ler em cima de qualquer slide.
    if (halo && !t.fundo) {
      ctx.strokeStyle = corClara(t.cor) ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = px * 0.16;
      ctx.strokeText(linha, x + respiro, ly);
    }
    ctx.fillText(linha, x + respiro, ly);
  });
  ctx.restore();
}

/** Distância do ponto ao segmento, em px. */
function distSegmento(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

function tocaTraco(t: Traco, x: number, y: number, w: number, h: number) {
  if (t.tipo === 'texto') {
    const { wf, hf } = medirTexto(t);
    // Meia letra de folga: com 4px era preciso acertar a linha no pixel, e
    // errar por pouco abria uma caixa nova em vez de pegar a que está lá.
    const folga = Math.max(10, t.tamanho * w * 0.5);
    return x >= t.x * w - folga && x <= t.x * w + wf * w + folga && y >= t.y * h - folga && y <= t.y * h + hf * w + folga;
  }
  const raio = Math.max(t.espessura * w / 2, 0) + 8;
  const p = t.pontos;
  if (p.length === 1) return Math.hypot(x - p[0][0] * w, y - p[0][1] * h) <= raio;
  for (let i = 0; i < p.length - 1; i++) {
    if (distSegmento(x, y, p[i][0] * w, p[i][1] * h, p[i + 1][0] * w, p[i + 1][1] * h) <= raio) return true;
  }
  return false;
}

/** `pagina`: no modo slides a prop muda sob o mesmo componente — a caixa
 *  aberta grava onde nasceu, não na página que entrou no lugar. */
type Edicao = { id?: number; x: number; y: number; texto: string; fundo?: boolean; pagina: number };

/**
 * A camada de uma página. Ocupa o pai inteiro (absolute inset-0) — o pai é
 * quem tem o tamanho da página na tela. Com a Seta ativa ela some para o
 * mouse: clique, arraste e rolagem passam para o que está embaixo.
 * `halo`: contorno no texto solto; o quadro branco (fundo liso) dispensa.
 */
export function CamadaAnotacao({ pagina, anot, halo = true }: { pagina: number; anot: Anotacoes; halo?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const atual = useRef<Omit<TracoLinha, 'id'> | null>(null);
  // Caixa de texto pega pelo mouse: vira arraste se andar, edição se soltar no lugar.
  const arrasto = useRef<{ t: TracoTexto; dx: number; dy: number; x0: number; y0: number; moveu: boolean; x: number; y: number } | null>(null);
  // Clique no vazio: onde começou, para não virar caixa nova se foi arraste.
  const novoEm = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  // Caixa pega pelo clique: a barra passa a refletir a cor e o tamanho dela,
  // e o clique seguinte abre para editar (como no PowerPoint).
  const [sel, setSel] = useState<number | null>(null);
  const selRef = useRef<number | null>(null);
  const selecionar = (id: number | null) => { selRef.current = id; setSel(id); };
  const [edit, setEdit] = useState<Edicao | null>(null);
  const editRef = useRef<Edicao | null>(null);
  const lista = anot.tracos[pagina] ?? [];
  const { ferramenta } = anot;
  const ativa = ferramenta !== 'seta';

  const abrirEdicao = (e: Edicao | null) => { editRef.current = e; setEdit(e); };

  // Chamado pelo blur, pelo Enter e pelo clique fora — o primeiro que chegar
  // grava e zera o ref; os outros encontram null e não gravam de novo.
  const confirmar = () => {
    const ed = editRef.current;
    if (!ed) return;
    abrirEdicao(null);
    const texto = ed.texto.replace(/\s+$/, '');
    const alvo = ed.pagina;
    const orig = ed.id != null ? (anot.tracos[alvo] ?? []).find(t => t.id === ed.id) : undefined;
    if (!texto.trim()) { if (orig) anot.apagar(alvo, orig.id); return; }
    if (orig && orig.tipo === 'texto') {
      if (orig.texto !== texto || orig.cor !== anot.corPincel || orig.tamanho !== anot.tamanhoTexto)
        anot.trocar(alvo, { ...orig, texto, cor: anot.corPincel, tamanho: anot.tamanhoTexto });
    } else {
      anot.adicionar(alvo, { tipo: 'texto', cor: anot.corPincel, tamanho: anot.tamanhoTexto, x: ed.x, y: ed.y, texto, fundo: ed.fundo });
    }
  };

  // A barra não tira o foco do campo (mousedown sem foco): trocar de
  // ferramenta ou de página com o campo aberto fecha gravando.
  useEffect(() => { if (ferramenta !== 'texto') confirmar(); selecionar(null); }, [ferramenta, pagina]); // eslint-disable-line react-hooks/exhaustive-deps

  const editando = edit !== null;
  useEffect(() => {
    const el = campo.current;
    if (!editando || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editando]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const redesenhar = useCallback(() => {
    const c = ref.current;
    if (!c || tam.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(tam.w * dpr)) c.width = Math.round(tam.w * dpr);
    if (c.height !== Math.round(tam.h * dpr)) c.height = Math.round(tam.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, tam.w, tam.h);
    const a = arrasto.current;
    lista.forEach(t => {
      if (t.tipo !== 'texto') { desenharTraco(ctx, t, tam.w, tam.h); return; }
      if (t.id === edit?.id) return; // está no campo aberto
      desenharTexto(ctx, a && a.moveu && a.t.id === t.id ? { ...t, x: a.x, y: a.y } : t, tam.w, tam.h, halo);
    });
    if (atual.current) desenharTraco(ctx, atual.current, tam.w, tam.h);
    // Contorno da caixa pega: sem ele o clique não dá sinal de que pegou.
    const escolhida = lista.find(t => t.id === sel && t.id !== edit?.id);
    if (escolhida?.tipo === 'texto') {
      const alvo = a && a.moveu && a.t.id === escolhida.id ? { ...escolhida, x: a.x, y: a.y } : escolhida;
      const { wf, hf } = medirTexto(alvo);
      const folga = alvo.tamanho * tam.w * 0.25;
      ctx.save();
      ctx.strokeStyle = '#F0B429';
      ctx.lineWidth = Math.max(1, tam.w * 0.0015);
      ctx.setLineDash([tam.w * 0.008, tam.w * 0.006]);
      ctx.strokeRect(alvo.x * tam.w - folga, alvo.y * tam.h - folga, wf * tam.w + 2 * folga, hf * tam.w + 2 * folga);
      ctx.restore();
    }
  }, [lista, tam, edit?.id, halo, sel]);

  useEffect(() => { redesenhar(); }, [redesenhar]);
  // A fonte pode terminar de carregar depois do primeiro desenho.
  useEffect(() => { document.fonts?.ready.then(() => redesenhar()).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ponto = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const tracoEm = (e: React.PointerEvent, soTexto = false) => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    for (let i = lista.length - 1; i >= 0; i--) {
      if (soTexto && lista[i].tipo !== 'texto') continue;
      if (tocaTraco(lista[i], x, y, r.width, r.height)) return lista[i];
    }
    return null;
  };

  const apagarEm = (e: React.PointerEvent) => {
    const t = tracoEm(e);
    if (t) anot.apagar(pagina, t.id);
  };

  const onDown = (e: React.PointerEvent) => {
    if (!ativa || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    ref.current?.setPointerCapture(e.pointerId);
    if (ferramenta === 'borracha') { atual.current = null; apagarEm(e); return; }
    if (ferramenta === 'texto') {
      // Campo aberto: o clique fora só fecha (gravando), não abre outro.
      if (editRef.current) { confirmar(); return; }
      const [x, y] = ponto(e);
      const t = tracoEm(e, true) as TracoTexto | null;
      if (t) arrasto.current = { t, dx: x - t.x, dy: y - t.y, x0: e.clientX, y0: e.clientY, moveu: false, x: t.x, y: t.y };
      else novoEm.current = { x, y, cx: e.clientX, cy: e.clientY };
      return;
    }
    atual.current = {
      tipo: ferramenta === 'marca' ? 'marca' : 'pincel',
      cor: anot.cor,
      espessura: ferramenta === 'marca' ? ESPESSURA_MARCA : anot.espessura,
      pontos: [ponto(e)],
    };
    redesenhar();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!ativa || !ref.current?.hasPointerCapture(e.pointerId)) return;
    if (ferramenta === 'borracha') { apagarEm(e); return; }
    const a = arrasto.current;
    if (a) {
      if (!a.moveu && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < 4) return;
      const [x, y] = ponto(e);
      a.moveu = true;
      a.x = x - a.dx;
      a.y = y - a.dy;
      redesenhar();
      return;
    }
    if (!atual.current) return;
    atual.current.pontos.push(ponto(e));
    redesenhar();
  };

  const onUp = (e: React.PointerEvent) => {
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
    const a = arrasto.current, novo = novoEm.current;
    arrasto.current = null;
    novoEm.current = null;
    if (a) {
      if (a.moveu) {
        // A posição vem da SOLTURA, não do último pointermove: o movimento
        // chega amostrado e a caixa parava no meio do caminho.
        if (e.type === 'pointerup' && ref.current) {
          const [x, y] = ponto(e);
          a.x = x - a.dx;
          a.y = y - a.dy;
        }
        // Presa na página: arrastada para fora, a caixa sumia sem volta.
        const { wf, hf } = medirTexto({ ...a.t, x: a.x });
        const x = Math.min(Math.max(a.x, 0.01), Math.max(0.01, LIMITE_DIR - wf));
        const y = Math.min(Math.max(a.y, 0.005), Math.max(0.005, 0.995 - (hf * tam.w) / Math.max(1, tam.h)));
        anot.trocar(pagina, { ...a.t, x, y });
        selecionar(a.t.id);
      } else if (e.type === 'pointerup') {
        // 1º clique pega (a barra passa a mostrar a cor e o tamanho dela);
        // o clique seguinte abre para editar. Com "clique = editar" era
        // impossível arrastar: o campo abria antes de o arraste começar.
        anot.setCorPincel(a.t.cor);
        anot.setTamanhoTexto(a.t.tamanho);
        if (selRef.current === a.t.id) {
          selecionar(null);
          abrirEdicao({ id: a.t.id, x: a.t.x, y: a.t.y, texto: a.t.texto, fundo: a.t.fundo, pagina });
        } else selecionar(a.t.id);
      } else redesenhar();
      return;
    }
    if (novo) {
      selecionar(null);
      // Arrastou no vazio (sem pegar caixa nenhuma): não vira caixa nova.
      const arrastou = Math.hypot(e.clientX - novo.cx, e.clientY - novo.cy) >= 4;
      // O campo abre na soltura: aberto no mousedown, o próprio clique tirava o foco dele.
      if (e.type === 'pointerup' && tam.h > 0 && !arrastou)
        abrirEdicao({ x: Math.min(novo.x, 0.9), y: novo.y - (anot.tamanhoTexto * ALTURA_LINHA * tam.w) / 2 / tam.h, texto: '', pagina });
      return;
    }
    const t = atual.current;
    atual.current = null;
    // O último pointermove pode não ter chegado no ponto onde o dedo soltou.
    if (t && ref.current && e.type === 'pointerup') t.pontos.push(ponto(e));
    if (t) anot.adicionar(pagina, t);
  };

  const cursor = ferramenta === 'borracha' ? 'cell' : ferramenta === 'texto' ? 'text' : ativa ? 'crosshair' : 'default';
  const px = anot.tamanhoTexto * tam.w;
  const medida = edit ? medirTexto({ texto: edit.texto, tamanho: anot.tamanhoTexto, fundo: edit.fundo, x: edit.x }) : null;
  // A caixa aberta tem a largura que sobra até a borda da página: o texto
  // quebra sozinho em vez de sair da tela.
  const larguraCampo = edit ? limiteDe({ texto: '', tamanho: anot.tamanhoTexto, fundo: edit.fundo, x: edit.x }) * tam.w : 0;
  return (
    <>
      <canvas ref={ref} className="max-show-anotacao"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onClick={ativa ? e => e.stopPropagation() : undefined}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          maxWidth: 'none', maxHeight: 'none',
          pointerEvents: ativa ? 'auto' : 'none',
          touchAction: ativa ? 'none' : 'auto',
          cursor,
        }} />
      {edit && medida && (
        <textarea ref={campo} className="max-show-campo-texto" value={edit.texto} spellCheck={false}
          placeholder="Digite…" aria-label="Texto da anotação"
          onChange={e => abrirEdicao({ ...edit, texto: e.target.value })}
          onBlur={confirmar}
          onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmar(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); abrirEdicao(null); }
          }}
          style={{
            left: `${edit.x * 100}%`, top: `${edit.y * 100}%`,
            width: larguraCampo, height: Math.max(medida.hf * tam.w, px * ALTURA_LINHA),
            padding: edit.fundo ? px * RESPIRO_FUNDO : 0,
            font: fonte(px), lineHeight: ALTURA_LINHA, color: anot.corPincel,
            background: corClara(anot.corPincel) ? 'rgba(17,24,39,0.85)' : 'rgba(255,255,255,0.92)',
          }} />
      )}
    </>
  );
}

/**
 * Barra flutuante das ferramentas. `quadro`: está no quadro branco — ganha a
 * troca de fundo, e a fórmula cai sem cartão, na cor que contrasta.
 */
export function BarraAnotacao({ anot, pagina, quadro, aspecto = 9 / 16, comFormulas = true }: {
  anot: Anotacoes; pagina: number;
  quadro?: { fundo: FundoQuadro; setFundo: (f: FundoQuadro) => void };
  /** altura ÷ largura da página na tela — converte a altura da caixa (que é
   *  medida em fração da LARGURA) para a fração de ALTURA em que y vive. */
  aspecto?: number;
  /** Biblioteca de fórmulas; o modo documento não a usa. */
  comFormulas?: boolean;
}) {
  const { ferramenta, setFerramenta } = anot;
  const [formulas, setFormulas] = useState(false);
  const [busca, setBusca] = useState('');
  const temTraco = (anot.tracos[pagina] ?? []).length > 0;
  const btn = (f: Ferramenta, Icon: any, titulo: string) => (
    <button type="button" onClick={() => setFerramenta(f)} title={titulo} aria-label={titulo} aria-pressed={ferramenta === f}
      className={ferramenta === f ? 'ativo' : ''}>
      <Icon size={15} />
    </button>
  );
  const cores = ferramenta === 'pincel' || ferramenta === 'texto' ? CORES_PINCEL : ferramenta === 'marca' ? CORES_MARCA : null;
  const corAtual = ferramenta === 'marca' ? anot.corMarca : anot.corPincel;
  const setCor = ferramenta === 'marca' ? anot.setCorMarca : anot.setCorPincel;

  /**
   * Primeiro y (fração da altura) em que uma caixa de `altura` não encosta em
   * nenhum texto já posto na página — a fórmula nova não cai sobre a anterior.
   * Trata cada texto como uma faixa horizontal inteira: a fórmula entra
   * centralizada e larga, então dividir a linha com outra não serviria.
   * Página cheia: encosta no rodapé em vez de empilhar por cima.
   */
  const faixaLivre = (altura: number) => {
    const TOPO = 0.12, PE = 0.97, RESPIRO = 0.015;
    const faixas = (anot.tracos[pagina] ?? [])
      .filter((t): t is TracoTexto => t.tipo === 'texto')
      .map(t => [t.y, t.y + medirTexto(t).hf / aspecto] as const)
      .sort((a, b) => a[0] - b[0]);
    let y = TOPO;
    for (const [de, ate] of faixas) {
      if (y + altura + RESPIRO <= de) break;        // cabe no vão antes dela
      if (ate + RESPIRO > y) y = ate + RESPIRO;     // ocupada: desce para depois
    }
    return Math.max(0.02, Math.min(y, PE - altura));
  };

  const fecharFormulas = () => { setFormulas(false); setBusca(''); };
  const achadas = filtrarFormulas(busca);

  // Esc fecha a biblioteca. Em captura e com stopPropagation: o Max Show
  // escuta Esc no window para voltar à Seta — sem isto, Esc trocaria de
  // ferramenta com o painel aberto e o painel ficaria lá.
  useEffect(() => {
    if (!formulas) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.max-show-formulas-busca')) return; // o campo trata o dele
      e.stopPropagation();
      fecharFormulas();
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [formulas]); // eslint-disable-line react-hooks/exhaustive-deps

  const inserirFormula = (f: FormulaShow) => {
    const fundo = !quadro;
    // A barra de ferramentas fica sobre o canto esquerdo da página: a fórmula
    // nasce depois dela, senão o começo da conta entra embaixo dos botões.
    const MARGEM_BARRA = 0.075;
    const LARGURA_MAX = LIMITE_DIR - MARGEM_BARRA;
    // Fórmula comprida desce de tamanho (sempre PARANDO num da régua P/M/G/E,
    // senão o botão da barra fica sem marcação e o valor solto gruda nas
    // caixas seguintes) até caber em duas linhas. Não cabendo, fica no menor
    // e o texto quebra — melhor duas linhas legíveis que uma minúscula.
    const regua = [...TAMANHOS_TEXTO].filter(t => t <= TAMANHO_FORMULA).sort((a, b) => b - a);
    const medir = (t: number) => medirTexto({ texto: f.formula, tamanho: t, fundo }, LARGURA_MAX);
    let tamanho = regua[regua.length - 1];
    for (const t of regua) { if (medir(t).linhas.length <= 2) { tamanho = t; break; } }
    const m = medir(tamanho);
    anot.adicionar(pagina, {
      tipo: 'texto', texto: f.formula, tamanho, fundo,
      cor: quadro?.fundo === 'preto' ? COR_CLARA : COR_ESCURA,
      x: Math.max(MARGEM_BARRA, (1 - m.wf) / 2), y: faixaLivre(m.hf / aspecto),
    });
    // Fica na ferramenta Texto: é com ela que se arrasta a fórmula para o lugar.
    setFerramenta('texto');
    fecharFormulas();
  };

  const trocarFundo = (f: FundoQuadro) => {
    if (!quadro || quadro.fundo === f) return;
    quadro.setFundo(f);
    // A cor que sumiria no fundo novo troca pela que aparece.
    if (f === 'preto' && anot.corPincel === COR_ESCURA) anot.setCorPincel(COR_CLARA);
    if (f === 'branco' && anot.corPincel === COR_CLARA) anot.setCorPincel(COR_ESCURA);
  };

  return (
    <>
      {/* mousedown sem foco: o Max Show ignora as setas com um botão focado, e o
          passador de slides parava de funcionar depois de escolher o pincel. */}
      <div className={`max-show-anotbar ${ferramenta !== 'seta' || formulas || quadro ? 'em-uso' : ''}`}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.preventDefault()}>
        {btn('seta', MousePointer2, 'Seta — navegar (Esc)')}
        {btn('pincel', Pencil, 'Pincel (P)')}
        {btn('marca', Highlighter, 'Marca-texto (M)')}
        {btn('texto', Type, 'Caixa de texto (T) — clique no vazio para escrever; na caixa, arraste para mover e clique de novo para editar')}
        {btn('borracha', Eraser, 'Borracha — apaga o traço tocado (E)')}
        {comFormulas && (
          <button type="button" onClick={() => setFormulas(v => !v)} title="Fórmulas" aria-label="Fórmulas" aria-pressed={formulas}
            className={formulas ? 'ativo' : ''}>
            <Sigma size={15} />
          </button>
        )}
        {cores && (
          <>
            <span className="sep" />
            {cores.map(c => (
              <button key={c} type="button" onClick={() => setCor(c)} title="Cor" aria-label={`Cor ${c}`} aria-pressed={corAtual === c}
                className={`cor ${corAtual === c ? 'ativo' : ''}`}>
                <span style={{ background: c }} />
              </button>
            ))}
          </>
        )}
        {ferramenta === 'pincel' && (
          <>
            <span className="sep" />
            {ESPESSURAS_PINCEL.map((esp, i) => (
              <button key={esp} type="button" onClick={() => anot.setEspessura(esp)} title={['Fino', 'Médio', 'Grosso'][i]}
                aria-label={['Fino', 'Médio', 'Grosso'][i]} aria-pressed={anot.espessura === esp}
                className={anot.espessura === esp ? 'ativo' : ''}>
                <span className="ponto" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
              </button>
            ))}
          </>
        )}
        {ferramenta === 'texto' && (
          <>
            <span className="sep" />
            {TAMANHOS_TEXTO.map((t, i) => {
              const nome = `Letra ${['pequena', 'média', 'grande', 'enorme'][i]}`;
              return (
                <button key={t} type="button" onClick={() => anot.setTamanhoTexto(t)} title={nome} aria-label={nome}
                  aria-pressed={anot.tamanhoTexto === t} className={anot.tamanhoTexto === t ? 'ativo' : ''}>
                  <span style={{ fontSize: 10 + i * 3, fontWeight: 800, lineHeight: 1 }}>A</span>
                </button>
              );
            })}
          </>
        )}
        {quadro && (
          <>
            <span className="sep" />
            {(['branco', 'preto'] as const).map(f => (
              <button key={f} type="button" onClick={() => trocarFundo(f)} title={`Fundo ${f}`} aria-label={`Fundo ${f}`}
                aria-pressed={quadro.fundo === f} className={`cor fundo ${quadro.fundo === f ? 'ativo' : ''}`}>
                <span style={{ background: f === 'branco' ? '#fff' : '#000' }} />
              </button>
            ))}
          </>
        )}
        <span className="sep" />
        <button type="button" onClick={() => anot.desfazer(pagina)} title="Desfazer nesta página (Ctrl+Z)" aria-label="Desfazer"><Undo2 size={15} /></button>
        <button type="button" onClick={() => anot.limparPagina(pagina)} disabled={!temTraco} title="Limpar esta página" aria-label="Limpar esta página">
          <Trash2 size={15} />
        </button>
      </div>
      {formulas && comFormulas && (
        /* Sem preventDefault no painel inteiro: ele impediria o campo de busca
           de receber o foco. Quem evita o foco é cada botão de fórmula. */
        <div className="max-show-formulas" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
          <div className="max-show-formulas-topo">
            <Sigma size={15} />
            <span>
              <strong>Fórmulas</strong>
              <small>Clique para colocar no slide</small>
            </span>
            <button type="button" onClick={fecharFormulas} title="Fechar" aria-label="Fechar"
              onMouseDown={e => e.preventDefault()}>
              <X size={14} />
            </button>
          </div>
          <label className="max-show-formulas-busca">
            <Search size={13} />
            {/* placeholder "Buscar…": campo de filtro não trava o reload da PWA. */}
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar fórmula…"
              data-trava-atualizacao="nao" spellCheck={false}
              onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); busca ? setBusca('') : fecharFormulas(); } }} />
            {busca && (
              <button type="button" onClick={() => setBusca('')} title="Limpar busca" aria-label="Limpar busca"
                onMouseDown={e => e.preventDefault()}>
                <X size={12} />
              </button>
            )}
          </label>
          <div className="max-show-formulas-lista">
            {achadas.length === 0 && <p className="vazio">Nenhuma fórmula encontrada.</p>}
            {GRUPOS_FORMULAS.map(g => {
              const doGrupo = achadas.filter(f => f.grupo === g);
              if (doGrupo.length === 0) return null;
              return (
                <div key={g} className="grupo">
                  <div className="grupo-titulo">{g}</div>
                  {doGrupo.map(f => (
                    <button key={f.nome} type="button" onClick={() => inserirFormula(f)} onMouseDown={e => e.preventDefault()}>
                      <strong>{f.nome}</strong>
                      <span>{f.formula}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="max-show-formulas-pe">{FORMULAS_SHOW.length} fórmulas · a mesma conta da tela de Precificação</div>
        </div>
      )}
    </>
  );
}
