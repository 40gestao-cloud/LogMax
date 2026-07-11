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

const FMT_DATETIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Rio_Branco',
  day:    '2-digit',
  month:  '2-digit',
  year:   'numeric',
  hour:   '2-digit',
  minute: '2-digit',
});

/** Formata um timestamp ISO/Date em "DD/MM/YYYY HH:MM" no fuso do Acre.
 *  Devolve string vazia para entrada vazia/inválida — facilita uso em JSX. */
export function formatDataHoraBR(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return FMT_DATETIME.format(d);
}

const FMT_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Rio_Branco',
  weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
});

/** Data por extenso no fuso do Acre: "quarta-feira, 10 de julho de 2026". */
export function dataExtensoBR(d: Date = new Date()): string {
  return FMT_EXTENSO.format(d);
}

/** Saudação por hora do dia no fuso do Acre: "Bom dia/tarde/noite". */
export function saudacaoBR(d: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Rio_Branco', hour: '2-digit', hour12: false,
  }).format(d));
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
