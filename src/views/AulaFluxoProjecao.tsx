// Modo projeção — o diagrama do fluxo na parede da sala.
//
// O diagrama dentro do card do Modo Aula sempre foi descrito no código como
// "material de projeção", e era desenhado em 10-11px cinza sobre fundo escuro:
// legível a 40cm do monitor, ilegível no fundo da sala. Esta tela é o mesmo
// conteúdo com a tipografia que a distância exige.
//
// O que ela acrescenta ao diagrama pequeno, além do tamanho:
//   • uma etapa por vez em foco — a aula caminha, a lista inteira acesa não
//     diz onde a turma está;
//   • seta/clique para avançar, porque o professor conduz de longe;
//   • a marca de "fora da aula" continua visível: se a etapa projetada não
//     está na whitelist, a turma não vai encontrá-la, e isso precisa aparecer
//     antes de alguém tentar.
//
// Não recebe `config` do banco: recebe a whitelist EM EDIÇÃO da tela de trás.
// Projetar o que está salvo enquanto o professor mexe em outra coisa seria
// mostrar à turma um fluxo diferente do que ele está montando.

import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, ChevronLeft, ChevronRight, EyeOff, FolderPlus } from 'lucide-react';
import { etapaCoberta, apoioDoFluxo, apoioCoberto, type AulaFluxo } from '../lib/aulaFluxos';
import { rotuloDaView } from '../lib/aulaModulos';

interface Props {
  fluxo: AulaFluxo;
  modulos: string[];
  submenus: string[];
  onClose: () => void;
}

export const AulaFluxoProjecao: React.FC<Props> = ({ fluxo, modulos, submenus, onClose }) => {
  // -1 = nenhuma etapa em foco: a cadeia inteira acesa, que é como a aula
  // começa ("olhem o caminho todo") antes de percorrer etapa a etapa.
  const [atual, setAtual] = useState(-1);
  const total = fluxo.etapas.length;
  // As telas de apoio são a última parada da projeção, não a etapa N+1: o
  // professor avança até elas com a mesma seta, e a turma vê de onde saiu (e
  // para onde volta) o cadastro que a cadeia consome. Ficavam de fora do
  // diagrama inteiro — «Montar» abria Cadastros e a projeção nunca dizia isso.
  const apoio = apoioDoFluxo(fluxo);
  const paradas = total + (apoio ? 1 : 0);

  const avancar = useCallback(() => setAtual(i => Math.min(i + 1, paradas - 1)), [paradas]);
  const voltar = useCallback(() => setAtual(i => Math.max(i - 1, -1)), []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      // Espaço e seta para a direita avançam: são as duas teclas que todo
      // controle remoto de apresentação manda.
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault(); avancar(); return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); voltar();
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [avancar, voltar, onClose]);

  // Fundo sólido, não translúcido: projetor lava o contraste, e o que passa
  // por trás de um overlay 70% vira ruído cinza na parede.
  return (
    <div className="fixed inset-0 z-[60] bg-[#08090b] overflow-y-auto">
      <div className="min-h-full flex flex-col max-w-5xl mx-auto px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight">{fluxo.nome}</h1>
            <p className="text-base sm:text-lg text-gray-400 mt-3 max-w-3xl leading-relaxed">{fluxo.resumo}</p>
          </div>
          <button type="button" onClick={onClose} title="Sair da projeção (Esc)"
            className="shrink-0 w-11 h-11 rounded-xl border border-white/15 flex items-center justify-center text-gray-400 hover:text-white hover:border-white/40 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-0 mt-10 flex-1">
          {fluxo.etapas.map((etapa, i) => {
            const ok = etapaCoberta(etapa, modulos, submenus);
            // Com bloco de apoio, a última etapa deixa de ser o fim do trilho:
            // a linha desce até ele.
            const ultima = i === total - 1 && !apoio;
            const foco = atual === -1 || atual === i;
            const passada = atual > i;
            return (
              <div key={`${etapa.view}-${i}`}
                onClick={() => setAtual(i)}
                className={`flex gap-5 sm:gap-7 cursor-pointer transition-opacity duration-200 ${
                  foco ? 'opacity-100' : passada ? 'opacity-30' : 'opacity-40'}`}>
                <div className="flex flex-col items-center shrink-0">
                  <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-xl sm:text-2xl font-black border-2 transition-colors ${
                    atual === i
                      ? 'bg-accent border-accent text-black'
                      : ok
                        ? 'border-accent/70 text-accent'
                        : 'border-white/25 text-gray-500'}`}>
                    {i + 1}
                  </div>
                  {!ultima && <div className={`w-0.5 flex-1 my-2 ${ok ? 'bg-accent/40' : 'bg-white/15'}`} />}
                </div>
                <div className={`min-w-0 flex-1 ${ultima ? 'pb-4' : 'pb-10'}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-xl sm:text-2xl font-bold text-white leading-snug">{etapa.titulo}</h2>
                    {etapa.opcional && (
                      <span className="text-xs font-black uppercase tracking-widest text-gray-500 border border-white/20 rounded-full px-2.5 py-1">
                        Opcional
                      </span>
                    )}
                    {/* A etapa está no diagrama e não está na whitelist: a turma
                        vai procurar a tela e não vai achar. Aparece na parede
                        porque é lá que o professor está olhando. */}
                    {!ok && (
                      <span className="text-xs font-black uppercase tracking-widest text-yellow-300 border border-yellow-500/50 rounded-full px-2.5 py-1 flex items-center gap-1.5">
                        <EyeOff size={12} /> Fora da aula
                      </span>
                    )}
                  </div>
                  <div className="text-base sm:text-lg text-accent mt-1.5 font-semibold">{etapa.quem}</div>
                  <p className="text-base sm:text-lg text-gray-300 mt-2.5 leading-relaxed max-w-3xl">
                    {etapa.detalhe}
                  </p>
                  {!ok && !etapa.opcional && (
                    <p className="text-sm sm:text-base text-yellow-300/90 mt-2.5 leading-relaxed max-w-3xl">
                      Fora da aula: {etapa.seQuebra}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Bloco de apoio: sem número, de propósito. Numerar aqui ensinaria
              uma sequência que a operação não tem — cadastrar não é o passo 10
              da compra. Fora da cadeia, mas dentro da aula, que é exatamente o
              que o aluno precisa entender ao ver Cadastros na sidebar. */}
          {apoio && (() => {
            const foco = atual === -1 || atual === total;
            const passada = atual > total;
            return (
              <div
                onClick={() => setAtual(total)}
                className={`flex gap-5 sm:gap-7 cursor-pointer transition-opacity duration-200 ${
                  foco ? 'opacity-100' : passada ? 'opacity-30' : 'opacity-40'}`}>
                <div className="flex flex-col items-center shrink-0">
                  <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center border-2 border-dashed transition-colors ${
                    atual === total ? 'bg-accent border-accent text-black' : 'border-white/30 text-gray-400'}`}>
                    <FolderPlus size={22} />
                  </div>
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-xl sm:text-2xl font-bold text-white leading-snug">
                      Apoio — o cadastro que a cadeia usa
                    </h2>
                    <span className="text-xs font-black uppercase tracking-widest text-gray-500 border border-white/20 rounded-full px-2.5 py-1">
                      Fora da numeração
                    </span>
                  </div>
                  <div className="text-base sm:text-lg text-accent mt-1.5 font-semibold">
                    Telas abertas na aula, sem serem etapas
                  </div>
                  <p className="text-base sm:text-lg text-gray-300 mt-2.5 leading-relaxed max-w-3xl">
                    {apoio.nota}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {apoio.views.map(v => {
                      const ok = apoioCoberto(v, modulos, submenus);
                      return (
                        <span key={v}
                          className={`text-sm sm:text-base font-semibold rounded-xl px-3 py-1.5 border flex items-center gap-2 ${
                            ok ? 'border-accent/50 text-accent' : 'border-yellow-500/50 text-yellow-300'}`}>
                          {!ok && <EyeOff size={14} />}
                          {rotuloDaView(v)}
                        </span>
                      );
                    })}
                  </div>
                  {apoio.views.some(v => !apoioCoberto(v, modulos, submenus)) && (
                    <p className="text-sm sm:text-base text-yellow-300/90 mt-3 leading-relaxed max-w-3xl">
                      As telas em amarelo não estão na aula: a turma não vai encontrá-las
                      para cadastrar o que os passos acima exigem.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Barra de condução. Fixa no rodapé da projeção porque o professor
            navega com o mouse na mão, longe do teclado. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="sticky bottom-0 mt-6 flex items-center justify-between gap-4 bg-[#08090b] border-t border-white/10 pt-4 pb-1"
        >
          <span className="text-sm text-gray-500">
            {atual === -1
              ? `Cadeia inteira · ${total} etapas${apoio ? ' + apoio' : ''}`
              : atual === total
                ? 'Apoio — fora da numeração'
                : `Etapa ${atual + 1} de ${total}`}
            <span className="hidden sm:inline text-gray-700"> · setas navegam, Esc sai</span>
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={voltar} disabled={atual === -1}
              className="w-11 h-11 rounded-xl border border-white/15 flex items-center justify-center text-gray-300 hover:text-white hover:border-white/40 transition-colors disabled:opacity-25">
              <ChevronLeft size={20} />
            </button>
            <button type="button" onClick={avancar} disabled={atual === paradas - 1}
              className="w-11 h-11 rounded-xl border border-white/15 flex items-center justify-center text-gray-300 hover:text-white hover:border-white/40 transition-colors disabled:opacity-25">
              <ChevronRight size={20} />
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
