// Atividade da aula — o lado do aluno.
//
// É a única tela do app cujo conteúdo o professor escreve para a turma daquele
// dia. Fica sempre liberada no Modo Aula (SEMPRE_LIBERADO em aulaModulos.ts):
// uma atividade que o próprio filtro esconde seria pior que não existir.
//
// O PDF é remontado aqui a partir do `roteiro` jsonb, pelo mesmo gerador que o
// professor usou — não há arquivo guardado em lugar nenhum.

import React, { useState } from 'react';
import { ClipboardList, Download, Check, Clock, ChevronDown, Sparkles } from 'lucide-react';
import { useAulaAtividades, type AtividadeAula } from '../hooks/useAulaAtividades';
import { exportAtividadePDF } from '../lib/aulaAtividadePdf';
import { nomeArquivoAtividade } from '../lib/aulaAtividade';
import type { UserProfile } from '../hooks/useUserProfile';
import { LoadingSpinner, EmptyState } from '../components/ui';

interface Props {
  profile: UserProfile;
  showToast: (msg: string, type?: string) => void;
}

const fmtPrazo = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Rio_Branco',
      })
    : '—';

const CartaoAtividade: React.FC<{
  atividade: AtividadeAula;
  profile: UserProfile;
  showToast: Props['showToast'];
  onCiencia: (id: string) => void;
  inicialmenteAberto: boolean;
}> = ({ atividade: a, profile, showToast, onCiencia, inicialmenteAberto }) => {
  const [aberto, setAberto] = useState(inicialmenteAberto);
  const [baixando, setBaixando] = useState(false);

  const baixar = async () => {
    setBaixando(true);
    try {
      await exportAtividadePDF(a, nomeArquivoAtividade(a), 'download', profile, showToast as any);
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível gerar o PDF.', 'error');
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className={`neu-flat rounded-3xl border overflow-hidden ${
      a.lida ? 'border-white/5' : 'border-accent/30'}`}>
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-gray-100">{a.titulo}</h2>
              {!a.lida && (
                <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30">
                  Nova
                </span>
              )}
              {a.geradoPorIa && (
                <span title="Roteiro montado com o MaxAI e revisado pelo professor"
                  className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full text-gray-500 border border-white/10 flex items-center gap-1">
                  <Sparkles size={9} /> MaxAI
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              {a.fluxoNome}
              {a.criador ? ` · por ${a.criador}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={baixar}
              disabled={baixando}
              className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download size={12} /> {baixando ? '…' : 'PDF'}
            </button>
            <button
              type="button"
              onClick={() => setAberto(v => !v)}
              className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent"
              aria-label={aberto ? 'Recolher atividade' : 'Abrir atividade'}
            >
              <ChevronDown size={14} className={`transition-transform ${aberto ? 'rotate-180 text-accent' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5">
            <Clock size={11} /> Até {fmtPrazo(a.expiraEm)}
          </span>
          <span className="text-gray-700">·</span>
          <span>{a.roteiro.tarefas.length} tarefa{a.roteiro.tarefas.length === 1 ? '' : 's'}</span>
        </div>

        {a.objetivo && (
          <p className="text-xs text-gray-400 leading-relaxed border-l-2 border-accent/40 pl-3">
            {a.objetivo}
          </p>
        )}
      </div>

      {aberto && (
        <div className="border-t border-white/5 bg-black/20 px-5 py-4 flex flex-col gap-4">
          {a.roteiro.prerequisitos.length > 0 && (
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">
                Antes de começar
              </h3>
              <ul className="flex flex-col gap-1">
                {a.roteiro.prerequisitos.map((p, i) => (
                  <li key={i} className="text-[11px] text-gray-400">
                    {p.label} <span className="text-gray-600">— {p.onde}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-0">
            {a.roteiro.tarefas.map((t, i) => {
              const ultima = i === a.roteiro.tarefas.length - 1;
              return (
                <div key={i} className="flex gap-3">
                  {/* Mesmo trilho do diagrama de fluxo da tela do professor: a
                      turma reconhece que a lista é uma cadeia, não um checklist. */}
                  <div className="flex flex-col items-center shrink-0 pt-1">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black border border-accent/50 text-accent">
                      {i + 1}
                    </div>
                    {!ultima && <div className="w-px flex-1 my-1 bg-accent/25" />}
                  </div>
                  <div className={`min-w-0 flex-1 ${ultima ? 'pb-0' : 'pb-4'}`}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-gray-200">{t.titulo}</span>
                      {t.opcional && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-600 border border-white/10 rounded-full px-1.5 py-0.5">
                          Opcional
                        </span>
                      )}
                    </div>
                    {t.papel && <div className="text-[10px] text-accent/80 mt-0.5">{t.papel}</div>}
                    {t.enunciado && (
                      <p className="text-[11px] text-gray-400 mt-1 leading-relaxed whitespace-pre-line">
                        {t.enunciado}
                      </p>
                    )}
                    {t.entregavel && (
                      <p className="text-[10px] text-gray-500 mt-1">
                        <span className="text-gray-400 font-bold">Entregar:</span> {t.entregavel}
                      </p>
                    )}
                    {t.criterio && (
                      <p className="text-[10px] text-gray-500 mt-0.5 italic">
                        Avaliação: {t.criterio}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!a.lida && (
            <button
              type="button"
              onClick={() => onCiencia(a.id)}
              className="self-start neu-button px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 hover:bg-accent/10 transition-colors flex items-center gap-1.5"
            >
              <Check size={12} /> Li a atividade
            </button>
          )}
          {a.lida && (
            <span className="self-start text-[10px] uppercase tracking-widest font-bold text-gray-600 flex items-center gap-1.5">
              <Check size={12} /> Leitura confirmada
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export const AulaAtividadeView: React.FC<Props> = ({ profile, showToast }) => {
  const { atividades, loading, darCiencia } = useAulaAtividades(profile);

  const confirmar = async (id: string) => {
    const { error } = await darCiencia(id);
    if (error) showToast(error, 'error');
    else showToast('Leitura confirmada.', 'success');
  };

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 neu-pressed rounded-2xl flex items-center justify-center shrink-0">
          <ClipboardList size={22} className="text-accent" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-100">Atividade da aula</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            O roteiro que a Matriz publicou para a sua turma. Cada tarefa diz em que papel
            ela é feita — as suas são as do papel que você ocupa hoje.
          </p>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : atividades.length === 0 ? (
        <EmptyState message="Nenhuma atividade publicada para você agora. Quando a Matriz enviar uma, ela aparece aqui sem precisar recarregar." />
      ) : (
        <div className="flex flex-col gap-4">
          {atividades.map((a, i) => (
            <CartaoAtividade
              key={a.id}
              atividade={a}
              profile={profile}
              showToast={showToast}
              onCiencia={confirmar}
              // A mais recente já vem aberta: é quase sempre a aula de agora, e
              // um clique a mais entre o aluno e o enunciado é um clique que o
              // professor repete trinta vezes na sala.
              inicialmenteAberto={i === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
};
