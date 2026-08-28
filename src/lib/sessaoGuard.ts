// Sessão em máquina compartilhada.
//
// O laboratório roda 4 turmas no mesmo computador. A sessão do Supabase é
// persistida em localStorage com `autoRefreshToken` — sem nada que a encerre,
// ela é eterna: o aluno da turma seguinte abre o app já logado na conta de quem
// estava antes. A RLS não protege disso, porque ela confere QUEM é o usuário e
// não QUEM está na cadeira: o herdeiro da sessão bate ponto, vende no PDV,
// aprova compra e avalia a Matriz no nome do outro.
//
// Três camadas:
//   1. inatividade de 15 min, com aviso de 60s antes  → `useIdleLogout`
//   2. purga no boot se a última atividade é velha    → aqui (`purgarSessaoSeExpirada`)
//   3. corte no fim do turno da turma                 → `useIdleLogout` + camada 2
//
// A camada 1 vale em todo dispositivo. As camadas 2 e 3 só valem em máquina
// COMPARTILHADA: no celular do aluno elas fariam o app pedir login toda vez que
// fosse reaberto, e o pedido explícito é que o celular continue lembrando o
// login. É por isso que a camada 2 existe separada da 1 — um timer de JS não
// dispara com a aba fechada, então é a purga no boot que cobre o caso mais
// comum do lab (o aluno fecha o app e vai embora).

import { todayBR } from './dates';
import { PONTO_HORARIOS } from './pontoHorarios';

/** Ociosidade tolerada antes do logout automático. */
export const IDLE_MS = 15 * 60 * 1000;

/** Antecedência do aviso de "sua sessão vai expirar". */
export const AVISO_MS = 60 * 1000;

/** Folga depois do horário de saída da turma antes do corte de turno. */
const MARGEM_FIM_TURNO_MIN = 30;

const CHAVE_ATIVIDADE      = 'logmax:ultimaAtividade';
const CHAVE_INICIO_SESSAO  = 'logmax:inicioSessao';
const CHAVE_COMPARTILHADO  = 'logmax:dispositivoCompartilhado';

/** Lido pelo LoginScreen para explicar por que a sessão caiu. */
export const CHAVE_MOTIVO_SAIDA = 'logmax:motivoSaida';
export type MotivoSaida = 'inatividade' | 'fim-turno';

// ── Tipo de dispositivo ──────────────────────────────────────────────────────

/**
 * Esta máquina é compartilhada entre turmas?
 *
 * Heurística: o lab é desktop com mouse (`pointer: fine`); o celular/tablet do
 * aluno tem ponteiro grosso. Erra para o lado seguro — sem `matchMedia`, trata
 * como compartilhada.
 *
 * Escape hatch para quando a heurística não servir (lab com touchscreen, ou um
 * tablet que fica na sala): rodar no console da máquina
 *   localStorage.setItem('logmax:dispositivoCompartilhado', '1')   // força estrito
 *   localStorage.setItem('logmax:dispositivoCompartilhado', '0')   // força pessoal
 */
export function isDispositivoCompartilhado(): boolean {
  try {
    const forcado = localStorage.getItem(CHAVE_COMPARTILHADO);
    if (forcado === '1') return true;
    if (forcado === '0') return false;
  } catch { /* modo privado */ }
  try {
    return !window.matchMedia('(pointer: coarse)').matches;
  } catch { return true; }
}

// ── Carimbos ─────────────────────────────────────────────────────────────────

function lerNumero(chave: string): number | null {
  try {
    const v = Number(localStorage.getItem(chave));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

export function marcarAtividade(ts: number = Date.now()): void {
  try { localStorage.setItem(CHAVE_ATIVIDADE, String(ts)); } catch { /* modo privado */ }
}

export function lerUltimaAtividade(): number | null {
  return lerNumero(CHAVE_ATIVIDADE);
}

/** Início da sessão nesta máquina, criando o carimbo se ainda não existir. */
export function garantirInicioSessao(ts: number = Date.now()): number {
  const atual = lerNumero(CHAVE_INICIO_SESSAO);
  if (atual !== null) return atual;
  try { localStorage.setItem(CHAVE_INICIO_SESSAO, String(ts)); } catch { /* modo privado */ }
  return ts;
}

export function limparCarimbos(): void {
  try {
    localStorage.removeItem(CHAVE_ATIVIDADE);
    localStorage.removeItem(CHAVE_INICIO_SESSAO);
  } catch { /* modo privado */ }
}

/**
 * Estado de navegação da sessão anterior. Sem isto o próximo usuário cairia na
 * tela e na filial de quem estava antes.
 */
export function limparEstadoDeSessao(): void {
  try {
    sessionStorage.removeItem('logmax:activeView');
    sessionStorage.removeItem('logmax:viewHistory');
    sessionStorage.removeItem('logmax:filialAtiva');
  } catch { /* modo privado */ }
}

export function registrarMotivoSaida(motivo: MotivoSaida): void {
  try { sessionStorage.setItem(CHAVE_MOTIVO_SAIDA, motivo); } catch { /* modo privado */ }
}

/** Lê e consome o motivo — só deve aparecer uma vez no LoginScreen. */
export function consumirMotivoSaida(): MotivoSaida | null {
  try {
    const v = sessionStorage.getItem(CHAVE_MOTIVO_SAIDA);
    if (v) sessionStorage.removeItem(CHAVE_MOTIVO_SAIDA);
    return v === 'inatividade' || v === 'fim-turno' ? v : null;
  } catch { return null; }
}

// ── Camada 3: fim do turno ───────────────────────────────────────────────────

/**
 * Epoch (ms) do fim do turno de hoje: horário de saída da turma + margem.
 *
 * Cada turma tem seu projeto Vercel, então `VITE_PONTO_SAIDA` já é o fim do
 * turno daquela turma. Acre é UTC-5 fixo (sem horário de verão), então somar 5h
 * converte o horário local em UTC sem depender de biblioteca de fuso.
 */
function fimDoTurnoHoje(): number {
  const [ano, mes, dia] = todayBR().split('-').map(Number);
  const [hora, min] = PONTO_HORARIOS.saida.split(':').map(Number);
  return Date.UTC(ano, mes - 1, dia, hora + 5, min + MARGEM_FIM_TURNO_MIN);
}

/**
 * A sessão iniciada em `desde` atravessou o fim do turno?
 *
 * É o que garante que nenhuma sessão sobreviva à troca de turma mesmo quando a
 * máquina é usada sem parar até o sinal — caso em que a camada 1 nunca dispara.
 */
export function cruzouFimDoTurno(desde: number, agora: number = Date.now()): boolean {
  const fim = fimDoTurnoHoje();
  return desde < fim && agora >= fim;
}

// ── Camada 2: purga no boot ──────────────────────────────────────────────────

/**
 * Remove o token do Supabase do localStorage. Roda ANTES do React montar, para
 * que `getSession()` já devolva null e o app pinte o LoginScreen direto — sem
 * o flash de meio segundo com a tela do usuário anterior que um `signOut()`
 * assíncrono dentro de um efeito produziria.
 *
 * O refresh token continua válido no servidor (revogar exigiria uma chamada de
 * rede assíncrona, que é justamente o que não cabe aqui); o que importa é que
 * ninguém nesta máquina tem mais acesso a ele.
 */
function purgarTokenSupabase(): void {
  try {
    const chaves: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.+-auth-token/.test(k)) chaves.push(k);
    }
    chaves.forEach(k => localStorage.removeItem(k));
  } catch { /* modo privado */ }
}

/**
 * Chamado uma vez no boot, antes do React montar. Em máquina compartilhada,
 * derruba a sessão que ficou de outra turma.
 *
 * Retorna true se purgou (usado só para log/depuração).
 */
export function purgarSessaoSeExpirada(): boolean {
  if (!isDispositivoCompartilhado()) return false;

  const ultima = lerUltimaAtividade();
  if (ultima === null) return false;  // nunca houve sessão carimbada aqui

  const agora = Date.now();
  const ociosaDemais = agora - ultima >= IDLE_MS;

  // Carimbo no FUTURO: a régua de tempo mudou entre uma sessão e outra. Foi o
  // que aconteceu quando o app passou a ancorar o relógio no servidor
  // (`horaServidor.ts`): numa máquina adiantada, a sessão anterior carimbou com
  // a hora local (à frente) e este boot compara com a hora do servidor. A
  // subtração dá NEGATIVA, `ociosaDemais` fica false e a purga não acontece —
  // justamente na máquina compartilhada que ela existe para proteger. Um minuto
  // de folga absorve jitter de relógio; acima disso, o carimbo não é confiável
  // e a saída segura é derrubar a sessão.
  const carimboNoFuturo = ultima - agora > 60_000;

  // O início da sessão pode não existir (versão anterior do app): a última
  // atividade serve de piso conservador para o corte de turno. E, pelo mesmo
  // motivo acima, um início no futuro não pode virar "sessão que nunca cruzou o
  // turno" — daí o teto em `agora`.
  const inicio = Math.min(lerNumero(CHAVE_INICIO_SESSAO) ?? ultima, agora);
  const trocouTurno = cruzouFimDoTurno(inicio, agora);

  if (!ociosaDemais && !trocouTurno && !carimboNoFuturo) return false;

  purgarTokenSupabase();
  limparCarimbos();
  limparEstadoDeSessao();
  registrarMotivoSaida(trocouTurno ? 'fim-turno' : 'inatividade');
  return true;
}
