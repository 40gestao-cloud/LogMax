import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Save, Check, Maximize2, Minimize2, Sparkles, Loader2, X } from 'lucide-react';
import { createUniver, LocaleType, merge } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import UniverPresetDocsCorePtBR from '@univerjs/preset-docs-core/locales/pt-BR';
import '@univerjs/preset-docs-core/lib/index.css';
import { DocSelectionManagerService } from '@univerjs/docs';
import { supabase } from '../lib/supabase';
import { isConselheiro } from '../lib/rbac';

// =================================================================
// Max Docs — editor Univer Docs
// =================================================================
// Univer traz ribbon Word-like completa (fonte, tamanho, alinhamento,
// listas, cores, etc). Header verde + botao Salvar ficam por cima; o
// resto e o container do Univer. Salva IDocumentData em max_docs.conteudo.
// Autosave debounce 3s disparado em CommandExecuted.
// =================================================================

type Props = {
  docId: string;
  mode?: 'view' | 'edit';
  onClose: () => void;
  showToast?: (msg: string, type?: string) => void;
  profile?: any;
};

// Documento minimo IDocumentData — Univer preenche o resto no createUniverDoc.
// dataStream: '\r\n' = 1 paragrafo vazio + fim da secao.
const emptyDocument = () => ({
  id: `doc_${Date.now()}`,
  locale: LocaleType.PT_BR,
  body: {
    dataStream: '\r\n',
    paragraphs: [{ startIndex: 0 }],
    sectionBreaks: [{ startIndex: 1 }],
  },
  documentStyle: {
    pageSize: { width: 794, height: 1123 },
    marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90,
  },
});

// Payloads antigos (Tiptap) eram strings HTML. Se algo escapar do TRUNCATE
// isUniverDocument() garante fallback pra empty ao inves de crashar.
const isUniverDocument = (v: any): boolean => {
  return !!(v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string' && v.body && typeof v.body.dataStream === 'string');
};

export const MaxDocEditor = ({ docId, mode = 'edit', onClose, showToast, profile }: Props) => {
  const [titulo, setTitulo] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // isDraft = doc ainda nao existe no banco. Primeiro Salvar manual faz INSERT.
  const [isDraft, setIsDraft] = useState(docId === '__draft__');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<any>(null);
  const univerAPIRef = useRef<any>(null);
  const docRef = useRef<any>(null);
  const saveTimer = useRef<number | null>(null);
  const lastSerialized = useRef<string>('');
  const lastTituloSaved = useRef<string>('');
  const currentIdRef = useRef<string>(docId);
  const isDraftRef = useRef<boolean>(docId === '__draft__');

  const readOnly = mode === 'view' || (ownerId !== null && ownerId !== profile?.id);
  // MaxAI aqui: só admin, CEO e conselheiro (inclui gerente c/ is_conselheiro=true).
  const canUseIA = !readOnly && (profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile));

  // ============ MaxAI: popover + acoes ============
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMenuPos, setAiMenuPos] = useState<{ top: number; right: number } | null>(null);
  const aiBtnRef = useRef<HTMLButtonElement | null>(null);
  const aiPopoverRef = useRef<HTMLDivElement | null>(null);
  // Cache da ultima seleção não-vazia. Ao clicar no botão IA no header, o
  // foco sai do doc e o Univer limpa getActiveTextRange — usamos o cache.
  const lastRangeRef = useRef<{ startOffset: number; endOffset: number } | null>(null);

  const getSelectionService = () => {
    const api = univerAPIRef.current as any;
    if (!api?._injector) return null;
    try { return api._injector.get(DocSelectionManagerService); } catch { return null; }
  };

  const readCurrentSelection = () => {
    const svc = getSelectionService();
    const r = svc?.getActiveTextRange?.();
    if (r && typeof r.startOffset === 'number' && typeof r.endOffset === 'number') {
      return { startOffset: r.startOffset, endOffset: r.endOffset };
    }
    return null;
  };

  const runAI = async (action: 'melhorar' | 'resumir' | 'expandir' | 'corrigir' | 'gerar') => {
    const doc = docRef.current; if (!doc) return;
    const snapshot = doc.getSnapshot();
    const stream: string = snapshot?.body?.dataStream || '';

    // Tenta seleção corrente; se vier vazia (botão IA tirou foco), usa cache.
    const current = readCurrentSelection();
    const range = (current && current.startOffset !== current.endOffset) ? current : lastRangeRef.current;

    let startOffset = 0, endOffset = 0, texto = '', hasRange = false, sliceHasBreak = false;
    if (action === 'gerar') {
      texto = aiPrompt.trim();
      if (!texto) { showToast?.('Descreva o que gerar.', 'info'); return; }
      if (range) {
        hasRange = true;
        startOffset = endOffset = range.startOffset;
      }
    } else {
      if (!range || range.startOffset === range.endOffset) {
        showToast?.('Selecione o texto no documento primeiro.', 'info');
        return;
      }
      hasRange = true;
      startOffset = range.startOffset;
      endOffset = range.endOffset;
      const rawSlice = stream.slice(startOffset, endOffset);
      sliceHasBreak = rawSlice.includes('\r');
      texto = rawSlice.replace(/\r/g, '\n').trim();
      if (!texto) { showToast?.('Seleção vazia.', 'info'); return; }
    }

    const instrucoes: Record<typeof action, string> = {
      melhorar: 'Reescreva o texto abaixo tornando-o mais claro, fluido e profissional, preservando o significado e o idioma. Mantenha o tom.',
      resumir:  'Resuma o texto abaixo em 1-2 frases, preservando os pontos principais.',
      expandir: 'Expanda o texto abaixo adicionando detalhes relevantes e exemplos concretos, preservando o significado.',
      corrigir: 'Corrija erros de ortografia, gramática, pontuação e concordância do texto abaixo. Não reescreva além do necessário.',
      gerar:    'Escreva o conteúdo pedido pelo usuário para um documento de trabalho, em português brasileiro, direto e bem estruturado.',
    };

    const userMessage = action === 'gerar'
      ? `${instrucoes.gerar}\n\nPedido: ${texto}\n\nResponda APENAS com o texto gerado, sem prefácio nem explicações.`
      : `${instrucoes[action]}\n\nTexto:\n"""\n${texto}\n"""\n\nResponda APENAS com o texto reescrito, sem prefácio nem explicações nem aspas.`;

    setAiBusy(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const token = session?.access_token;
      const resp = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: userMessage }] }),
      });
      const raw = await resp.text();
      let json: any = null;
      try { json = raw ? JSON.parse(raw) : null; } catch { /* HTML/vazio */ }
      if (!resp.ok) {
        const msg = json?.error || (raw && raw.length < 200 ? raw : `HTTP ${resp.status}`);
        showToast?.(`Erro da IA: ${msg}`, 'error'); return;
      }
      if (!json) {
        showToast?.('Endpoint /api/ai-chat indisponível no dev server (rode "vercel dev" ou teste em produção).', 'error');
        return;
      }
      const reply: string = (json?.reply || json?.content || '').trim();
      if (!reply) { showToast?.('IA não retornou texto.', 'error'); return; }
      // Insere/substitui no documento. Se a seleção abraça \r ou o reply tem
      // \n, usa insertParagraph pra preservar/gerar quebras de parágrafo —
      // insertText normaliza tudo pra 1 linha e sobrescreveria markers.
      const useParagraphs = reply.includes('\n') || sliceHasBreak;
      const cursorOffset = startOffset + reply.length;
      if (!hasRange) {
        await (useParagraphs ? doc.insertParagraph(reply) : doc.insertText(reply));
      } else {
        const opts = { startOffset, endOffset, cursorOffset };
        await (useParagraphs ? doc.insertParagraph(reply, opts) : doc.insertText(reply, opts));
      }
      setAiOpen(false);
      setAiPrompt('');
      scheduleSave();
    } catch (e: any) {
      showToast?.(`Falha na IA: ${e?.message || e}`, 'error');
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const so: any = (screen as any).orientation;
    try { so?.unlock?.(); } catch { /* precisa fullscreen em alguns browsers */ }
    return () => { try { so?.lock?.('portrait'); } catch { /* ignore */ } };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.().catch(() => showToast?.('Tela cheia não disponível.', 'error'));
  };

  const salvarRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});
  const salvar = useCallback(async (silent = false) => {
    if (!supabase || readOnly) return;
    const doc = docRef.current;
    if (!doc) return;
    const snapshot = doc.getSnapshot();
    const serialized = JSON.stringify(snapshot);
    const tituloFinal = titulo.trim();
    if (!isDraftRef.current && serialized === lastSerialized.current && tituloFinal === lastTituloSaved.current) return;
    setSaving(true);
    if (isDraftRef.current) {
      const { data, error } = await supabase.from('max_docs')
        .insert({ user_id: profile?.id, titulo: tituloFinal || 'Documento sem título', conteudo: snapshot })
        .select().single();
      setSaving(false);
      if (error || !data) { showToast?.(`Erro ao salvar: ${error?.message || 'sem retorno'}`, 'error'); return; }
      currentIdRef.current = data.id;
      isDraftRef.current = false;
      setIsDraft(false);
      setOwnerId(data.user_id);
    } else {
      const { error } = await supabase.from('max_docs')
        .update({ titulo: tituloFinal, conteudo: snapshot })
        .eq('id', currentIdRef.current);
      setSaving(false);
      if (error) { showToast?.(`Erro ao salvar: ${error.message}`, 'error'); return; }
    }
    lastSerialized.current = serialized;
    lastTituloSaved.current = tituloFinal;
    setSavedAt(new Date());
    if (!silent) showToast?.('Documento salvo.', 'success');
  }, [readOnly, titulo, showToast, profile?.id]);
  useEffect(() => { salvarRef.current = salvar; }, [salvar]);

  const scheduleSave = useCallback(() => {
    // Autosave só depois do primeiro save manual — no rascunho, nada e persistido.
    if (readOnly || isDraftRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => salvar(true), 3000);
  }, [salvar, readOnly]);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const draft = docId === '__draft__';
      let loaded: any = null;
      if (!draft) {
        if (!supabase) return;
        const { data, error } = await supabase
          .from('max_docs')
          .select('titulo,conteudo,user_id')
          .eq('id', docId)
          .maybeSingle();
        if (error || !data) {
          showToast?.('Não foi possível abrir o documento.', 'error');
          onClose();
          return;
        }
        loaded = data;
      }
      if (disposed) return;
      setTitulo(loaded?.titulo || '');
      setOwnerId(draft ? profile?.id ?? null : loaded.user_id);
      lastTituloSaved.current = (loaded?.titulo || '').trim();

      const container = containerRef.current;
      if (!container) return;

      const { univer, univerAPI } = createUniver({
        locale: LocaleType.PT_BR,
        locales: { [LocaleType.PT_BR]: merge({}, UniverPresetDocsCorePtBR) },
        presets: [ UniverDocsCorePreset({ container }) ],
      });

      const snap = draft ? emptyDocument() : (isUniverDocument(loaded.conteudo) ? loaded.conteudo : emptyDocument());
      const doc = univerAPI.createUniverDoc(snap);
      lastSerialized.current = JSON.stringify(doc.getSnapshot());

      univerRef.current = univer;
      univerAPIRef.current = univerAPI;
      docRef.current = doc;

      if (!readOnly) {
        univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => scheduleSave());
      }

      setReady(true);
    })();
    return () => {
      disposed = true;
      // Draft abandonado NAO persiste (Word/Excel style).
      if (!isDraftRef.current) salvarRef.current(true);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      try { univerRef.current?.dispose(); } catch { /* ignore */ }
      univerRef.current = null;
      univerAPIRef.current = null;
      docRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        salvar(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [salvar]);

  // Click-away pro popover da IA. Não usamos backdrop full-screen pra não
  // impedir seleção no doc enquanto o popover está aberto.
  useEffect(() => {
    if (!aiOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (aiPopoverRef.current?.contains(t)) return;
      if (aiBtnRef.current?.contains(t)) return; // toggle cuida
      setAiOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [aiOpen]);

  // Cache a ultima seleção não-vazia. Ao clicar no botão IA no header o
  // Univer perde a seleção — o cache mantem o range pra runAI usar.
  useEffect(() => {
    if (!ready) return;
    const svc = getSelectionService();
    if (!svc?.textSelection$) return;
    const sub = svc.textSelection$.subscribe(() => {
      const r = readCurrentSelection();
      if (r && r.startOffset !== r.endOffset) lastRangeRef.current = r;
    });
    return () => { try { sub.unsubscribe?.(); } catch { /* ignore */ } };
  }, [ready]);

  return (
    <div ref={rootRef} className="max-doc-scope max-doc-light">
      <div className="md-header flex items-center gap-2 px-4 py-3 shrink-0">
        <button onClick={onClose} className="md-headerbtn p-2 rounded-lg" title="Voltar">
          <ArrowLeft size={16} />
        </button>
        <input
          value={titulo}
          onChange={e => { setTitulo(e.target.value); scheduleSave(); }}
          onBlur={() => salvar(true)}
          disabled={readOnly}
          placeholder="Título do documento"
          className="flex-1 bg-transparent text-lg font-bold focus:outline-none px-2"
        />
        <div className="md-status text-xs flex items-center gap-2">
          {readOnly && <span className="px-2 py-0.5 rounded bg-yellow-400/30 text-yellow-100 font-bold">Somente leitura</span>}
          {isDraft && !saving && !savedAt && <span className="px-2 py-0.5 rounded bg-white/20 text-white">Não salvo</span>}
          {saving ? <span>Salvando…</span> : savedAt ? (
            <span className="flex items-center gap-1"><Check size={12} /> Salvo {savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          ) : null}
        </div>
        <button onClick={toggleFullscreen} className="md-headerbtn p-2 rounded-lg" title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}>
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {canUseIA && (
          <button
            ref={aiBtnRef}
            onMouseDown={e => e.preventDefault() /* nao rouba foco do doc */}
            onClick={() => {
              // Snapshot da seleção atual ANTES de abrir (segurança extra)
              const r = readCurrentSelection();
              if (r && r.startOffset !== r.endOffset) lastRangeRef.current = r;
              if (aiOpen) { setAiOpen(false); return; }
              const rect = aiBtnRef.current?.getBoundingClientRect();
              if (rect) setAiMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
              setAiOpen(true);
            }}
            className="md-headerbtn md-ai-btn px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1"
            title="MaxAI — melhorar/resumir/gerar"
          >
            <Sparkles size={13} /> IA
          </button>
        )}
        {!readOnly && (
          <button onClick={() => salvar(false)} className="md-savebtn px-3 py-1.5 rounded-lg text-xs flex items-center gap-1">
            <Save size={13} /> Salvar
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 max-univer-wrap">
        <div ref={containerRef} className="max-univer-host" />
        {!ready && (
          <div className="flex items-center justify-center h-full text-gray-500">Carregando editor…</div>
        )}
      </div>

      {aiOpen && aiMenuPos && createPortal(
        <>
          <div
            ref={aiPopoverRef}
            style={{
              position: 'fixed', top: aiMenuPos.top, right: aiMenuPos.right,
              zIndex: 2147483001, width: 300, background: '#fff', color: '#111',
              border: '1px solid #e5e7eb', borderRadius: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.18)', padding: 10,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="md-ai-title" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Sparkles size={12} style={{ color: '#9B4FE0' }} /> MaxAI
              </span>
              <button onClick={() => setAiOpen(false)} style={{ padding: 2, background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }} title="Fechar">
                <X size={14} />
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.35 }}>
              Selecione o texto no documento e escolha uma ação. Ou peça pra gerar algo novo abaixo.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button className="md-ai-item" disabled={aiBusy} onClick={() => runAI('melhorar')}>Melhorar</button>
              <button className="md-ai-item" disabled={aiBusy} onClick={() => runAI('resumir')}>Resumir</button>
              <button className="md-ai-item" disabled={aiBusy} onClick={() => runAI('expandir')}>Expandir</button>
              <button className="md-ai-item" disabled={aiBusy} onClick={() => runAI('corrigir')}>Corrigir</button>
            </div>
            <div style={{ height: 1, background: '#e5e7eb', margin: '2px 0' }} />
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="Ex: escreva um parágrafo sobre segurança do trabalho"
              rows={3}
              disabled={aiBusy}
              style={{
                width: '100%', fontSize: 12, padding: 6, borderRadius: 4,
                border: '1px solid #d1d5db', outline: 'none', resize: 'vertical',
                fontFamily: 'inherit', color: '#111', background: '#fff',
              }}
            />
            <button className="md-ai-primary" disabled={aiBusy || !aiPrompt.trim()} onClick={() => runAI('gerar')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {aiBusy ? <><Loader2 size={12} className="animate-spin" /> Gerando…</> : <><Sparkles size={12} /> Gerar e inserir</>}
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};
