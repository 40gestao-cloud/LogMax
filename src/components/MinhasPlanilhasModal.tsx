import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Trash2, Upload, X } from 'lucide-react';
import {
  listarPlanilhas, salvarPlanilha, baixarPlanilha, excluirPlanilha,
  formatarTamanho, extensaoValida, PLANILHA_TAMANHO_MAX,
  type PlanilhaTrabalho,
} from '../lib/planilhasTrabalho';
import { formatDataHoraBR } from '../lib/dates';
import { LoadingSpinner, EmptyState, FilialBadge } from '../components/ui';
import type { ModeloEntidade } from '../lib/modelosPlanilha';

// "Minhas planilhas" (migração 389) — onde o trabalho preenchido fica guardado.
//
// Antes disto, a planilha preenchida dependia de pendrive, WhatsApp ou Drive
// pessoal para sobreviver até a aula seguinte.
//
// O modal mostra TODAS as planilhas do aluno, não só as da tela em que ele
// está: o arquivo é dele, e ter de adivinhar por qual porta entrou para
// reencontrar o próprio trabalho seria trocar um problema por outro. A tela
// atual só define a etiqueta do que for enviado agora.

const ENTIDADE_LABEL: Record<string, string> = {
  clientes: 'Clientes', fornecedores: 'Fornecedores', produtos: 'Produtos',
  servicos: 'Serviços', requisicoes: 'Requisições', outro: 'Outro',
};

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
  const inputRef = useRef<HTMLInputElement>(null);

  // Sem `userId` não há o que listar: a sessão ainda está resolvendo. Manter o
  // spinner é o certo — a versão anterior chamava a listagem assim mesmo, e
  // sem dono a consulta trazia tudo o que a RLS permitisse, que para admin,
  // CEO e conselheiro é a turma inteira dentro de "Minhas planilhas".
  const carregar = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setItens(await listarPlanilhas(userId));
      setErro(null);
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível listar suas planilhas.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const enviar = async (file: File | undefined) => {
    if (!file || !userId) return;
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
    if (!window.confirm(`Excluir "${p.arquivo_nome}"? Não dá para desfazer.`)) return;
    setOcupado(true);
    try {
      await excluirPlanilha(p);
      showToast?.('Planilha excluída.', 'success');
      await carregar();
    } catch (e: any) {
      showToast?.(e?.message ?? 'Não foi possível excluir.', 'error', true);
    } finally { setOcupado(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="neu-card w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl overflow-hidden"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
              <FolderOpen size={18} className="text-accent shrink-0" /> Minhas planilhas
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Guarde aqui a planilha preenchida e continue de onde parou na próxima aula,
              de qualquer computador. Só você e o professor enxergam.
            </p>
          </div>
          <button onClick={onClose}
            className="shrink-0 modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 border-b border-white/5">
          <input ref={inputRef} type="file" className="hidden"
            accept=".xlsx,.xls,.ods,.csv"
            onChange={e => void enviar(e.target.files?.[0])} />
          <button onClick={() => inputRef.current?.click()} disabled={ocupado || !userId}
            className="neu-button px-4 py-2.5 rounded-xl text-sm text-accent font-medium flex items-center gap-2 disabled:opacity-50">
            <Upload size={15} /> {ocupado ? 'Enviando…' : 'Enviar planilha preenchida'}
          </button>
          <p className="text-[11px] text-gray-500 mt-2">
            Até 5 MB, nos formatos .xlsx, .xls, .ods ou .csv. Enviar um arquivo com o mesmo
            nome substitui o anterior — é assim que você continua a mesma planilha.
            O que for enviado agora fica etiquetado como{' '}
            <span className="text-gray-400">{ENTIDADE_LABEL[entidade] ?? entidade}</span>.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {loading ? <LoadingSpinner />
            : erro ? <EmptyState message="Minhas planilhas" error={erro} />
            : itens.length === 0 ? (
              <EmptyState message="Nenhuma planilha guardada ainda. Baixe o modelo, preencha e envie por aqui." />
            ) : itens.map(p => (
              <div key={p.id} className="bg-black/20 rounded-xl p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-100 truncate">{p.arquivo_nome}</div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap mt-0.5">
                    <span>{ENTIDADE_LABEL[p.entidade] ?? p.entidade}</span>
                    {p.filial && <FilialBadge filial={p.filial} />}
                    <span>{formatarTamanho(p.tamanho_bytes)}</span>
                    {p.versao > 1 && <span>versão {p.versao}</span>}
                    <span>{formatDataHoraBR(p.updated_at)}</span>
                  </div>
                </div>
                <button onClick={() => void baixar(p)} disabled={ocupado} title="Baixar"
                  className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent disabled:opacity-50">
                  <Download size={15} />
                </button>
                {p.user_id === userId && (
                  <button onClick={() => void excluir(p)} disabled={ocupado} title="Excluir"
                    className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-400 disabled:opacity-50">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
