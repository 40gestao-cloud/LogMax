import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Guard de sessão do laboratório: as 4 turmas dividem o mesmo computador, e
// sem isto a sessão de uma sobrevive para a seguinte. Ver src/lib/sessaoGuard.ts.
//
// Roda no grupo `estatico` (sem banco): a lógica aqui é pura, só depende de
// relógio e de storage — os dois são falsificados abaixo.

class StorageFake implements Storage {
  private dados = new Map<string, string>();
  get length() { return this.dados.size; }
  key(i: number) { return Array.from(this.dados.keys())[i] ?? null; }
  getItem(k: string) { return this.dados.get(k) ?? null; }
  setItem(k: string, v: string) { this.dados.set(k, String(v)); }
  removeItem(k: string) { this.dados.delete(k); }
  clear() { this.dados.clear(); }
}

let local: StorageFake;
let sessao: StorageFake;
/** `false` = ponteiro fino = desktop = máquina compartilhada. */
let ponteiroGrosso = false;

beforeEach(() => {
  local = new StorageFake();
  sessao = new StorageFake();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', sessao);
  vi.stubGlobal('window', {
    matchMedia: (q: string) => ({ matches: q.includes('coarse') ? ponteiroGrosso : !ponteiroGrosso }),
  });
  ponteiroGrosso = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

// Import dinâmico: o módulo precisa ser avaliado com os globals já falsificados.
const carregar = () => import('../src/lib/sessaoGuard');

const TOKEN = 'sb-abcdefgh-auth-token';
const MIN = 60_000;

/** Turno padrão termina 11:20 no Acre; +30 min de margem → corte às 11:50. */
const ACRE_09H = new Date('2026-08-17T14:00:00Z');  // 09:00 no Acre
const ACRE_13H = new Date('2026-08-17T18:00:00Z');  // 13:00 no Acre, turno já fechou

describe('cruzouFimDoTurno', () => {
  it('não corta durante o turno', async () => {
    vi.setSystemTime(ACRE_09H);
    const { cruzouFimDoTurno } = await carregar();
    expect(cruzouFimDoTurno(ACRE_09H.getTime() - 60 * MIN)).toBe(false);
  });

  it('corta a sessão que atravessou o fim do turno', async () => {
    vi.setSystemTime(ACRE_13H);
    const { cruzouFimDoTurno } = await carregar();
    expect(cruzouFimDoTurno(ACRE_13H.getTime() - 5 * 60 * MIN)).toBe(true);
  });

  it('não corta sessão que já nasceu depois do fim do turno', async () => {
    vi.setSystemTime(ACRE_13H);
    const { cruzouFimDoTurno } = await carregar();
    // Professor mexendo no app fora do horário de aula: não há troca de turma
    // para proteger, então só a inatividade vale.
    expect(cruzouFimDoTurno(ACRE_13H.getTime() - 1 * MIN)).toBe(false);
  });
});

describe('purgarSessaoSeExpirada', () => {
  it('derruba a sessão ociosa há mais de 15 min na máquina compartilhada', async () => {
    vi.setSystemTime(ACRE_09H);
    const { purgarSessaoSeExpirada, CHAVE_MOTIVO_SAIDA } = await carregar();
    local.setItem(TOKEN, '{"access_token":"x"}');
    local.setItem('logmax:ultimaAtividade', String(ACRE_09H.getTime() - 20 * MIN));
    local.setItem('logmax:inicioSessao',    String(ACRE_09H.getTime() - 60 * MIN));
    sessao.setItem('logmax:activeView', 'pdv');

    expect(purgarSessaoSeExpirada()).toBe(true);
    expect(local.getItem(TOKEN)).toBeNull();
    expect(local.getItem('logmax:ultimaAtividade')).toBeNull();
    // Estado de navegação da turma anterior também sai.
    expect(sessao.getItem('logmax:activeView')).toBeNull();
    expect(sessao.getItem(CHAVE_MOTIVO_SAIDA)).toBe('inatividade');
  });

  it('preserva a sessão que está só há 5 min parada', async () => {
    vi.setSystemTime(ACRE_09H);
    const { purgarSessaoSeExpirada } = await carregar();
    local.setItem(TOKEN, '{"access_token":"x"}');
    local.setItem('logmax:ultimaAtividade', String(ACRE_09H.getTime() - 5 * MIN));
    local.setItem('logmax:inicioSessao',    String(ACRE_09H.getTime() - 30 * MIN));

    expect(purgarSessaoSeExpirada()).toBe(false);
    expect(local.getItem(TOKEN)).not.toBeNull();
  });

  it('derruba por fim de turno mesmo com atividade recente', async () => {
    vi.setSystemTime(ACRE_13H);
    const { purgarSessaoSeExpirada, CHAVE_MOTIVO_SAIDA } = await carregar();
    local.setItem(TOKEN, '{"access_token":"x"}');
    local.setItem('logmax:ultimaAtividade', String(ACRE_13H.getTime() - 1 * MIN));
    local.setItem('logmax:inicioSessao',    String(ACRE_13H.getTime() - 5 * 60 * MIN));

    expect(purgarSessaoSeExpirada()).toBe(true);
    expect(local.getItem(TOKEN)).toBeNull();
    expect(sessao.getItem(CHAVE_MOTIVO_SAIDA)).toBe('fim-turno');
  });

  it('não mexe em dispositivo pessoal — o celular continua lembrando o login', async () => {
    ponteiroGrosso = true;  // celular
    vi.setSystemTime(ACRE_13H);
    const { purgarSessaoSeExpirada } = await carregar();
    local.setItem(TOKEN, '{"access_token":"x"}');
    local.setItem('logmax:ultimaAtividade', String(ACRE_13H.getTime() - 3 * 24 * 60 * MIN));
    local.setItem('logmax:inicioSessao',    String(ACRE_13H.getTime() - 3 * 24 * 60 * MIN));

    expect(purgarSessaoSeExpirada()).toBe(false);
    expect(local.getItem(TOKEN)).not.toBeNull();
  });

  it('respeita o override manual da máquina', async () => {
    ponteiroGrosso = true;  // heurística diria "pessoal"
    vi.setSystemTime(ACRE_09H);
    const { purgarSessaoSeExpirada } = await carregar();
    local.setItem('logmax:dispositivoCompartilhado', '1');
    local.setItem(TOKEN, '{"access_token":"x"}');
    local.setItem('logmax:ultimaAtividade', String(ACRE_09H.getTime() - 20 * MIN));

    expect(purgarSessaoSeExpirada()).toBe(true);
    expect(local.getItem(TOKEN)).toBeNull();
  });

  it('primeiro acesso da máquina não vira "sessão expirada"', async () => {
    vi.setSystemTime(ACRE_09H);
    const { purgarSessaoSeExpirada, CHAVE_MOTIVO_SAIDA } = await carregar();
    local.setItem(TOKEN, '{"access_token":"x"}');  // sessão nova, sem carimbo ainda

    expect(purgarSessaoSeExpirada()).toBe(false);
    expect(local.getItem(TOKEN)).not.toBeNull();
    expect(sessao.getItem(CHAVE_MOTIVO_SAIDA)).toBeNull();
  });
});
