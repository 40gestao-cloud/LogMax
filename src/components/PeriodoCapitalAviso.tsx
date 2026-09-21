import { AlertTriangle } from 'lucide-react';
import { todayBR } from '../lib/dates';

// `calcular_saldo_capital` só soma o que caiu DENTRO da janela do
// `capital_config` vigente. Fora dela o lançamento existe, o dinheiro está na
// conta, e a tela mostra zero — foi exatamente o que aconteceu em 21/09/2026:
// aporte de R$ 35 milhões na holding com "Capital Total 0,00", porque o último
// período cadastrado tinha terminado em 08/09.
//
// O silêncio era o defeito: sem este aviso, o número zerado parece perda de
// dado. Aqui a tela diz qual é a janela e o que fazer.
export function PeriodoCapitalAviso({
  dataInicio, dataFim, podeConfigurar,
}: {
  dataInicio: string | null | undefined;
  dataFim: string | null | undefined;
  // Só o admin/CEO abre período novo; para o resto o texto vira "procure a Matriz".
  podeConfigurar?: boolean;
}) {
  // Coluna `date` é texto 'YYYY-MM-DD' e comparação de string basta — passar
  // por `new Date()` traria o fuso de volta ([[feedback_coluna_date_nao_passa_por_new_date]]).
  const hoje = todayBR();
  const fechado = !!dataFim && dataFim < hoje;
  const naoComecou = !!dataInicio && dataInicio > hoje;
  if (!fechado && !naoComecou) return null;

  const fmt = (d: string) => d.split('-').reverse().join('/');

  return (
    <div className="neu-flat rounded-2xl p-4 border border-amber-500/40 bg-amber-500/5 flex items-start gap-3">
      <AlertTriangle size={16} className="shrink-0 text-amber-400 mt-0.5" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-amber-300">
          {fechado
            ? `Período encerrado em ${fmt(dataFim!)}`
            : `Período começa em ${fmt(dataInicio!)}`}
        </p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Os números desta tela contam apenas o que foi lançado
          {dataInicio ? ` de ${fmt(dataInicio)}` : ''}
          {dataFim ? ` até ${fmt(dataFim)}` : ''}.
          Aporte, empréstimo, receita e despesa fora dessa janela aparecem como
          zero — o lançamento continua gravado e o dinheiro continua na conta.
          {podeConfigurar
            ? ' Para voltar a contar, abra um período novo em Configuração (deixe o Fim em branco para ficar sem prazo).'
            : ' Peça à Matriz para abrir um período novo.'}
        </p>
      </div>
    </div>
  );
}
