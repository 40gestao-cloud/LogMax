// =================================================================
// LogMax — régua dos alarmes da aula (migr. 529)
// =================================================================
// O alarme deixou de ser um lembrete guardado no navegador de quem
// cadastrou: agora ele vive no banco e interrompe a turma inteira,
// em qualquer tela, com um modal central.
//
// Os textos de `intervalo` e `saida` moram AQUI e não no banco de
// propósito — são procedimento da operação, iguais nas 4 turmas, e
// texto repetido linha a linha diverge no primeiro ajuste. Só o
// tipo `aviso` carrega mensagem própria.
// =================================================================

export type AlarmeTipo = 'aviso' | 'intervalo' | 'saida';

export type AlarmeTurma = {
  id: string;
  hora: number;   // 0–23
  minuto: number; // 0–59
  tipo: AlarmeTipo;
  mensagem: string | null;
  ativo: boolean;
  /** Dias em que toca, 0 = domingo … 6 = sábado, no fuso do Acre (migr. 637). */
  dias: number[];
  criado_por: string | null;
  created_at: string;
};

export const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];
export const DIAS_UTEIS = [1, 2, 3, 4, 5];

/** Na ordem da semana de trabalho: segunda primeiro, domingo por último. */
export const DIAS_SEMANA: { valor: number; curto: string; nome: string }[] = [
  { valor: 1, curto: 'Seg', nome: 'Segunda' },
  { valor: 2, curto: 'Ter', nome: 'Terça' },
  { valor: 3, curto: 'Qua', nome: 'Quarta' },
  { valor: 4, curto: 'Qui', nome: 'Quinta' },
  { valor: 5, curto: 'Sex', nome: 'Sexta' },
  { valor: 6, curto: 'Sáb', nome: 'Sábado' },
  { valor: 0, curto: 'Dom', nome: 'Domingo' },
];

/** Linha antiga (antes da 637) chega sem `dias`: toca todo dia, como tocava. */
export const diasDoAlarme = (a: Pick<AlarmeTurma, 'dias'>): number[] =>
  Array.isArray(a.dias) && a.dias.length > 0 ? a.dias : TODOS_OS_DIAS;

/** "Todos os dias", "Seg a Sex", "Fim de semana" ou a lista: "Seg, Qua, Sex". */
export function rotuloDias(dias: number[]): string {
  const set = new Set(dias);
  if (set.size === 7) return 'Todos os dias';
  if (set.size === 5 && DIAS_UTEIS.every(d => set.has(d))) return 'Seg a Sex';
  if (set.size === 6 && !set.has(0)) return 'Seg a Sáb';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Fim de semana';
  return DIAS_SEMANA.filter(d => set.has(d.valor)).map(d => d.curto).join(', ');
}

const ACRE_DIA = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Rio_Branco', weekday: 'short' });
const DIA_EN: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana no Acre (0 = domingo) — não o da máquina, que pode estar noutro fuso. */
export const diaSemanaAcre = (d: Date = new Date()): number => DIA_EN[ACRE_DIA.format(d)] ?? d.getDay();

export const ALARME_TIPOS: { valor: AlarmeTipo; rotulo: string }[] = [
  { valor: 'aviso',     rotulo: 'Aviso Importante' },
  { valor: 'intervalo', rotulo: 'Horário de Intervalo' },
  { valor: 'saida',     rotulo: 'Fim de Expediente' },
];

export const ALARME_TITULO: Record<AlarmeTipo, string> = {
  aviso:     'Aviso Importante',
  intervalo: 'Intervalo de Trabalho',
  saida:     'Fim de Expediente',
};

const ALARME_TEXTO_FIXO: Record<Exclude<AlarmeTipo, 'aviso'>, string> = {
  intervalo:
    'Intervalo de Trabalho - Alimente-se, e não esqueça de beber água e ir ao banheiro',
  saida:
    'Fim de Expediente - Remova suas contas pessoais, desligue o computador, arrume sua mesa e posicione sua cadeira corretamente. Até mais',
};

/** Texto que o modal mostra. `aviso` usa a mensagem do professor. */
export function textoDoAlarme(tipo: AlarmeTipo, mensagem?: string | null): string {
  if (tipo === 'aviso') return (mensagem ?? '').trim();
  return ALARME_TEXTO_FIXO[tipo];
}

export const ALARME_AUDIO_URL = '/sounds/alarm.mp3';

/** Hora do Acre em "HH:MM" — o fuso da operação, não o da máquina. */
export const ACRE_HHMM = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Rio_Branco',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const pad2 = (n: number) => String(n).padStart(2, '0');
