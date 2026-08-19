// "Novo Documento Disponível" — o documento publicado pela Matriz alcança a
// pessoa onde ela estiver, não só se ela lembrar de abrir a tela (migr. 476).
//
// Desenho copiado do AvisoMatrizFAB (263) de propósito: mesma mecânica de fila
// não-lida, mesmo botão de confirmação, mesmo lugar na tela. Duas coisas que
// interrompem o aluno do mesmo jeito devem parecer a mesma coisa.
//
// Diferença: aqui o modal ABRE sozinho na primeira vez que a fila aparece. Um
// aviso pode esperar o clique; um documento que a turma precisa baixar antes
// da atividade, não. Fechado sem confirmar, vira FAB e continua cobrando.
//
// ─── MAS NUNCA POR CIMA DE OPERAÇÃO EM CURSO ────────────────────────────────
//
// Isto é um recado, não uma tarefa: ele espera. Abrir sozinho no meio de uma
// venda rouba o foco do leitor de código de barras (que digita direto na tela)
// e sequestra o Escape com um cliente na frente do caixa. No meio de um
// cadastro, cobre o formulário que a pessoa está preenchendo.
//
// Duas travas, porque uma só não cobre o caso real:
//
//   · TELAS DE OPERAÇÃO (lista abaixo) — ali o módulo some por inteiro: nem
//     modal, nem FAB. Interromper não é inconveniência, é erro de operação.
//
//   · CAMPO EM FOCO — se o cursor está num input, textarea, select ou área
//     editável, alguém está digitando, em QUALQUER tela. Esta trava vale só
//     para o auto-abrir (o FAB não cobre nada) e é a que se mantém sozinha:
//     cadastro novo que aparecer amanhã já nasce protegido, sem ninguém
//     precisar lembrar de adicioná-lo a lista nenhuma.
//
// Adiar não é descartar. O documento continua na fila e o aviso aparece assim
// que a pessoa sai da operação ou tira o cursor do campo — a recheca acontece a
// cada troca de view e a cada 30s enquanto houver algo represado.

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, X, Check, Download, Building2, Loader2 } from 'lucide-react';
import { formatDataHoraBR } from '../lib/dates';
import { useDocumentos, baixarDocumento } from '../hooks/useDocumentos';
import type { UserProfile } from '../hooks/useUserProfile';

// Telas de OPERAÇÃO: nelas o módulo inteiro se cala — nem modal, nem FAB.
//
// O critério não é "tela importante" (todas são), é: existe alguém ou alguma
// coisa esperando do outro lado enquanto a pessoa mexe aqui? Ou o balcão com um
// cliente parado, ou uma contagem física que perde o fio se for interrompida.
// Nesses dois casos um botão piscando no canto não é lembrete, é ruído em cima
// de trabalho que não pode ser refeito.
//
//   · vendas-pdv                 venda no balcão, cliente na frente
//   · vendas-devoluções          troca/devolução, cliente na frente
//   · vendas-pedidosonline       fila de comprador esperando atendimento
//   · financeiro-controledecaixa abertura, sangria, suprimento, fechamento
//   · estoque-recebimentos       conferência da carga contra o pedido
//   · estoque-expedição          separação e saída da mercadoria
//   · estoque-inventários        contagem física
//
// Fora daqui o FAB fica: é o único jeito de a pessoa saber que chegou documento
// sem depender de lembrar de abrir o módulo. E a fila não se perde — o que a
// operação faz é adiar o aviso, não descartá-lo.
const VIEWS_DE_OPERACAO = new Set([
  'vendas-pdv',
  'vendas-devoluções',
  'vendas-pedidosonline',
  'financeiro-controledecaixa',
  'estoque-recebimentos',
  'estoque-expedição',
  'estoque-inventários',
]);

function emOperacao(view?: string): boolean {
  return !!view && VIEWS_DE_OPERACAO.has(view);
}

/** Alguém está digitando? Vale em qualquer tela, inclusive dentro de modal. */
function digitandoAgora(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function NovoDocumentoModal({ profile, showToast, activeView }: {
  profile: UserProfile; showToast?: any; activeView?: string;
}) {
  const { naoLidos, marcarLido } = useDocumentos(profile);
  const [open, setOpen] = useState(false);
  const [indice, setIndice] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  // Abre sozinho uma vez por documento. Sem esta memória, fechar sem confirmar
  // faria o modal voltar a cada re-render da fila — e aí ele deixa de ser
  // aviso e vira armadilha.
  const [jaAbriuPara, setJaAbriuPara] = useState<string | null>(null);

  const doc = naoLidos[indice];

  const tentarAbrir = useCallback(() => {
    const primeiro = naoLidos[0]?.id ?? null;
    if (!primeiro || primeiro === jaAbriuPara) return;
    if (emOperacao(activeView)) return;
    if (digitandoAgora()) return;
    // Só marca como "já mostrado" quando de fato mostrou. Marcar antes da hora
    // faria o documento perder o auto-abrir para sempre por ter chegado no
    // instante errado.
    setJaAbriuPara(primeiro);
    setIndice(0);
    setOpen(true);
  }, [naoLidos, jaAbriuPara, activeView]);

  useEffect(() => {
    if (naoLidos.length === 0) { setOpen(false); return; }
    if (indice > naoLidos.length - 1) setIndice(Math.max(0, naoLidos.length - 1));
    tentarAbrir();
  }, [naoLidos, indice, tentarAbrir]);

  // Represado: recheca sozinho enquanto houver documento esperando. Sem isto,
  // quem passa a aula inteira no PDV só veria o modal ao trocar de tela.
  useEffect(() => {
    const primeiro = naoLidos[0]?.id ?? null;
    if (!primeiro || primeiro === jaAbriuPara) return;
    const t = window.setInterval(tentarAbrir, 30000);
    return () => window.clearInterval(t);
  }, [naoLidos, jaAbriuPara, tentarAbrir]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (naoLidos.length === 0) return null;

  const baixar = async () => {
    if (!doc) return;
    setBaixando(true);
    const { error } = await baixarDocumento(doc);
    setBaixando(false);
    if (error) return showToast?.(error, 'error');
  };

  const confirmar = async () => {
    if (!doc) return;
    setSalvando(true);
    const { error } = await marcarLido(doc.id);
    setSalvando(false);
    if (error) return showToast?.(error, 'error');
    showToast?.('Leitura confirmada.', 'success');
  };

  return (
    <>
      {!emOperacao(activeView) && (
        <motion.button
          onClick={() => { setIndice(0); setOpen(true); }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Ver documentos novos"
          className="fixed bottom-72 right-6 z-40 h-12 pl-4 pr-5 rounded-full neu-flat border border-sky-400/40 flex items-center gap-2 text-sky-200 hover:border-sky-400 hover:text-sky-100 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
          style={{ background: 'var(--color-card-bg)' }}
        >
          <span className="relative flex items-center justify-center">
            <span className="absolute inline-flex w-5 h-5 rounded-full bg-sky-400/30 animate-ping" />
            <FileText size={18} className="relative" />
          </span>
          <span className="text-xs font-black uppercase tracking-widest">Novo Documento</span>
          {naoLidos.length > 1 && (
            <span className="text-[10px] font-black tabular-nums w-5 h-5 rounded-full bg-sky-400/20 border border-sky-400/40 flex items-center justify-center">
              {naoLidos.length}
            </span>
          )}
        </motion.button>
      )}

      <AnimatePresence>
        {open && doc && (
          <motion.div
            key="documento-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              key="documento-dialog"
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
              className="neu-flat rounded-3xl border border-sky-400/30 p-5 sm:p-6 w-full max-w-lg max-h-[85vh] flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-sky-400/10 ring-1 ring-sky-400/30 flex items-center justify-center shrink-0">
                    <FileText size={18} className="text-sky-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-sky-300">Novo Documento Disponível</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {doc.publicado_por_nome ?? 'Matriz'}
                      {naoLidos.length > 1 && ` · ${indice + 1} de ${naoLidos.length}`}
                    </p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Fechar"
                  className="shrink-0 neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto flex flex-col gap-3 -mx-1 px-1">
                <h3 className="text-lg font-black text-gray-100 leading-tight">{doc.titulo}</h3>
                {doc.descricao && (
                  <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{doc.descricao}</p>
                )}

                <button
                  onClick={baixar}
                  disabled={baixando}
                  className="neu-pressed rounded-xl px-4 py-3 flex items-center gap-2.5 text-sm text-gray-200 hover:text-white disabled:opacity-50"
                >
                  {baixando ? <Loader2 size={15} className="animate-spin text-sky-300" /> : <Download size={15} className="text-sky-300" />}
                  <span className="truncate">{doc.arquivo_nome}</span>
                </button>

                <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-white/5 text-[11px] text-gray-500">
                  <span>{formatDataHoraBR(doc.created_at)}</span>
                  <span className="flex items-center gap-1.5">
                    <Building2 size={11} />
                    {doc.filial_alvo ?? 'Todas as unidades'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                {naoLidos.length > 1 ? (
                  <button
                    onClick={() => setIndice(i => (i + 1) % naoLidos.length)}
                    className="text-[11px] font-bold px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-gray-200"
                  >
                    Ver outro documento
                  </button>
                ) : <span />}
                <button
                  onClick={confirmar}
                  disabled={salvando}
                  className="text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-xl neu-button text-emerald-300 ring-1 ring-emerald-500/40 hover:ring-emerald-400 flex items-center gap-2 disabled:opacity-50"
                >
                  {salvando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Recebi
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
