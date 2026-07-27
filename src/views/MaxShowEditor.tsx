import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, Play, Minimize2, Presentation, ChevronLeft, ChevronRight, ExternalLink, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { supabase } from '../lib/supabase';

// =================================================================
// Max Show — viewer/apresentador de PDF importado
// =================================================================
// LogMax não edita slides. O aluno monta a apresentação em qualquer
// ferramenta (PowerPoint/Canva/Slides), exporta como PDF, importa no
// Max Show e apresenta aqui.
//
// Renderiza via pdf.js (pdfjs-dist) num <canvas> proprio pra ter
// controle total de teclado (setas/PageDown/Space/passador) — o
// viewer nativo do Chrome dentro de iframe cross-origin nao entrega
// esse controle.
// =================================================================

type Props = {
  showId: string;
  mode?: 'view' | 'edit';
  onClose: () => void;
  showToast?: (msg: string, type?: string) => void;
  profile?: any;
};

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any>; destroy?: () => Promise<void> | void };

export const MaxShowEditor = ({ showId, onClose, showToast }: Props) => {
  const [titulo, setTitulo] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfNome, setPdfNome] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1); // 1 = fit-to-stage; > 1 amplia e o stage vira scrollavel

  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfRef = useRef<PdfDoc | null>(null);
  const renderTaskRef = useRef<any>(null);
  // Refs pra callbacks — evita que os useEffects abaixo reexecutem quando
  // o pai recria showToast/onClose a cada render (recarregaria o PDF).
  const showToastRef = useRef(showToast);
  const onCloseRef = useRef(onClose);
  useEffect(() => { showToastRef.current = showToast; onCloseRef.current = onClose; });

  // Carrega metadados
  useEffect(() => {
    let disposed = false;
    (async () => {
      if (!supabase) return;
      const { data, error } = await supabase.from('max_shows')
        .select('titulo,arquivo_url,arquivo_nome').eq('id', showId).maybeSingle();
      if (error || !data || !data.arquivo_url) {
        showToastRef.current?.('Não foi possível abrir a apresentação.', 'error');
        onCloseRef.current();
        return;
      }
      if (disposed) return;
      setTitulo(data.titulo || '');
      setPdfUrl(data.arquivo_url);
      setPdfNome(data.arquivo_nome ?? null);
    })();
    return () => { disposed = true; };
  }, [showId]);

  // Carrega o PDF via pdf.js (lazy import — o chunk vendor-pdfjs so baixa aqui)
  useEffect(() => {
    if (!pdfUrl) return;
    let disposed = false;
    (async () => {
      setLoading(true);
      const pdfjs: any = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      try {
        const loadingTask = pdfjs.getDocument({ url: pdfUrl });
        const doc = await loadingTask.promise;
        if (disposed) { try { await doc.destroy(); } catch {} return; }
        try { await pdfRef.current?.destroy?.(); } catch {}
        pdfRef.current = doc;
        setNumPages(doc.numPages);
        setPageNum(1);
      } catch (e) {
        console.error(e);
        showToastRef.current?.('Erro ao carregar PDF.', 'error');
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
      try { renderTaskRef.current?.cancel?.(); } catch {}
      const doc = pdfRef.current as any;
      pdfRef.current = null;
      try { doc?.destroy?.(); } catch {}
    };
  }, [pdfUrl]);

  // Renderiza a pagina atual — contain no stage (largura E altura)
  const renderPage = useCallback(async () => {
    const doc = pdfRef.current;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!doc || !canvas || !stage) return;

    try { renderTaskRef.current?.cancel?.(); } catch {}

    const page = await doc.getPage(pageNum);
    const viewport1 = page.getViewport({ scale: 1 });
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (stageW < 10 || stageH < 10) return;
    const fitScale = Math.min(stageW / viewport1.width, stageH / viewport1.height);
    const scale = fitScale * zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * dpr });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const task = page.render({ canvasContext: ctx, viewport, canvas });
    renderTaskRef.current = task;
    try { await task.promise; } catch { /* cancelado */ }
  }, [pageNum, zoom]);

  useEffect(() => { renderPage(); }, [renderPage, numPages, isFullscreen]);

  // Re-renderiza em resize
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => renderPage());
    ro.observe(el);
    return () => ro.disconnect();
  }, [renderPage]);

  // Fullscreen
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.().catch(() => showToastRef.current?.('Tela cheia não disponível.', 'error'));
  };

  // Zoom
  const ZOOM_MIN = 1, ZOOM_MAX = 4, ZOOM_STEP = 0.25;
  const zoomIn  = useCallback(() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  // Navegacao — setas, PageUp/Down, Space, Home/End (passador de slides usa Page/Arrow)
  const next = useCallback(() => { setPageNum(p => Math.min(p + 1, numPages || p)); setZoom(1); }, [numPages]);
  const prev = useCallback(() => { setPageNum(p => Math.max(p - 1, 1)); setZoom(1); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignora se o foco esta num controle interativo — evita Space/Enter
      // disparar navegacao alem da acao do botao/input focado.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'A' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault(); next();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); prev();
      } else if (e.key === 'Home') {
        e.preventDefault(); setPageNum(1);
      } else if (e.key === 'End') {
        e.preventDefault(); if (numPages) setPageNum(numPages);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault(); zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault(); zoomOut();
      } else if (e.key === '0') {
        e.preventDefault(); zoomReset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, numPages, zoomIn, zoomOut, zoomReset]);

  // Ctrl+wheel amplia/reduz (comportamento familiar de leitor PDF).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn(); else zoomOut();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomIn, zoomOut]);

  return (
    <div ref={rootRef} className="max-doc-scope max-doc-light max-show-scope flex flex-col h-full">
      <div className="md-header flex items-center gap-2 px-4 py-3 shrink-0">
        <button onClick={onClose} className="md-headerbtn p-2 rounded-lg" title="Voltar">
          <ArrowLeft size={16} />
        </button>
        <Presentation size={16} className="opacity-70" />
        <div className="flex-1 text-lg font-bold px-2 truncate flex items-center gap-2 min-w-0">
          <span className="truncate">{titulo || pdfNome || 'Apresentação'}</span>
          <span className="text-xs font-normal opacity-70 shrink-0 hidden sm:inline">PDF importado</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN} className="md-headerbtn px-2 py-1.5 rounded-lg text-xs disabled:opacity-40" title="Diminuir zoom (−)">
            <ZoomOut size={13} />
          </button>
          <button onClick={zoomReset} className="md-headerbtn px-2 py-1.5 rounded-lg text-xs min-w-[46px] text-center" title="Ajustar (0)">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX} className="md-headerbtn px-2 py-1.5 rounded-lg text-xs disabled:opacity-40" title="Aumentar zoom (+)">
            <ZoomIn size={13} />
          </button>
          {zoom !== 1 && (
            <button onClick={zoomReset} className="md-headerbtn px-2 py-1.5 rounded-lg text-xs" title="Voltar ao encaixe (0)">
              <Maximize size={13} />
            </button>
          )}
        </div>
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="md-headerbtn px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1" title="Abrir em nova aba">
            <ExternalLink size={13} /> <span className="hidden sm:inline">Nova aba</span>
          </a>
        )}
        <button onClick={toggleFullscreen} className="md-headerbtn px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1" title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Apresentar (tela cheia)'}>
          {isFullscreen ? <Minimize2 size={13} /> : <Play size={13} />} {isFullscreen ? 'Sair' : 'Apresentar'}
        </button>
      </div>

      <div
        ref={stageRef}
        className={`max-show-stage flex-1 min-h-0 bg-black relative select-none ${zoom > 1 ? 'overflow-auto' : 'overflow-hidden flex items-center justify-center'}`}
      >
        {loading ? (
          <div className="text-gray-400 text-sm">Carregando apresentação…</div>
        ) : (
          <>
            <canvas ref={canvasRef} className="block shadow-2xl mx-auto" onClick={zoom === 1 ? next : undefined} style={{ cursor: zoom === 1 ? 'pointer' : 'default' }} />
            <button
              type="button"
              onClick={prev}
              className="max-show-nav max-show-nav-left"
              aria-label="Slide anterior"
              disabled={pageNum <= 1}
            >
              <ChevronLeft size={28} />
            </button>
            <button
              type="button"
              onClick={next}
              className="max-show-nav max-show-nav-right"
              aria-label="Próximo slide"
              disabled={pageNum >= numPages}
            >
              <ChevronRight size={28} />
            </button>
            <div className="max-show-counter">
              {pageNum} / {numPages || '…'}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
