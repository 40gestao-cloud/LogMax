// Util de datas no fuso do Acre (UTC-5). Toda regra de negócio que
// depende de "hoje" (caixa do dia, ponto, validade de promoção,
// vencimento) precisa usar ACT para alinhar com a percepção do
// usuário e com o `CURRENT_DATE` das funções SECURITY DEFINER no
// Postgres (cluster Supabase fica em UTC; resolvemos isso no FRONT
// para que o `data` inserido em `controle_caixa` etc. case com o
// dia local do operador).

const FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Rio_Branco',
  year:  'numeric',
  month: '2-digit',
  day:   '2-digit',
});

/** Data de hoje no fuso do Acre (`America/Rio_Branco`) no formato `YYYY-MM-DD`. */
export function todayBR(): string {
  return FMT.format(new Date());
}
