// FAB de convocação para vaga interna — visível em qualquer tela enquanto o
// funcionário tiver convite sem resposta. Clica → modal com a vaga → anexa o
// currículo e concorre, ou recusa. Respondido, sai da fila; fila vazia, o FAB
// some sozinho.
//
// Fica acima do PedidoOnlineFAB (bottom-40) na pilha do canto direito.
//
// Por que FAB e não item de menu: a convocação é nominal e episódica. Um item
// fixo na sidebar ficaria vazio para quase todo mundo quase o tempo todo, e
// justamente quem foi convocado é quem menos costuma abrir o módulo de RH.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BriefcaseBusiness, X, Send, Clock, Loader2, Paperclip, Building2, Star } from 'lucide-react';
import { formatDataHoraBR } from '../lib/dates';
import { useConvitesVaga } from '../hooks/useConvitesVaga';
import type { UserProfile } from '../hooks/useUserProfile';

const brl = (n: any) =>
  `R$ ${Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ConviteVagaFAB({ profile, showToast, hideTrigger, openSignal, onCount }: {
  profile: UserProfile; showToast?: any;
  /** FAB único de pendências (item 23): esconde o próprio botão e só reage
   *  ao `openSignal` para abrir o modal. `onCount` devolve o tamanho da fila
   *  para quem mostra a contagem — o hook fica montado só aqui. */
  hideTrigger?: boolean; openSignal?: number; onCount?: (n: number) => void;
}) {
  const { pendentes, responder, enviarCurriculo } = useConvitesVaga(profile);
  const [open, setOpen] = useState(false);
  const [indice, setIndice] = useState(0);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // A fila encolhe a cada resposta — reancora o índice pra não estourar.
  useEffect(() => {
    if (indice > pendentes.length - 1) setIndice(Math.max(0, pendentes.length - 1));
    if (pendentes.length === 0) setOpen(false);
  }, [pendentes.length, indice]);

  useEffect(() => {
    if (!openSignal) return;
    // Reset em linha, sem chamar `limpar` — ela só existe depois do early
    // return de baixo, e um `openSignal` chegando no mesmo render em que a
    // fila está vazia (corrida rara com o realtime) pegaria TDZ.
    setIndice(0);
    setArquivo(null);
    setMotivo('');
    setRecusando(false);
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  // Antes do early return: fila vazia também é notícia para quem conta.
  useEffect(() => { onCount?.(pendentes.length); }, [pendentes.length, onCount]);
  useEffect(() => () => { onCount?.(0); }, [onCount]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (pendentes.length === 0) return null;

  const convite = pendentes[indice];
  const vaga = convite?.vagas;

  const limpar = () => { setArquivo(null); setMotivo(''); setRecusando(false); if (inputRef.current) inputRef.current.value = ''; };

  const escolherArquivo = (f: File | null) => {
    if (!f) { setArquivo(null); return; }
    if (f.type !== 'application/pdf') { showToast?.('O currículo precisa ser um PDF.', 'error'); return; }
    if (f.size > 2 * 1024 * 1024)     { showToast?.('O arquivo passa de 2 MB.', 'error'); return; }
    setArquivo(f);
  };

  const concorrer = async () => {
    if (!convite) return;
    setSalvando(true);

    // O upload vem antes da RPC: candidatura gravada apontando para um arquivo
    // que falhou seria pior do que não ter candidatura nenhuma.
    let path: string | null = null;
    if (arquivo) {
      const up = await enviarCurriculo(arquivo);
      if (up.error) { setSalvando(false); return showToast?.(up.error, 'error', true); }
      path = up.path ?? null;
    }

    const { error } = await responder(convite.id, true, path);
    setSalvando(false);
    if (error) return showToast?.(error, 'error', true);
    limpar();
    showToast?.('Candidatura enviada — o RH já foi avisado.', 'success');
  };

  const recusar = async () => {
    if (!convite) return;
    setSalvando(true);
    const { error } = await responder(convite.id, false, null, motivo.trim() || null);
    setSalvando(false);
    if (error) return showToast?.(error, 'error', true);
    limpar();
    showToast?.('Convite recusado.', 'success');
  };

  return (
    <>
      {!hideTrigger && (
      <motion.button
        onClick={() => { setIndice(0); limpar(); setOpen(true); }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Ver vaga para a qual você foi convocado"
        className="fixed bottom-56 right-6 z-40 h-12 pl-4 pr-5 rounded-full neu-flat border border-indigo-400/40 flex items-center gap-2 text-indigo-200 hover:border-indigo-400 hover:text-indigo-100 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        style={{ background: 'var(--color-card-bg)' }}
      >
        <span className="relative flex items-center justify-center">
          <span className="absolute inline-flex w-5 h-5 rounded-full bg-indigo-400/30 animate-ping" />
          <BriefcaseBusiness size={18} className="relative" />
        </span>
        <span className="text-xs font-black uppercase tracking-widest">Vaga para você</span>
        {pendentes.length > 1 && (
          <span className="text-[10px] font-black tabular-nums w-5 h-5 rounded-full bg-indigo-400/20 border border-indigo-400/40 flex items-center justify-center">
            {pendentes.length}
          </span>
        )}
      </motion.button>
      )}

      <AnimatePresence>
        {open && convite && (
          <motion.div
            key="convite-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              key="convite-dialog"
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
              className="neu-flat rounded-3xl border border-indigo-400/30 p-5 sm:p-6 w-full max-w-lg max-h-[88vh] flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-400/10 ring-1 ring-indigo-400/30 flex items-center justify-center shrink-0">
                    <BriefcaseBusiness size={18} className="text-indigo-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Processo seletivo interno</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      Convocado por {convite.convidado_por_nome ?? 'RH'}
                      {pendentes.length > 1 && ` · ${indice + 1} de ${pendentes.length}`}
                    </p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Fechar"
                  className="shrink-0 neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto flex flex-col gap-3 -mx-1 px-1">
                <h3 className="text-lg font-black text-gray-100 leading-tight">
                  {vaga?.cargo ?? 'Vaga interna'}
                  {vaga?.departamento ? <span className="text-gray-500 font-bold"> · {vaga.departamento}</span> : null}
                </h3>

                {vaga?.justificativa && (
                  <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{vaga.justificativa}</p>
                )}

                <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <Building2 size={11} />
                    {vaga?.filial ?? convite.filial}
                    {vaga?.escopo === 'Interfilial' ? ' · aberta a toda a rede' : ''}
                  </span>
                  {(vaga?.salario_min || vaga?.salario_max) && (
                    <span className="font-mono tabular-nums">
                      {brl(vaga?.salario_min ?? 0)} – {brl(vaga?.salario_max ?? 0)}
                    </span>
                  )}
                  {vaga?.nota_minima != null && (
                    <span className="flex items-center gap-1.5">
                      <Star size={11} /> Exige média {String(vaga.nota_minima).replace('.', ',')}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-[11px] text-amber-300/90 pt-2 border-t border-white/5">
                  <Clock size={11} /> Responda até {formatDataHoraBR(convite.prazo)}
                </div>

                {!recusando ? (
                  <div className="neu-pressed rounded-xl p-4 flex flex-col gap-2.5">
                    <p className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                      <Paperclip size={13} className="text-indigo-300" /> Currículo (PDF, até 2 MB)
                    </p>
                    <input
                      ref={inputRef}
                      type="file"
                      accept="application/pdf"
                      onChange={e => escolherArquivo(e.target.files?.[0] ?? null)}
                      className="text-xs text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-indigo-400/10 file:text-indigo-200 hover:file:bg-indigo-400/20"
                    />
                    {arquivo && (
                      <p className="text-[11px] text-gray-500 truncate">
                        {arquivo.name} · {(arquivo.size / 1024).toFixed(0)} KB
                      </p>
                    )}
                    {/* O RH já tem o cadastro e as avaliações de quem é da casa
                        — o currículo aqui soma, não é porteiro. */}
                    <p className="text-[10px] text-gray-600 leading-relaxed">
                      O anexo é opcional e só o RH da sua unidade e a Matriz conseguem abrir.
                    </p>
                  </div>
                ) : (
                  <div className="neu-pressed rounded-xl p-4 flex flex-col gap-2.5">
                    <p className="text-xs font-bold text-gray-300">Por que não tem interesse? (opcional)</p>
                    <textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
                      className="neu-input rounded-xl px-3 py-2 text-sm resize-none"
                      placeholder="Vai direto para o RH." />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                {recusando ? (
                  <button onClick={() => setRecusando(false)} disabled={salvando}
                    className="text-[11px] font-bold px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                    Voltar
                  </button>
                ) : (
                  <button onClick={() => setRecusando(true)} disabled={salvando}
                    className="text-[11px] font-bold px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                    Não tenho interesse
                  </button>
                )}

                {recusando ? (
                  <button onClick={recusar} disabled={salvando}
                    className="text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-xl neu-button text-red-300 ring-1 ring-red-500/40 hover:ring-red-400 flex items-center gap-2 disabled:opacity-50">
                    {salvando ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                    Confirmar recusa
                  </button>
                ) : (
                  <button onClick={concorrer} disabled={salvando}
                    className="text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-xl neu-button text-indigo-200 ring-1 ring-indigo-500/40 hover:ring-indigo-400 flex items-center gap-2 disabled:opacity-50">
                    {salvando ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Quero concorrer
                  </button>
                )}
              </div>

              {pendentes.length > 1 && !recusando && (
                <button
                  onClick={() => { setIndice(i => (i + 1) % pendentes.length); limpar(); }}
                  className="text-[11px] font-bold text-gray-500 hover:text-gray-300 self-center"
                >
                  Ver outra vaga
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
