import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Save, Edit2, Trash2, ChevronRight, X, Search,
  Eye, EyeOff, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, FilialBadge, ModalFormulario, CardContador } from '../components/ui';
import { MenuMais, ItemMenu } from '../components/MenuMais';
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

const EMPTY = { nome: '', cor: '#D4AF37', icone: '📦', imagem_url: '' };
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
  // Imagem que não carrega (arquivo apagado do bucket, rede fora) cai no
  // ícone, em vez de deixar um quadrado vazio que parece cadastro sem ícone.
  const [falhou, setFalhou] = useState(false);
  const c = cor ?? '#6b7280';
  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: Math.round(size * 0.28),
    border: `1px solid ${c}55`,
  };
  if (imagem_url && !falhou) {
    return (
      <div style={base} className="overflow-hidden shrink-0">
        <img src={imagem_url} alt="" loading="lazy" onError={() => setFalhou(true)} className="w-full h-full object-cover" />
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
function InlineForm({ initial, onSave, onCancel, saving, comSubcategorias, nomeTravado, nomesEmUso, titulo }: {
  initial: FormData;
  /** Grava o cadastro e, só depois, anexa `novaImagem` — ver handleSubmit.
   *  `subcategorias`: os nomes digitados no campo de etiquetas (categoria nova). */
  onSave: (v: FormData, novaImagem: File | null, subcategorias: string[]) => Promise<void>;
  onCancel: () => void; saving: boolean;
  /** Categoria nova já nasce com as filhas: o campo de etiquetas aparece. */
  comSubcategorias?: boolean;
  /** Linha da lista padrão (migr. 629): o nome não muda — o banco recusa. */
  nomeTravado?: boolean;
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
    <ModalFormulario
      aberto
      titulo={titulo}
      onCancelar={onCancel}
      acoes={
        <NeuButtonAccent onClick={handleSubmit} disabled={!podeSalvar} className="flex items-center gap-1.5 text-sm">
          {saving ? '…' : <><Save size={13} /> Salvar</>}
        </NeuButtonAccent>
      }
    >
      <div
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
        className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start"
      >
        <div className="space-y-4">
          <div className="rounded-xl px-3 py-2.5 flex items-center gap-3"
            style={{ background: `${f.cor}12`, border: `1px solid ${f.cor}33` }}>
            <CatThumb imagem_url={previewUrl} icone={f.icone} cor={f.cor} size={40} />
            <p className="text-sm font-bold text-gray-100 truncate min-w-0">{f.nome.trim() || 'Nome da categoria'}</p>
          </div>

          <FormField label="Nome *" error={duplicado ? 'Já existe um registro com este nome.' : undefined}>
            <input className={`neu-input py-2 px-3 rounded-xl w-full text-sm ${nomeTravado ? 'opacity-60 cursor-not-allowed' : ''}`} value={f.nome}
              readOnly={nomeTravado}
              onChange={e => { if (!nomeTravado) setF(p => ({ ...p, nome: e.target.value })); }}
              placeholder="Ex: Mercearia, Bebidas, Smartphones…" autoFocus={!nomeTravado} />
            {nomeTravado && (
              <span className="text-[10px] text-gray-500">Nome da lista padrão — não muda.</span>
            )}
          </FormField>

          {comSubcategorias && (
            <FormField label="Subcategorias">
              <div className="neu-input w-full flex flex-wrap items-center gap-1.5 !py-1.5">
                {subs.map(nome => (
                  /* A etiqueta inteira é o botão de tirar: alvo maior que o "x"
                     sozinho, e o nome dentro diz o que sai. */
                  <button key={nome} type="button" onClick={() => setSubs(p => p.filter(x => x !== nome))}
                    title={`Tirar "${nome}"`}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md text-gray-200 hover:brightness-125"
                    style={{ background: `${f.cor}1f`, border: `1px solid ${f.cor}55` }}>
                    {nome}
                    <X size={11} className="text-gray-400" />
                  </button>
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
            </FormField>
          )}

          <p className="text-[10px] text-gray-600 hidden sm:block">Enter salva · Esc cancela</p>
        </div>
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
    </ModalFormulario>
  );
}

// ── Botões de ação de uma linha ───────────────────────────────────────────────
// Padrão das listagens: editar à vista, o resto no "⋯". Antes eram o olho, o
// lápis e a lixeira lado a lado — três botões coloridos por linha, 170 linhas.
function AcoesLinha({ ativo, onToggle, onEdit, onDelete }: {
  ativo: boolean; onToggle: () => void; onEdit: () => void;
  /** Ausente na linha da lista padrão: ela não se exclui, só se desativa. */
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-1 shrink-0 pr-1.5">
      <button onClick={onEdit} title="Editar" className="action-btn-edit">
        <Edit2 size={12} />
      </button>
      <MenuMais>
        {fechar => (
          <>
            <ItemMenu icon={ativo ? EyeOff : Eye} cor={ativo ? 'text-amber-400 hover:bg-amber-400/10' : 'text-emerald-400 hover:bg-emerald-400/10'}
              onClick={() => { fechar(); onToggle(); }}>
              {ativo ? 'Inativar (some das listas de produto)' : 'Reativar'}
            </ItemMenu>
            {onDelete ? (
              <ItemMenu icon={Trash2} cor="text-red-400 hover:bg-red-400/10" onClick={() => { fechar(); onDelete(); }}>
                Excluir
              </ItemMenu>
            ) : (
              <p className="px-3 py-1.5 text-[10px] text-gray-500 leading-snug">
                Lista padrão: não se exclui, só se inativa.
              </p>
            )}
          </>
        )}
      </MenuMais>
    </div>
  );
}

// Etiquetas da linha — as mesmas na categoria e na subcategoria.
const EtiquetaPropria = () => (
  <span title="Criada pela unidade — fora da lista padrão"
    className="text-[9px] uppercase tracking-wider font-bold text-sky-300 bg-sky-400/10 px-1.5 py-0.5 rounded shrink-0">
    Própria
  </span>
);
const EtiquetaInativa = () => (
  <span className="text-[9px] uppercase tracking-wider font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded shrink-0">
    Inativa
  </span>
);

type Filtro = 'todas' | 'proprias' | 'inativas';
const casaFiltro = (item: any, filtro: Filtro) =>
  filtro === 'proprias' ? !item.padrao : filtro === 'inativas' ? !item.ativo : true;

// ── Árvore de categorias ──────────────────────────────────────────────────────
// Uma lista só, em árvore (24/09). Antes eram dois painéis: categorias à
// esquerda e, à direita, as subcategorias da categoria CLICADA — o painel
// abria vazio, o aluno salvava "Mercearia" e não havia nada dizendo que o
// passo seguinte era clicar nela para chegar às filhas. Agora a categoria
// abre ali mesmo, com as subcategorias dentro e o campo para criar mais —
// o desenho de árvore de Bling, Tiny e Omie.
function ArvoreCategorias({
  canEdit, abertas, onAlternar, onAbrir, onDefinirAbertas, filtro, filial, data, isLoading, error, reload,
  subsPorCategoria, subsError, showToast,
}: {
  canEdit: boolean; abertas: Set<string>;
  onAlternar: (id: string) => void; onAbrir: (id: string) => void;
  onDefinirAbertas: (ids: string[]) => void;
  /** Recorte dos cards do topo: a categoria entra se ela OU uma filha casa. */
  filtro: Filtro;
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
    return data.filter((c: any) => {
      const filhas = subsPorCategoria[c.id] ?? [];
      if (filtro !== 'todas' && !casaFiltro(c, filtro) && !filhas.some((s: any) => casaFiltro(s, filtro))) return false;
      if (!q) return true;
      return normalizar(c.nome ?? '').includes(q) || filhas.some((sub: any) => normalizar(sub.nome ?? '').includes(q));
    });
  }, [data, busca, filtro, subsPorCategoria]);

  const todasAbertas = filtradas.length > 0 && filtradas.every((c: any) => abertas.has(c.id));

  const nomesEmUso = (excetoId?: string) =>
    data.filter((c: any) => c.id !== excetoId).map((c: any) => normalizar(c.nome ?? ''));

  const handleSave = async (f: FormData, novaImagem: File | null, subcategorias: string[]) => {
    if (!filial) return;
    setSaving(true);
    const imagemAntiga = editItem?.imagem_url ?? '';
    const editando = !!editItem;
    try {
      const base = { nome: f.nome.trim(), cor: f.cor, icone: f.icone, imagem_url: f.imagem_url || null };
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
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar categoria ou subcategoria…"
            className="neu-input w-full text-sm pl-8" />
        </div>
        {filtradas.length > 0 && (
          <button type="button"
            onClick={() => onDefinirAbertas(todasAbertas ? [] : filtradas.map((c: any) => c.id))}
            className="neu-button px-3 py-2 rounded-lg text-xs font-bold text-gray-300 flex items-center gap-1.5">
            {todasAbertas ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            {todasAbertas ? 'Fechar todas' : 'Abrir todas'}
          </button>
        )}
        {canEdit && (
          <NeuButtonAccent onClick={() => { setEditItem(null); setShowForm(true); }} className="text-xs flex items-center gap-1 px-3 py-2">
            <Plus size={13} /> Nova categoria
          </NeuButtonAccent>
        )}
      </div>

      <AnimatePresence>
        {showForm && !editItem && (
          <InlineForm titulo="Nova categoria própria — fora da lista padrão" comSubcategorias nomesEmUso={nomesEmUso()} initial={{ ...EMPTY }}
            onSave={handleSave} onCancel={() => setShowForm(false)} saving={saving} />
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : filtradas.length === 0 ? (
        <EmptyState
          error={error}
          message={busca
            ? `Nenhuma categoria ou subcategoria com "${busca}".`
            : filtro === 'proprias'
              ? 'Nenhuma categoria ou subcategoria própria — tudo aqui é da lista padrão.'
            : filtro === 'inativas'
              ? 'Nenhuma categoria ou subcategoria inativa.'
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
            // O mesmo vale para o filtro: "Inativas" que achou a categoria por
            // uma filha inativa abre para mostrar qual é.
            const aberta = abertas.has(cat.id)
              || (!!busca && subs.some((sub: any) => normalizar(sub.nome ?? '').includes(normalizar(busca))))
              || (filtro !== 'todas' && !casaFiltro(cat, filtro) && subs.some((sub: any) => casaFiltro(sub, filtro)));
            const subsInativas = subs.filter((sub: any) => !sub.ativo).length;
            if (editItem?.id === cat.id) {
              return (
                <InlineForm key={cat.id}
                  titulo={`Editando "${cat.nome}"`}
                  nomeTravado={!!cat.padrao}
                  nomesEmUso={nomesEmUso(cat.id)}
                  initial={{
                    nome: cat.nome, cor: cat.cor ?? '#6b7280', icone: cat.icone ?? '📦',
                    imagem_url: cat.imagem_url ?? '',
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
                    className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-2 py-2.5 text-left">
                    <ChevronRight size={15}
                      className={`shrink-0 transition-transform ${aberta ? 'rotate-90 text-accent' : 'text-gray-600 group-hover:text-gray-400'}`} />
                    <CatThumb imagem_url={cat.imagem_url} icone={cat.icone} cor={cat.cor} size={38} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm font-bold text-gray-100 truncate">{cat.nome}</p>
                        {!cat.padrao && <EtiquetaPropria />}
                        {!cat.ativo && <EtiquetaInativa />}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-[10px] font-semibold text-gray-400 px-1.5 py-0.5 rounded bg-white/5 tabular-nums">
                          {subs.length === 0 ? 'Sem subcategorias' : `${subs.length} subcategoria${subs.length > 1 ? 's' : ''}`}
                        </span>
                        {cat.lucro_alvo != null && (
                          <span title="Lucro líquido desejado, em % do preço de venda. Definido em Financeiro › Precificação."
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums"
                            style={{ color: cat.cor ?? '#9ca3af', background: `${cat.cor ?? '#6b7280'}1a` }}>
                            Lucro {String(cat.lucro_alvo).replace('.', ',')}%
                          </span>
                        )}
                        {subsInativas > 0 && (
                          <span className="text-[10px] font-semibold text-amber-400/80 tabular-nums">
                            {subsInativas} inativa{subsInativas > 1 ? 's' : ''}
                          </span>
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
                      onDelete={cat.padrao ? undefined : () => handleDelete(cat)} />
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
    <div className="pl-4 sm:pl-10 pr-3 pb-3 pt-2.5 flex flex-col gap-2 border-t border-white/5">
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

      {editItem && (
        <InlineForm key={editItem.id}
          titulo={`Editando "${editItem.nome}"`}
          nomeTravado={!!editItem.padrao}
          nomesEmUso={nomesEmUso(editItem.id)}
          initial={{
            nome: editItem.nome, cor: editItem.cor ?? '#6b7280', icone: editItem.icone ?? '📦',
            imagem_url: editItem.imagem_url ?? '',
          }}
          onSave={handleSave} onCancel={() => setEditItem(null)} saving={saving} />
      )}

      {/* Grade em vez de uma linha inteira por subcategoria: são 153 na
          SuperMax, e o nome é curto — a lista corrida empurrava a categoria
          seguinte para fora da tela a cada uma que se abria. */}
      {data.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
          {data.map((sub: any) => (
            <div key={sub.id} className={`relative flex items-center rounded-lg overflow-hidden neu-flat border border-white/5 min-w-0 ${!sub.ativo ? 'opacity-50' : ''}`}>
              <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: sub.cor ?? '#6b7280' }} />
              <div className="flex-1 min-w-0 flex items-center gap-2 pl-3 pr-1 py-1.5">
                <CatThumb imagem_url={sub.imagem_url} icone={sub.icone} cor={sub.cor} size={26} />
                <p className="flex-1 min-w-0 text-[13px] font-medium text-gray-200 truncate" title={sub.nome}>{sub.nome}</p>
                {!sub.padrao && <EtiquetaPropria />}
                {!sub.ativo && <EtiquetaInativa />}
              </div>
              {canEdit && (
                <AcoesLinha
                  ativo={sub.ativo}
                  onToggle={() => handleToggle(sub)}
                  onEdit={() => setEditItem(sub)}
                  onDelete={sub.padrao ? undefined : () => handleDelete(sub)} />
              )}
            </div>
          ))}
        </div>
      )}

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

  // Os contadores contam categoria E subcategoria: "Inativas 0" com uma
  // subcategoria inativa escondida dentro de Açougue mentia para quem procura.
  const todos = [...cats.data, ...subsVisiveis];
  const totalProprias = todos.filter((x: any) => !x.padrao).length;
  const totalInativas = todos.filter((x: any) => !x.ativo).length;

  // Card de filtro: clicar no ativo volta para "todas".
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const alternarFiltro = (f: Filtro) => setFiltro(atual => (atual === f ? 'todas' : f));

  const recarregarTudo = () => { cats.reload(); subs.reload(); };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Categorias{filial ? ` — ${filial}` : ' — Consolidado'}</h1>
        <p className="text-xs text-gray-500 mt-1">
          Lista padrão do mercado, com as categorias próprias da unidade marcadas. Abra uma categoria para ver e criar as subcategorias.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CardContador label="Categorias" value={cats.data.length} tom="dourado"
          onClick={() => setFiltro('todas')} ativo={filtro === 'todas'} />
        <CardContador label="Subcategorias" value={subsVisiveis.length} tom="azul" />
        <CardContador label="Próprias" value={totalProprias} tom="roxo" sub="fora da lista padrão"
          onClick={() => alternarFiltro('proprias')} ativo={filtro === 'proprias'} />
        <CardContador label="Inativas" value={totalInativas} tom="amarelo" sub="fora das listas de produto"
          onClick={() => alternarFiltro('inativas')} ativo={filtro === 'inativas'} />
      </div>

      <div className="neu-flat border border-white/5 rounded-xl p-4">
        <ArvoreCategorias
          canEdit={canEdit} abertas={abertas} onAlternar={alternar} onAbrir={abrir}
          onDefinirAbertas={ids => setAbertas(new Set(ids))} filtro={filtro} filial={filial}
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
