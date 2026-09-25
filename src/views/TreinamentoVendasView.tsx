import { motion } from 'motion/react';
import { ExternalLink } from 'lucide-react';

// =================================================================
// LogMax — Vendas › Treinamento
// =================================================================
// Porta para o MaxPOS, o simulador de frente de caixa onde a turma
// treina antes de operar o PDV de verdade. É só um cartão com link
// externo: não há estado nem dado de banco aqui.
//
// A logo é azul-marinho sobre fundo transparente, então some no tema
// dark. O quadro branco atrás dela fica nos dois temas — é o que a
// mantém legível.
// =================================================================

const MAXPOS_URL = 'https://maxpos-x.vercel.app';

export function TreinamentoVendasView() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Treinamento</h2>
      </div>

      <div className="neu-flat rounded-3xl p-5 sm:p-7 flex flex-col items-center justify-center text-center border border-accent/20 max-w-sm w-full mx-auto">
        <div className="w-full max-w-[200px] rounded-2xl bg-white border border-black/10 px-6 py-6 mb-5">
          <img src="/icon-maxpos.png" alt="MaxPOS" className="w-full h-auto" />
        </div>

        <span className="text-xs text-gray-500 leading-snug mb-6 max-w-[260px]">
          Ambiente de treino da frente de caixa — venda, pagamento e fechamento sem afetar o estoque nem o caixa do LogMax.
        </span>

        <a
          href={MAXPOS_URL} target="_blank" rel="noopener noreferrer"
          className="btn-shimmer w-full max-w-[260px] py-3 px-6 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
          style={{
            background: 'var(--color-accent)',
            color:      'var(--color-accent-text)',
            border:     'none',
            boxShadow:  '0 1px 2px rgba(0, 0, 0, 0.35)',
          }}>
          Abrir MaxPOS <ExternalLink size={14} />
        </a>
      </div>
    </motion.div>
  );
}
