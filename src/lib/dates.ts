// Util de datas no fuso de Brasília. Toda regra de negócio que
// depende de "hoje" (caixa do dia, ponto, validade de promoção,
// vencimento) precisa usar BRT para alinhar com a percepção do
// usuário e com o `CURRENT_DATE` das funções SECURITY DEFINER no
// Postgres (cluster Supabase fica em UTC, mas as RPCs já operam
// no contexto de uma transação BR — `criar_venda_pdv` usa CURRENT_DATE,
// que aqui também é UTC; resolvemos isso no FRONT para que o `data`
// inserido em `controle_caixa` etc. case com o cálculo do front).

const FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year:  'numeric',
  month: '2-digit',
  day:   '2-digit',
});

/** Data de hoje em América/São_Paulo no formato `YYYY-MM-DD`. */
export function todayBR(): string {
  return FMT.format(new Date());
}
