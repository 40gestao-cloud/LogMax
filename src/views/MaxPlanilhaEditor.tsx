import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Workbook, WorkbookInstance } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import {
  ArrowLeft, Save, Check, Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  Palette, PaintBucket, Merge, WrapText, Percent, Undo2, Redo2,
  Rows3, Columns3, Trash2, Snowflake, Maximize2, Minimize2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// =================================================================
// Max Planilhas — editor Fortune-sheet com ribbon custom estilo Excel
// =================================================================
// Toolbar nativa do Fortune-sheet fica desligada (showToolbar=false).
// Aqui montamos uma ribbon estilo Excel em grupos (Fonte / Alinhamento
// / Número / Células / Editar) e aplicamos formatação via ref usando
// setCellFormatByRange sobre a seleção atual. Formula bar nativa fica
// visível (é o `showFormulaBar`, ligado por padrão).
// =================================================================

type Props = {
  planilhaId: string;
  mode?: 'view' | 'edit';
  onClose: () => void;
  showToast?: (msg: string, type?: string) => void;
  profile?: any;
};

const DEFAULT_SHEETS = [{ name: 'Planilha1', celldata: [], row: 50, column: 20 }];

const FONT_FAMILIES = ['Calibri', 'Arial', 'Times New Roman', 'Verdana', 'Tahoma', 'Courier New', 'Cambria', 'Georgia', 'Segoe UI'];
const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36'];
// Fortune-sheet number formats (ct.fa). t: 'n' número, 'g' geral, 'd' data.
const NUM_FORMATS: { label: string; ct: any }[] = [
  { label: 'Geral',        ct: { fa: 'General',      t: 'g' } },
  { label: 'Número',       ct: { fa: '0.00',         t: 'n' } },
  { label: 'Moeda (R$)',   ct: { fa: 'R$ #,##0.00',  t: 'n' } },
  { label: 'Porcentagem',  ct: { fa: '0.00%',        t: 'n' } },
  { label: 'Data',         ct: { fa: 'dd/MM/yyyy',   t: 'd' } },
  { label: 'Hora',         ct: { fa: 'hh:mm:ss',     t: 'd' } },
  { label: 'Texto',        ct: { fa: '@',            t: 's' } },
];

export const MaxPlanilhaEditor = ({ planilhaId, mode = 'edit', onClose, showToast, profile }: Props) => {
  const [titulo, setTitulo] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [initial, setInitial] = useState<any[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const currentData = useRef<any[]>(DEFAULT_SHEETS);
  const saveTimer = useRef<number | null>(null);
  const lastSerialized = useRef<string>('');
  const lastTituloSaved = useRef<string>('');
  const wbRef = useRef<WorkbookInstance | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const readOnly = mode === 'view' || (ownerId !== null && ownerId !== profile?.id);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.().catch(() => showToast?.('Tela cheia não disponível.', 'error'));
  };

  useEffect(() => {
    (async () => {
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
      setTitulo(data.titulo || '');
      setOwnerId(data.user_id);
      const sheets = Array.isArray(data.conteudo) && data.conteudo.length > 0 ? data.conteudo : DEFAULT_SHEETS;
      currentData.current = sheets;
      lastSerialized.current = JSON.stringify(sheets);
      lastTituloSaved.current = (data.titulo || '').trim();
      setInitial(sheets);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planilhaId]);

  const salvarRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});
  const salvar = useCallback(async (silent = false) => {
    if (!supabase || readOnly) return;
    const serialized = JSON.stringify(currentData.current);
    const tituloFinal = titulo.trim();
    // Dedup: só grava se algo mudou desde o último save.
    if (serialized === lastSerialized.current && tituloFinal === lastTituloSaved.current) return;
    const payload = { titulo: tituloFinal, conteudo: currentData.current };
    setSaving(true);
    const { error } = await supabase.from('max_planilhas').update(payload).eq('id', planilhaId);
    setSaving(false);
    if (error) { showToast?.(`Erro ao salvar: ${error.message}`, 'error'); return; }
    lastSerialized.current = serialized;
    lastTituloSaved.current = tituloFinal;
    setSavedAt(new Date());
    if (!silent) showToast?.('Planilha salva.', 'success');
  }, [planilhaId, readOnly, titulo, showToast]);
  useEffect(() => { salvarRef.current = salvar; }, [salvar]);

  const scheduleSave = useCallback(() => {
    if (readOnly) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => salvar(true), 3000);
  }, [salvar, readOnly]);

  const onSheetChange = useCallback((sheets: any[]) => {
    currentData.current = sheets;
    scheduleSave();
  }, [scheduleSave]);

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

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      salvarRef.current(true);
    };
  }, []);

  // ============ Helpers do ribbon (aplicam sobre a seleção atual) ============
  const getSel = () => {
    const s = wbRef.current?.getSelection();
    return (s && s.length > 0) ? s[0] : null;
  };

  const applyFmt = (attr: string, value: any) => {
    const s = getSel(); if (!s) { showToast?.('Selecione uma célula ou intervalo primeiro.', 'info'); return; }
    wbRef.current?.setCellFormatByRange(attr as any, value, { row: s.row, column: s.column });
  };

  const toggleFmt = (attr: string, onValue: any = 1, offValue: any = 0) => {
    const s = getSel(); if (!s) { showToast?.('Selecione uma célula ou intervalo primeiro.', 'info'); return; }
    const current = wbRef.current?.getCellValue(s.row[0], s.column[0], { type: attr as any });
    applyFmt(attr, current === onValue ? offValue : onValue);
  };

  const insertRow = () => { const s = getSel(); if (s) wbRef.current?.insertRowOrColumn('row', s.row[0], 1); };
  const insertCol = () => { const s = getSel(); if (s) wbRef.current?.insertRowOrColumn('column', s.column[0], 1); };
  const deleteRow = () => { const s = getSel(); if (s) wbRef.current?.deleteRowOrColumn('row', s.row[0], s.row[1]); };
  const deleteCol = () => { const s = getSel(); if (s) wbRef.current?.deleteRowOrColumn('column', s.column[0], s.column[1]); };
  const mergeAll = () => { const s = getSel(); if (s) wbRef.current?.mergeCells({ row: s.row, column: s.column } as any, 'merge-all'); };
  const freeze = () => { const s = getSel(); if (s) wbRef.current?.freeze('both', { row: s.row[0], column: s.column[0] }); };

  if (!initial) {
    return <div className="flex items-center justify-center h-full text-gray-500">Carregando planilha…</div>;
  }

  return (
    <div ref={rootRef} className="max-plan-scope">
      {/* Header verde Excel */}
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

      {/* Ribbon custom estilo Excel */}
      {!readOnly && (
        <div className="md-ribbon">
          {/* Fonte */}
          <div className="md-group">
            <div className="md-group-row1">
              <select onChange={e => e.target.value && applyFmt('ff', e.target.value)} defaultValue="" className="md-select md-select-font" title="Fonte">
                <option value="">Fonte</option>
                {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
              <select onChange={e => e.target.value && applyFmt('fs', parseInt(e.target.value, 10))} defaultValue="" className="md-select md-select-size" title="Tamanho">
                <option value=""></option>
                {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="md-group-row2">
              <ToolBtn onClick={() => toggleFmt('bl')} title="Negrito"><Bold size={13} /></ToolBtn>
              <ToolBtn onClick={() => toggleFmt('it')} title="Itálico"><Italic size={13} /></ToolBtn>
              <ToolBtn onClick={() => toggleFmt('un', 1, 0)} title="Sublinhado"><UnderlineIcon size={13} /></ToolBtn>
              <ToolBtn onClick={() => toggleFmt('cl', 1, 0)} title="Tachado"><Strikethrough size={13} /></ToolBtn>
              <label className="md-colorbtn" title="Cor do texto">
                <Palette size={13} />
                <span className="md-colorbar" style={{ background: '#000000' }} />
                <input type="color" defaultValue="#000000" onChange={e => applyFmt('fc', e.target.value)} />
              </label>
              <label className="md-colorbtn" title="Cor de preenchimento">
                <PaintBucket size={13} />
                <span className="md-colorbar" style={{ background: '#ffff00' }} />
                <input type="color" defaultValue="#ffff00" onChange={e => applyFmt('bg', e.target.value)} />
              </label>
            </div>
            <div className="md-group-label">Fonte</div>
          </div>

          <div className="md-group-divider" />

          {/* Alinhamento */}
          <div className="md-group">
            <div className="md-group-row1">
              <ToolBtn onClick={() => applyFmt('vt', 1)} title="Alinhar em cima"><AlignVerticalJustifyStart size={13} /></ToolBtn>
              <ToolBtn onClick={() => applyFmt('vt', 0)} title="Alinhar ao meio"><AlignVerticalJustifyCenter size={13} /></ToolBtn>
              <ToolBtn onClick={() => applyFmt('vt', 2)} title="Alinhar embaixo"><AlignVerticalJustifyEnd size={13} /></ToolBtn>
              <ToolBtn onClick={() => toggleFmt('tb', '2', '1')} title="Quebrar texto"><WrapText size={13} /></ToolBtn>
            </div>
            <div className="md-group-row2">
              <ToolBtn onClick={() => applyFmt('ht', 1)} title="Alinhar à esquerda"><AlignLeft size={13} /></ToolBtn>
              <ToolBtn onClick={() => applyFmt('ht', 0)} title="Centralizar"><AlignCenter size={13} /></ToolBtn>
              <ToolBtn onClick={() => applyFmt('ht', 2)} title="Alinhar à direita"><AlignRight size={13} /></ToolBtn>
              <ToolBtn onClick={mergeAll} title="Mesclar células"><Merge size={13} /></ToolBtn>
            </div>
            <div className="md-group-label">Alinhamento</div>
          </div>

          <div className="md-group-divider" />

          {/* Número */}
          <div className="md-group">
            <div className="md-group-row1">
              <select onChange={e => {
                const idx = parseInt(e.target.value, 10);
                if (!Number.isNaN(idx)) applyFmt('ct', NUM_FORMATS[idx].ct);
              }} defaultValue="" className="md-select md-select-numfmt" title="Formato do número">
                <option value="">Formato</option>
                {NUM_FORMATS.map((f, i) => <option key={i} value={i}>{f.label}</option>)}
              </select>
            </div>
            <div className="md-group-row2">
              <ToolBtn onClick={() => applyFmt('ct', NUM_FORMATS[2].ct)} title="Moeda R$">R$</ToolBtn>
              <ToolBtn onClick={() => applyFmt('ct', NUM_FORMATS[3].ct)} title="Porcentagem"><Percent size={13} /></ToolBtn>
            </div>
            <div className="md-group-label">Número</div>
          </div>

          <div className="md-group-divider" />

          {/* Células */}
          <div className="md-group">
            <div className="md-group-row1">
              <ToolBtn onClick={insertRow} title="Inserir linha"><Rows3 size={13} /></ToolBtn>
              <ToolBtn onClick={insertCol} title="Inserir coluna"><Columns3 size={13} /></ToolBtn>
              <ToolBtn onClick={freeze} title="Congelar painéis"><Snowflake size={13} /></ToolBtn>
            </div>
            <div className="md-group-row2">
              <ToolBtn onClick={deleteRow} title="Excluir linha"><Trash2 size={13} /> <Rows3 size={11} /></ToolBtn>
              <ToolBtn onClick={deleteCol} title="Excluir coluna"><Trash2 size={13} /> <Columns3 size={11} /></ToolBtn>
            </div>
            <div className="md-group-label">Células</div>
          </div>

          <div className="md-group-divider" />

          {/* Editar */}
          <div className="md-group">
            <div className="md-group-row1">
              <ToolBtn onClick={() => wbRef.current?.handleUndo()} title="Desfazer (Ctrl+Z)"><Undo2 size={13} /></ToolBtn>
              <ToolBtn onClick={() => wbRef.current?.handleRedo()} title="Refazer (Ctrl+Y)"><Redo2 size={13} /></ToolBtn>
            </div>
            <div className="md-group-label">Editar</div>
          </div>
        </div>
      )}

      {/* Fortune-sheet (formula bar nativa fica ligada — é a "fx bar" do Excel) */}
      <div className="flex-1 min-h-0 max-planilha-wrap">
        <Workbook
          ref={wbRef}
          data={initial as any}
          onChange={onSheetChange}
          lang="en"
          allowEdit={!readOnly}
          showToolbar={false}
          showFormulaBar={true}
          showSheetTabs={true}
        />
      </div>
    </div>
  );
};

const ToolBtn = ({ children, onClick, active, title }: any) => (
  <button onClick={onClick} title={title} type="button" className={`md-toolbtn ${active ? 'md-active' : ''}`}>
    {children}
  </button>
);
