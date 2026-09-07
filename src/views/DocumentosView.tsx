// Documentos — mão única da Matriz para as unidades (migr. 476).
//
// O professor (role='admin') publica um arquivo — PDF, Word ou imagem (PNG,
// JPG, WEBP); todo mundo lê. PDF e imagem abrem na própria tela pelo botão
// "Ver" (VisualizadorDocumento); Word só baixa, porque o navegador não desenha
// .docx e converter seria outra promessa.
// Aluno não sobe nada, e isso não depende desta tela: a RLS e as policies do
// bucket recusam INSERT de quem não é admin. O que muda aqui é só o que
// aparece — esconder botão que o banco já barra evita erro de permissão na
// cara do aluno, não é a trava.
//
// Um arquivo por documento, no formato que o professor escolher. Não há
// conversão de docx para PDF nem o contrário: prometer isso seria mentir, e o
// aluno aprenderia errado o que é "o documento oficial".

import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Upload, Download, Trash2, Pencil, X, Building2, Loader2, Check, Info, Send, FileClock,
  ChevronDown, ImageIcon, Eye,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDataHoraBR } from '../lib/dates';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FilialBadge } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { useFilial } from '../contexts/FilialContext';
import { useDocumentos, baixarDocumento, podeVisualizar, ehRascunho, type Documento } from '../hooks/useDocumentos';
import { VisualizadorDocumento } from '../components/VisualizadorDocumento';
import type { UserProfile } from '../hooks/useUserProfile';

const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialAlvo = (typeof FILIAIS)[number];

// Logos das unidades, os mesmos arquivos do seletor de filial (512x512, os três
// quadrados — a versão larga do SuperMax fica com o emblema minúsculo dentro de
// um quadrado pequeno).
//
// Sobre um losango escuro, e não solto na aba: as três artes foram desenhadas
// para fundo preto e a MaxLook escreve "LOOK" em branco — no tema claro ela
// perderia metade do nome. O losango dá o mesmo chão nos dois temas.
const FILIAL_LOGO: Record<FilialAlvo, string> = {
  SuperMax: '/icon-supermax-view.png',
  MaxLook:  '/icon-maxlook.png',
  TechMax:  '/icon-techmax.png',
};

// Imagem entrou porque metade do que a Matriz manda é foto: o cartaz da
// campanha, o print do procedimento, a planta do layout da loja. Sem isso a
// única saída era colar dentro de um .docx, e o aluno recebia um Word de uma
// página só para ver uma figura.
const MIMES_ACEITOS = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/png',
  'image/jpeg',
  'image/webp',
];
const TETO_BYTES = 10 * 1024 * 1024;

// `File.type` vem do registro do sistema operacional, não do conteúdo — em
// máquina sem Office instalado ele volta vazio para .docx. Confiar só nele
// rejeitaria arquivo legítimo, e mandar string vazia no upload faria o bucket
// recusar (ele valida `allowed_mime_types`). A extensão é o desempate.
const MIME_POR_EXTENSAO: Record<string, string> = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  png:  'image/png',
  // `.jpg` e `.jpeg` são o MESMO tipo: o bucket só conhece 'image/jpeg', e
  // mandar 'image/jpg' (que alguns sistemas reportam) faria o upload voltar
  // recusado por causa da extensão que a pessoa escolheu.
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const EH_IMAGEM = (mime?: string | null) => String(mime ?? '').startsWith('image/');

function mimeDoArquivo(f: File): string | null {
  if (MIMES_ACEITOS.includes(f.type)) return f.type;
  const ext = f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase();
  return MIME_POR_EXTENSAO[ext] ?? null;
}

function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf('.');
  return i > 0 ? nome.slice(i + 1).toUpperCase() : 'ARQUIVO';
}

function tamanhoLegivel(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Nome de arquivo dentro do bucket: sem acento, sem espaço, com carimbo de
// tempo. O nome bonito que o aluno vê no download vem de `arquivo_nome`.
function pathSeguro(nome: string): string {
  // NFD separa "ó" em "o" + acento; `\p{M}` joga fora só o acento. Sem esse
  // passo o filtro seguinte trocaria o acento solto por hífen e "relatório"
  // viraria "relato-rio" em vez de "relatorio".
  const limpo = nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);
  return `${Date.now()}-${limpo}`;
}

// ── Modal: rascunho / publicar / editar ────────────────────────────────────
//
// Duas saídas em vez de uma (migr. 513). "Salvar rascunho" guarda o documento
// pronto e calado — nenhuma unidade fica sabendo. "Publicar" é o clique que o
// manda embora. Preparar o material da semana e escolher a hora de soltá-lo
// são duas decisões, e antes elas cabiam no mesmo botão.
//
// ─── O QUE A EDIÇÃO DEIXA MEXER ─────────────────────────────────────────────
//
// Enquanto é RASCUNHO, tudo — inclusive o arquivo: ninguém viu, não há
// confirmação de leitura para invalidar.
//
// Depois de PUBLICADO, só o que está escrito (título, descrição, quem recebe).
// O arquivo não se troca, e isso é decisão, não falta: quem já clicou em
// "Recebi" continuaria confirmado sobre um arquivo que mudou embaixo dele.
// Trocar o arquivo de um documento no ar é excluir e publicar de novo — aí a
// leitura recomeça do zero porque a linha é outra.
function ModalDocumento({
  profile, doc, filialAtiva, onClose, onSaved, showToast, publicarDoc,
}: {
  profile: UserProfile | null; doc: Documento | null; filialAtiva: string | null;
  onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
  publicarDoc: (id: string) => Promise<{ error?: string }>;
}) {
  const editando = !!doc;
  // Rascunho é o estado editável de verdade. Publicado só aceita retoque de
  // texto — vide o cabeçalho.
  const rascunho = !doc || ehRascunho(doc);
  const [titulo, setTitulo] = useState(doc?.titulo ?? '');
  const [descricao, setDescricao] = useState(doc?.descricao ?? '');
  // Documento novo nasce mirando a unidade em que se está — senão ele sumiria
  // da lista assim que fosse salvo, porque a tela só mostra a filial ativa.
  // Em modo Matriz continua "Todas as unidades".
  // Migr. 528: o gerente emite para a própria unidade, e só. O destino nasce
  // travado nela porque a RLS recusa qualquer outro — deixar o select aberto
  // seria oferecer "Todas as unidades" para quem vai levar 42501 ao salvar.
  const ehGerenteEmissor = profile?.role === 'gerente';
  const filialDoEmissor = String(profile?.filial ?? '');
  const [filialAlvo, setFilialAlvo] = useState(
    ehGerenteEmissor ? (doc?.filial_alvo ?? filialDoEmissor)
                     : (doc?.filial_alvo ?? filialAtiva ?? ''));
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [mime, setMime] = useState('');
  const [salvando, setSalvando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const escolher = (f: File | null) => {
    if (!f) { setArquivo(null); setMime(''); return; }
    const tipo = mimeDoArquivo(f);
    if (!tipo) {
      showToast('Formato não aceito. Envie PDF, Word (.docx / .doc) ou imagem (PNG, JPG, WEBP).', 'error');
      return;
    }
    if (f.size > TETO_BYTES) {
      showToast(`Arquivo de ${tamanhoLegivel(f.size)} — o teto é 10 MB.`, 'error');
      return;
    }
    setArquivo(f);
    setMime(tipo);
    if (!titulo.trim()) setTitulo(f.name.replace(/\.[^.]+$/, ''));
  };

  // Um caminho só para os dois botões: `irAoAr` decide se, depois de gravado, o
  // documento sai da gaveta. Duas funções separadas duplicariam o upload e a
  // limpeza do bucket, e é sempre uma das duas cópias que fica pra trás.
  //
  // A linha SEMPRE nasce rascunho, mesmo no clique de "Publicar": quem carimba
  // `publicado_em` é a RPC, com a hora do banco. Deixar o cliente mandar a data
  // no INSERT poria a hora do navegador — errada ou mentirosa — no que a fila
  // de não-lidos usa pra dizer "chegou agora".
  const salvar = async (irAoAr: boolean) => {
    if (!supabase) return;
    if (!titulo.trim()) { showToast('Dê um título ao documento.', 'error'); return; }
    if (!editando && !arquivo) { showToast('Escolha o arquivo.', 'error'); return; }

    setSalvando(true);
    // Só existe quando há arquivo novo (documento novo, ou troca em rascunho).
    let pathNovo: string | null = null;
    try {
      if (arquivo) {
        pathNovo = pathSeguro(arquivo.name);
        const { error: upErro } = await supabase.storage
          .from('documentos')
          .upload(pathNovo, arquivo, { contentType: mime, upsert: false });
        if (upErro) throw upErro;
      }

      const texto = {
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        filial_alvo: filialAlvo || null,
      };
      const doArquivo = arquivo && pathNovo ? {
        arquivo_path: pathNovo,
        arquivo_nome: arquivo.name,
        arquivo_mime: mime,
        arquivo_tamanho: arquivo.size,
      } : {};

      let id: string;
      if (editando) {
        const { error } = await supabase.from('documentos')
          .update({ ...texto, ...doArquivo }).eq('id', doc!.id);
        if (error) throw error;
        id = doc!.id;
        // Arquivo antigo do rascunho vira lixo inalcançável assim que a linha
        // aponta pro novo — a policy de leitura resolve pelo `arquivo_path`.
        // Só depois do UPDATE dar certo: apagar antes deixaria o documento sem
        // arquivo se o banco recusasse.
        if (arquivo && doc!.arquivo_path !== pathNovo) {
          await supabase.storage.from('documentos').remove([doc!.arquivo_path]);
        }
      } else {
        const { data, error } = await supabase.from('documentos').insert({
          ...texto, ...doArquivo,
          publicado_por: profile?.id ?? null,
          publicado_por_nome: profile?.nome ?? null,
        }).select('id').single();
        // Linha recusada com arquivo já no bucket deixaria lixo que ninguém
        // alcança. Limpa antes de sair.
        if (error || !data) {
          if (pathNovo) await supabase.storage.from('documentos').remove([pathNovo]);
          throw error ?? new Error('Não foi possível gravar o documento.');
        }
        id = (data as any).id as string;
      }

      if (irAoAr) {
        const { error } = await publicarDoc(id);
        // O documento está gravado; o que falhou foi só o carimbo. Dizer
        // "erro ao publicar" e sumir com a tela faria o professor achar que
        // perdeu o trabalho — ele está lá, como rascunho, esperando o botão.
        if (error) {
          showToast(`Salvo como rascunho, mas não foi ao ar: ${error}`, 'error');
          onSaved(); onClose();
          return;
        }
      }

      showToast(
        irAoAr
          ? 'Documento publicado — já está nas unidades.'
          : 'Rascunho salvo. Ele só vai para as unidades quando você publicar.',
        'success',
      );
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error');
    } finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-100">
            {!editando ? 'Novo Documento' : rascunho ? 'Editar Rascunho' : 'Editar Documento'}
          </h2>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Título *</label>
          <input
            type="text" value={titulo} onChange={e => setTitulo(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
            placeholder="Ex.: Regulamento interno 2026"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Descrição</label>
          <textarea
            value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="O que é e o que a equipe deve fazer com ele."
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Quem recebe</label>
          {ehGerenteEmissor ? (
            <>
              <div className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100">
                Somente {filialDoEmissor || '—'}
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                A equipe da sua unidade. Documento para todas as unidades é da Matriz.
              </p>
            </>
          ) : (
            <select
              value={filialAlvo} onChange={e => setFilialAlvo(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
            >
              <option value="">Todas as unidades</option>
              {FILIAIS.map(f => <option key={f} value={f}>Somente {f}</option>)}
            </select>
          )}
        </div>

        {editando && !rascunho ? (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Arquivo</label>
            <div className="neu-pressed rounded-xl px-3 py-3 text-sm text-gray-400 flex items-center gap-2">
              <FileText size={14} className="text-accent shrink-0" />
              <span className="truncate">{doc!.arquivo_nome}{doc!.arquivo_tamanho ? ` · ${tamanhoLegivel(doc!.arquivo_tamanho)}` : ''}</span>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              O arquivo não se troca depois de publicado — quem já confirmou a leitura continuaria
              confirmado sobre outro conteúdo. Para trocar, exclua e publique de novo.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Arquivo {editando ? '' : '* '}(PDF, Word ou imagem, até 10 MB)
            </label>
            <input
              ref={inputRef} type="file" className="hidden"
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,image/png,image/jpeg,image/webp"
              onChange={e => escolher(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => inputRef.current?.click()}
              className="neu-pressed rounded-xl px-3 py-3 text-sm text-gray-300 flex items-center gap-2 hover:text-gray-100"
            >
              <Upload size={14} className="text-accent shrink-0" />
              <span className="truncate">
                {arquivo
                  ? `${arquivo.name} · ${tamanhoLegivel(arquivo.size)}`
                  : editando
                    ? `${doc!.arquivo_nome} — clique para trocar`
                    : 'Escolher arquivo…'}
              </span>
            </button>
            {editando && (
              <p className="text-[10px] text-gray-500 mt-1">
                Ainda é rascunho: ninguém recebeu, então dá para trocar o arquivo.
              </p>
            )}
          </div>
        )}

        {/* Salvar mirando outra unidade tira o documento da lista na hora: a
            tela mostra só a filial aberta. Dizer antes evita o "sumiu". */}
        {filialAtiva && filialAlvo && filialAlvo !== filialAtiva && (
          <p className="text-[10px] text-amber-300/80 leading-snug">
            Você está operando a {filialAtiva} e este documento é só da {filialAlvo} — depois de salvar
            ele sai desta lista. Troque a unidade no topo, ou vá para a Matriz, para encontrá-lo.
          </p>
        )}

        {editando && !rascunho ? (
          <NeuButtonAccent onClick={() => salvar(false)} isLoading={salvando}>
            Salvar alterações
          </NeuButtonAccent>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => salvar(false)}
                disabled={salvando}
                className="flex-1 neu-button rounded-xl px-3 py-3 text-xs font-black uppercase tracking-widest text-gray-300 hover:text-gray-100 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {salvando ? <Loader2 size={13} className="animate-spin" /> : <FileClock size={13} />}
                Salvar rascunho
              </button>
              <div className="flex-1">
                <NeuButtonAccent onClick={() => salvar(true)} isLoading={salvando}>
                  Publicar
                </NeuButtonAccent>
              </div>
            </div>
            <p className="text-[10px] text-gray-500 text-center">
              O rascunho fica só com você. Publicar é o que manda para as unidades.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── View ───────────────────────────────────────────────────────────────────
export const DocumentosView = ({ showToast, profile }: { showToast: any; profile: UserProfile | null }) => {
  const { documentos: todos, naoLidos: naoLidosTodos, loading, marcarLido, publicar, recarregar } = useDocumentos(profile);
  const { filialAtiva } = useFilial();
  // null = fechado · 'novo' = publicar · Documento = editando aquele.
  const [modal, setModal] = useState<'novo' | Documento | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  // Descrição fica recolhida até o clique. No celular a coluna de texto tem
  // uns 110px (o ícone do arquivo e os botões comem o resto da largura), e um
  // parágrafo ali vira uma tira estreita de dez linhas — o card do documento
  // seguinte some da tela. Um por vez: abrir o segundo fecha o primeiro, senão
  // a lista volta a crescer sozinha.
  const [descricaoAberta, setDescricaoAberta] = useState<string | null>(null);
  // Documento aberto no visor (PDF/imagem). Fica aqui, e não dentro do card,
  // porque o visor é tela cheia: montá-lo por linha faria N overlays dormindo.
  const [vendo, setVendo] = useState<Documento | null>(null);
  const confirm = useConfirm();

  // Publicar deixou de ser só do professor (migr. 528): o gerente emite para a
  // equipe da unidade dele — escala, procedimento de caixa, roteiro de
  // inventário. CEO e conselheiro continuam de fora: são alunos, e o banco já
  // recusa; aqui só não se oferece o botão (vide comentário no topo).
  const ehAdmin  = profile?.role === 'admin';
  const ehGerente = profile?.role === 'gerente';
  const podePublicar = ehAdmin || ehGerente;
  // O gerente publica só na unidade dele, e nunca em "todas" — é o que a RLS
  // impõe. E mexe só no que ele mesmo criou: oferecer os botões no documento
  // do professor seria oferecer um caminho que termina em erro.
  const minhaFilial = String(profile?.filial ?? '');
  const podeMexer = (d: Documento) => ehAdmin || (ehGerente && d.publicado_por === profile?.id);

  // A tela mostra a unidade em que se está operando, e só ela. O admin vê os
  // documentos das tres unidades porque a RLS nao o recorta — mas ler tudo
  // junto enquanto se opera a SuperMax e' o mesmo erro de sempre: o nicho do
  // topbar tem que valer aqui. Documento sem alvo ("Todas as unidades") chega
  // na filial ativa tambem, entao continua na lista.
  // Em modo Matriz (filialAtiva === null) o consolidado e' o certo: mostra tudo.
  const dentroDaFilial = (d: Documento) =>
    !filialAtiva || !d.filial_alvo || d.filial_alvo === filialAtiva;
  const documentos = useMemo(() => todos.filter(dentroDaFilial), [todos, filialAtiva]);
  const naoLidos = useMemo(() => naoLidosTodos.filter(dentroDaFilial), [naoLidosTodos, filialAtiva]);
  const idsNaoLidos = useMemo(() => new Set(naoLidos.map(d => d.id)), [naoLidos]);

  // ── Abas por unidade ────────────────────────────────────────────────────
  //
  // Só em modo Matriz: operando dentro de uma unidade a lista já é de uma
  // unidade só, e três abas em que duas nunca têm nada seria mobília.
  //
  // Documento sem alvo aparece nas TRÊS, e não numa quarta aba de "geral": ele
  // de fato chega nas três, e uma aba separada faria a SuperMax parecer não ter
  // recebido o que recebeu. O selo "Todas as unidades" na linha diz que aquela
  // cópia é a mesma nas outras duas.
  const mostrarAbas = !filialAtiva;
  const [aba, setAba] = useState<FilialAlvo>(FILIAIS[0]);
  const daAba = (d: Documento, f: FilialAlvo) => !d.filial_alvo || d.filial_alvo === f;
  const visiveis = useMemo(
    () => (mostrarAbas ? documentos.filter(d => daAba(d, aba)) : documentos),
    [documentos, mostrarAbas, aba],
  );
  // Contagem por aba: o que a unidade recebe (dela + sem alvo). O segundo
  // número é o que ainda espera decisão do professor — é por ele que se escolhe
  // a aba, não pelo total.
  // O que "pendente" quer dizer muda com o papel: para o professor é rascunho
  // esperando publicação; para quem lê (CEO e conselheiro enxergam as três) é
  // documento sem confirmação de leitura. É esse número que acende o ponto na
  // aba — o total de documentos a própria lista já mostra.
  const contagem = useMemo(() => Object.fromEntries(FILIAIS.map(f => [f, {
    rascunhos: documentos.filter(d => daAba(d, f) && ehRascunho(d)).length,
    novos: naoLidos.filter(d => daAba(d, f)).length,
  }])) as Record<FilialAlvo, { rascunhos: number; novos: number }>,
  [documentos, naoLidos]);

  // Ver conta como ter recebido, igual a baixar: os dois querem dizer que a
  // pessoa abriu o arquivo. Confirmar a leitura ("Recebi") continua sendo um
  // clique à parte — ver é ter olhado, confirmar é assumir que leu.
  const ver = (doc: Documento) => {
    setVendo(doc);
    if (idsNaoLidos.has(doc.id)) marcarLido(doc.id);
  };

  const baixar = async (doc: Documento) => {
    setBaixando(doc.id);
    const { error, sumiu } = await baixarDocumento(doc);
    setBaixando(null);
    if (error) {
      showToast(error, 'error');
      // Sumiu do bucket = sumiu do sistema. Relê a lista pra tirar da tela o
      // que já não existe, em vez de deixar o aluno clicando de novo.
      if (sumiu) recarregar();
      return;
    }
    if (idsNaoLidos.has(doc.id)) marcarLido(doc.id);
  };

  // Publicar é o clique que manda o documento embora — e não tem volta (o
  // gatilho da migr. 513 recusa despublicar). Por isso confirma antes, dizendo
  // exatamente quem vai receber.
  const publicarAgora = async (doc: Documento) => {
    const alvo = doc.filial_alvo ?? 'todas as unidades';
    const ok = await confirm({
      message: `Publicar "${doc.titulo}"? Ele chega agora em ${alvo} e passa a cobrar confirmação de leitura. Publicado não volta a ser rascunho.`,
      confirmLabel: 'Publicar',
    });
    if (!ok) return;
    const { error } = await publicar(doc.id);
    showToast(error ?? 'Documento publicado — já está nas unidades.', error ? 'error' : 'success');
  };

  const excluir = async (doc: Documento) => {
    const ok = await confirm({
      message: ehRascunho(doc)
        ? `Excluir o rascunho "${doc.titulo}"? Ele nunca foi publicado, então nenhuma unidade fica sabendo — o arquivo sai do sistema.`
        : `Excluir "${doc.titulo}"? Ele some na hora da tela de todas as unidades e o arquivo sai do sistema — ninguém mais consegue baixar.`,
      danger: true,
    });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('documentos').delete().eq('id', doc.id);
    if (error) { showToast(error.message, 'error'); return; }
    await supabase.storage.from('documentos').remove([doc.arquivo_path]);
    showToast('Documento excluído.', 'success');
    recarregar();
  };

  if (loading) return <LoadingSpinner />;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-5 pb-16"
    >
      <div className="neu-flat rounded-3xl p-5 border border-accent/20 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText size={14} className="text-accent" />
            <h1 className="text-sm font-black uppercase tracking-widest text-gray-100">Documentos</h1>
          </div>
          <p className="text-xs text-gray-500">
            {ehAdmin
              ? 'Deixe pronto como rascunho e publique quando quiser — aí chega nas unidades e o sistema registra quem leu.'
              : ehGerente
                ? 'Publique para a equipe da sua unidade e veja quem leu. O que a Matriz enviar aparece aqui também, para você baixar e confirmar.'
                : 'Documentos enviados pela Matriz. Baixe e confirme a leitura.'}
          </p>
        </div>
        {podePublicar && (
          <button
            onClick={() => setModal('novo')}
            className="neu-button rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-widest text-accent flex items-center gap-2"
          >
            <Upload size={14} /> Novo documento
          </button>
        )}
      </div>

      {mostrarAbas && (
        <div className="flex gap-2 flex-wrap shrink-0">
          {FILIAIS.map(f => {
            const ativa = f === aba;
            // Um sinal só, e sem número: o ponto diz "tem algo seu aqui" — o
            // que é, a lista da aba mostra em duas linhas. Dois contadores lado
            // a lado só faziam a pessoa parar para decifrar qual era qual.
            const pendente = podePublicar ? contagem[f].rascunhos : contagem[f].novos;
            return (
              <button
                key={f}
                onClick={() => setAba(f)}
                title={pendente > 0
                  ? `${pendente} ${podePublicar ? 'rascunho(s) esperando publicação' : 'documento(s) sem confirmação de leitura'}`
                  : undefined}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  ativa ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="w-7 h-7 rounded-lg bg-black/70 flex items-center justify-center shrink-0 overflow-hidden">
                  <img src={FILIAL_LOGO[f]} alt="" aria-hidden className="w-full h-full object-contain p-0.5" />
                </span>
                {f}
                {pendente > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {podePublicar && visiveis.some(ehRascunho) && (
        <div className="neu-flat rounded-2xl p-4 border border-gray-500/25 flex items-start gap-2 text-xs text-gray-400">
          <FileClock size={13} className="shrink-0 mt-0.5" />
          <span>
            {visiveis.filter(ehRascunho).length === 1
              ? `Há 1 rascunho guardado para a ${filialAtiva ?? aba} — ela ainda não o recebeu.`
              : `Há ${visiveis.filter(ehRascunho).length} rascunhos guardados para a ${filialAtiva ?? aba} — ela ainda não os recebeu.`}
          </span>
        </div>
      )}

      {/* Migr. 528: o gerente publica E recebe. Amarrar este aviso a
          `!podePublicar` o faria sumir justamente para quem tem as duas
          caixas — e o que a Matriz manda continua esperando confirmação. */}
      {!ehAdmin && naoLidos.length > 0 && (
        <div className="neu-flat rounded-2xl p-4 border border-amber-400/25 flex items-start gap-2 text-xs text-amber-200">
          <Info size={13} className="shrink-0 mt-0.5" />
          <span>
            {naoLidos.length === 1
              ? 'Há 1 documento novo que você ainda não confirmou.'
              : `Há ${naoLidos.length} documentos novos que você ainda não confirmou.`}
          </span>
        </div>
      )}

      {visiveis.length === 0 ? (
        <EmptyState message={`Nenhum documento para a ${filialAtiva ?? aba} ainda.`} />
      ) : (
        <div className="flex flex-col gap-2">
          {visiveis.map(doc => {
            const novo = idsNaoLidos.has(doc.id);
            const draft = ehRascunho(doc);
            return (
              <div
                key={doc.id}
                className={`neu-flat rounded-2xl p-4 border flex flex-col gap-3 ${
                  draft ? 'border-dashed border-gray-500/40' : novo ? 'border-amber-400/30' : 'border-white/5'
                }`}
              >
                {/* `flex-wrap` + `w-full` nos botões: no celular a fileira de
                    ações desce para uma linha só dela. Sem isto o bloco de
                    botões é `shrink-0` e a coluna do meio é quem cede — com
                    rascunho são quatro botões (Baixar, Publicar, editar,
                    excluir), o título desaparecia e a data quebrava uma
                    palavra por linha. No desktop nada muda: `sm:w-auto`
                    devolve os botões para a mesma linha. */}
                <div className="flex items-start gap-3 flex-wrap">
                  {/* Ícone de imagem quando é imagem: com a extensão embaixo em
                      8px, uma folha de papel escrita "PNG" faz o olho ler
                      documento de texto. */}
                  <div className="w-11 h-11 rounded-2xl neu-pressed flex flex-col items-center justify-center shrink-0">
                    {EH_IMAGEM(doc.arquivo_mime)
                      ? <ImageIcon size={15} className="text-accent" />
                      : <FileText size={15} className="text-accent" />}
                    <span className="text-[8px] font-black text-gray-500 mt-0.5">{extensaoDe(doc.arquivo_nome)}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Com descrição, o título inteiro é o botão que a revela —
                          alvo grande de toque, em vez de um ícone de 12px. Sem
                          descrição continua sendo texto puro: botão que não faz
                          nada ensina o aluno a desconfiar do clique. */}
                      {doc.descricao ? (
                        <button
                          type="button"
                          onClick={() => setDescricaoAberta(id => id === doc.id ? null : doc.id)}
                          aria-expanded={descricaoAberta === doc.id}
                          title={descricaoAberta === doc.id ? 'Ocultar descrição' : 'Ver descrição'}
                          className="group flex items-center gap-1.5 min-w-0 text-left"
                        >
                          <h3 className={`text-sm font-bold truncate ${draft ? 'text-gray-400' : 'text-gray-100'}`}>{doc.titulo}</h3>
                          <Info
                            size={12}
                            className={`shrink-0 transition-colors ${
                              descricaoAberta === doc.id ? 'text-accent' : 'text-gray-500 group-hover:text-accent'
                            }`}
                          />
                          <ChevronDown
                            size={12}
                            className={`shrink-0 text-gray-500 transition-transform ${
                              descricaoAberta === doc.id ? 'rotate-180 text-accent' : ''
                            }`}
                          />
                        </button>
                      ) : (
                        <h3 className={`text-sm font-bold truncate ${draft ? 'text-gray-400' : 'text-gray-100'}`}>{doc.titulo}</h3>
                      )}
                      {draft && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-gray-500/15 text-gray-400 border border-gray-500/30 flex items-center gap-1">
                          <FileClock size={9} /> Rascunho
                        </span>
                      )}
                      {novo && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30">
                          Novo
                        </span>
                      )}
                      {doc.filial_alvo ? <FilialBadge filial={doc.filial_alvo} /> : (
                        <span className="text-[10px] text-gray-500 flex items-center gap-1">
                          <Building2 size={10} /> Todas as unidades
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      {/* Publicado mostra QUANDO foi ao ar, não quando o arquivo
                          subiu — é a data que a unidade usa pra saber se está
                          atrasada. Rascunho mostra desde quando está guardado. */}
                      {draft
                        ? `Criado em ${formatDataHoraBR(doc.created_at)}`
                        : formatDataHoraBR(doc.publicado_em ?? doc.created_at)}
                      {doc.publicado_por_nome && ` · ${doc.publicado_por_nome}`}
                      {doc.arquivo_tamanho ? ` · ${tamanhoLegivel(doc.arquivo_tamanho)}` : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 w-full justify-end flex-wrap sm:w-auto sm:flex-nowrap">
                    {/* Ver antes de Baixar: para PDF e imagem, abrir na tela
                        é o que a pessoa quer em nove de dez cliques. Word não
                        ganha o botão — vide `podeVisualizar`. */}
                    {podeVisualizar(doc) && (
                      <button
                        onClick={() => ver(doc)}
                        title={`Ver ${extensaoDe(doc.arquivo_nome)} sem baixar`}
                        className="neu-button rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5"
                      >
                        <Eye size={13} /> Ver
                      </button>
                    )}
                    <button
                      onClick={() => baixar(doc)}
                      disabled={baixando === doc.id}
                      title={`Baixar ${extensaoDe(doc.arquivo_nome)}`}
                      className="neu-button rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {baixando === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                      Baixar
                    </button>
                    {novo && (
                      <button
                        onClick={() => marcarLido(doc.id)}
                        title="Confirmar leitura"
                        className="neu-button rounded-xl p-2 text-emerald-300"
                      >
                        <Check size={13} />
                      </button>
                    )}
                    {podeMexer(doc) && draft && (
                      <button
                        onClick={() => publicarAgora(doc)}
                        title="Publicar para as unidades"
                        className="neu-button rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-emerald-300 ring-1 ring-emerald-500/40 hover:ring-emerald-400 flex items-center gap-1.5"
                      >
                        <Send size={13} /> Publicar
                      </button>
                    )}
                    {/* Migr. 528: o gerente mexe no que ele mesmo publicou. O
                        documento do professor que caiu na filial dele é de
                        leitura — a RLS recusa, e oferecer o botão seria prometer
                        o que não acontece. */}
                    {podeMexer(doc) && (
                      <>
                        <button onClick={() => setModal(doc)} title={draft ? 'Editar rascunho' : 'Editar informações'} className="action-btn-edit">
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => excluir(doc)} className="action-btn-delete">
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Fora da coluna do meio de propósito: aqui o texto ocupa a
                    largura inteira do card, que era o problema de origem —
                    espremido ao lado dos botões ele virava uma tira estreita. */}
                {doc.descricao && descricaoAberta === doc.id && (
                  <p className="text-[11px] text-gray-400 leading-relaxed whitespace-pre-wrap neu-pressed rounded-xl p-3 border border-white/5">
                    {doc.descricao}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {vendo && (
          <VisualizadorDocumento
            key={vendo.id}
            doc={vendo}
            onClose={() => setVendo(null)}
            showToast={showToast}
            onSumiu={() => { setVendo(null); recarregar(); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modal && (
          <ModalDocumento
            profile={profile}
            doc={modal === 'novo' ? null : modal}
            filialAtiva={filialAtiva}
            onClose={() => setModal(null)}
            onSaved={recarregar}
            showToast={showToast}
            publicarDoc={publicar}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};
