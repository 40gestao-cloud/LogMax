// Contratos entre unidades (migr. 623).
//
// Filial com Matriz, filial com filial. Quem fala por uma filial é o gerente
// dela; pela Matriz, o professor. CEO e conselheiro acompanham em leitura.
//
// O ciclo: a parte A redige (rascunho), assina — e assinar é o que envia —, a
// parte B confere e assina, e o contrato fica vigente. Recusar, encerrar e
// rescindir pedem motivo e ficam no manifesto. Toda troca de situação é RPC;
// esta tela só decide que botão aparece.
//
// A assinatura é a eletrônica SIMPLES: antes de assinar, a tela baixa o
// arquivo, calcula o SHA-256 e mostra se bate com o gravado no upload. É esse
// resumo que vai para a RPC, que recusa se divergir. Word não abre na tela
// (vide `podeVisualizar` em useDocumentos) — o gerente baixa, lê e volta.

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileSignature, Upload, Download, Trash2, Pencil, X, Loader2, ShieldCheck, ShieldAlert,
  FileText, ArrowRight, PenLine, Ban, FilePlus2, FileDown, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDataHoraBR, todayBR } from '../lib/dates';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { LoadingSpinner, EmptyState, NeuButtonAccent, corDoStatus } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePrompt } from '../contexts/PromptContext';
import { useFilial } from '../contexts/FilialContext';
import { useContratos } from '../hooks/useContratos';
import {
  PARTES, STATUS_LABEL, numeroContrato, parteQueRepresento, contraparte, venceu,
  sha256Hex, conferirArquivo, baixarContrato,
  type Contrato, type AssinaturaContrato, type Parte, type StatusContrato,
} from '../lib/contratos';
import { exportManifestoContratoPDF } from '../lib/contratoManifestoPdf';
import type { UserProfile } from '../hooks/useUserProfile';

const MIME_POR_EXTENSAO: Record<string, string> = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
};
const TETO_BYTES = 10 * 1024 * 1024;

// `File.type` volta vazio para .docx em máquina sem Office — a extensão desempata
// (mesma armadilha de DocumentosView).
function mimeDoArquivo(f: File): string | null {
  if (Object.values(MIME_POR_EXTENSAO).includes(f.type)) return f.type;
  const ext = f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase();
  return MIME_POR_EXTENSAO[ext] ?? null;
}

function tamanhoLegivel(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// A pasta é o uid de quem sobe: é o que a policy do bucket confere
// (vide feedback_upload_pasta_do_bucket_e_de_quem_sobe).
function pathSeguro(uid: string, nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);
  return `${uid}/${Date.now()}-${limpo}`;
}

const dataBR = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');


const StatusPill = ({ c, hoje }: { c: Contrato; hoje: string }) => {
  const vencido = c.status === 'vigente' && venceu(c, hoje);
  return (
    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${
      vencido ? corDoStatus('Vencido') : corDoStatus(c.status)
    }`}>
      {vencido ? 'Vigência encerrada' : STATUS_LABEL[c.status]}
    </span>
  );
};

type Aba = 'pendentes' | 'vigentes' | 'encerrados';
const ABA_DE: Record<StatusContrato, Aba> = {
  rascunho: 'pendentes', aguardando: 'pendentes', vigente: 'vigentes',
  recusado: 'encerrados', encerrado: 'encerrados', rescindido: 'encerrados',
};

// ── Modal: novo / editar rascunho / aditivo ────────────────────────────────
function ModalContrato({
  profile, minhaParte, doc, pai, filialAtiva, onClose, onSaved, showToast, assinar,
}: {
  profile: UserProfile; minhaParte: Parte; filialAtiva: string | null;
  doc: Contrato | null; pai: Contrato | null;
  onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
  assinar: (id: string, sha: string) => Promise<{ error?: string; status?: string }>;
}) {
  const editando = !!doc;
  // Aditivo repete as partes e os termos do original; o arquivo é novo.
  const base = doc ?? pai;
  const outrasPartes = PARTES.filter(p => p !== minhaParte);
  const [titulo, setTitulo] = useState(doc?.titulo ?? (pai ? `Aditivo ao ${numeroContrato(pai.numero)} — ${pai.titulo}` : ''));
  const [parteB, setParteB] = useState<Parte | ''>(
    doc?.parte_b ?? (pai ? contraparte(pai, minhaParte)
      // O professor operando a SuperMax quer contratar com a SuperMax — e
      // contrato com outra unidade sairia da lista filtrada ao salvar.
      : (filialAtiva && filialAtiva !== minhaParte && (PARTES as readonly string[]).includes(filialAtiva)
          ? filialAtiva as Parte : '')));
  const [objeto, setObjeto] = useState(base?.objeto ?? '');
  const [valor, setValor] = useState(base?.valor != null ? formatBRL(Number(base.valor)) : '');
  const [condicoes, setCondicoes] = useState(base?.condicoes ?? '');
  const [inicio, setInicio] = useState(base?.vigencia_inicio ?? '');
  const [fim, setFim] = useState(base?.vigencia_fim ?? '');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [mime, setMime] = useState('');
  const [salvando, setSalvando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  const escolher = (f: File | null) => {
    if (!f) return;
    const tipo = mimeDoArquivo(f);
    if (!tipo) { showToast('Formato não aceito. Envie PDF ou Word (.docx / .doc).', 'error'); return; }
    if (f.size > TETO_BYTES) { showToast(`Arquivo de ${tamanhoLegivel(f.size)} — o teto é 10 MB.`, 'error'); return; }
    setArquivo(f); setMime(tipo);
  };

  // `assinarDepois`: o mesmo caminho grava e, se pedido, assina — e assinar é
  // o que manda para a outra parte. Duas funções duplicariam o upload.
  const salvar = async (assinarDepois: boolean) => {
    if (!supabase) return;
    if (!titulo.trim()) { showToast('Dê um título ao contrato.', 'error'); return; }
    if (!parteB) { showToast('Escolha com quem é o contrato.', 'error'); return; }
    if (!editando && !arquivo) { showToast('Anexe o arquivo do contrato.', 'error'); return; }
    if (inicio && fim && fim < inicio) { showToast('O fim da vigência vem antes do início.', 'error'); return; }
    if (assinarDepois) {
      const ok = await confirm({
        message: `Assinar em nome da ${minhaParte} e enviar à ${parteB}? Depois de assinado o arquivo não se troca mais — mudar o contrato vira aditivo.`,
        confirmLabel: 'Assinar e enviar',
      });
      if (!ok) return;
    }

    setSalvando(true);
    let pathNovo: string | null = null;
    try {
      let sha = doc?.arquivo_sha256 ?? '';
      if (arquivo) {
        sha = await sha256Hex(await arquivo.arrayBuffer());
        pathNovo = pathSeguro(profile.id, arquivo.name);
        const { error: upErro } = await supabase.storage
          .from('contratos').upload(pathNovo, arquivo, { contentType: mime, upsert: false });
        if (upErro) throw upErro;
      }

      const campos = {
        titulo: titulo.trim(),
        parte_b: parteB,
        objeto: objeto.trim() || null,
        valor: valor ? parseBRL(valor) : null,
        condicoes: condicoes.trim() || null,
        vigencia_inicio: inicio || null,
        vigencia_fim: fim || null,
      };
      const doArquivo = arquivo && pathNovo ? {
        arquivo_path: pathNovo, arquivo_nome: arquivo.name, arquivo_mime: mime,
        arquivo_tamanho: arquivo.size, arquivo_sha256: sha,
      } : {};

      let id: string;
      if (editando) {
        const { data, error } = await supabase.from('contratos')
          .update({ ...campos, ...doArquivo }).eq('id', doc!.id).select('id');
        // UPDATE que a RLS recortou não é erro — é zero linhas
        // (vide feedback_update_zero_linhas_nao_e_erro). Nos dois casos o
        // arquivo novo já subiu e ninguém aponta para ele: limpa antes de sair.
        if (error || !data?.length) {
          if (pathNovo) await supabase.storage.from('contratos').remove([pathNovo]);
          throw error ?? new Error('O contrato não é mais rascunho — recarregue a tela.');
        }
        id = doc!.id;
        if (arquivo && pathNovo) await supabase.storage.from('contratos').remove([doc!.arquivo_path]);
      } else {
        const { data, error } = await supabase.from('contratos').insert({
          ...campos, ...doArquivo,
          parte_a: minhaParte,
          contrato_pai_id: pai?.id ?? null,
          // Autor, nome e número o banco carimba (migr. 624); `criado_por`
          // segue aqui porque a policy de INSERT o confere.
          criado_por: profile.id,
        }).select('id').single();
        if (error || !data) {
          if (pathNovo) await supabase.storage.from('contratos').remove([pathNovo]);
          throw error ?? new Error('Não foi possível gravar o contrato.');
        }
        id = (data as any).id as string;
      }

      if (assinarDepois) {
        const { error } = await assinar(id, sha);
        if (error) {
          showToast(`Salvo como rascunho, mas a assinatura falhou: ${error}`, 'error');
          onSaved(); onClose(); return;
        }
      }
      showToast(assinarDepois
        ? `Assinado e enviado — agora é com a ${parteB}.`
        : 'Rascunho salvo. Só a sua unidade enxerga até você assinar.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error');
    } finally { setSalvando(false); }
  };

  const label = 'text-[10px] font-black uppercase tracking-widest text-gray-500';
  const campo = 'neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none w-full';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-lg border border-accent/20 flex flex-col gap-3 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-100">
            {editando ? 'Editar rascunho' : pai ? 'Novo aditivo' : 'Novo contrato'}
          </h2>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="flex flex-col gap-1">
          <label className={label}>Título *</label>
          <input className={campo} value={titulo} onChange={e => setTitulo(e.target.value)}
            placeholder="Ex.: Prestação de serviço de manutenção" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className={label}>Parte A (você)</label>
            <div className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-300">{minhaParte}</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={label}>Parte B *</label>
            {pai || editando ? (
              <div className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-300">{parteB}</div>
            ) : (
              <select className={campo} value={parteB} onChange={e => setParteB(e.target.value as Parte)}>
                <option value="">Escolha…</option>
                {outrasPartes.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className={label}>Objeto</label>
          <textarea className={`${campo} resize-none`} rows={2} value={objeto} onChange={e => setObjeto(e.target.value)}
            placeholder="O que uma parte entrega à outra." />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className={label}>Valor (R$)</label>
            <input className={campo} type="text" inputMode="numeric" placeholder="0,00"
              value={valor} onChange={e => setValor(formatBRL(e.target.value))} onKeyDown={handleMoneyKeyDown} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={label}>Início</label>
            <input className={campo} type="date" value={inicio} onChange={e => setInicio(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={label}>Fim</label>
            <input className={campo} type="date" value={fim} onChange={e => setFim(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className={label}>Condições</label>
          <textarea className={`${campo} resize-none`} rows={2} value={condicoes} onChange={e => setCondicoes(e.target.value)}
            placeholder="Ex.: pagamento mensal até o dia 10, reajuste anual pelo IPCA." />
        </div>

        <div className="flex flex-col gap-1">
          <label className={label}>Arquivo {editando ? '' : '* '}(PDF ou Word, até 10 MB)</label>
          <input ref={inputRef} type="file" className="hidden"
            accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            onChange={e => escolher(e.target.files?.[0] ?? null)} />
          <button onClick={() => inputRef.current?.click()}
            className="neu-pressed rounded-xl px-3 py-3 text-sm text-gray-300 flex items-center gap-2 hover:text-gray-100">
            <Upload size={14} className="text-accent shrink-0" />
            <span className="truncate">
              {arquivo ? `${arquivo.name} · ${tamanhoLegivel(arquivo.size)}`
                : editando ? `${doc!.arquivo_nome} — clique para trocar` : 'Escolher arquivo…'}
            </span>
          </button>
          <p className="text-[10px] text-gray-500 mt-1">
            Enquanto é rascunho o arquivo pode ser trocado. Depois da primeira assinatura, não — mudar o
            contrato vira um aditivo.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button onClick={() => salvar(false)} disabled={salvando}
            className="flex-1 neu-button rounded-xl px-3 py-3 text-xs font-black uppercase tracking-widest text-gray-300 hover:text-gray-100 flex items-center justify-center gap-2 disabled:opacity-50">
            {salvando ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            Salvar rascunho
          </button>
          <div className="flex-1">
            <NeuButtonAccent onClick={() => salvar(true)} isLoading={salvando}>Assinar e enviar</NeuButtonAccent>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Modal: detalhe, conferência e assinatura ───────────────────────────────
function DetalheContrato({
  c, assinaturas, minhaParte, ehAdmin, hoje, onClose, showToast, acoes,
}: {
  c: Contrato; assinaturas: AssinaturaContrato[]; minhaParte: Parte | null; ehAdmin: boolean; hoje: string;
  onClose: () => void; showToast: (msg: string, t?: string) => void;
  acoes: {
    assinar: (id: string, sha: string) => Promise<{ error?: string; status?: string }>;
    recusar: (c: Contrato) => void; encerrar: (c: Contrato, rescisao: boolean) => void;
    editar: (c: Contrato) => void; excluir: (c: Contrato) => void; aditivo: (c: Contrato) => void;
  };
}) {
  const [conferindo, setConferindo] = useState(false);
  const [conferido, setConferido] = useState<{ hash: string; confere: boolean } | null>(null);
  const [concordo, setConcordo] = useState(false);
  const [assinando, setAssinando] = useState(false);

  const souParte = !!minhaParte && (c.parte_a === minhaParte || c.parte_b === minhaParte);
  const jaAssinei = !!minhaParte && assinaturas.some(a => a.parte === minhaParte);
  const podeAssinar = souParte && !jaAssinei &&
    (c.status === 'aguardando' || (c.status === 'rascunho' && c.parte_a === minhaParte)) &&
    !venceu(c, hoje);

  const conferir = async () => {
    setConferindo(true);
    const r = await conferirArquivo(c);
    setConferindo(false);
    if (r.error) { showToast(r.error, 'error'); return; }
    setConferido({ hash: r.hash!, confere: !!r.confere });
  };

  const assinarAgora = async () => {
    if (!conferido?.confere || !concordo) return;
    setAssinando(true);
    const { error, status } = await acoes.assinar(c.id, conferido.hash);
    setAssinando(false);
    if (error) { showToast(error, 'error'); return; }
    showToast(status === 'vigente'
      ? 'Assinado. As duas partes assinaram — o contrato está vigente.'
      : `Assinado e enviado — agora é com a ${contraparte(c, minhaParte!)}.`, 'success');
    onClose();
  };

  const linha = (rotulo: string, valor: ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{rotulo}</span>
      <span className="text-sm text-gray-200 whitespace-pre-wrap break-words">{valor || '—'}</span>
    </div>
  );

  const assinaturaDe = (p: Parte) => assinaturas.find(a => a.parte === p);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-2xl border border-accent/20 flex flex-col gap-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-accent">{numeroContrato(c.numero)}</div>
            <h2 className="text-base font-bold text-gray-100 break-words">{c.titulo}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusPill c={c} hoje={hoje} />
              <span className="text-xs text-gray-400 flex items-center gap-1">
                {c.parte_a} <ArrowRight size={11} /> {c.parte_b}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn shrink-0"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {linha('Objeto', c.objeto)}
          {linha('Valor', c.valor != null ? `R$ ${formatBRL(Number(c.valor))}` : null)}
          {linha('Vigência', c.vigencia_inicio || c.vigencia_fim
            ? `${dataBR(c.vigencia_inicio) || '—'} a ${dataBR(c.vigencia_fim) || 'indeterminado'}` : null)}
          {linha('Condições', c.condicoes)}
          {linha('Criado por', `${c.criado_por_nome ?? '—'} · ${formatDataHoraBR(c.created_at)}`)}
          {c.contrato_pai_id && linha('Aditivo', 'Altera um contrato anterior entre as mesmas partes.')}
        </div>

        {c.motivo_encerramento && (
          <div className="neu-pressed rounded-xl p-3 text-xs text-gray-300 border border-red-400/20">
            <b>{STATUS_LABEL[c.status]}</b> por {c.encerrado_por_nome ?? '—'} em {formatDataHoraBR(c.encerrado_em)}:{' '}
            {c.motivo_encerramento}
          </div>
        )}

        {/* Arquivo + conferência */}
        <div className="neu-pressed rounded-2xl p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText size={14} className="text-accent shrink-0" />
            <span className="text-sm text-gray-200 truncate flex-1 min-w-0">{c.arquivo_nome}</span>
            <span className="text-[10px] text-gray-500">{tamanhoLegivel(c.arquivo_tamanho)}</span>
            <button onClick={async () => { const { error } = await baixarContrato(c); if (error) showToast(error, 'error'); }}
              className="neu-button rounded-xl px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5">
              <Download size={12} /> Baixar
            </button>
            <button onClick={conferir} disabled={conferindo}
              className="neu-button rounded-xl px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-gray-300 flex items-center gap-1.5 disabled:opacity-50">
              {conferindo ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Conferir
            </button>
          </div>
          <div className="text-[10px] text-gray-500 font-mono break-all">SHA-256: {c.arquivo_sha256}</div>
          {conferido && (
            <div className={`text-xs flex items-start gap-1.5 ${conferido.confere ? 'text-emerald-300' : 'text-red-300'}`}>
              {conferido.confere ? <ShieldCheck size={13} className="shrink-0 mt-0.5" /> : <ShieldAlert size={13} className="shrink-0 mt-0.5" />}
              <span>
                {conferido.confere
                  ? 'O arquivo guardado é exatamente o que foi enviado — nenhum byte mudou.'
                  : `O arquivo guardado NÃO bate com o resumo do contrato (${conferido.hash.slice(0, 16)}…). Não assine.`}
              </span>
            </div>
          )}
        </div>

        {/* Assinaturas */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Assinaturas</span>
          {[c.parte_a, c.parte_b].map(p => {
            const a = assinaturaDe(p);
            return (
              <div key={p} className="neu-flat rounded-xl p-3 border border-white/5 flex items-center gap-2 flex-wrap text-xs">
                <span className="font-bold text-gray-200 w-20">{p}</span>
                {a ? (
                  <span className="text-emerald-300 flex items-center gap-1.5 flex-wrap">
                    <PenLine size={12} /> {a.nome_snapshot} ({a.cargo_snapshot}) · {formatDataHoraBR(a.assinado_em)}
                    {a.arquivo_sha256 !== c.arquivo_sha256 && <b className="text-red-300">— resumo diferente!</b>}
                  </span>
                ) : (
                  <span className="text-gray-500">
                    {['recusado', 'encerrado', 'rescindido'].includes(c.status) ? 'Não assinou' : 'Pendente'}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {podeAssinar && (
          <div className="neu-flat rounded-2xl p-4 border border-accent/30 flex flex-col gap-3">
            <div className="text-xs text-gray-300 flex items-start gap-2">
              <Info size={13} className="shrink-0 mt-0.5 text-accent" />
              <span>
                Baixe e leia o contrato. Para assinar, clique em <b>Conferir</b>: a tela calcula o resumo do
                arquivo e sua assinatura fica presa a ele.
              </span>
            </div>
            <label className="flex items-start gap-2 text-xs text-gray-200 cursor-pointer">
              <input type="checkbox" checked={concordo} onChange={e => setConcordo(e.target.checked)} className="mt-0.5" />
              <span>Li o contrato e concordo com os termos, em nome da <b>{minhaParte}</b>.</span>
            </label>
            <NeuButtonAccent onClick={assinarAgora} isLoading={assinando} disabled={!conferido?.confere || !concordo}>
              {c.status === 'rascunho' ? 'Assinar e enviar' : 'Assinar'}
            </NeuButtonAccent>
            {!conferido && <p className="text-[10px] text-gray-500 text-center">Confira o arquivo antes de assinar.</p>}
          </div>
        )}
        {souParte && !jaAssinei && c.status === 'aguardando' && venceu(c, hoje) && (
          <p className="text-xs text-red-300">A vigência já terminou — contrato vencido não se assina. Recuse e faça um novo.</p>
        )}

        {/* Ações */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {c.status !== 'rascunho' && (
            <button onClick={() => exportManifestoContratoPDF(c, assinaturas)}
              className="btn-solido btn-solido--vermelho">
              <FileDown size={13} /> Manifesto PDF
            </button>
          )}
          {souParte && c.status === 'aguardando' && (
            <button onClick={() => acoes.recusar(c)}
              className="neu-button rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-red-300 flex items-center gap-1.5">
              <Ban size={13} /> {jaAssinei ? 'Retirar' : 'Recusar'}
            </button>
          )}
          {souParte && c.status === 'vigente' && (
            <>
              <button onClick={() => acoes.aditivo(c)}
                className="neu-button rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5">
                <FilePlus2 size={13} /> Aditivo
              </button>
              <button onClick={() => acoes.encerrar(c, false)}
                className="neu-button rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-gray-300">
                Encerrar
              </button>
              <button onClick={() => acoes.encerrar(c, true)}
                className="neu-button rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-red-300">
                Rescindir
              </button>
            </>
          )}
          {c.status === 'rascunho' && c.parte_a === minhaParte && (
            <button onClick={() => acoes.editar(c)} title="Editar rascunho" className="action-btn-edit">
              <Pencil size={12} />
            </button>
          )}
          {((c.status === 'rascunho' && c.parte_a === minhaParte) || ehAdmin) && (
            <button onClick={() => acoes.excluir(c)} title="Excluir" className="action-btn-delete">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── View ───────────────────────────────────────────────────────────────────
export const ContratosView = ({ showToast, profile }: { showToast: any; profile: UserProfile | null }) => {
  const { contratos: todos, assinaturas, loading, assinar, recusar, encerrar, recarregar } = useContratos(profile);
  const { filialAtiva } = useFilial();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const hoje = todayBR();

  const minhaParte = parteQueRepresento(profile);
  const ehAdmin = profile?.role === 'admin';

  const [aba, setAba] = useState<Aba>('pendentes');
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [form, setForm] = useState<{ doc: Contrato | null; pai: Contrato | null } | null>(null);

  // Operando dentro de uma unidade, só os contratos em que ela é parte — o
  // nicho do topbar vale aqui também. Em modo Matriz, o consolidado.
  const contratos = useMemo(
    () => (filialAtiva ? todos.filter(c => c.parte_a === filialAtiva || c.parte_b === filialAtiva) : todos),
    [todos, filialAtiva],
  );

  const esperaMinhaAssinatura = (c: Contrato) =>
    !!minhaParte && c.status === 'aguardando'
    && (c.parte_a === minhaParte || c.parte_b === minhaParte)
    && !(assinaturas[c.id] ?? []).some(a => a.parte === minhaParte);

  const paraAssinar = contratos.filter(esperaMinhaAssinatura);
  const daAba = contratos.filter(c => ABA_DE[c.status] === aba);
  // O que espera a minha assinatura sobe para o topo da aba.
  const visiveis = [...daAba].sort((x, y) => Number(esperaMinhaAssinatura(y)) - Number(esperaMinhaAssinatura(x)));
  const contagem = (a: Aba) => contratos.filter(c => ABA_DE[c.status] === a).length;

  const aberto = abertoId ? todos.find(c => c.id === abertoId) ?? null : null;

  const acoes = {
    assinar,
    recusar: async (c: Contrato) => {
      const retirar = minhaParte === c.parte_a && (assinaturas[c.id] ?? []).some(a => a.parte === minhaParte);
      const motivo = await prompt({
        message: retirar
          ? `Por que a ${minhaParte} está retirando o contrato? A ${contraparte(c, minhaParte!)} vai ler.`
          : `Por que a ${minhaParte} recusa o contrato? A outra parte vai ler.`,
        placeholder: 'Ex.: o valor não é o combinado na reunião',
        confirmLabel: retirar ? 'Retirar' : 'Recusar',
        maxLength: 300,
      });
      if (motivo == null) return;
      const { error } = await recusar(c.id, motivo);
      showToast(error ?? (retirar ? 'Contrato retirado.' : 'Contrato recusado.'), error ? 'error' : 'success');
      if (!error) setAbertoId(null);
    },
    encerrar: async (c: Contrato, rescisao: boolean) => {
      // Encerrar é o fim combinado e não pede motivo — o prompt não aceita
      // vazio, então ele vira confirmação. Rescindir pede, e o banco confere.
      let motivo = '';
      if (rescisao) {
        const m = await prompt({
          message: 'Rescindir é romper antes do combinado. Qual o motivo? (fica no manifesto)',
          placeholder: 'Ex.: serviço não entregue no prazo',
          confirmLabel: 'Rescindir',
          maxLength: 300,
        });
        if (m == null) return;
        motivo = m;
      } else {
        const ok = await confirm({
          message: `Encerrar ${numeroContrato(c.numero)} "${c.titulo}"? É o fim combinado entre as partes — ele sai de Vigentes e não volta.`,
          confirmLabel: 'Encerrar',
        });
        if (!ok) return;
      }
      const { error } = await encerrar(c.id, rescisao, motivo);
      showToast(error ?? (rescisao ? 'Contrato rescindido.' : 'Contrato encerrado.'), error ? 'error' : 'success');
      if (!error) setAbertoId(null);
    },
    editar: (c: Contrato) => { setAbertoId(null); setForm({ doc: c, pai: null }); },
    aditivo: (c: Contrato) => { setAbertoId(null); setForm({ doc: null, pai: c }); },
    excluir: async (c: Contrato) => {
      const ok = await confirm({
        message: c.status === 'rascunho'
          ? `Excluir o rascunho "${c.titulo}"? A outra parte nunca o viu.`
          : `Excluir ${numeroContrato(c.numero)} "${c.titulo}"? Ele está ${STATUS_LABEL[c.status].toLowerCase()} — some das duas partes junto com as assinaturas e o arquivo.`,
        danger: true,
      });
      if (!ok || !supabase) return;
      const { data, error } = await supabase.from('contratos').delete().eq('id', c.id).select('id');
      if (error || !data?.length) { showToast(error?.message ?? 'O contrato não pôde ser excluído.', 'error'); return; }
      await supabase.storage.from('contratos').remove([c.arquivo_path]);
      showToast('Contrato excluído.', 'success');
      setAbertoId(null);
      recarregar();
    },
  };

  if (loading) return <LoadingSpinner />;

  const ABAS: { id: Aba; label: string }[] = [
    { id: 'pendentes', label: 'Em andamento' },
    { id: 'vigentes', label: 'Vigentes' },
    { id: 'encerrados', label: 'Encerrados' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="flex flex-col gap-5 pb-16">
      <div className="neu-flat rounded-3xl p-5 border border-accent/20 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileSignature size={14} className="text-accent" />
            <h1 className="text-sm font-black uppercase tracking-widest text-gray-100">Contratos</h1>
          </div>
          <p className="text-xs text-gray-500">
            {minhaParte
              ? `Acordos da ${minhaParte} com a Matriz e as outras unidades. Quem cria assina primeiro; vale quando as duas partes assinam.`
              : 'Acordos entre as unidades. Quem assina é o gerente de cada filial e, pela Matriz, o professor.'}
          </p>
        </div>
        {minhaParte && (
          <button onClick={() => setForm({ doc: null, pai: null })}
            className="neu-button rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-widest text-accent flex items-center gap-2">
            <Upload size={14} /> Novo contrato
          </button>
        )}
      </div>

      {paraAssinar.length > 0 && (
        <div className="neu-flat rounded-2xl p-4 border border-amber-400/25 flex items-start gap-2 text-xs text-amber-200">
          <PenLine size={13} className="shrink-0 mt-0.5" />
          <span>
            {paraAssinar.length === 1
              ? `1 contrato espera a assinatura da ${minhaParte}.`
              : `${paraAssinar.length} contratos esperam a assinatura da ${minhaParte}.`}
          </span>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {ABAS.map(a => (
          <button key={a.id} onClick={() => setAba(a.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              aba === a.id ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            {a.label} <span className="text-[10px] text-gray-500 ml-1">{contagem(a.id)}</span>
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <EmptyState message={aba === 'pendentes' ? 'Nenhum contrato em andamento.' : aba === 'vigentes' ? 'Nenhum contrato vigente.' : 'Nenhum contrato encerrado.'} />
      ) : (
        <div className="flex flex-col gap-2">
          {visiveis.map(c => {
            const minha = esperaMinhaAssinatura(c);
            const ass = assinaturas[c.id] ?? [];
            return (
              <button key={c.id} onClick={() => setAbertoId(c.id)}
                className={`neu-flat rounded-2xl p-4 border text-left flex flex-col gap-2 hover:border-accent/30 transition-colors ${
                  minha ? 'border-amber-400/30' : c.status === 'rascunho' ? 'border-dashed border-gray-500/40' : 'border-white/5'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black text-accent">{numeroContrato(c.numero)}</span>
                  <h3 className="text-sm font-bold text-gray-100 truncate min-w-0 flex-1">{c.titulo}</h3>
                  <StatusPill c={c} hoje={hoje} />
                  {minha && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30">
                      Sua assinatura
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-400 flex items-center gap-x-3 gap-y-1 flex-wrap">
                  <span className="flex items-center gap-1">{c.parte_a} <ArrowRight size={10} /> {c.parte_b}</span>
                  {c.valor != null && <span>R$ {formatBRL(Number(c.valor))}</span>}
                  {c.vigencia_fim && <span>até {dataBR(c.vigencia_fim)}</span>}
                  <span>{ass.length}/2 assinaturas</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {aberto && (
          <DetalheContrato
            key={aberto.id}
            c={aberto}
            assinaturas={assinaturas[aberto.id] ?? []}
            minhaParte={minhaParte}
            ehAdmin={ehAdmin}
            hoje={hoje}
            onClose={() => setAbertoId(null)}
            showToast={showToast}
            acoes={acoes}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {form && profile && minhaParte && (
          <ModalContrato
            profile={profile}
            minhaParte={minhaParte}
            doc={form.doc}
            pai={form.pai}
            filialAtiva={filialAtiva}
            onClose={() => setForm(null)}
            onSaved={recarregar}
            showToast={showToast}
            assinar={assinar}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};
