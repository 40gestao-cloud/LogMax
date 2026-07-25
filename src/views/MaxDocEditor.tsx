import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Save, Check, Maximize2, Minimize2 } from 'lucide-react';
import { createUniver, LocaleType, merge } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import UniverPresetDocsCorePtBR from '@univerjs/preset-docs-core/locales/pt-BR';
import '@univerjs/preset-docs-core/lib/index.css';
import { supabase } from '../lib/supabase';

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
    </div>
  );
};
