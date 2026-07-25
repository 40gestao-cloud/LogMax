import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Save, Check, Maximize2, Minimize2 } from 'lucide-react';
import { createUniver, LocaleType, merge } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCorePtBR from '@univerjs/preset-sheets-core/locales/pt-BR';
import '@univerjs/preset-sheets-core/lib/index.css';
import { supabase } from '../lib/supabase';

// =================================================================
// Max Planilhas — editor Univer Sheets
// =================================================================
// Univer traz ribbon nativa estilo Excel (bordas, formulas, formatos,
// mesclar, congelar, tudo). Header verde + botao Salvar ficam por cima;
// o restante e o container do Univer. Salva IWorkbookData em
// max_planilhas.conteudo. Autosave debounce 3s disparado em
// CommandExecuted (qualquer mutacao dispara).
// =================================================================

type Props = {
  planilhaId: string;
  mode?: 'view' | 'edit';
  onClose: () => void;
  showToast?: (msg: string, type?: string) => void;
  profile?: any;
};

const DEFAULT_ROWS = 100;
const DEFAULT_COLS = 26;

// Snapshot minimo compativel com IWorkbookData (Univer preenche o resto no createWorkbook)
const emptyWorkbook = () => ({
  id: `wb_${Date.now()}`,
  sheetOrder: ['sheet-01'],
  name: 'Planilha',
  appVersion: '0.25.0',
  locale: LocaleType.PT_BR,
  styles: {},
  sheets: {
    'sheet-01': {
      id: 'sheet-01',
      name: 'Planilha1',
      rowCount: DEFAULT_ROWS,
      columnCount: DEFAULT_COLS,
      cellData: {},
    },
  },
});

// Detecta se o payload salvo esta no formato Univer (tem sheetOrder + sheets objeto).
// Payloads antigos (Fortune-sheet) eram array de sheets — sao descartados no TRUNCATE
// mas o guard aqui evita crash se algo escapar.
const isUniverWorkbook = (v: any): boolean => {
  return !!(v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.sheetOrder) && v.sheets && typeof v.sheets === 'object');
};

export const MaxPlanilhaEditor = ({ planilhaId, mode = 'edit', onClose, showToast, profile }: Props) => {
  const [titulo, setTitulo] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // isDraft = planilha ainda nao existe no banco. Primeiro Salvar manual
  // faz INSERT e transiciona para modo normal (autosave liberado).
  const [isDraft, setIsDraft] = useState(planilhaId === '__draft__');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<any>(null);
  const univerAPIRef = useRef<any>(null);
  const saveTimer = useRef<number | null>(null);
  const lastSerialized = useRef<string>('');
  const lastTituloSaved = useRef<string>('');
  // Id "vigente" na sessao — vira UUID real apos primeiro save do draft.
  const currentIdRef = useRef<string>(planilhaId);
  const isDraftRef = useRef<boolean>(planilhaId === '__draft__');

  const readOnly = mode === 'view' || (ownerId !== null && ownerId !== profile?.id);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // PWA instalada tem manifest com orientation=portrait. No editor destravamos
  // pra permitir horizontal, re-travando ao sair.
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
    const wb = univerAPIRef.current?.getActiveWorkbook();
    if (!wb) return;
    const snapshot = wb.save();
    const serialized = JSON.stringify(snapshot);
    const tituloFinal = titulo.trim();
    if (!isDraftRef.current && serialized === lastSerialized.current && tituloFinal === lastTituloSaved.current) return;
    setSaving(true);
    if (isDraftRef.current) {
      // Primeiro save: INSERT (cria a linha no banco)
      const { data, error } = await supabase.from('max_planilhas')
        .insert({ user_id: profile?.id, titulo: tituloFinal || 'Planilha sem título', conteudo: snapshot })
        .select().single();
      setSaving(false);
      if (error || !data) { showToast?.(`Erro ao salvar: ${error?.message || 'sem retorno'}`, 'error'); return; }
      currentIdRef.current = data.id;
      isDraftRef.current = false;
      setIsDraft(false);
      setOwnerId(data.user_id);
    } else {
      const { error } = await supabase.from('max_planilhas')
        .update({ titulo: tituloFinal, conteudo: snapshot })
        .eq('id', currentIdRef.current);
      setSaving(false);
      if (error) { showToast?.(`Erro ao salvar: ${error.message}`, 'error'); return; }
    }
    lastSerialized.current = serialized;
    lastTituloSaved.current = tituloFinal;
    setSavedAt(new Date());
    if (!silent) showToast?.('Planilha salva.', 'success');
  }, [readOnly, titulo, showToast, profile?.id]);
  useEffect(() => { salvarRef.current = salvar; }, [salvar]);

  const scheduleSave = useCallback(() => {
    // Autosave só depois do primeiro save manual — no rascunho, nada e persistido
    // ate o usuario clicar Salvar (Word/Excel style).
    if (readOnly || isDraftRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => salvar(true), 3000);
  }, [salvar, readOnly]);

  // Carrega dados + monta Univer
  useEffect(() => {
    let disposed = false;
    (async () => {
      const draft = planilhaId === '__draft__';
      let loaded: any = null;
      if (!draft) {
        if (!supabase) return;
        const { data, error } = await supabase
          .from('max_planilhas')
          .select('titulo,conteudo,user_id')
          .eq('id', planilhaId)
          .maybeSingle();
        if (error || !data) {
          showToast?.('Não foi possível abrir a planilha.', 'error');
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
        locales: { [LocaleType.PT_BR]: merge({}, UniverPresetSheetsCorePtBR) },
        presets: [
          UniverSheetsCorePreset({
            container,
            // Formula bar + barra de status ligados; ribbon padrao (nao simplificada)
          }),
        ],
      });

      const snap = draft ? emptyWorkbook() : (isUniverWorkbook(loaded.conteudo) ? loaded.conteudo : emptyWorkbook());
      const wb = univerAPI.createWorkbook(snap);
      lastSerialized.current = JSON.stringify(wb.save());

      univerRef.current = univer;
      univerAPIRef.current = univerAPI;

      // Autosave: qualquer command executado agenda save (edicao, formatacao, etc)
      if (!readOnly) {
        univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => scheduleSave());
      }

      setReady(true);
    })();
    return () => {
      disposed = true;
      // Save silencioso ao desmontar — mas so se ja saiu do modo draft.
      // Draft abandonado NAO persiste nada (comportamento Word/Excel).
      if (!isDraftRef.current) salvarRef.current(true);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      try { univerRef.current?.dispose(); } catch { /* ignore */ }
      univerRef.current = null;
      univerAPIRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planilhaId]);

  // Ctrl+S manual
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
    <div ref={rootRef} className="max-plan-scope">
      <div className="max-plan-header flex items-center gap-2 px-4 py-3 shrink-0">
        <button onClick={onClose} className="md-headerbtn p-2 rounded-lg" title="Voltar">
          <ArrowLeft size={16} />
        </button>
        <input
          value={titulo}
          onChange={e => { setTitulo(e.target.value); scheduleSave(); }}
          onBlur={() => salvar(true)}
          disabled={readOnly}
          placeholder="Título da planilha"
          className="flex-1 text-lg font-bold focus:outline-none px-2"
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
          <div className="flex items-center justify-center h-full text-gray-500">Carregando planilha…</div>
        )}
      </div>
    </div>
  );
};
