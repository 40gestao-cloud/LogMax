/**
 * Código curto de uma cobrança (`pix_pendentes` / `cartao_pendentes`).
 *
 * POR QUE ELE EXISTE
 *
 * A maquininha MaxPay acha a cobrança pelo VALOR: o operador digita o total e
 * ela procura pendências do mesmo valor abertas nos últimos 5 minutos. Com uma
 * turma de 45 alunos vendendo o mesmo produto pelo preço certo, várias
 * cobranças de R$ 10,00 coexistem — e a maquininha, corretamente, se recusa a
 * escolher sozinha: lista os candidatos e pede que o operador decida.
 *
 * Só que ela lista loja e horário, e quando os candidatos são da mesma loja no
 * mesmo minuto isso não decide nada. Então ela também mostra `nº ABC123` — os
 * seis últimos caracteres do id da cobrança. Faltava o outro lado: o aluno não
 * via esse número em lugar nenhum e não tinha como dizer qual era o dele.
 *
 * Este helper existe para os dois lados falarem o mesmo número. Mexer no
 * formato aqui exige mexer em `PixWaitScreen.tsx` e `NfcReaderScreen.tsx` do
 * repositório MaxPay, que fatiam o id do mesmo jeito.
 *
 * Seis caracteres: é a régua que o ERP já usa para identificar venda em texto
 * ("Venda #A3F91C"), e a chance de dois ids coincidirem nos seis últimos dentro
 * de uma janela de 5 minutos é desprezível.
 */
export function codigoCobranca(id: string): string {
  return String(id).slice(-6).toUpperCase();
}
