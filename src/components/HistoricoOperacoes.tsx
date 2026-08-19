// Trilha de um documento: quem fez o quê, quando, e de onde para onde.
//
// Substitui o <AuditoriaInspect> nas tabelas que têm `trg_historico`. Aquele
// mostrava "criado por / alterado por último", e a trilha já traz isso na
// primeira linha (o trigger grava o evento `Criado`, e a migr. 333 fez backfill
// do que é anterior). Dois ícones de relógio lado a lado, contando a mesma
// coisa com regras de visibilidade diferentes, só confundiam.
//
// Sobrava um caso que a trilha não conta: UPDATE em coluna fora do TG_ARGV do
// trigger (mexer só na observação, por exemplo) move `updated_at` sem gerar
// evento. Por isso `criadoEm` / `atualizadoEm` entram como props e viram o
// rodapé de datas — incluindo o aviso quando houve edição sem trilha.
//
// Lê no clique, não no render: uma tabela com 60 linhas não deve fazer 60
// consultas de histórico para mostrar um ícone.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { History, X, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDataHoraBR } from '../lib/dates';

type Evento = {
  id: string;
  evento: string;
  de: string | null;
  para: string | null;
  detalhe: string | null;
  ator_nome: string | null;
  ator_setor: string | null;
  created_at: string;
};

// Rótulo humano das colunas que o trigger grava cruas. Coluna sem tradução cai
// no próprio nome — melhor um nome técnico do que esconder a mudança.
const CAMPO_LABEL: Record<string, string> = {
  item: 'item', qtd: 'quantidade', urgencia: 'urgência', centro_custo: 'centro de custo',
  valor_total: 'valor', valor: 'valor', fornecedor_id: 'fornecedor',
  prazo_entrega: 'prazo de entrega', qtd_recebida: 'quantidade recebida',
  vencimento: 'vencimento', destino: 'destino', aprovador: 'aprovador',
};

const traduzDetalhe = (d: string) =>
  d.replace(/([a-z_]+): /g, (_, c) => `${CAMPO_LABEL[c] ?? c}: `);

const COR_EVENTO: Record<string, string> = {
  Criado:    'text-emerald-400 border-emerald-500/30',
  Status:    'text-accent border-accent/30',
  Alterado:  'text-yellow-400 border-yellow-500/30',
  Inativado: 'text-red-400 border-red-500/30',
};

export function HistoricoOperacoes({ entidade, entidadeId, titulo, criadoEm, atualizadoEm }: {
  entidade: string;
  entidadeId: string;
  titulo?: string;
  /** `created_at` da linha — carimba o cabeçalho mesmo se a trilha estiver vazia. */
  criadoEm?: string | null;
  /** `updated_at` da linha — revela edição que o trigger não registra. */
  atualizadoEm?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!supabase) return;
    setErro(null);
    const { data, error } = await supabase
      .from('historico_operacoes')
      .select('id, evento, de, para, detalhe, ator_nome, ator_setor, created_at')
      .eq('entidade', entidade)
      .eq('entidade_id', entidadeId)
      .order('created_at', { ascending: true });
    if (error) { setErro(error.message); setEventos([]); return; }
    setEventos((data ?? []) as Evento[]);
  }, [entidade, entidadeId]);

  useEffect(() => { if (open) void carregar(); }, [open, carregar]);

  // Margem de 2s: o trigger é AFTER e grava na mesma transação, então o evento
  // sai microssegundos depois do `updated_at`. Sem a folga, todo documento
  // acusaria edição sem trilha.
  const ultimoEvento = eventos?.length ? eventos[eventos.length - 1].created_at : null;
  const edicaoSemTrilha = !!atualizadoEm && !!ultimoEvento &&
    new Date(atualizadoEm).getTime() - new Date(ultimoEvento).getTime() > 2000;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        title="Histórico deste documento"
        aria-label="Ver histórico deste documento"
        className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 border border-white/5 hover:text-accent hover:border-accent/30 transition"
      >
        <History size={12} />
      </button>

      {open && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg max-h-[85vh] flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-accent">Histórico</p>
                  <p className="text-sm font-bold text-gray-200 truncate">{titulo ?? 'Documento'}</p>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Fechar"
                  className="shrink-0 neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto main-scrollbar flex flex-col gap-2 -mx-1 px-1">
                {erro ? (
                  <p className="text-[11px] text-red-400 leading-relaxed flex items-start gap-1.5">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    {erro}
                  </p>
                ) : eventos === null ? (
                  <p className="text-xs text-gray-500 py-6 text-center">Carregando…</p>
                ) : eventos.length === 0 ? (
                  // Documento anterior à migr. 331 não tem trilha, e dizer isso
                  // evita a leitura de que "nada aconteceu".
                  <p className="text-xs text-gray-500 py-6 text-center leading-relaxed">
                    Sem histórico registrado.<br />
                    <span className="text-[11px] text-gray-600">
                      Documentos criados antes do histórico entrar no ar não têm trilha anterior.
                    </span>
                  </p>
                ) : eventos.map(ev => (
                  <div key={ev.id} className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${COR_EVENTO[ev.evento] ?? 'text-gray-400 border-white/10'}`}>
                        {ev.evento}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono">{formatDataHoraBR(ev.created_at)}</span>
                    </div>
                    {(ev.de || ev.para) && (
                      <p className="text-xs text-gray-300">
                        {ev.de ? <><span className="text-gray-500">{ev.de}</span> → </> : null}
                        <span className="font-bold text-gray-100">{ev.para ?? '—'}</span>
                      </p>
                    )}
                    {ev.detalhe && (
                      <p className="text-[11px] text-gray-400 leading-relaxed">{traduzDetalhe(ev.detalhe)}</p>
                    )}
                    <p className="text-[10px] text-gray-500">
                      {ev.ator_nome ?? '—'}
                      {ev.ator_setor && <span className="uppercase tracking-widest text-gray-600"> · {ev.ator_setor}</span>}
                    </p>
                  </div>
                ))}
              </div>

              {(criadoEm || atualizadoEm) && (
                <div className="shrink-0 border-t border-white/5 pt-3 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-gray-500">
                  {criadoEm && (
                    <span>Criado em <span className="tabular-nums text-gray-400">{formatDataHoraBR(criadoEm)}</span></span>
                  )}
                  {atualizadoEm && atualizadoEm !== criadoEm && (
                    <span>Última alteração <span className="tabular-nums text-gray-400">{formatDataHoraBR(atualizadoEm)}</span></span>
                  )}
                </div>
              )}

              {edicaoSemTrilha && (
                <p className="text-[10px] text-yellow-400/80 leading-relaxed shrink-0 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  Houve edição depois do último evento acima. A trilha só registra status, inativação
                  e os campos que valem como decisão — ajuste em outro campo move a data sem gerar linha.
                </p>
              )}

              <p className="text-[10px] text-gray-500 leading-relaxed shrink-0">
                O histórico não pode ser editado nem apagado por ninguém pela aplicação — é o que o
                torna útil quando há dúvida sobre o que aconteceu.
              </p>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
