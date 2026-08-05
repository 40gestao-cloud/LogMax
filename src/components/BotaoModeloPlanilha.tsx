import React, { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { baixarModeloPlanilha, type ModeloEntidade } from '../lib/modelosPlanilha';

// Botão "Modelo de planilha" — baixa o .xlsx espelho do formulário da tela
// (ver src/lib/modelosPlanilha.ts). Sem gate de RBAC: quem enxerga a tela pode
// baixar o modelo dela, porque o arquivo não carrega dado nenhum da operação —
// é só a estrutura dos campos.
export const BotaoModeloPlanilha = ({ entidade, filial, showToast, label = 'Modelo de planilha' }: {
  entidade: ModeloEntidade;
  filial: string;
  showToast?: (msg: string, tipo?: string, flag?: boolean) => void;
  label?: string;
}) => {
  const [baixando, setBaixando] = useState(false);

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
    <button
      onClick={handleClick}
      disabled={baixando}
      title="Baixa uma planilha em branco com os campos desta tela, para preencher antes de cadastrar no LogMax"
      className="neu-button py-2 px-4 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-50"
    >
      <FileSpreadsheet size={13} />
      {baixando ? 'Gerando...' : label}
    </button>
  );
};
