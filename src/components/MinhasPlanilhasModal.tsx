import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Download, FileSpreadsheet, FolderOpen, Loader2, Trash2, Upload, X } from 'lucide-react';
import {
  listarPlanilhas, salvarPlanilha, baixarPlanilha, excluirPlanilha,
  formatarTamanho, extensaoValida, tituloPlanilhas, PLANILHA_TAMANHO_MAX,
  type PlanilhaTrabalho,
} from '../lib/planilhasTrabalho';
import { formatDataHoraBR } from '../lib/dates';
import { LoadingSpinner, EmptyState, FilialBadge } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { useVoltarInterno } from '../hooks/useVoltarInterno';
import type { ModeloEntidade } from '../lib/modelosPlanilha';

// "Minhas planilhas" (migração 389) — onde o trabalho preenchido fica guardado.
//
// Antes disto, a planilha preenchida dependia de pendrive, WhatsApp ou Drive
// pessoal para sobreviver até a aula seguinte.
//
// Cada operação é uma pasta: o modal de Produtos mostra só as planilhas
// enviadas em Produtos, e se chama "Planilhas de Produtos". Misturar as
// operações num lugar só fazia a planilha de Requisições aparecer no meio das
// de Produtos.
//
// Painel em `neu-flat` e portal no body: a classe `neu-card` antiga saiu do
// CSS e o painel ficou sem fundo (o texto boiava sobre a tela), e as views
// animam com transform, que prende o `fixed` à view em vez da tela.

// Cor do ícone pelo formato — acha-se de relance o .csv no meio dos .xlsx.
const COR_EXTENSAO: Record<string, string> = {
  xlsx: 'bg-emerald-500/15 text-emerald-400',
  xls:  'bg-emerald-500/15 text-emerald-400',
  ods:  'bg-sky-500/15 text-sky-400',
  csv:  'bg-amber-500/15 text-amber-400',
};

const extensao = (nome: string) => nome.split('.').pop()?.toLowerCase() ?? '';

export function MinhasPlanilhasModal({
  entidade, filial, userId, userNome, onClose, showToast,
}: {
  entidade: ModeloEntidade;
  filial: string;
  /** `auth.uid()` — é ele que nomeia a pasta no bucket. */
  userId?: string;
  userNome?: string;
  onClose: () => void;
  showToast?: (msg: string, tipo?: string, flag?: boolean) => void;
}) {
  const [itens, setItens]     = useState<PlanilhaTrabalho[]>([]);
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro]       = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmar = useConfirm();

  // Voltar do celular e Esc fecham o modal, não a tela por baixo dele.
  useVoltarInterno(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ocupado, onClose]);

  // Sem `userId` não há o que listar: a sessão ainda está resolvendo. Manter o
  // spinner é o certo — a versão anterior chamava a listagem assim mesmo, e
  // sem dono a consulta trazia tudo o que a RLS permitisse, que para admin,
  // CEO e conselheiro é a turma inteira dentro de "Minhas planilhas".
  const carregar = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setItens(await listarPlanilhas(userId, entidade));
      setErro(null);
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível listar suas planilhas.');
    } finally {
      setLoading(false);
    }
  }, [userId, entidade]);

  useEffect(() => { void carregar(); }, [carregar]);

  const enviar = async (file: File | undefined) => {
    if (!file || !userId || ocupado) return;
    if (!extensaoValida(file.name)) {
      showToast?.('Envie uma planilha (.xlsx, .xls, .ods ou .csv).', 'error', true); return;
    }
    if (file.size > PLANILHA_TAMANHO_MAX) {
      showToast?.(`A planilha tem ${formatarTamanho(file.size)} e o limite é 5 MB.`, 'error', true); return;
    }
    setOcupado(true);
    try {
      // Case-insensitive porque é assim que o caminho no bucket é montado:
      // "Produtos.xlsx" e "produtos.xlsx" são a mesma planilha, e o aviso de
      // substituição precisa dizer isso.
      const jaExistia = itens.some(
        i => i.arquivo_nome.toLowerCase() === file.name.toLowerCase(),
      );
      await salvarPlanilha({
        file, userId, nome: userNome ?? '', entidade, filial: filial || null,
      });
      showToast?.(
        jaExistia ? 'Planilha atualizada — a versão anterior foi substituída.' : 'Planilha guardada no LogMax.',
        'success',
      );
      await carregar();
    } catch (e: any) {
      showToast?.(e?.message ?? 'Não foi possível guardar a planilha.', 'error', true);
    } finally {
      setOcupado(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const baixar = async (p: PlanilhaTrabalho) => {
    setOcupado(true);
    try { await baixarPlanilha(p); }
    catch (e: any) { showToast?.(e?.message ?? 'Não foi possível baixar.', 'error', true); }
    finally { setOcupado(false); }
  };

  const excluir = async (p: PlanilhaTrabalho) => {
    const ok = await confirmar({
      message: `Excluir "${p.arquivo_nome}"? Não dá para desfazer.`,
      confirmLabel: 'Excluir', danger: true,
    });
    if (!ok) return;
    setOcupado(true);
    try {
      await excluirPlanilha(p);
      showToast?.('Planilha excluída.', 'success');
      await carregar();
    } catch (e: any) {
      showToast?.(e?.message ?? 'Não foi possível excluir.', 'error', true);
    } finally { setOcupado(false); }
  };

  const podeEnviar = !ocupado && !!userId;
  const titulo = tituloPlanilhas(entidade);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm"
      onClick={() => !ocupado && onClose()}>
      <motion.div role="dialog" aria-modal="true" aria-label={titulo}
        initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="neu-flat border border-white/10 shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col rounded-3xl overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Cabeçalho */}
        <header className="flex items-start gap-3 px-5 py-4 border-b border-white/10 shrink-0">
          <div className="w-10 h-10 rounded-2xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <FolderOpen size={20} />
          </div>
          <h2 className="min-w-0 flex-1 self-center text-base font-bold text-gray-100 leading-tight">{titulo}</h2>
          <button onClick={onClose} disabled={ocupado} aria-label="Fechar" className="shrink-0 modal-close-btn">
            <X size={16} />
          </button>
        </header>

        {/* Envio */}
        <section className="px-5 py-4 border-b border-white/10 shrink-0">
          <input ref={inputRef} type="file" className="hidden"
            accept=".xlsx,.xls,.ods,.csv"
            onChange={e => void enviar(e.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={!podeEnviar}
            onDragOver={e => { e.preventDefault(); if (podeEnviar) setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={e => { e.preventDefault(); setArrastando(false); if (podeEnviar) void enviar(e.dataTransfer.files?.[0]); }}
            className={`w-full rounded-2xl border-2 border-dashed px-4 py-5 flex flex-col sm:flex-row items-center gap-3 sm:gap-4 text-center sm:text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed
              ${arrastando ? 'border-accent bg-accent/10' : 'border-white/15 bg-black/20 hover:border-accent/50 hover:bg-accent/5'}`}>
            <div className="w-11 h-11 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
              {ocupado ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-gray-100">
                {ocupado ? 'Enviando…' : arrastando ? 'Solte para guardar' : 'Enviar planilha preenchida'}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">.xlsx, .xls, .ods ou .csv · até 5 MB</div>
            </div>
          </button>
        </section>

        {/* Lista */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Guardadas</h3>
          {!loading && !erro && (
            <span className="text-[11px] font-bold text-gray-500 tabular-nums">
              {itens.length} {itens.length === 1 ? 'arquivo' : 'arquivos'}
            </span>
          )}
        </div>

        <div className="flex-1 min-h-[8rem] overflow-y-auto px-5 pb-5 space-y-2">
          {loading ? <LoadingSpinner />
            : erro ? <EmptyState message={titulo} error={erro} />
            : itens.length === 0 ? (
              <EmptyState message="Nenhuma planilha guardada." />
            ) : itens.map(p => {
              const ext = extensao(p.arquivo_nome);
              return (
                <div key={p.id}
                  className="rounded-2xl border border-white/10 bg-black/20 hover:border-white/20 p-3 flex items-center gap-3 transition-colors">
                  <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center shrink-0 ${COR_EXTENSAO[ext] ?? 'bg-white/5 text-gray-400'}`}>
                    <FileSpreadsheet size={16} />
                    <span className="text-[8px] font-black uppercase leading-none mt-0.5">{ext}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-100 truncate" title={p.arquivo_nome}>{p.arquivo_nome}</div>
                    <div className="text-[11px] text-gray-500 flex items-center gap-x-2 gap-y-1 flex-wrap mt-1">
                      {p.filial && <FilialBadge filial={p.filial} />}
                      <span>{formatarTamanho(p.tamanho_bytes)}</span>
                      {p.versao > 1 && <span className="text-accent">v{p.versao}</span>}
                      <span>· {formatDataHoraBR(p.updated_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => void baixar(p)} disabled={ocupado} title="Baixar" aria-label={`Baixar ${p.arquivo_nome}`}
                      className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent disabled:opacity-50">
                      <Download size={15} />
                    </button>
                    {p.user_id === userId && (
                      <button onClick={() => void excluir(p)} disabled={ocupado} title="Excluir" aria-label={`Excluir ${p.arquivo_nome}`}
                        className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-400 disabled:opacity-50">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
