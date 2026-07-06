// Critérios e escala compartilhados pelo módulo de Avaliações (ciclos) e
// pela avaliação pontual de participantes de treinamento (TI & Desenvolvimento
// com IA). Mantidos num só lugar para os dois fluxos ficarem em sincronia
// e evitar duplicação entre AvaliacoesView e DesenvolvimentoIAView.

export const CRITERIOS = {
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

export type CategoriaCriterio = keyof typeof CRITERIOS;
export type Categoria = CategoriaCriterio;

// Descrições exibidas como subtítulo no form (mesma ordem dos critérios).
export const CRITERIO_DESC: Record<string, string> = {
  'Frequência de Trabalho':     'Não faltar às aulas nem chegar atrasado; a frequência será monitorada.',
  'Financeiro':                 'Financeiro organizado e realista, com relatórios no LogMax, Excel, Word e slides.',
  'Planejamento e Organização': 'Pesquisas, discussões em equipe, plano de ação com ferramentas de produtividade e entregas com qualidade.',
  'Recursos Humanos':           'Controle da folha de pagamento, frequência, treinamentos e ações para a equipe.',
  'Redes Sociais e Marketing':  'Gerar engajamento, mais seguidores e curtidas, artes de qualidade e vídeos virais.',
  'Logística':                  'Cadastro realista de produtos e fornecedores, compras de mercado e controle rigoroso do estoque.',
  'Vendas e Atendimento':       'Vendas simuladas online e por telefone/WhatsApp com pessoas reais, além de atendimento presencial simulado.',
};

// Escala 0-10. Default 5 = neutro (centro da escala).
export const ESCALA_MIN = 0;
export const ESCALA_MAX = 10;
export const NOTA_DEFAULT = 5;
export const NOTAS = Array.from({ length: ESCALA_MAX - ESCALA_MIN + 1 }, (_, i) => i + ESCALA_MIN);

export const CATEGORIA_LABEL: Record<string, string> = {
  criterios: 'Critérios de Avaliação',
};
