// Atividade da aula — o roteiro que sai de um fluxo do Modo Aula.
//
// `aulaFluxos.ts` já descreve a cadeia de operação com quem executa cada etapa
// e o que quebra sem ela. Isso É o enunciado de uma atividade: falta só virar
// documento. Por isso o roteiro nasce DETERMINÍSTICO aqui — sem IA, sem rede,
// sem quota — e a IA (api/ai-aula-atividade.ts) entra depois, opcionalmente,
// substituindo `tarefas` por enunciados situados (cenário, entregável,
// critério de correção). Se a IA falhar, o professor ainda tem a atividade.
//
// Este mesmo tipo é o que vai para `aula_atividades.roteiro` (jsonb, migr. 403)
// e o que o aluno recebe. O PDF do aluno é remontado a partir dele pelo mesmo
// `aulaAtividadePdf.ts` que gera o do professor — é o que dispensa upload de
// arquivo e bucket.

import { AULA_FLUXOS, etapasObrigatorias, type AulaFluxo } from './aulaFluxos';

/** Uma tarefa do enunciado. `papel` é quem executa — a dimensão que a aula perde sem isto. */
export type AtividadeTarefa = {
  ordem: number;
  papel: string;
  titulo: string;
  enunciado: string;
  /** O que o aluno mostra ao professor no fim. */
  entregavel?: string;
  /** Como o professor confere. Vazio no roteiro determinístico. */
  criterio?: string;
  /** viewId da etapa de origem — liga a tarefa à tela que o Modo Aula liberou. */
  view?: string;
  opcional?: boolean;
};

export type AtividadePrerequisito = { label: string; onde: string };

export type AtividadeEtapa = {
  ordem: number;
  titulo: string;
  quem: string;
  detalhe: string;
  opcional?: boolean;
};

export type AtividadeRoteiro = {
  versao: 1;
  resumo: string;
  prerequisitos: AtividadePrerequisito[];
  etapas: AtividadeEtapa[];
  tarefas: AtividadeTarefa[];
};

/** O documento inteiro, como o professor envia e como o aluno lê. */
export type Atividade = {
  titulo: string;
  fluxoId: string;
  fluxoNome: string;
  objetivo: string | null;
  roteiro: AtividadeRoteiro;
  /** Só preenchidos quando a atividade veio do banco (lado do aluno). */
  criador?: string | null;
  expiraEm?: string | null;
  geradoPorIa?: boolean;
};

/**
 * Roteiro base de um fluxo: a cadeia vira etapas numeradas e uma tarefa por
 * etapa. As opcionais entram marcadas em vez de sumirem — na sala elas são
 * justamente o "faça também se der tempo".
 */
export function roteiroDoFluxo(f: AulaFluxo): AtividadeRoteiro {
  return {
    versao: 1,
    resumo: f.resumo,
    prerequisitos: f.prerequisitos.map(p => ({ label: p.label, onde: p.onde })),
    etapas: f.etapas.map((e, i) => ({
      ordem: i + 1,
      titulo: e.titulo,
      quem: e.quem,
      detalhe: e.detalhe,
      opcional: e.opcional,
    })),
    tarefas: f.etapas.map((e, i) => ({
      ordem: i + 1,
      papel: e.quem,
      titulo: e.titulo,
      // Sem IA o enunciado é o que o sistema faz na etapa. Não é pouco: é
      // exatamente o que o aluno tem de observar na tela.
      enunciado: e.detalhe,
      entregavel: e.opcional ? undefined : `Deixar a etapa "${e.titulo}" concluída no sistema.`,
      view: e.view || undefined,
      opcional: e.opcional,
    })),
  };
}

/** Título sugerido ao publicar. O professor edita antes de enviar. */
export const tituloPadraoAtividade = (f: AulaFluxo): string =>
  `Atividade — ${f.nome}`;

/** Nome de arquivo do PDF, sem extensão. */
export const nomeArquivoAtividade = (a: Pick<Atividade, 'fluxoId'>): string =>
  `atividade-${a.fluxoId}-${new Date().toISOString().slice(0, 10)}`;

/**
 * Quantas etapas obrigatórias do fluxo a whitelist atual cobre. Publicar uma
 * atividade cujo fluxo não está inteiro liberado manda a turma para uma tela
 * que o próprio Modo Aula esconde — a tarefa fica impossível e o aluno culpa
 * o próprio raciocínio.
 */
export const fluxoPorId = (id: string): AulaFluxo | undefined =>
  AULA_FLUXOS.find(f => f.id === id);

export const totalObrigatorias = (f: AulaFluxo): number => etapasObrigatorias(f).length;

/**
 * Normaliza o que veio do banco (jsonb sem garantia de forma) ou da IA. Uma
 * atividade antiga, publicada antes de um campo existir, tem de continuar
 * abrindo — o aluno não pode ver tela quebrada por causa de versão de schema.
 */
export function normalizarRoteiro(raw: any): AtividadeRoteiro {
  const arr = (v: any): any[] => (Array.isArray(v) ? v : []);
  const txt = (v: any): string => (typeof v === 'string' ? v.trim() : '');
  return {
    versao: 1,
    resumo: txt(raw?.resumo),
    prerequisitos: arr(raw?.prerequisitos)
      .map((p: any) => ({ label: txt(p?.label), onde: txt(p?.onde) }))
      .filter(p => p.label),
    etapas: arr(raw?.etapas)
      .map((e: any, i: number) => ({
        ordem: Number(e?.ordem) || i + 1,
        titulo: txt(e?.titulo),
        quem: txt(e?.quem),
        detalhe: txt(e?.detalhe),
        opcional: !!e?.opcional,
      }))
      .filter(e => e.titulo),
    tarefas: arr(raw?.tarefas)
      .map((t: any, i: number) => ({
        ordem: Number(t?.ordem) || i + 1,
        papel: txt(t?.papel),
        titulo: txt(t?.titulo),
        enunciado: txt(t?.enunciado),
        entregavel: txt(t?.entregavel) || undefined,
        criterio: txt(t?.criterio) || undefined,
        view: txt(t?.view) || undefined,
        opcional: !!t?.opcional,
      }))
      .filter(t => t.titulo)
      .sort((a, b) => a.ordem - b.ordem),
  };
}
