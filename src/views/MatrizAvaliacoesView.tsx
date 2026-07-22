import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy, Loader2, FileDown, FileSpreadsheet } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';
import { MatrizTarefasPanel } from './MatrizTarefasPanel';
import { buscarRelatorioCentralAvaliacao, exportCentralAvaliacaoPDF, exportCentralAvaliacaoExcel } from '../lib/centralAvaliacaoExports';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const FILIAL_TONE: Record<FilialOp, string> = {
  SuperMax: 'bg-sky-500/20 text-sky-300',
  MaxLook:  'bg-amber-400/20 text-amber-200',
  TechMax:  'bg-orange-500/20 text-orange-300',
};

type Competicao = {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  status: string;
};

// Central de Avaliação — Competição: hoje é só o painel de Tarefas da Matriz.
// Admin/CEO cadastra atividades por tipo (treinamento em vendas, treinamento em IA,
// apresentação, etc.); CEO+conselheiros julgam por participante.
export function MatrizAvaliacoesView({ profile, showToast }: { profile: UserProfile; showToast: any }) {
  const podeAvaliar = profile.role === 'ceo' || isConselheiro(profile);
  const podeAcessar = profile.role === 'admin' || podeAvaliar;

  const [competicao, setCompeticao] = useState<Competicao | null>(null);
  const [loadingComp, setLoadingComp] = useState(true);
  const [exportando, setExportando] = useState<'pdf' | 'excel' | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingComp(true);
      const { data } = await supabase
        .from('competicoes_matriz')
        .select('id,nome,data_inicio,data_fim,status')
        .eq('ativo', true)
        .eq('status', 'em_andamento')
        .maybeSingle();
      setCompeticao(data as any);
      setLoadingComp(false);
    })();
  }, []);

  if (!podeAcessar) {
    return <EmptyState message="⛔ Acesso restrito — Central de Avaliação Matriz é exclusiva de admin, CEO e conselheiros." />;
  }
  if (loadingComp) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  if (!competicao) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Central de Avaliação — Matriz</h2>
          <p className="text-sm text-gray-400 mt-1">Tarefas propostas pela Matriz para as filiais durante a competição.</p>
        </div>
        <EmptyState message="🏆 Nenhuma competição em andamento — abra uma em Matriz → Competição para começar a cadastrar tarefas." />
      </motion.div>
    );
  }

  const nomeArquivo = `central-avaliacao-${competicao.nome.trim().replace(/[^a-zA-Z0-9]+/g, '-')}`;

  const baixarPDF = async () => {
    setExportando('pdf');
    try {
      const rel = await buscarRelatorioCentralAvaliacao(competicao);
      await exportCentralAvaliacaoPDF(rel, nomeArquivo);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar PDF.', 'error');
    } finally {
      setExportando(null);
    }
  };

  const baixarExcel = async () => {
    setExportando('excel');
    try {
      const rel = await buscarRelatorioCentralAvaliacao(competicao);
      await exportCentralAvaliacaoExcel(rel, nomeArquivo);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar Excel.', 'error');
    } finally {
      setExportando(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="neu-flat rounded-2xl border border-accent/20 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-accent tracking-tight truncate">Central de Avaliação — Matriz</h2>
            <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
              <Trophy size={12} className="text-amber-400" />
              <span className="font-mono font-bold text-gray-200">{competicao.nome}</span>
              <span className="text-gray-500">·</span>
              <span className="font-mono">{competicao.data_inicio} → {competicao.data_fim}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              onClick={baixarPDF}
              disabled={exportando !== null}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all disabled:opacity-50"
              title="Baixar consolidado em PDF"
            >
              {exportando === 'pdf' ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
              PDF
            </button>
            <button
              onClick={baixarExcel}
              disabled={exportando !== null}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all disabled:opacity-50"
              title="Baixar consolidado em Excel"
            >
              {exportando === 'excel' ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
              Excel
            </button>
            {!podeAvaliar && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg bg-gray-500/15 text-gray-400 border border-gray-500/30">
                Modo leitura
              </span>
            )}
          </div>
        </div>
      </div>

      <MatrizTarefasPanel
        competicao={competicao}
        profile={profile}
        podeAvaliar={podeAvaliar}
        showToast={showToast}
      />
    </motion.div>
  );
}

// Re-exports preservados — MatrizTarefasPanel consome esses símbolos.
export type { Competicao as CentralCompeticao };
export const CENTRAL_FILIAL_TONE = FILIAL_TONE;
export { OP_FILIAIS as CENTRAL_OP_FILIAIS };
