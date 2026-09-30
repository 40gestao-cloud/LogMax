import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, Play, Minimize2, Presentation, ChevronLeft, ChevronRight, ExternalLink, ZoomIn, ZoomOut, RotateCcw, FileText, GalleryHorizontal } from 'lucide-react';
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
//
// Dois modos. SLIDES: uma página por vez, setas/passador avançam para o
// lado. DOCUMENTO: as páginas empilhadas e a roda desce o conteúdo — é o
// que serve para apostila e guia (A4 em pé). O modo nasce da orientação da
// 1ª página (em pé = documento) e o botão do topo troca.
// =================================================================

type Props = {
  showId: string;
  mode?: 'view' | 'edit';
  onClose: () => void;
  showToast?: (msg: string, type?: string) => void;
  profile?: any;
};

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any>; destroy?: () => Promise<void> | void };
type Modo = 'slides' | 'documento';

// Largura máxima da página no modo documento, em 100% de zoom: além disso a
// linha de texto fica longa demais para ler num monitor largo.
const LARGURA_LEITURA = 960;

/** Modo documento: todas as páginas, uma embaixo da outra, desenhadas quando
 *  chegam perto da tela (um PDF de 40 páginas não pinta 40 canvas de uma vez). */
function PaginasContinuas({ doc, numPages, zoom, largura, scrollRef, onPaginaAtual }: {
  doc: PdfDoc; numPages: number; zoom: number; largura: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onPaginaAtual: (n: number) => void;
}) {
  const [tamanhos, setTamanhos] = useState<{ w: number; h: number }[] | null>(null);
  const caixas = useRef<(HTMLDivElement | null)[]>([]);
  const desenhadas = useRef<Map<number, number>>(new Map()); // página → largura com que foi desenhada

  useEffect(() => {
    let vivo = true;
    (async () => {
      const t: { w: number; h: number }[] = [];
      for (let i = 1; i <= numPages; i++) {
        const v = (await doc.getPage(i)).getViewport({ scale: 1 });
        t.push({ w: v.width, h: v.height });
      }
      if (vivo) setTamanhos(t);
    })();
    return () => { vivo = false; };
  }, [doc, numPages]);

  const larguraPagina = Math.max(200, Math.min(largura - 48, LARGURA_LEITURA)) * zoom;

  const desenhar = useCallback(async (n: number) => {
    const caixa = caixas.current[n - 1];
    const canvas = caixa?.querySelector('canvas');
    if (!canvas || desenhadas.current.get(n) === larguraPagina) return;
    desenhadas.current.set(n, larguraPagina);
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (larguraPagina / v1.width) * dpr });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try { await page.render({ canvasContext: ctx, viewport, canvas }).promise; }
    catch { desenhadas.current.delete(n); }
  }, [doc, larguraPagina]);

  // Desenha o que está na tela ou a até ~1,5 tela de distância.
  useEffect(() => {
    const root = scrollRef.current;
    if (!tamanhos || !root) return;
    const obs = new IntersectionObserver(entradas => {
      entradas.forEach(e => { if (e.isIntersecting) desenhar(Number((e.target as HTMLElement).dataset.pagina)); });
    }, { root, rootMargin: '150% 0px' });
    caixas.current.forEach(c => c && obs.observe(c));
    return () => obs.disconnect();
  }, [tamanhos, desenhar, scrollRef]);

  // Página "atual" = a que cruza o meio da tela.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !tamanhos) return;
    const onScroll = () => {
      const meio = root.scrollTop + root.clientHeight / 2;
      let atual = 1;
      caixas.current.forEach((c, i) => { if (c && c.offsetTop <= meio) atual = i + 1; });
      onPaginaAtual(atual);
    };
    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [tamanhos, scrollRef, onPaginaAtual]);

  if (!tamanhos) return <div className="text-gray-400 text-sm text-center py-10">Carregando páginas…</div>;

  // Só ampliado a coluna passa da tela (e aí rola para o lado); em 100% ela
  // cabe — sem isto a barra vertical que aparece depois gerava rolagem lateral.
  return (
    <div className="flex flex-col items-center gap-4 py-6 px-6" style={{ minWidth: zoom > 1 ? larguraPagina + 48 : undefined }}>
      {tamanhos.map((t, i) => (
        <div key={i} ref={el => { caixas.current[i] = el; }} data-pagina={i + 1}
          className="bg-white shadow-2xl shrink-0"
          style={{ width: larguraPagina, height: larguraPagina * (t.h / t.w) }}>
          <canvas className="block" style={{ width: '100%', height: '100%', cursor: 'default' }} />
        </div>
      ))}
    </div>
  );
}

export const MaxShowEditor = ({ showId, onClose, showToast }: Props) => {
  const [titulo, setTitulo] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfNome, setPdfNome] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1); // 1 = fit-to-stage; > 1 amplia e o stage vira scrollavel
  const [modo, setModo] = useState<Modo>('slides');
  const [larguraDoc, setLarguraDoc] = useState(0);
  const docScrollRef = useRef<HTMLDivElement | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfRef = useRef<PdfDoc | null>(null);
  const renderTaskRef = useRef<any>(null);
  // Fit-scale calculado uma vez com o palco vazio (sem scrollbar). Fixa
  // o tamanho "100%" pra evitar feedback: scrollbar aparece -> stage
  // shrinks -> renderPage -> canvas encolhe -> scrollbar some -> ...
  const baseFitRef = useRef<{ scale: number; page: number } | null>(null);
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
        // Em pé (A4, apostila) lê-se descendo; deitado (16:9) é slide.
        const v = (await doc.getPage(1)).getViewport({ scale: 1 });
        if (disposed) return;
        setModo(v.height > v.width ? 'documento' : 'slides');
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
    // Só re-mede o palco quando ainda não tem base ou quando trocou de
    // página. Zoom NUNCA re-mede — usa a base fixa. Isso quebra o loop
    // scrollbar-aparece/some que apagava o canvas em zooms baixos.
    const cached = baseFitRef.current;
    let fitScale: number;
    if (cached && cached.page === pageNum) {
      fitScale = cached.scale;
    } else {
      const stageW = stage.clientWidth;
      const stageH = stage.clientHeight;
      if (stageW < 10 || stageH < 10) return;
      fitScale = Math.min(stageW / viewport1.width, stageH / viewport1.height);
      baseFitRef.current = { scale: fitScale, page: pageNum };
    }
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

  // `modo`: voltando do Documento o canvas dos slides é outro elemento.
  useEffect(() => { renderPage(); }, [renderPage, numPages, isFullscreen, modo]);

  // Re-renderiza em resize da janela (window), não do stage — resize do
  // stage também dispara com scrollbar aparecendo/sumindo, causando loop.
  // Ao redimensionar a janela, invalida o base pra remedir no próximo render.
  useEffect(() => {
    const onResize = () => { baseFitRef.current = null; renderPage(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderPage]);

  // Largura do palco no modo documento — pela janela, como o dos slides.
  useEffect(() => {
    if (modo !== 'documento') return;
    const medir = () => { const el = docScrollRef.current; if (el) setLarguraDoc(el.clientWidth); };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [modo, loading, isFullscreen]);

  const irParaPagina = useCallback((n: number) => {
    const el = docScrollRef.current?.querySelector<HTMLElement>(`[data-pagina="${n}"]`);
    el?.scrollIntoView({ block: 'start' });
  }, []);

  // Ao trocar de página ou entrar/sair de fullscreen, invalida o base.
  useEffect(() => { baseFitRef.current = null; }, [isFullscreen]);

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
      if (modo === 'documento') {
        // Setas ↑↓, PageDown, espaço e Home/End rolam (padrão do navegador);
        // ← → pulam de página, para o passador de slides seguir funcionando.
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
        else if (e.key === '0') { e.preventDefault(); zoomReset(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); irParaPagina(Math.min(pageNum + 1, numPages)); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); irParaPagina(Math.max(pageNum - 1, 1)); }
        return;
      }
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
  }, [next, prev, numPages, zoomIn, zoomOut, zoomReset, modo, pageNum, irParaPagina]);

  // Ctrl+wheel amplia/reduz (comportamento familiar de leitor PDF).
  // Sem Ctrl e ampliado: roda faz pan vertical (browser default no overflow-auto).
  useEffect(() => {
    const el = modo === 'documento' ? docScrollRef.current : stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn(); else zoomOut();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomIn, zoomOut, modo, loading]);

  // Drag-to-pan quando ampliado (mouse). Sem isso o usuário precisaria
  // usar a scrollbar/roda pra ver os cantos.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || zoom <= 1 || modo !== 'slides') return;
    let dragging = false;
    let startX = 0, startY = 0, startL = 0, startT = 0;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Se clicou num botão (setas de navegação, pill), deixa o botão agir.
      if ((e.target as HTMLElement)?.closest('button, a')) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startL = el.scrollLeft; startT = el.scrollTop;
      el.style.cursor = 'grabbing';
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      el.scrollLeft = startL - (e.clientX - startX);
      el.scrollTop  = startT - (e.clientY - startY);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.style.cursor = 'grab';
    };
    el.style.cursor = 'grab';
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom, modo]);

  const trocarModo = () => {
    setZoom(1);
    baseFitRef.current = null;
    setModo(m => m === 'slides' ? 'documento' : 'slides');
  };
  // Indo para Documento, rola até a página em que estava; voltando para
  // Slides, parte dela.
  useEffect(() => {
    if (modo === 'documento' && !loading) requestAnimationFrame(() => {
      irParaPagina(pageNum);
      // Espaço e PageDown rolam o elemento com foco — sem isto rolariam a janela.
      docScrollRef.current?.focus({ preventScroll: true });
    });
  }, [modo, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBar = (
    <div className="max-show-zoombar">
      <button type="button" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Diminuir zoom (−)" aria-label="Diminuir zoom">
        <ZoomOut size={14} />
      </button>
      <button type="button" onClick={zoomReset} title="Resetar zoom (0)" aria-label="Resetar zoom" className="max-show-zoombar-label">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="Aumentar zoom (+)" aria-label="Aumentar zoom">
        <ZoomIn size={14} />
      </button>
      {zoom !== 1 && (
        <button type="button" onClick={zoomReset} title="Voltar ao encaixe" aria-label="Voltar ao encaixe" className="max-show-zoombar-reset">
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  );

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
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="md-headerbtn px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1" title="Abrir em nova aba">
            <ExternalLink size={13} /> <span className="hidden sm:inline">Nova aba</span>
          </a>
        )}
        {!loading && numPages > 0 && (
          <button onClick={trocarModo} className="md-headerbtn px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1"
            title={modo === 'slides' ? 'Ler como documento: páginas uma embaixo da outra, rolando para baixo' : 'Apresentar como slides: uma página por vez'}>
            {modo === 'slides' ? <FileText size={13} /> : <GalleryHorizontal size={13} />}
            <span className="hidden sm:inline">{modo === 'slides' ? 'Documento' : 'Slides'}</span>
          </button>
        )}
        <button onClick={toggleFullscreen} className="md-headerbtn px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1" title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Apresentar (tela cheia)'}>
          {isFullscreen ? <Minimize2 size={13} /> : <Play size={13} />} {isFullscreen ? 'Sair' : 'Apresentar'}
        </button>
      </div>

      {modo === 'documento' && !loading ? (
        <div className="max-show-stage flex-1 min-h-0 relative select-none">
          <div ref={docScrollRef} tabIndex={0} className="absolute inset-0 overflow-auto bg-neutral-800 outline-none">
            {pdfRef.current && larguraDoc > 0 && (
              <PaginasContinuas doc={pdfRef.current} numPages={numPages} zoom={zoom} largura={larguraDoc}
                scrollRef={docScrollRef} onPaginaAtual={setPageNum} />
            )}
          </div>
          <div className="max-show-counter">{pageNum} / {numPages || '…'}</div>
          {zoomBar}
        </div>
      ) : (
        <div
          ref={stageRef}
          className={`max-show-stage flex-1 min-h-0 bg-black relative select-none ${zoom > 1 ? 'overflow-auto' : 'overflow-hidden flex items-center justify-center'}`}
        >
          {loading ? (
            <div className="text-gray-400 text-sm">Carregando apresentação…</div>
          ) : (
            <>
              <canvas
                ref={canvasRef}
                className="block shadow-2xl mx-auto"
                onClick={zoom === 1 ? next : undefined}
                style={{
                  cursor: zoom === 1 ? 'pointer' : 'inherit',
                  // Anula o max-width/max-height: 100% do CSS quando ampliado —
                  // sem isso o canvas fica travado no tamanho do stage.
                  maxWidth: zoom > 1 ? 'none' : undefined,
                  maxHeight: zoom > 1 ? 'none' : undefined,
                }}
              />
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
              {zoomBar}
            </>
          )}
        </div>
      )}
    </div>
  );
};
