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
  criado_por: string | null;
  created_at: string;
};

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
