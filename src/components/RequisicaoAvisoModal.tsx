// "Requisição devolvida" / "Requisição corrigida" — o recado que não pode
// esperar a pessoa reparar no sino (migr. 520).
//
// Desenho copiado do NovoDocumentoModal (476), que por sua vez copiou o
// AvisoMatrizFAB (263), de propósito: coisas que interrompem o aluno do mesmo
// jeito devem parecer a mesma coisa. Modal abre sozinho, fechado sem confirmar
// vira FAB e continua cobrando, e a ciência é por pessoa.
//
// As mesmas duas travas do modal de documentos, pelo mesmo motivo: telas de
// operação (balcão, caixa, contagem) não são interrompidas, e o auto-abrir
// espera quem está digitando terminar. Adiar não é descartar — a fila continua
// e o modal volta a tentar a cada troca de tela e a cada 30s.
//
// Por que os dois eventos no mesmo componente: são o mesmo documento, o mesmo
// par de pessoas e o mesmo ciclo, só que em sentidos opostos. Duas telas
// diferentes para isso ensinariam que são dois assuntos.

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, X, Check, ArrowRight, Building2, Loader2 } from 'lucide-react';
import { formatDataHoraBR } from '../lib/dates';
import { numeroRequisicao } from '../lib/documentos';
import { useRequisicoesAviso, type RequisicaoAviso } from '../hooks/useRequisicoesAviso';
import { useFilial } from '../contexts/FilialContext';
import type { UserProfile } from '../hooks/useUserProfile';

// Mesma lista do NovoDocumentoModal: onde há alguém (ou uma contagem) esperando
// do outro lado, o módulo inteiro se cala — nem modal, nem FAB.
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

const chave = (a: RequisicaoAviso) => `${a.id}:${a.evento}`;

export function RequisicaoAvisoModal({ profile, showToast, activeView, onNavigate }: {
  profile: UserProfile;
  showToast?: any;
  activeView?: string;
  onNavigate?: (view: string) => void;
}) {
  const { filialAtiva } = useFilial();
  const { pendentes, darCiencia } = useRequisicoesAviso(profile, filialAtiva);
  const [open, setOpen] = useState(false);
  const [indice, setIndice] = useState(0);
  const [salvando, setSalvando] = useState(false);
  // Abre sozinho uma vez por evento. Sem esta memória, fechar sem confirmar
  // faria o modal voltar a cada re-render — aviso vira armadilha.
  const [jaAbriuPara, setJaAbriuPara] = useState<string | null>(null);

  const aviso = pendentes[indice];
  const devolvida = aviso?.evento === 'devolvida';

  const tentarAbrir = useCallback(() => {
    const primeiro = pendentes[0] ? chave(pendentes[0]) : null;
    if (!primeiro || primeiro === jaAbriuPara) return;
    if (emOperacao(activeView)) return;
    if (digitandoAgora()) return;
    setJaAbriuPara(primeiro);
    setIndice(0);
    setOpen(true);
  }, [pendentes, jaAbriuPara, activeView]);

  useEffect(() => {
    if (pendentes.length === 0) { setOpen(false); return; }
    if (indice > pendentes.length - 1) setIndice(Math.max(0, pendentes.length - 1));
    tentarAbrir();
  }, [pendentes, indice, tentarAbrir]);

  // Represado: recheca sozinho enquanto houver documento esperando. Quem passa
  // a aula no PDV só veria o modal ao trocar de tela.
  useEffect(() => {
    const primeiro = pendentes[0] ? chave(pendentes[0]) : null;
    if (!primeiro || primeiro === jaAbriuPara) return;
    const t = window.setInterval(tentarAbrir, 30000);
    return () => window.clearInterval(t);
  }, [pendentes, jaAbriuPara, tentarAbrir]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (pendentes.length === 0) return null;

  const confirmar = async () => {
    if (!aviso) return;
    setSalvando(true);
    const { error } = await darCiencia(aviso);
    setSalvando(false);
    if (error) return showToast?.(error, 'error');
    showToast?.('Ciente.', 'success');
  };

  // Ir para a tela onde o trabalho acontece — e dar ciência no caminho, porque
  // quem foi resolver já viu o recado.
  const irResolver = async () => {
    if (!aviso) return;
    const destino = aviso.evento === 'devolvida' ? 'requisicoes-dosetor' : 'requisicoes-aprovações';
    await darCiencia(aviso);
    setOpen(false);
    onNavigate?.(destino);
  };

  const quantos = pendentes.length;
  const rotuloFab = pendentes[0]?.evento === 'devolvida'
    ? (quantos === 1 ? 'Requisição devolvida' : 'Requisições devolvidas')
    : (quantos === 1 ? 'Requisição corrigida' : 'Requisições corrigidas');

  return (
    <>
      {!emOperacao(activeView) && (
        <motion.button
          onClick={() => { setIndice(0); setOpen(true); }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Ver requisições que esperam por você"
          className="fixed bottom-88 right-6 z-40 h-12 pl-4 pr-5 rounded-full neu-flat border border-orange-400/40 flex items-center gap-2 text-orange-200 hover:border-orange-400 hover:text-orange-100 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
          style={{ background: 'var(--color-card-bg)' }}
        >
          <span className="relative flex items-center justify-center">
            <span className="absolute inline-flex w-5 h-5 rounded-full bg-orange-400/30 animate-ping" />
            <RotateCcw size={18} className="relative" />
          </span>
          <span className="text-xs font-black uppercase tracking-widest">{rotuloFab}</span>
          {quantos > 1 && (
            <span className="text-[10px] font-black tabular-nums w-5 h-5 rounded-full bg-orange-400/20 border border-orange-400/40 flex items-center justify-center">
              {quantos}
            </span>
          )}
        </motion.button>
      )}

      <AnimatePresence>
        {open && aviso && (
          <motion.div
            key="requisicao-aviso-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              key="requisicao-aviso-dialog"
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
              className="neu-flat rounded-3xl border border-orange-400/30 p-5 sm:p-6 w-full max-w-lg max-h-[85vh] flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-orange-400/10 ring-1 ring-orange-400/30 flex items-center justify-center shrink-0">
                    <RotateCcw size={18} className="text-orange-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-orange-300">
                      {devolvida ? 'Requisição devolvida para correção' : 'Requisição corrigida e reenviada'}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {numeroRequisicao(aviso)}
                      {quantos > 1 && ` · ${indice + 1} de ${quantos}`}
                    </p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Fechar"
                  className="shrink-0 neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto flex flex-col gap-3 -mx-1 px-1">
                <h3 className="text-lg font-black text-gray-100 leading-tight">{aviso.item}</h3>
                <p className="text-xs text-gray-400">
                  {aviso.qtd ?? '—'} {aviso.unidade ?? ''}
                  {aviso.solicitante ? ` · pedido por ${aviso.solicitante}` : ''}
                </p>

                {devolvida ? (
                  <>
                    <div className="neu-pressed rounded-xl p-3">
                      <span className="text-[10px] text-orange-300/90 uppercase tracking-widest font-bold block mb-1">
                        Motivo da devolução
                      </span>
                      <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {aviso.correcao_motivo || 'O gerente devolveu sem escrever o motivo.'}
                      </p>
                    </div>
                    <p className="text-[11px] text-gray-500 leading-snug">
                      Nada foi negado — o documento continua vivo e é o MESMO que volta corrigido.
                      Não abra outra requisição para o mesmo item: em Requisições &gt; Do Setor,
                      aba “Para corrigir”, você conserta e reenvia esta.
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-gray-500 leading-snug">
                    O solicitante corrigiu o que você pediu e devolveu o documento para a sua fila.
                    Ele espera Aprovar ou Negar em Requisições &gt; Aprovações, aba “Para decidir”.
                  </p>
                )}

                <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-white/5 text-[11px] text-gray-500">
                  <span>{formatDataHoraBR(aviso.evento_em)}</span>
                  <span className="flex items-center gap-1.5">
                    <Building2 size={11} />
                    {aviso.filial ?? '—'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                {quantos > 1 ? (
                  <button
                    onClick={() => setIndice(i => (i + 1) % quantos)}
                    className="text-[11px] font-bold px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-gray-200"
                  >
                    Ver a próxima
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <button
                    onClick={confirmar}
                    disabled={salvando}
                    className="text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-xl neu-button text-gray-300 hover:text-gray-100 flex items-center gap-2 disabled:opacity-50"
                  >
                    {salvando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Ciente
                  </button>
                  <button
                    onClick={irResolver}
                    disabled={salvando}
                    className="text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-xl neu-button text-orange-300 ring-1 ring-orange-500/40 hover:ring-orange-400 flex items-center gap-2 disabled:opacity-50"
                  >
                    {devolvida ? 'Corrigir agora' : 'Decidir agora'}
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
