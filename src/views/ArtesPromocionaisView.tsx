import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ExternalLink, Maximize2 } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { useFilial } from '../contexts/FilialContext';
import { ehArteHospedada } from '../lib/arteImagem';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { ArteLightbox, periodoArte } from '../components/ArteLightbox';

type Arte = {
  id: string;
  promocao_id: string;
  nome_produto: string;
  descricao_promocao: string | null;
  preco_promocional: number | null;
  data_inicio: string | null;
  data_fim: string | null;
  arte_url: string;
  publicada_em: string;
  nome_publicador: string | null;
};

const ArtesPromocionaisViewInner = ({ filial }: { filial: string }) => {
  const { data: artes, isLoading, error: artesError } = useFetchData<Arte>('/api/marketingartesview', { filial }, true);

  // Visor de apresentação. Só entram as artes hospedadas por nós: link externo
  // colado pelo aluno pode não ser imagem (Canva, Drive, PDF), e um <img> em
  // cima disso mostraria um quadrado quebrado no meio da aula.
  const [ampliado, setAmpliado] = useState<number | null>(null);
  const artesAmpliaveis = useMemo(
    () => artes
      .filter(a => ehArteHospedada(a.arte_url))
      .map(a => ({
        id: a.id,
        src: a.arte_url,
        titulo: a.nome_produto,
        descricao: a.descricao_promocao,
        preco: a.preco_promocional != null
          ? `R$ ${Number(a.preco_promocional).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
          : null,
        periodo: periodoArte(a.data_inicio, a.data_fim),
        rodape: a.nome_publicador
          ? `Publicada por ${a.nome_publicador} · ${new Date(a.publicada_em).toLocaleDateString('pt-BR')}`
          : null,
      })),
    [artes],
  );
  const abrirArte = (id: string) => {
    const pos = artesAmpliaveis.findIndex(a => a.id === id);
    if (pos >= 0) setAmpliado(pos);
  };
  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0 flex items-start justify-between gap-3">
        <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Artes Promocionais — {filial}</h2>
        </div>
      </div>

      {artesError || artes.length === 0 ? (
        <div className="neu-flat rounded-3xl p-10 border border-white/5">
          <EmptyState
            error={artesError}
            message="Nenhuma arte publicada ainda. Quando o Marketing publicar, ela aparece aqui."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {artes.map((arte) => {
            return (
              <motion.div
                key={arte.id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-100 truncate">{arte.nome_produto}</p>
                    {arte.descricao_promocao && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{arte.descricao_promocao}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
                      {arte.preco_promocional != null && (
                        <span className="font-mono text-accent">
                          R$ {Number(arte.preco_promocional).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                      {arte.data_inicio && (
                        <span>· {arte.data_inicio}{arte.data_fim ? ` → ${arte.data_fim}` : ''}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* A peça em si, quando é imagem nossa (migr. 539). Clicar
                    amplia; link externo continua só como botão, porque pode
                    não ser imagem (Canva, Drive, PDF). */}
                {ehArteHospedada(arte.arte_url) && (
                  <button type="button" onClick={() => abrirArte(arte.id)}
                    title="Clique para ampliar"
                    className="block w-full rounded-xl overflow-hidden border border-white/10 bg-black/20 cursor-zoom-in relative group">
                    <img src={arte.arte_url} alt={`Arte de ${arte.nome_produto}`}
                      loading="lazy"
                      className="w-full max-h-56 object-contain" />
                    <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white/80">
                      <Maximize2 size={12} />
                    </span>
                  </button>
                )}

                {/* Arte nossa amplia aqui mesmo; o arquivo original continua
                    a um clique, em texto pequeno, para quem quer baixar. Link
                    externo não tem visor possível — segue abrindo noutra aba. */}
                {ehArteHospedada(arte.arte_url) ? (
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => abrirArte(arte.id)}
                      className="inline-flex items-center justify-center gap-2 neu-button-accent rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-widest"
                    >
                      <Maximize2 size={12} /> Ampliar
                    </button>
                    <a
                      href={arte.arte_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      <ExternalLink size={10} /> abrir o arquivo original
                    </a>
                  </div>
                ) : (
                  <a
                    href={arte.arte_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 neu-button-accent rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-widest"
                  >
                    <ExternalLink size={12} /> Abrir Arte
                  </a>
                )}

                {arte.nome_publicador && (
                  <p className="text-[10px] text-gray-500 -mt-1">
                    Publicada por {arte.nome_publicador} · {new Date(arte.publicada_em).toLocaleDateString('pt-BR')}
                  </p>
                )}

              </motion.div>
            );
          })}
        </div>
      )}

      {ampliado !== null && artesAmpliaveis[ampliado] && (
        <ArteLightbox
          itens={artesAmpliaveis}
          indice={ampliado}
          onIndice={setAmpliado}
          onClose={() => setAmpliado(null)}
        />
      )}
    </motion.div>
  );
};

export const ArtesPromocionaisView = () => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <ArtesPromocionaisViewInner filial={filialAtiva} />;
};
