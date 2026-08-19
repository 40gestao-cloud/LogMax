// Exclusão de documento do fluxo — só admin, e só como último recurso.
//
// A migr. 340 tirou a exclusão de todo mundo porque apagar quebra o trabalho da
// turma: some o documento que o aluno abriu, o gerente aprovou e Compras ia
// cotar. O banco, porém, sempre manteve a saída para a direção; o que faltava
// era a porta na tela.
//
// Ela existe separada e diferente do resto de propósito: quem clica aqui
// precisa saber que está destruindo rastro, e precisa ter lido que existe um
// caminho melhor. Por isso a confirmação nomeia a alternativa em vez de só
// perguntar "tem certeza?".

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { dbDelete } from '../hooks/useSupabaseData';
import { useConfirm } from '../contexts/ConfirmContext';

export function ExcluirAdmin({ endpoint, id, rotulo, alternativa, showToast, onExcluido }: {
  endpoint: string;
  id: string;
  rotulo: string;
  /** O que fazer em vez de excluir, na linguagem daquela tela. */
  alternativa: string;
  showToast: (msg: string, tipo?: string, persist?: boolean) => void;
  onExcluido?: () => void;
}) {
  const confirm = useConfirm();
  const [indo, setIndo] = useState(false);

  const excluir = async () => {
    if (!await confirm(
      `Excluir ${rotulo}?\n\n` +
      `Isto some com o documento e com a correspondência dele nas outras telas — ` +
      `foi o que já aconteceu uma vez, e levou meio dia para ser entendido.\n\n` +
      `Se o objetivo é corrigir um erro, ${alternativa}\n\n` +
      `Excluir é exclusivo do admin e não tem desfazer pela tela.`)) return;

    setIndo(true);
    try {
      await dbDelete(endpoint, id);
      showToast(`${rotulo} excluído.`, 'success', true);
      onExcluido?.();
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível excluir.', 'error', true);
    } finally {
      setIndo(false);
    }
  };

  return (
    <button onClick={excluir} disabled={indo} title="Excluir (admin)"
      className="action-btn-delete">
      <Trash2 size={12} />
    </button>
  );
}
