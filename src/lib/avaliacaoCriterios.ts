// Critérios e escala compartilhados pelo módulo de Avaliações (ciclos) e
// pela avaliação pontual de participantes de treinamento (TI & Desenvolvimento
// com IA). Mantidos num só lugar para os dois fluxos ficarem em sincronia
// e evitar duplicação entre AvaliacoesView e DesenvolvimentoIAView.

// ── Modo Filial: critérios aplicados a Conselheiros/Gerentes/Colaboradores ──
export const CRITERIOS = {
  desempenho: [
    'Frequência de Trabalho',
    'Pontualidade',
    'Desempenho individual',
    'Desempenho em Equipe',
  ],
} as const;

export type CategoriaCriterio = keyof typeof CRITERIOS;
export type Categoria = CategoriaCriterio;

export const CATEGORIA_LABEL: Record<string, string> = {
  desempenho: 'Critérios de Avaliação',
};

// ── Modo Matriz: eixos subjetivos da competição de filiais ───────────────────
// Financeiro / RH / Redes Sociais e Marketing / Logística / Vendas e Atendimento
// foram removidos: cada um já é medido por dados objetivos (painel BI) e/ou
// avaliado como Tarefa da Matriz (tarefa_rh, tarefa_financeiro, tarefa_logistica,
// tarefa_marketing, tarefa_treinamento_vendas).
//
// 'Frequência de Trabalho' saiu na migr. 349 pelo mesmo motivo, com atraso:
// `ponto_eletronico` já sabe quem esteve presente em cada dia do período da
// competição, então a nota do conselho era palpite sobre dado existente. Agora
// entra no placar como parcela medida (peso 20%) e a tela mostra %, não voto.
// Sobrou o único eixo que é julgamento de fato.
export const CRITERIOS_MATRIZ = {
  criterios: [
    'Planejamento e Organização',
  ],
} as const;

export const CATEGORIA_LABEL_MATRIZ: Record<string, string> = {
  criterios: 'Critérios de Avaliação',
};

// ── Admin → CEO / Conselheiro: 6 critérios estratégicos ─────────────────────
export const CRITERIOS_ADMIN = {
  estrategico: [
    'Pontualidade',
    'Decisões Estratégicas',
    'Planos de Ação',
    'Qualidade de Relatórios',
    'Ordem de Comando',
    'Condução dos Trabalhos',
  ],
} as const;

export const CATEGORIA_LABEL_ADMIN: Record<string, string> = {
  estrategico: 'Critérios de Avaliação',
};

// Tipo genérico usado pelo form (aceita qualquer um dos dois sets).
export type CriteriosSet = Record<string, readonly string[]>;

// ── Escala 0-10. Default 5 = neutro ─────────────────────────────────────────
export const ESCALA_MIN = 0;
export const ESCALA_MAX = 10;
export const NOTA_DEFAULT = 5;
export const NOTAS = Array.from({ length: ESCALA_MAX - ESCALA_MIN + 1 }, (_, i) => i + ESCALA_MIN);
