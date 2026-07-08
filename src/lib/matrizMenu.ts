// Rotas permitidas no modo Matriz (filialAtiva === null).
// Chaves são os IDs de módulo do menuModules em App.tsx.
// Valor string[] = submenus permitidos (label exato, case-sensitive).
// Valor true = módulo inteiro permitido (todos os submenus).
// Valor false / ausente = módulo oculto na sidebar.
//
// Além disso, o modo Matriz injeta os módulos 'matriz-rh', 'matriz-financeiro',
// 'matriz-marketing' e 'matriz-operacoes' que só existem nesse modo.

export const MATRIZ_ALLOWED_SUBMENUS: Record<string, string[] | true> = {
  empresa:     ['Filiais'],
  financeiro:  ['Gerenciamento', 'Relatórios'],
  rh:          ['Frequência de Trabalho', 'Gerenciamento', 'Relatórios'],
  compras:     ['Gerenciamento', 'Relatórios'],
  estoque:     ['Gerenciamento', 'Relatórios'],
  marketing:   [],                       // ocultado — vive em Comparativo
  vendas:      [],                       // sem PDV em Matriz
  ti:          true,                     // Tecnologia e IA aparece só em Matriz
  cadastros:   ['Produtos', 'Serviços'], // catálogo global
};

// Módulos top-level exclusivos do modo Matriz.
// Adicionados no início do visibleModules quando filialAtiva === null.
export const MATRIZ_MODULES = [
  { id: 'matriz-rh',         label: 'RH Comparativo',         group: 'Comparativos Matriz' },
  { id: 'matriz-financeiro', label: 'Financeiro Comparativo', group: null },
  { id: 'matriz-logistica',  label: 'Logística Comparativo',  group: null },
  { id: 'matriz-marketing',  label: 'Marketing Comparativo',  group: null },
  { id: 'matriz-operacoes',  label: 'Operações Comparativo',  group: null },
  { id: 'matriz-votacoes',   label: 'Votações',               group: null },
  { id: 'matriz-capital',        label: 'Capital',        group: null },
  { id: 'matriz-requerimentos', label: 'Requerimentos',  group: null },
] as const;

export type MatrizModuleId = typeof MATRIZ_MODULES[number]['id'];
