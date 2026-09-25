import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Save, Edit2, Trash2, ChevronRight, X, Search,
  Eye, EyeOff, FolderTree, Percent,
} from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, FilialBadge } from '../components/ui';
import { ImagemUploader } from '../components/ImagemCadastro';
import { uploadImagem, removerImagem, CATEGORIA_IMAGEM_BUCKET } from '../lib/imagemCadastro';
import { useConfirm } from '../contexts/ConfirmContext';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';

// Paleta com nome. O cadastro nunca mostra o hexadecimal na lista — cor é
// linguagem visual, não dado do usuário; quem precisa do código exato mexe no
// seletor livre dentro do formulário, onde o hex faz sentido.
const COR_PRESETS: { hex: string; nome: string }[] = [
  { hex: '#D4AF37', nome: 'Dourado' },
  { hex: '#22c55e', nome: 'Verde' },
  { hex: '#3b82f6', nome: 'Azul' },
  { hex: '#06b6d4', nome: 'Ciano' },
  { hex: '#8b5cf6', nome: 'Roxo' },
  { hex: '#ec4899', nome: 'Rosa' },
  { hex: '#ef4444', nome: 'Vermelho' },
  { hex: '#f97316', nome: 'Laranja' },
  { hex: '#f59e0b', nome: 'Âmbar' },
  { hex: '#6b7280', nome: 'Cinza' },
];

// Catálogo de ícones em vez de campo livre de emoji: digitar emoji no teclado
// do desktop é atrito puro e o resultado saía inconsistente entre categorias.
const ICONE_PRESETS = [
  '📦','🛒','🥫','🍞','🥩','🥦','🍫','🥤','🧊','🧴',
  '🧼','🧻','👕','👟','👜','💄','💍','🕶️','📱','💻',
  '🎧','🔌','🖥️','🎮','🔋','🏠','🔧','📚','🎁','🐾',
];

const EMPTY = { nome: '', cor: '#D4AF37', icone: '📦', imagem_url: '', margem_alvo: '' };
type FormData = typeof EMPTY;

const normalizar = (s: string) => s.trim().toLowerCase();

// ── Thumbnail exibido nas listas e na prévia ──────────────────────────────────
// `size` em pixels, aplicado via style. Antes era `w-${size}` interpolado na
// classe — o Tailwind varre o código fonte procurando classes literais, então
// `w-8` gerado em tempo de execução só funcionava por acidente, quando outra
// tela do app tinha a mesma classe escrita à mão.
function CatThumb({ imagem_url, icone, cor, size = 34 }: {
  imagem_url?: string; icone?: string; cor?: string; size?: number;
}) {
  const c = cor ?? '#6b7280';
  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: Math.round(size * 0.28),
    border: `1px solid ${c}55`,
  };
  if (imagem_url) {
    return (
      <div style={base} className="overflow-hidden shrink-0">
        <img src={imagem_url} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div
      style={{ ...base, background: `${c}1f`, fontSize: Math.round(size * 0.48), lineHeight: 1 }}
      className="flex items-center justify-center shrink-0 select-none"
    >
      {icone || '📦'}
    </div>
  );
}

// ── Picker de cor ─────────────────────────────────────────────────────────────
function CorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const livre = !COR_PRESETS.some(c => c.hex.toLowerCase() === value.toLowerCase());
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5 flex-wrap items-center">
        {COR_PRESETS.map(c => {
          const ativo = c.hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c.hex} type="button" title={c.nome} onClick={() => onChange(c.hex)}
              className={`w-7 h-7 rounded-lg transition-all ${ativo ? 'scale-110 ring-2 ring-white/80' : 'opacity-70 hover:opacity-100 hover:scale-105'}`}
              style={{ background: c.hex }}
            />
          );
        })}
        <label
          title="Cor personalizada"
          className={`w-7 h-7 rounded-lg cursor-pointer flex items-center justify-center transition-all relative overflow-hidden ${livre ? 'scale-110 ring-2 ring-white/80' : 'opacity-70 hover:opacity-100'}`}
          style={{
            background: livre
              ? value
              : 'conic-gradient(#ef4444,#f59e0b,#22c55e,#06b6d4,#3b82f6,#8b5cf6,#ec4899,#ef4444)',
          }}
        >
          {!livre && <Plus size={12} className="text-white drop-shadow" />}
          <input type="color" value={value} onChange={e => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
      </div>
      <span className="text-[10px] text-gray-600 font-mono">{value.toUpperCase()}</span>
    </div>
  );
}

// ── Picker de ícone ───────────────────────────────────────────────────────────
function IconePicker({ value, onChange }: { value: string; onChange: (i: string) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {ICONE_PRESETS.map(i => (
        <button
          key={i} type="button" onClick={() => onChange(i)}
          className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all
            ${value === i ? 'neu-pressed border border-accent/40 scale-105' : 'neu-flat border border-white/5 opacity-70 hover:opacity-100'}`}
        >
          {i}
        </button>
      ))}
    </div>
  );
}

// Anexa a imagem DEPOIS que o cadastro já existe.
//
// A ordem importa: enquanto o upload vinha primeiro, uma recusa do storage
// (policy de setor, migr. 479) levava o cadastro junto e não sobrava linha
// nenhuma no banco — nem para o admin ver. Agora o registro está salvo quando
// esta função roda, então falha de imagem é aviso, e o aluno reanexa editando.
//
// O upload usa o id REAL do registro como pasta, inclusive na criação: antes,
// categoria nova caía num uuid aleatório, e o arquivo ficava sem dono
// rastreável no bucket.
async function anexarImagem(
  endpoint: 'categorias_produto' | 'subcategorias_produto',
  id: string | null,
  novaImagem: File | null,
  imagemAntiga: string,
  imagemNoForm: string,
  reload: () => void,
  showToast: any,
  rotulo: string,
): Promise<void> {
  // Imagem removida na edição: o registro já gravou `null`, resta o arquivo.
  if (!novaImagem) {
    if (!imagemNoForm && imagemAntiga) removerImagem(CATEGORIA_IMAGEM_BUCKET, imagemAntiga);
    return;
  }
  if (!id) {
    showToast?.(`A ${rotulo} foi salva, mas a imagem não pôde ser anexada. Edite-a para enviar de novo.`, 'error');
    return;
  }
  try {
    const url = await uploadImagem(CATEGORIA_IMAGEM_BUCKET, novaImagem, id);
    await dbUpdate(endpoint, id, { imagem_url: url });
    // Só depois que a nova está gravada: apagar antes deixaria o registro
    // apontando para arquivo inexistente se o update falhasse.
    if (imagemAntiga) removerImagem(CATEGORIA_IMAGEM_BUCKET, imagemAntiga);
    reload();
  } catch (e: any) {
    showToast?.(`A ${rotulo} foi salva, mas a imagem não subiu: ${e?.message ?? 'falha no envio'} Edite-a para tentar de novo.`, 'error');
  }
}

// ── Form inline ───────────────────────────────────────────────────────────────
function InlineForm({ initial, onSave, onCancel, saving, comMargem, comSubcategorias, nomesEmUso, titulo }: {
  initial: FormData;
  /** Grava o cadastro e, só depois, anexa `novaImagem` — ver handleSubmit.
   *  `subcategorias`: os nomes digitados no campo de etiquetas (categoria nova). */
  onSave: (v: FormData, novaImagem: File | null, subcategorias: string[]) => Promise<void>;
  onCancel: () => void; saving: boolean;
  /** Só categoria tem markup — subcategoria herda o da mãe. */
  comMargem?: boolean;
  /** Categoria nova já nasce com as filhas: o campo de etiquetas aparece. */
  comSubcategorias?: boolean;
  /** Nomes já cadastrados no mesmo nível, para barrar duplicata antes do save. */
  nomesEmUso: string[];
  titulo: string;
}) {
  const [f, setF]           = useState<FormData>(initial);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl]   = useState<string>(initial.imagem_url);
  // Subcategorias digitadas na criação (24/09). Antes a categoria nascia
  // sozinha e as filhas moravam num painel à parte, que só abria clicando na
  // categoria — o aluno salvava "Mercearia" e não via onde pôr "Massas".
  const [subs, setSubs] = useState<string[]>([]);
  const [subTexto, setSubTexto] = useState('');
  const addSub = (texto: string) => {
    const nome = texto.trim();
    if (!nome) return;
    if (!subs.some(x => normalizar(x) === normalizar(nome))) setSubs(p => [...p, nome]);
    setSubTexto('');
  };

  const duplicado = !!f.nome.trim() && nomesEmUso.includes(normalizar(f.nome));
  const podeSalvar = !!f.nome.trim() && !duplicado && !saving;

  const handlePreview = (file: File, url: string) => {
    // libera blob URL anterior antes de sobrescrever (evita leak de memória)
    if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(url);
    setF(p => ({ ...p, imagem_url: url }));
  };

  const handleClear = () => {
    setPendingFile(null);
    setPreviewUrl('');
    setF(p => ({ ...p, imagem_url: '' }));
  };

  // O upload NÃO acontece aqui, e essa é a inversão de 17/09/2026.
  //
  // Antes a imagem subia antes do save: uma recusa do storage abortava a
  // gravação inteira e o cadastro não nascia. A mensagem que sobrava começava
  // com "Sem permissão para enviar imagem", e chega ao professor como "o aluno
  // não consegue salvar a categoria" — com a categoria inexistente no banco,
  // invisível até para o admin. A imagem é ANEXO do cadastro, não requisito
  // dele: o nome, a cor e o markup gravam sozinhos.
  //
  // `imagem_url` do formulário carrega um blob: local enquanto há arquivo
  // pendente (é o que alimenta a prévia). Esse valor nunca pode ir para o
  // banco, então o que se persiste agora é a imagem que JÁ existia — trocada
  // depois, se e quando o upload der certo.
  const handleSubmit = () => {
    if (!podeSalvar) return;
    const urlPersistida = pendingFile ? initial.imagem_url : f.imagem_url;
    // O que ficou digitado no campo e não virou etiqueta também entra — quem
    // escreve "Enlatados" e clica em Salvar espera que ela exista.
    const pendente = subTexto.trim();
    const todas = pendente && !subs.some(x => normalizar(x) === normalizar(pendente)) ? [...subs, pendente] : subs;
    void onSave({ ...f, imagem_url: urlPersistida }, pendingFile, todas);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      onKeyDown={e => {
        if (e.key === 'Escape') { onCancel(); return; }
        // Enter salva só a partir de um campo de texto. Sem esta checagem, o
        // Enter num swatch de cor ou num botão de emoji disparava o clique do
        // botão E o save junto, pelo bubbling — quem navega por teclado salvava
        // a categoria ao escolher o ícone.
        const alvo = e.target as HTMLElement;
        // No campo de subcategorias o Enter vira etiqueta, não salva.
        if (alvo.dataset.etiqueta) return;
        const ehCampoTexto = alvo.tagName === 'INPUT'
          && !['color', 'file', 'checkbox', 'radio'].includes((alvo as HTMLInputElement).type);
        if (e.key === 'Enter' && !e.shiftKey && ehCampoTexto) { e.preventDefault(); void handleSubmit(); }
      }}
      className="neu-flat border border-accent/25 rounded-xl overflow-hidden"
    >
      <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
        <p className="text-[10px] font-bold text-accent uppercase tracking-widest">{titulo}</p>
        <button onClick={onCancel} className="modal-close-btn" title="Fechar (Esc)">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Prévia ao vivo: o cadastro deixa de ser um formulário às cegas — o
            aluno vê o mesmo chip que vai aparecer em Produtos e no PDV. */}
        <div className="rounded-xl px-3 py-2.5 flex items-center gap-3"
          style={{ background: `${f.cor}12`, border: `1px solid ${f.cor}33` }}>
          <CatThumb imagem_url={previewUrl} icone={f.icone} cor={f.cor} size={40} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-100 truncate">{f.nome.trim() || 'Nome da categoria'}</p>
            <p className="text-[10px] text-gray-500">Prévia — é assim que aparece em Produtos e no PDV</p>
          </div>
        </div>

        <FormField label="Nome *" error={duplicado ? 'Já existe um registro com este nome.' : undefined}>
          <input className="neu-input w-full text-sm" value={f.nome}
            onChange={e => setF(p => ({ ...p, nome: e.target.value }))}
            placeholder="Ex: Mercearia, Bebidas, Smartphones…" autoFocus />
        </FormField>

        {comMargem && (
          /* Markup por linha de produto — é o que faz a categoria deixar de
             ser cor e ícone. Com o custo preenchido, o cadastro de produto
             sugere o preço de venda; vazio, o preço fica livre. */
          <FormField label="Markup-alvo">
            <div className="relative">
              <input className="neu-input w-full text-sm pr-9" inputMode="decimal" value={f.margem_alvo}
                onChange={e => setF(p => ({ ...p, margem_alvo: e.target.value.replace(/[^0-9,.]/g, '') }))}
                placeholder="Ex: 35" />
              <Percent size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
            </div>
            <span className="text-[10px] text-gray-500 leading-relaxed">
              Markup padrão da linha. O cadastro de produto usa isto para sugerir o preço de venda
              a partir do custo — deixe vazio para preço livre.
            </span>
          </FormField>
        )}

        {comSubcategorias && (
          <FormField label="Subcategorias">
            <div className="neu-input w-full flex flex-wrap items-center gap-1.5 !py-1.5">
              {subs.map(nome => (
                <span key={nome} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                  style={{ background: `${f.cor}1f`, border: `1px solid ${f.cor}55` }}>
                  {nome}
                  <button type="button" onClick={() => setSubs(p => p.filter(x => x !== nome))}
                    className="text-gray-400 hover:text-gray-100" title={`Tirar "${nome}"`}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input data-etiqueta="1" value={subTexto}
                onChange={e => setSubTexto(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSub(subTexto); }
                  else if (e.key === 'Backspace' && !subTexto && subs.length) setSubs(p => p.slice(0, -1));
                }}
                onBlur={() => addSub(subTexto)}
                placeholder={subs.length ? 'Mais uma…' : 'Ex: Massas — Enter para adicionar'}
                className="flex-1 min-w-[10rem] bg-transparent outline-none text-sm py-1" />
            </div>
            <span className="text-[10px] text-gray-500 leading-relaxed">
              Opcional. Digite o nome e aperte Enter; dá para acrescentar outras depois, dentro da categoria.
            </span>
          </FormField>
        )}

        <div className="rounded-xl border border-white/5 p-3 space-y-3">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Aparência</p>

          <FormField label="Imagem (opcional)">
            <ImagemUploader imagemUrl={previewUrl} onPreview={handlePreview} onClear={handleClear} />
          </FormField>

          {previewUrl ? (
            <p className="text-[10px] text-gray-600">A imagem substitui o ícone enquanto estiver enviada.</p>
          ) : (
            <FormField label="Ícone">
              <IconePicker value={f.icone} onChange={i => setF(p => ({ ...p, icone: i }))} />
            </FormField>
          )}

          <FormField label="Cor">
            <CorPicker value={f.cor} onChange={c => setF(p => ({ ...p, cor: c }))} />
          </FormField>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-white/5 flex gap-2 justify-end items-center">
        <span className="text-[10px] text-gray-600 mr-auto hidden sm:block">Enter salva · Esc cancela</span>
        <button onClick={onCancel} className="neu-button px-3 py-1.5 text-sm rounded-lg text-gray-400">Cancelar</button>
        <NeuButtonAccent onClick={handleSubmit} disabled={!podeSalvar} className="flex items-center gap-1.5 text-sm">
          {saving ? '…' : <><Save size={13} /> Salvar</>}
        </NeuButtonAccent>
      </div>
    </motion.div>
  );
}

// ── Botões de ação de uma linha ───────────────────────────────────────────────
function AcoesLinha({ ativo, onToggle, onEdit, onDelete }: {
  ativo: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex gap-0.5 shrink-0 pr-1.5">
      <button onClick={onToggle} title={ativo ? 'Desativar (some das listas de produto)' : 'Reativar'}
        className={ativo ? 'action-btn-neutral' : 'action-btn-warning'}>
        {ativo ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
      <button onClick={onEdit} title="Editar"
        className="action-btn-edit">
        <Edit2 size={12} />
      </button>
      <button onClick={onDelete} title="Excluir"
        className="action-btn-delete">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ── Árvore de categorias ──────────────────────────────────────────────────────
// Uma lista só, em árvore (24/09). Antes eram dois painéis: categorias à
// esquerda e, à direita, as subcategorias da categoria CLICADA — o painel
// abria vazio, o aluno salvava "Mercearia" e não havia nada dizendo que o
// passo seguinte era clicar nela para chegar às filhas. Agora a categoria
// abre ali mesmo, com as subcategorias dentro e o campo para criar mais —
// o desenho de árvore de Bling, Tiny e Omie.
function ArvoreCategorias({
  canEdit, abertas, onAlternar, onAbrir, filial, data, isLoading, error, reload,
  subsPorCategoria, subsError, showToast,
}: {
  canEdit: boolean; abertas: Set<string>;
  onAlternar: (id: string) => void; onAbrir: (id: string) => void;
  filial: FilialOp | null;
  data: any[]; isLoading: boolean; error: string | null; reload: () => void;
  subsPorCategoria: Record<string, any[]>; subsError: string | null; showToast: any;
}) {
  // Sem esta linha, `confirm` cai no `window.confirm` do navegador — a função
  // global existe, aceita string e devolve boolean, então o TypeScript aprova
  // e o `await` funciona. O sintoma é o diálogo cinza do browser no lugar do
  // modal do app. O hook mora aqui, e não só no componente de fora: `confirm`
  // é resolvido por escopo léxico, não herdado do pai.
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [busca,    setBusca]    = useState('');

  // A busca olha também as subcategorias: procurar "Massas" acha Mercearia.
  const filtradas = useMemo(() => {
    const q = normalizar(busca);
    if (!q) return data;
    return data.filter((c: any) => normalizar(c.nome ?? '').includes(q)
      || (subsPorCategoria[c.id] ?? []).some((sub: any) => normalizar(sub.nome ?? '').includes(q)));
  }, [data, busca, subsPorCategoria]);

  const nomesEmUso = (excetoId?: string) =>
    data.filter((c: any) => c.id !== excetoId).map((c: any) => normalizar(c.nome ?? ''));

  const handleSave = async (f: FormData, novaImagem: File | null, subcategorias: string[]) => {
    if (!filial) return;
    setSaving(true);
    const imagemAntiga = editItem?.imagem_url ?? '';
    const editando = !!editItem;
    try {
      // String vazia vira NULL: "sem markup" é ausência de regra, não zero por
      // cento — zero faria o produto sugerir preço igual ao custo.
      const margem = f.margem_alvo.trim() === '' ? null : Number(f.margem_alvo.replace(',', '.'));
      const base = { nome: f.nome.trim(), cor: f.cor, icone: f.icone, imagem_url: f.imagem_url || null, margem_alvo: margem };
      const salvo = editando
        ? await dbUpdate<any>('categorias_produto', editItem.id, base)
        : await dbInsert<any>('categorias_produto', { ...base, filial });
      const id = salvo?.id ?? editItem?.id ?? null;

      // As filhas digitadas no formulário. Uma a uma e sem abortar: se uma
      // falhar, a categoria e as outras ficam, e o aviso diz qual faltou.
      const falharam: string[] = [];
      if (!editando && id) {
        for (const nome of subcategorias) {
          try {
            await dbInsert<any>('subcategorias_produto', { nome, cor: f.cor, icone: f.icone, categoria_id: id });
          } catch { falharam.push(nome); }
        }
      }
      reload(); setEditItem(null); setShowForm(false);
      // Categoria nova abre: é ali que o aluno continua (as filhas aparecem
      // dentro dela, com o campo para criar mais).
      if (!editando && id) onAbrir(id);
      const criadas = subcategorias.length - falharam.length;
      showToast?.(
        editando ? 'Categoria atualizada.'
          : falharam.length
            ? `Categoria criada, mas ${falharam.length === 1 ? 'a subcategoria' : 'as subcategorias'} ${falharam.join(', ')} não ${falharam.length === 1 ? 'foi criada' : 'foram criadas'} — crie de novo dentro da categoria.`
            : criadas > 0 ? `Categoria criada com ${criadas} subcategoria${criadas > 1 ? 's' : ''}.` : 'Categoria criada.',
        falharam.length ? 'error' : 'success');

      // A partir daqui o cadastro já está no banco. Qualquer coisa que dê
      // errado com a imagem é aviso, não perda: a categoria está salva e o
      // aluno reanexa editando.
      await anexarImagem('categorias_produto', id, novaImagem, imagemAntiga, f.imagem_url, reload, showToast, 'categoria');
    } catch (e: any) {
      // Antes o erro subia e morria como unhandled rejection: o formulário
      // ficava aberto e o usuário não sabia se salvou.
      showToast?.(e?.message ?? 'Não foi possível salvar a categoria.', 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async (item: any) => {
    const n = (subsPorCategoria[item.id] ?? []).length;
    const aviso = n > 0 ? ` As ${n} subcategoria(s) serão removidas e` : ' Os';
    if (!await confirm(`Excluir a categoria "${item.nome}"?${aviso} produtos vinculados perderão a categoria.`)) return;
    try {
      await dbDelete('categorias_produto', item.id);
      // Remove imagem só após confirmar exclusão do registro no DB
      removerImagem(CATEGORIA_IMAGEM_BUCKET, item.imagem_url);
      reload();
      showToast?.('Categoria excluída.', 'success');
    } catch (e: any) {
      showToast?.(e?.message ?? 'Não foi possível excluir a categoria.', 'error');
    }
  };

  const handleToggle = async (item: any) => {
    try {
      await dbUpdate('categorias_produto', item.id, { ativo: !item.ativo });
      reload();
    } catch (e: any) {
      showToast?.(e?.message ?? 'Não foi possível alterar a categoria.', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <FolderTree size={13} className="text-gray-600" /> Categorias e subcategorias
        </p>
        <div className="flex items-center gap-2 flex-1 sm:flex-none justify-end">
          {data.length > 6 && (
            <div className="relative flex-1 sm:w-56">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar categoria ou subcategoria…"
                className="neu-input w-full text-sm pl-8" />
            </div>
          )}
          {canEdit && (
            <NeuButtonAccent onClick={() => { setEditItem(null); setShowForm(true); }} className="text-xs flex items-center gap-1 px-2 py-1">
              <Plus size={12} /> Nova categoria
            </NeuButtonAccent>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showForm && !editItem && (
          <InlineForm titulo="Nova categoria" comMargem comSubcategorias nomesEmUso={nomesEmUso()} initial={{ ...EMPTY }}
            onSave={handleSave} onCancel={() => setShowForm(false)} saving={saving} />
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : filtradas.length === 0 ? (
        <EmptyState
          error={error}
          message={busca
            ? `Nenhuma categoria ou subcategoria com "${busca}".`
            : canEdit
              ? 'Nenhuma categoria ainda — crie a primeira em "Nova categoria".'
              : 'Nenhuma categoria cadastrada nas unidades.'}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtradas.map((cat: any) => {
            const subs = subsPorCategoria[cat.id] ?? [];
            // Buscando, a categoria que casou pela filha abre sozinha — senão a
            // busca achava "Mercearia" e escondia justamente o "Massas".
            const aberta = abertas.has(cat.id) || (!!busca && subs.some((sub: any) => normalizar(sub.nome ?? '').includes(normalizar(busca))));
            if (editItem?.id === cat.id) {
              return (
                <InlineForm key={cat.id}
                  titulo={`Editando "${cat.nome}"`}
                  comMargem
                  nomesEmUso={nomesEmUso(cat.id)}
                  initial={{
                    nome: cat.nome, cor: cat.cor ?? '#6b7280', icone: cat.icone ?? '📦',
                    imagem_url: cat.imagem_url ?? '',
                    margem_alvo: cat.margem_alvo == null ? '' : String(cat.margem_alvo),
                  }}
                  onSave={handleSave} onCancel={() => setEditItem(null)} saving={saving} />
              );
            }
            return (
              <div key={cat.id} className={`rounded-xl overflow-hidden transition-all ${aberta
                ? 'neu-pressed border border-accent/25' : 'neu-flat border border-white/5 hover:border-accent/20'}
                ${!cat.ativo ? 'opacity-50' : ''}`}>
                {/* Linha = <div> com um <button> que abre ao lado dos botões de
                    ação: botão dentro de botão é HTML inválido. */}
                <div className="group relative flex items-center">
                  <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: cat.cor ?? '#6b7280' }} />
                  <button onClick={() => onAlternar(cat.id)} aria-expanded={aberta}
                    title={aberta ? 'Fechar' : 'Abrir as subcategorias'}
                    className="flex-1 min-w-0 flex items-center gap-2.5 pl-4 pr-2 py-2.5 text-left">
                    <ChevronRight size={14}
                      className={`shrink-0 transition-transform ${aberta ? 'rotate-90 text-accent' : 'text-gray-600 group-hover:text-gray-400'}`} />
                    <CatThumb imagem_url={cat.imagem_url} icone={cat.icone} cor={cat.cor} size={34} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm font-semibold text-gray-200 truncate">{cat.nome}</p>
                        {!cat.ativo && (
                          <span className="text-[9px] uppercase tracking-wider font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded shrink-0">
                            Inativa
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-500">
                          {subs.length === 0 ? 'sem subcategorias' : `${subs.length} subcategoria${subs.length > 1 ? 's' : ''}`}
                        </span>
                        {cat.margem_alvo != null && (
                          <span className="text-[10px] text-gray-500" title="Markup-alvo: percentual acrescentado ao custo para sugerir o preço de venda.">· markup {cat.margem_alvo}%</span>
                        )}
                        {!filial && <FilialBadge filial={cat.filial} />}
                      </div>
                    </div>
                  </button>
                  {canEdit && (
                    <AcoesLinha
                      ativo={cat.ativo}
                      onToggle={() => handleToggle(cat)}
                      onEdit={() => { setEditItem(cat); setShowForm(false); }}
                      onDelete={() => handleDelete(cat)} />
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {aberta && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <SubcategoriasDaCategoria categoria={cat} canEdit={canEdit} data={subs}
                        error={subsError} reload={reload} showToast={showToast} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Subcategorias, dentro da categoria aberta ─────────────────────────────────
function SubcategoriasDaCategoria({ categoria, canEdit, data, error, reload, showToast }: {
  categoria: any; canEdit: boolean; data: any[]; error: string | null;
  reload: () => void; showToast: any;
}) {
  const confirm = useConfirm();
  const [editItem, setEditItem] = useState<any | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [nova,     setNova]     = useState('');
  const [criando,  setCriando]  = useState(false);

  const nomesEmUso = (excetoId?: string) =>
    data.filter((sub: any) => sub.id !== excetoId).map((sub: any) => normalizar(sub.nome ?? ''));
  const novaDuplicada = !!nova.trim() && nomesEmUso().includes(normalizar(nova));

  // Criação rápida: só o nome. Ícone e cor vêm da categoria mãe — para o
  // aluno, a subcategoria é o nome; quem quiser personalizar usa o lápis.
  const criar = async () => {
    const nome = nova.trim();
    if (!nome || novaDuplicada || criando) return;
    setCriando(true);
    try {
      await dbInsert<any>('subcategorias_produto', {
        nome, cor: categoria.cor ?? EMPTY.cor, icone: categoria.icone ?? EMPTY.icone, categoria_id: categoria.id,
      });
      setNova('');
      reload();
    } catch (e: any) {
      showToast?.(e?.message ?? 'Não foi possível criar a subcategoria.', 'error');
    } finally { setCriando(false); }
  };

  const handleSave = async (f: FormData, novaImagem: File | null) => {
    if (!editItem) return;
    setSaving(true);
    const imagemAntiga = editItem.imagem_url ?? '';
    try {
      const payload = { nome: f.nome.trim(), cor: f.cor, icone: f.icone, imagem_url: f.imagem_url || null };
      await dbUpdate<any>('subcategorias_produto', editItem.id, payload);
      const id = editItem.id;
      reload(); setEditItem(null);
      showToast?.('Subcategoria atualizada.', 'success');
      await anexarImagem('subcategorias_produto', id, novaImagem, imagemAntiga, f.imagem_url, reload, showToast, 'subcategoria');
    } catch (e: any) {
      showToast?.(e?.message ?? 'Não foi possível salvar a subcategoria.', 'error');
    } finally { setSaving(false); }
  };

  const handleToggle = async (item: any) => {
    try {
      await dbUpdate('subcategorias_produto', item.id, { ativo: !item.ativo });
      reload();
    } catch (e: any) {
      showToast?.(e?.message ?? 'Não foi possível alterar a subcategoria.', 'error');
    }
  };

  const handleDelete = async (item: any) => {
    if (!await confirm(`Excluir a subcategoria "${item.nome}"? Produtos vinculados perderão a subcategoria.`)) return;
    try {
      await dbDelete('subcategorias_produto', item.id);
      removerImagem(CATEGORIA_IMAGEM_BUCKET, item.imagem_url);
      reload();
      showToast?.('Subcategoria excluída.', 'success');
    } catch (e: any) {
      showToast?.(e?.message ?? 'Não foi possível excluir a subcategoria.', 'error');
    }
  };

  return (
    <div className="pl-10 pr-3 pb-3 pt-1 flex flex-col gap-1.5 border-t border-white/5">
      {data.length === 0 && (
        /* `error` repassado: sem ele, uma falha de RLS na consulta de
           subcategorias é indistinguível de "esta categoria não tem nenhuma". */
        error
          ? <EmptyState error={error} message="Não foi possível ler as subcategorias." />
          : <p className="text-[11px] text-gray-500 py-1.5">
              {canEdit
                ? `"${categoria.nome}" ainda não tem subcategorias. Elas refinam a categoria — ex.: Mercearia → Massas, Enlatados.`
                : `"${categoria.nome}" não tem subcategorias.`}
            </p>
      )}

      {data.map((sub: any) => (
        editItem?.id === sub.id ? (
          <InlineForm key={sub.id}
            titulo={`Editando "${sub.nome}"`}
            nomesEmUso={nomesEmUso(sub.id)}
            initial={{
              nome: sub.nome, cor: sub.cor ?? '#6b7280', icone: sub.icone ?? '📦',
              imagem_url: sub.imagem_url ?? '', margem_alvo: '',
            }}
            onSave={handleSave} onCancel={() => setEditItem(null)} saving={saving} />
        ) : (
          <div key={sub.id} className={`relative flex items-center rounded-lg overflow-hidden neu-flat border border-white/5 ${!sub.ativo ? 'opacity-50' : ''}`}>
            <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: sub.cor ?? '#6b7280' }} />
            <div className="flex-1 min-w-0 flex items-center gap-2.5 pl-3.5 pr-2 py-2">
              <CatThumb imagem_url={sub.imagem_url} icone={sub.icone} cor={sub.cor} size={24} />
              <p className="flex-1 text-sm font-medium text-gray-200 truncate">{sub.nome}</p>
              {!sub.ativo && (
                <span className="text-[9px] uppercase tracking-wider font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded shrink-0">
                  Inativa
                </span>
              )}
            </div>
            {canEdit && (
              <AcoesLinha
                ativo={sub.ativo}
                onToggle={() => handleToggle(sub)}
                onEdit={() => setEditItem(sub)}
                onDelete={() => handleDelete(sub)} />
            )}
          </div>
        )
      ))}

      {canEdit && (
        <div className="flex items-center gap-2 mt-1">
          <div className="relative flex-1">
            <Plus size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
            <input value={nova} onChange={e => setNova(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void criar(); } }}
              placeholder={`Nova subcategoria de ${categoria.nome}…`}
              className={`neu-input w-full text-sm pl-8 ${novaDuplicada ? 'border border-red-500/40' : ''}`} />
          </div>
          <button type="button" onClick={() => void criar()} disabled={!nova.trim() || novaDuplicada || criando}
            className="neu-button px-3 py-2 rounded-lg text-xs font-bold text-accent disabled:opacity-40">
            {criando ? '…' : 'Adicionar'}
          </button>
        </div>
      )}
      {novaDuplicada && (
        <span className="text-[10px] text-red-400">Já existe "{nova.trim()}" nesta categoria.</span>
      )}
    </div>
  );
}

// ── View principal ────────────────────────────────────────────────────────────
const CategoriasProdutoViewInner = ({ showToast, filial }: {
  showToast: any; filial: FilialOp | null;
}) => {
  // Categorias abertas na árvore. Várias ao mesmo tempo: comparar duas linhas
  // de produto lado a lado é o caso comum ao organizar o catálogo.
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const alternar = (id: string) => setAbertas(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const abrir = (id: string) => setAbertas(prev => new Set(prev).add(id));

  // Matriz (filial null) vê o consolidado de todas as unidades, só leitura.
  const cats = useFetchData<any>('categorias_produto', filial ? { filial } : undefined, false,
    { orderBy: 'nome', ascending: true });
  // Subcategorias carregam de uma vez só: alimentam a árvore e a contagem com
  // uma única ida ao servidor, e um único `reload` mantém tudo em sincronia.
  const subs = useFetchData<any>('subcategorias_produto', undefined, false,
    { orderBy: 'nome', ascending: true });

  // `subcategorias_produto` não tem coluna `filial` — ela herda a unidade pela
  // categoria mãe. A consulta vem sem filtro, então precisa ser recortada aqui
  // pelas categorias visíveis: sem isso o contador do cabeçalho somava as
  // subcategorias das outras unidades enquanto a tela mostrava uma só.
  const subsVisiveis = useMemo(() => {
    const ids = new Set(cats.data.map((c: any) => c.id));
    return subs.data.filter((s: any) => ids.has(s.categoria_id));
  }, [subs.data, cats.data]);

  const subsPorCategoria = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const s of subsVisiveis) (m[s.categoria_id] ??= []).push(s);
    return m;
  }, [subsVisiveis]);

  // Qualquer colaborador com acesso ao módulo Empresa gerencia as categorias
  // da própria filial. Matriz continua só-leitura (consolidado, sem filial).
  const canEdit = !!filial;

  const totalInativas = cats.data.filter((c: any) => !c.ativo).length;

  const recarregarTudo = () => { cats.reload(); subs.reload(); };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Categorias{filial ? ` — ${filial}` : ' — Consolidado'}</h1>
        </div>
        <div className="flex items-center gap-4 shrink-0 neu-flat border border-white/5 rounded-xl px-4 py-2.5">
          <div className="text-center">
            <p className="text-xl font-black text-accent tabular-nums leading-none">{cats.data.length}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Categorias</p>
          </div>
          <div className="w-px h-8 bg-white/5" />
          <div className="text-center">
            <p className="text-xl font-black text-gray-300 tabular-nums leading-none">{subsVisiveis.length}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Subcategorias</p>
          </div>
          {totalInativas > 0 && (
            <>
              <div className="w-px h-8 bg-white/5" />
              <div className="text-center">
                <p className="text-xl font-black text-amber-400 tabular-nums leading-none">{totalInativas}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Inativas</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="neu-flat border border-white/5 rounded-xl p-4">
        <ArvoreCategorias
          canEdit={canEdit} abertas={abertas} onAlternar={alternar} onAbrir={abrir} filial={filial}
          data={cats.data} isLoading={cats.isLoading} error={cats.error} reload={recarregarTudo}
          subsPorCategoria={subsPorCategoria} subsError={subs.error} showToast={showToast} />
      </div>
    </motion.div>
  );
};

export const CategoriasProdutoView = ({ showToast }: { profile?: any; showToast: any }) => {
  const { filialAtiva } = useFilial();
  return <CategoriasProdutoViewInner showToast={showToast} filial={filialAtiva} />;
};
