import { useCallback, useEffect, useRef, useState } from 'react';
import { MousePointer2, Pencil, Highlighter, Eraser, Undo2, Trash2 } from 'lucide-react';

// =================================================================
// Max Show — anotações por cima do PDF (pincel, marca-texto, borracha)
// =================================================================
// Uma camada <canvas> transparente sobre cada página; o PDF embaixo não é
// tocado. O traço é guardado em coordenadas da PÁGINA (0–1), não da tela:
// acompanha zoom, tela cheia e redimensionamento sem se desalinhar.
//
// Vive só enquanto a apresentação está aberta (quadro branco): nada vai ao
// banco. Borracha apaga o traço inteiro em que encosta.
// =================================================================

export type Ferramenta = 'seta' | 'pincel' | 'marca' | 'borracha';

export type Traco = {
  id: number;
  tipo: 'pincel' | 'marca';
  cor: string;
  /** Espessura em fração da largura da página. */
  espessura: number;
  pontos: [number, number][];
};

/** Traços por número de página (1-based). */
export type TracosPorPagina = Record<number, Traco[]>;

type Acao =
  | { tipo: 'add'; pagina: number; traco: Traco }
  | { tipo: 'del'; pagina: number; traco: Traco; indice: number }
  | { tipo: 'limpar'; pagina: number; tracos: Traco[] };

export const CORES_PINCEL = ['#ef4444', '#2563eb', '#16a34a', '#f97316', '#9333ea', '#111827'];
export const CORES_MARCA = ['#facc15', '#4ade80', '#f472b6', '#38bdf8'];
export const ESPESSURAS_PINCEL = [0.003, 0.006, 0.012];
const ESPESSURA_MARCA = 0.025;
const OPACIDADE_MARCA = 0.38;

let proximoId = 1;

/** Estado das anotações de uma apresentação: traços, ferramenta e desfazer. */
export function useAnotacoes() {
  const [ferramenta, setFerramenta] = useState<Ferramenta>('seta');
  const [corPincel, setCorPincel] = useState(CORES_PINCEL[0]);
  const [corMarca, setCorMarca] = useState(CORES_MARCA[0]);
  const [espessura, setEspessura] = useState(ESPESSURAS_PINCEL[1]);
  const [tracos, setTracosState] = useState<TracosPorPagina>({});
  // Espelho síncrono: a borracha apaga vários traços no mesmo arraste, antes
  // de o React renderizar — ler do estado apagaria o mesmo traço duas vezes
  // e empilharia o desfazer em dobro.
  const tracosRef = useRef<TracosPorPagina>({});
  const historico = useRef<Acao[]>([]);
  const gravar = (pagina: number, lista: Traco[]) => {
    tracosRef.current = { ...tracosRef.current, [pagina]: lista };
    setTracosState(tracosRef.current);
  };

  const adicionar = useCallback((pagina: number, t: Omit<Traco, 'id'>) => {
    const traco = { ...t, id: proximoId++ };
    historico.current.push({ tipo: 'add', pagina, traco });
    gravar(pagina, [...(tracosRef.current[pagina] ?? []), traco]);
  }, []);

  const apagar = useCallback((pagina: number, id: number) => {
    const lista = tracosRef.current[pagina] ?? [];
    const indice = lista.findIndex(t => t.id === id);
    if (indice < 0) return;
    historico.current.push({ tipo: 'del', pagina, traco: lista[indice], indice });
    gravar(pagina, lista.filter(t => t.id !== id));
  }, []);

  const limparPagina = useCallback((pagina: number) => {
    const lista = tracosRef.current[pagina] ?? [];
    if (lista.length === 0) return;
    historico.current.push({ tipo: 'limpar', pagina, tracos: lista });
    gravar(pagina, []);
  }, []);

  const desfazer = useCallback(() => {
    const a = historico.current.pop();
    if (!a) return;
    const lista = tracosRef.current[a.pagina] ?? [];
    if (a.tipo === 'add') gravar(a.pagina, lista.filter(t => t.id !== a.traco.id));
    else if (a.tipo === 'del') {
      const nova = [...lista];
      nova.splice(Math.min(a.indice, nova.length), 0, a.traco);
      gravar(a.pagina, nova);
    } else gravar(a.pagina, a.tracos);
  }, []);

  const cor = ferramenta === 'marca' ? corMarca : corPincel;
  return {
    ferramenta, setFerramenta, cor, corPincel, setCorPincel, corMarca, setCorMarca,
    espessura, setEspessura, tracos, adicionar, apagar, limparPagina, desfazer,
  };
}

export type Anotacoes = ReturnType<typeof useAnotacoes>;

function desenharTraco(ctx: CanvasRenderingContext2D, t: Traco | Omit<Traco, 'id'>, w: number, h: number) {
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

/** Distância do ponto ao segmento, em px. */
function distSegmento(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

function tocaTraco(t: Traco, x: number, y: number, w: number, h: number) {
  const raio = Math.max(t.espessura * w / 2, 0) + 8;
  const p = t.pontos;
  if (p.length === 1) return Math.hypot(x - p[0][0] * w, y - p[0][1] * h) <= raio;
  for (let i = 0; i < p.length - 1; i++) {
    if (distSegmento(x, y, p[i][0] * w, p[i][1] * h, p[i + 1][0] * w, p[i + 1][1] * h) <= raio) return true;
  }
  return false;
}

/**
 * A camada de uma página. Ocupa o pai inteiro (absolute inset-0) — o pai é
 * quem tem o tamanho da página na tela. Com a Seta ativa ela some para o
 * mouse: clique, arraste e rolagem passam para o que está embaixo.
 */
export function CamadaAnotacao({ pagina, anot }: { pagina: number; anot: Anotacoes }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const atual = useRef<Omit<Traco, 'id'> | null>(null);
  const lista = anot.tracos[pagina] ?? [];
  const { ferramenta } = anot;
  const ativa = ferramenta !== 'seta';

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
    lista.forEach(t => desenharTraco(ctx, t, tam.w, tam.h));
    if (atual.current) desenharTraco(ctx, atual.current, tam.w, tam.h);
  }, [lista, tam]);

  useEffect(() => { redesenhar(); }, [redesenhar]);

  const ponto = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const apagarEm = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    for (let i = lista.length - 1; i >= 0; i--) {
      if (tocaTraco(lista[i], x, y, r.width, r.height)) { anot.apagar(pagina, lista[i].id); return; }
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (!ativa || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    ref.current?.setPointerCapture(e.pointerId);
    if (ferramenta === 'borracha') { atual.current = null; apagarEm(e); return; }
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
    if (!atual.current) return;
    atual.current.pontos.push(ponto(e));
    redesenhar();
  };

  const onUp = (e: React.PointerEvent) => {
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
    const t = atual.current;
    atual.current = null;
    // O último pointermove pode não ter chegado no ponto onde o dedo soltou.
    if (t && ref.current && e.type === 'pointerup') t.pontos.push(ponto(e));
    if (t) anot.adicionar(pagina, t);
  };

  const cursor = ferramenta === 'borracha' ? 'cell' : ativa ? 'crosshair' : 'default';
  return (
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
  );
}

/** Barra flutuante das ferramentas (embaixo, no centro do palco). */
export function BarraAnotacao({ anot, pagina }: { anot: Anotacoes; pagina: number }) {
  const { ferramenta, setFerramenta } = anot;
  const temTraco = (anot.tracos[pagina] ?? []).length > 0;
  const btn = (f: Ferramenta, Icon: any, titulo: string) => (
    <button type="button" onClick={() => setFerramenta(f)} title={titulo} aria-label={titulo} aria-pressed={ferramenta === f}
      className={ferramenta === f ? 'ativo' : ''}>
      <Icon size={15} />
    </button>
  );
  const cores = ferramenta === 'pincel' ? CORES_PINCEL : ferramenta === 'marca' ? CORES_MARCA : null;
  const corAtual = ferramenta === 'marca' ? anot.corMarca : anot.corPincel;
  const setCor = ferramenta === 'marca' ? anot.setCorMarca : anot.setCorPincel;

  return (
    // mousedown sem foco: o Max Show ignora as setas com um botão focado, e o
    // passador de slides parava de funcionar depois de escolher o pincel.
    <div className={`max-show-anotbar ${ferramenta !== 'seta' ? 'em-uso' : ''}`}
      onClick={e => e.stopPropagation()} onMouseDown={e => e.preventDefault()}>
      {btn('seta', MousePointer2, 'Seta — navegar (Esc)')}
      {btn('pincel', Pencil, 'Pincel (P)')}
      {btn('marca', Highlighter, 'Marca-texto (M)')}
      {btn('borracha', Eraser, 'Borracha — apaga o traço tocado (E)')}
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
      <span className="sep" />
      <button type="button" onClick={anot.desfazer} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><Undo2 size={15} /></button>
      <button type="button" onClick={() => anot.limparPagina(pagina)} disabled={!temTraco} title="Limpar esta página" aria-label="Limpar esta página">
        <Trash2 size={15} />
      </button>
    </div>
  );
}
