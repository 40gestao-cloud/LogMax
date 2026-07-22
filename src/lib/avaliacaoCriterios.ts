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

// ── Modo Matriz: 7 eixos da competição de filiais ────────────────────────────
export const CRITERIOS_MATRIZ = {
  criterios: [
    'Frequência de Trabalho',
    'Financeiro',
    'Planejamento e Organização',
    'Recursos Humanos',
    'Redes Sociais e Marketing',
    'Logística',
    'Vendas e Atendimento',
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
