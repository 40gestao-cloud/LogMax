import { useState } from 'react';
import { FileSpreadsheet, FolderOpen } from 'lucide-react';
import { baixarModeloPlanilha, type ModeloEntidade } from '../lib/modelosPlanilha';
import { MinhasPlanilhasModal } from './MinhasPlanilhasModal';
import { useAuth } from '../hooks/useAuth';

// Par de botões da barra de ferramentas da tela:
//
//   "Modelo de planilha"  → baixa o .xlsx espelho do formulário, com as listas
//                           suspensas já carregadas do LogMax.
//   "Minhas planilhas"    → onde a planilha PREENCHIDA fica guardada (migr.
//                           389). Antes disso ela dependia de pendrive,
//                           WhatsApp ou Drive pessoal para chegar à aula
//                           seguinte, e era o que mais se perdia.
//
// Sem gate de RBAC: quem enxerga a tela pode baixar o modelo, porque o arquivo
// não carrega dado da operação — é só a estrutura dos campos —, e guardar a
// própria planilha é de todo mundo. A RLS confina cada aluno à própria pasta.
//
// `useAuth` em vez de `useUserProfile` de propósito: aqui só é preciso o
// `auth.uid()`, que já está na sessão. Chamar o perfil acrescentaria uma
// consulta em cada uma das quatro telas que montam este botão.
export const BotaoModeloPlanilha = ({ entidade, filial, showToast, label = 'Modelo de planilha' }: {
  entidade: ModeloEntidade;
  filial: string;
  showToast?: (msg: string, tipo?: string, flag?: boolean) => void;
  label?: string;
}) => {
  const { user } = useAuth();
  const [baixando, setBaixando] = useState(false);
  const [aberto, setAberto] = useState(false);

  const handleClick = async () => {
    setBaixando(true);
    try {
      await baixarModeloPlanilha(entidade, filial);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Não foi possível gerar o modelo.', 'error', true);
    } finally {
      setBaixando(false);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={baixando}
        title="Baixa uma planilha com os campos desta tela e listas suspensas já preenchidas com o que existe no LogMax, para conferir antes de cadastrar"
        className="neu-button py-2 px-4 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-50"
      >
        <FileSpreadsheet size={13} />
        {baixando ? 'Gerando...' : label}
      </button>

      <button
        onClick={() => setAberto(true)}
        title="Guarde aqui a planilha preenchida e continue de onde parou na próxima aula, de qualquer computador"
        className="neu-button py-2 px-4 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors flex items-center gap-1.5"
      >
        <FolderOpen size={13} />
        Minhas planilhas
      </button>

      {aberto && (
        <MinhasPlanilhasModal
          entidade={entidade}
          filial={filial}
          userId={user?.id}
          userNome={user?.email ?? ''}
          onClose={() => setAberto(false)}
          showToast={showToast}
        />
      )}
    </>
  );
};
