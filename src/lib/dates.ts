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

/**
 * Dia (no fuso do Acre) em que um timestamp caiu, formato `YYYY-MM-DD`.
 *
 * `iso.slice(0,10)` não serve: `created_at` vem em UTC, e das 19h às 24h do
 * Acre o corte de UTC já é o dia seguinte. Quem compara com uma data gravada
 * pelo banco em ACT (o corte de turma da migr. 505/514, por exemplo) erraria
 * cinco horas por dia.
 */
export function dataBR(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : FMT.format(d);
}

/** Data N dias antes de hoje no fuso do Acre, formato `YYYY-MM-DD`. */
export function daysAgoBR(dias: number): string {
  const [y, m, d] = todayBR().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dias);
  return dt.toISOString().slice(0, 10);
}

export type PeriodoFiltro = '' | 'hoje' | 'semana' | 'mes';

/**
 * Intervalo [inicio, fim] em `YYYY-MM-DD` para os filtros de período das telas
 * financeiras, ancorado no fuso do Acre. Semana começa na segunda.
 *
 * Existe porque ContasPagar/ContasReceber montavam isto com
 * `new Date().toISOString()`: em UTC-5 o dia virava às 19h locais, então das
 * 19h à meia-noite o filtro "Hoje" escondia o que vencia hoje.
 */
export function periodoRangeBR(periodo: PeriodoFiltro): { inicio: string; fim: string } | null {
  if (!periodo) return null;
  const hojeStr = todayBR();
  if (periodo === 'hoje') return { inicio: hojeStr, fim: hojeStr };

  const [y, m, d] = hojeStr.split('-').map(Number);
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);

  if (periodo === 'semana') {
    // UTC puro: a data já veio resolvida no fuso do Acre, aqui é só aritmética.
    const base = new Date(Date.UTC(y, m - 1, d));
    const dow = base.getUTCDay();
    const segunda = new Date(base);
    segunda.setUTCDate(base.getUTCDate() - (dow === 0 ? 6 : dow - 1));
    const domingo = new Date(segunda);
    domingo.setUTCDate(segunda.getUTCDate() + 6);
    return { inicio: iso(segunda), fim: iso(domingo) };
  }

  return {
    inicio: iso(new Date(Date.UTC(y, m - 1, 1))),
    fim:    iso(new Date(Date.UTC(y, m, 0))),
  };
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
