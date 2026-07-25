import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { FontFamily } from '@tiptap/extension-font-family';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import {
  ArrowLeft, Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3, List, ListOrdered, Quote,
  Undo2, Redo2, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Save, Check, Sun, Moon, Subscript as SubIcon, Superscript as SupIcon,
  Type, Highlighter, Palette, IndentIncrease, IndentDecrease, Maximize2, Minimize2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { FontSize, LineHeight } from './maxDocExtensions';

// =================================================================
// Max Docs — editor Tiptap com toolbar estilo Word
// =================================================================
// Grupos: Fonte / Parágrafo / Estilos, com divisórias verticais e
// legenda cinza abaixo (como o ribbon do Word). Tema claro (Word)
// ou escuro (LogMax), escopado. Autosave 3s + Ctrl+S.
// =================================================================

type Props = {
  docId: string;
  mode?: 'view' | 'edit';
  onClose: () => void;
  showToast?: (msg: string, type?: string) => void;
  profile?: any;
};

const THEME_LS_KEY = 'logmax:maxdocs:theme';

const FONT_FAMILIES = [
  'Calibri', 'Arial', 'Times New Roman', 'Georgia',
  'Verdana', 'Tahoma', 'Courier New', 'Cambria', 'Segoe UI',
];
const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '72'];
const LINE_HEIGHTS = [
  { label: '1,0', value: '1' },
  { label: '1,15', value: '1.15' },
  { label: '1,5', value: '1.5' },
  { label: '2,0', value: '2' },
  { label: '2,5', value: '2.5' },
  { label: '3,0', value: '3' },
];

type StyleId = 'normal' | 'sem-esp' | 'h1' | 'h2' | 'h3';
const STYLE_PRESETS: { id: StyleId; label: string; apply: (editor: any) => void }[] = [
  { id: 'normal',  label: 'Normal',         apply: e => e.chain().focus().setParagraph().setLineHeight('1.15').run() },
  { id: 'sem-esp', label: 'Sem Espaçamento',apply: e => e.chain().focus().setParagraph().setLineHeight('1').run() },
  { id: 'h1',      label: 'Título 1',       apply: e => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2',      label: 'Título 2',       apply: e => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3',      label: 'Título 3',       apply: e => e.chain().focus().setHeading({ level: 3 }).run() },
];

export const MaxDocEditor = ({ docId, mode = 'edit', onClose, showToast, profile }: Props) => {
  const [titulo, setTitulo] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return (localStorage.getItem(THEME_LS_KEY) as 'light' | 'dark') || 'light'; }
    catch { return 'light'; }
  });
  const saveTimer = useRef<number | null>(null);
  const lastPayload = useRef<{ titulo: string; conteudo: string }>({ titulo: '', conteudo: '' });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.().catch(() => showToast?.('Tela cheia não disponível.', 'error'));
  };

  const readOnly = mode === 'view' || (ownerId !== null && ownerId !== profile?.id);

  useEffect(() => { try { localStorage.setItem(THEME_LS_KEY, theme); } catch {} }, [theme]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color.configure({ types: ['textStyle'] }),
      Highlight.configure({ multicolor: true }),
      FontFamily.configure({ types: ['textStyle'] }),
      Subscript,
      Superscript,
      FontSize,
      LineHeight,
    ],
    content: '',
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'prose max-w-none focus:outline-none min-h-[60vh] px-12 py-10',
      },
    },
  });

  useEffect(() => { editor?.setEditable(!readOnly); }, [editor, readOnly]);

  useEffect(() => {
    (async () => {
      if (!supabase || !editor) return;
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
      setTitulo(data.titulo || '');
      setOwnerId(data.user_id);
      editor.commands.setContent(data.conteudo || '', { emitUpdate: false });
      // Baseline usa o que o editor de fato renderizou (ex.: '' vira '<p></p>'),
      // senão o 1º autosave dispara um UPDATE inútil comparando strings diferentes.
      lastPayload.current = {
        titulo: (data.titulo || '').trim(),
        conteudo: editor.getHTML(),
      };
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, editor]);

  const salvarRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});
  const salvar = useCallback(async (silent = false) => {
    if (!supabase || !editor || readOnly) return;
    const payload = { titulo: titulo.trim(), conteudo: editor.getHTML() };
    if (payload.titulo === lastPayload.current.titulo && payload.conteudo === lastPayload.current.conteudo) return;
    setSaving(true);
    const { error } = await supabase.from('max_docs').update(payload).eq('id', docId);
    setSaving(false);
    if (error) { showToast?.(`Erro ao salvar: ${error.message}`, 'error'); return; }
    lastPayload.current = payload;
    setSavedAt(new Date());
    if (!silent) showToast?.('Documento salvo.', 'success');
  }, [docId, editor, readOnly, titulo, showToast]);
  useEffect(() => { salvarRef.current = salvar; }, [salvar]);

  const scheduleSave = useCallback(() => {
    if (readOnly) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => salvar(true), 3000);
  }, [salvar, readOnly]);

  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => { scheduleSave(); forceRender(n => n + 1); };
    const onSelection = () => forceRender(n => n + 1);
    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onSelection);
    editor.on('transaction', onSelection);
    return () => {
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onSelection);
      editor.off('transaction', onSelection);
    };
  }, [editor, scheduleSave]);

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

  if (loading || !editor) {
    return <div className="flex items-center justify-center h-full text-gray-500">Carregando editor…</div>;
  }

  const currentFontFamily = editor.getAttributes('textStyle').fontFamily || '';
  const currentFontSize = (editor.getAttributes('textStyle').fontSize || '').replace('px', '');
  const currentColor = editor.getAttributes('textStyle').color || '';
  const currentHighlight = editor.getAttributes('highlight').color || '';

  const bumpFontSize = (delta: number) => {
    const size = parseInt(currentFontSize, 10) || 11;
    editor.chain().focus().setFontSize(`${Math.max(6, Math.min(120, size + delta))}px`).run();
  };

  return (
    <div ref={rootRef} className={`max-doc-scope ${theme === 'light' ? 'max-doc-light' : 'max-doc-dark'}`}>
      {/* Header */}
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
          {saving ? <span>Salvando…</span> : savedAt ? (
            <span className="flex items-center gap-1"><Check size={12} /> Salvo {savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          ) : null}
        </div>
        <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className="md-headerbtn p-2 rounded-lg"
          title={theme === 'light' ? 'Mudar pra tema escuro' : 'Mudar pra tema claro'}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        <button onClick={toggleFullscreen} className="md-headerbtn p-2 rounded-lg" title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}>
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {!readOnly && (
          <button onClick={() => salvar(false)} className="md-savebtn px-3 py-1.5 rounded-lg text-xs flex items-center gap-1">
            <Save size={13} /> Salvar
          </button>
        )}
      </div>

      {/* Toolbar em grupos estilo ribbon Word */}
      {!readOnly && (
        <div className="md-toolbar md-ribbon flex items-stretch gap-0 px-3 py-1 shrink-0 overflow-x-auto">
          {/* Grupo Fonte */}
          <div className="md-group">
            <div className="md-group-row1">
              <select
                value={currentFontFamily}
                onChange={e => e.target.value ? editor.chain().focus().setFontFamily(e.target.value).run() : editor.chain().focus().unsetFontFamily().run()}
                className="md-select md-select-font"
                title="Fonte"
              >
                <option value="">(padrão)</option>
                {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
              <select
                value={currentFontSize}
                onChange={e => e.target.value ? editor.chain().focus().setFontSize(`${e.target.value}px`).run() : editor.chain().focus().unsetFontSize().run()}
                className="md-select md-select-size"
                title="Tamanho"
              >
                <option value=""></option>
                {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ToolBtn onClick={() => bumpFontSize(2)} title="Aumentar fonte">A<sup>+</sup></ToolBtn>
              <ToolBtn onClick={() => bumpFontSize(-2)} title="Diminuir fonte">A<sup>−</sup></ToolBtn>
            </div>
            <div className="md-group-row2">
              <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Negrito (Ctrl+B)"><Bold size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Itálico (Ctrl+I)"><Italic size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Sublinhado (Ctrl+U)"><UnderlineIcon size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Tachado"><Strikethrough size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscrito"><SubIcon size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Sobrescrito"><SupIcon size={13} /></ToolBtn>
              <label className="md-colorbtn" title="Cor do texto">
                <Palette size={13} />
                <span className="md-colorbar" style={{ background: currentColor || '#000000' }} />
                <input type="color" value={currentColor || '#000000'}
                  onChange={e => editor.chain().focus().setColor(e.target.value).run()} />
              </label>
              <label className="md-colorbtn" title="Cor de destaque">
                <Highlighter size={13} />
                <span className="md-colorbar" style={{ background: currentHighlight || '#ffff00' }} />
                <input type="color" value={currentHighlight || '#ffff00'}
                  onChange={e => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()} />
              </label>
            </div>
            <div className="md-group-label">Fonte</div>
          </div>

          <div className="md-group-divider" />

          {/* Grupo Parágrafo */}
          <div className="md-group">
            <div className="md-group-row1">
              <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Lista com marcadores"><List size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Lista numerada"><ListOrdered size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().liftListItem('listItem').run()} title="Diminuir recuo"><IndentDecrease size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().sinkListItem('listItem').run()} title="Aumentar recuo"><IndentIncrease size={13} /></ToolBtn>
              <select
                onChange={e => e.target.value && editor.chain().focus().setLineHeight(e.target.value).run()}
                value=""
                className="md-select"
                title="Espaçamento entre linhas"
              >
                <option value="">↕</option>
                {LINE_HEIGHTS.map(lh => <option key={lh.value} value={lh.value}>{lh.label}</option>)}
              </select>
            </div>
            <div className="md-group-row2">
              <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Alinhar à esquerda"><AlignLeft size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Centralizar"><AlignCenter size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Alinhar à direita"><AlignRight size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justificar"><AlignJustify size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Citação"><Quote size={13} /></ToolBtn>
            </div>
            <div className="md-group-label">Parágrafo</div>
          </div>

          <div className="md-group-divider" />

          {/* Grupo Estilos */}
          <div className="md-group">
            <div className="md-styles">
              {STYLE_PRESETS.map(preset => {
                const isActive = preset.id === 'h1' ? editor.isActive('heading', { level: 1 })
                  : preset.id === 'h2' ? editor.isActive('heading', { level: 2 })
                  : preset.id === 'h3' ? editor.isActive('heading', { level: 3 })
                  : preset.id === 'normal' ? editor.isActive('paragraph') && !editor.isActive('heading')
                  : false;
                const previewCls =
                  preset.id === 'h1' ? 'md-style-h1' :
                  preset.id === 'h2' ? 'md-style-h2' :
                  preset.id === 'h3' ? 'md-style-h3' :
                  'md-style-normal';
                return (
                  <button
                    key={preset.id}
                    onClick={() => preset.apply(editor)}
                    className={`md-style-card ${isActive ? 'md-active' : ''}`}
                    title={preset.label}
                  >
                    <span className={previewCls}>{preset.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="md-group-label">Estilos</div>
          </div>

          <div className="md-group-divider" />

          {/* Grupo Utilidades */}
          <div className="md-group">
            <div className="md-group-row1">
              <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Título 1"><Heading1 size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Título 2"><Heading2 size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Título 3"><Heading3 size={13} /></ToolBtn>
            </div>
            <div className="md-group-row2">
              <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="Desfazer (Ctrl+Z)"><Undo2 size={13} /></ToolBtn>
              <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="Refazer (Ctrl+Y)"><Redo2 size={13} /></ToolBtn>
            </div>
            <div className="md-group-label">Editar</div>
          </div>
        </div>
      )}

      {/* Papel */}
      <div className="md-page flex-1 overflow-auto py-8 px-4">
        <div className="md-paper max-w-[816px] mx-auto rounded-sm">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
};

const ToolBtn = ({ children, onClick, active, title }: any) => (
  <button
    onClick={onClick}
    title={title}
    type="button"
    className={`md-toolbtn ${active ? 'md-active' : ''}`}
  >
    {children}
  </button>
);
