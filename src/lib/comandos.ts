// Comandos globais — a MESMA lista servida ao atalho de teclado e à paleta
// (Ctrl+K). Se cada porta tivesse a sua lista, a segunda nasceria
// desatualizada; aqui a unidade nova entra num sítio só.
//
// O casamento é por SUBSTRING de propósito: ninguém digita o rótulo inteiro, e
// os apelidos ("mercado", "moda", "logout") são como as pessoas chamam as
// coisas. O preço é a ambiguidade ("max" está em três unidades), e aí a
// resposta certa é não escolher nenhuma: `casarComando` devolve null e quem
// chamou mostra a lista.

import type { FilialOp } from '../components/FilialSelector';

export type AcaoComando =
  | { tipo: 'unidade'; destino: FilialOp | 'Matriz' }
  | { tipo: 'seletor' }
  | { tipo: 'sair' };

export interface Comando {
  id: string;
  label: string;
  descricao: string;
  atalho: string;
  /** Sempre normalizados — ver `normalizar`. */
  aliases: string[];
  acao: AcaoComando;
}

/** Minúsculas, sem acento, sem espaço sobrando: "Eletrônicos" e "eletronicos"
 *  têm de cair no mesmo texto. */
export const normalizar = (s: string): string =>
  s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const UNIDADES: { destino: FilialOp | 'Matriz'; atalho: string; descricao: string; aliases: string[] }[] = [
  {
    destino: 'Matriz',
    atalho: 'Alt+1',
    descricao: 'Consolidado das três unidades',
    aliases: ['matriz', 'holding', 'consolidado', 'grupo', 'max group'],
  },
  {
    destino: 'SuperMax',
    atalho: 'Alt+2',
    descricao: 'Supermercado',
    aliases: ['supermax', 'super max', 'supermercado', 'mercado'],
  },
  {
    destino: 'MaxLook',
    atalho: 'Alt+3',
    descricao: 'Moda e vestuário',
    aliases: ['maxlook', 'max look', 'moda', 'vestuario', 'roupa'],
  },
  {
    destino: 'TechMax',
    atalho: 'Alt+4',
    descricao: 'Eletrônicos e informática',
    aliases: ['techmax', 'tech max', 'tec max', 'eletronicos', 'informatica', 'tecnologia'],
  },
];

export const COMANDO_SAIR: Comando = {
  id: 'sair',
  label: 'Sair do sistema',
  descricao: 'Encerra a sessão nesta máquina',
  atalho: 'Alt+Q',
  aliases: ['sair', 'sair do sistema', 'sair do app', 'encerrar sessao', 'deslogar', 'logout', 'log out', 'desconectar', 'fechar sessao'],
  acao: { tipo: 'sair' },
};

const COMANDO_SELETOR: Comando = {
  id: 'seletor',
  label: 'Escolher unidade…',
  descricao: 'Volta à tela de escolha de unidade',
  atalho: 'Alt+0',
  aliases: ['trocar unidade', 'trocar filial', 'escolher unidade', 'escolher filial', 'mudar de unidade', 'seletor'],
  acao: { tipo: 'seletor' },
};

/** A lista que a pessoa pode usar AGORA. Trocar de unidade é privilégio de
 *  admin/CEO/conselheiro (a mesma régua do seletor pós-login); sair é de todos. */
export function listaDeComandos(podeTrocarUnidade: boolean): Comando[] {
  if (!podeTrocarUnidade) return [COMANDO_SAIR];
  return [
    ...UNIDADES.map<Comando>(u => ({
      id: `unidade:${u.destino}`,
      label: `Ir para ${u.destino}`,
      descricao: u.descricao,
      atalho: u.atalho,
      aliases: [...u.aliases, ...u.aliases.map(a => `ir para ${a}`), ...u.aliases.map(a => `abrir ${a}`)],
      acao: { tipo: 'unidade', destino: u.destino },
    })),
    COMANDO_SELETOR,
    COMANDO_SAIR,
  ];
}

/** Comandos que casam com o texto, do mais específico para o menos. Serve a
 *  lista da paleta enquanto a pessoa digita. */
export function filtrarComandos(texto: string, comandos: Comando[]): Comando[] {
  const q = normalizar(texto);
  if (!q) return comandos;
  return comandos.filter(c =>
    normalizar(c.label).includes(q) ||
    normalizar(c.descricao).includes(q) ||
    c.aliases.some(a => a.includes(q) || q.includes(a))
  );
}

/**
 * Um comando para executar direto, ou null.
 *
 * Null cobre dois casos que NÃO se deve tratar igual a "não entendi e desisto":
 * nada casou, e mais de um casou. No segundo, executar o primeiro seria trocar
 * a unidade errada por conta própria — quem chama mostra as opções.
 */
export function casarComando(texto: string, comandos: Comando[]): Comando | null {
  const q = normalizar(texto);
  if (!q) return null;

  const exato = comandos.filter(c => c.aliases.includes(q) || normalizar(c.label) === q);
  if (exato.length === 1) return exato[0];
  if (exato.length > 1) return null;

  // "ir para a supermax" contém "supermax": o alias dentro da frase é caso
  // normal, não exceção.
  const contidos = comandos.filter(c => c.aliases.some(a => q.includes(a)));
  if (contidos.length === 1) return contidos[0];
  if (contidos.length > 1) {
    // Empate resolvido pelo alias mais longo SÓ quando ele contém os outros
    // ("super max" vs "max"); empate real continua ambíguo.
    const maior = (c: Comando) => Math.max(...c.aliases.filter(a => q.includes(a)).map(a => a.length));
    const ordenado = [...contidos].sort((a, b) => maior(b) - maior(a));
    if (maior(ordenado[0]) > maior(ordenado[1])) return ordenado[0];
    return null;
  }

  return null;
}
