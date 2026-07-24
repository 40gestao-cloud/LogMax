// Rotas permitidas no modo Matriz (filialAtiva === null).
// Chaves são os IDs de módulo do menuModules em App.tsx.
// Valor string[] = submenus permitidos (label exato, case-sensitive).
// Valor true = módulo inteiro permitido (todos os submenus).
// Valor false / ausente = módulo oculto na sidebar.
//
// Além disso, o modo Matriz injeta os módulos 'matriz-competicao',
// 'matriz-avaliacoes' e 'matriz-capital' que só existem nesse modo.

export const MATRIZ_ALLOWED_SUBMENUS: Record<string, string[] | true> = {
  empresa:     ['Filiais'],
  financeiro:  ['Gerenciamento', 'Relatórios'],
  rh:          ['Frequência de Trabalho', 'Gerenciamento', 'Relatórios'],
  compras:     ['Gerenciamento', 'Relatórios'],
  estoque:     ['Gerenciamento', 'Relatórios'],
  marketing:   ['Vitrine Pública'],
  vendas:      [],                       // sem PDV em Matriz
  ti:          true,                     // Tecnologia e IA aparece só em Matriz
  cadastros:   ['Produtos', 'Serviços'], // catálogo global
};

// Módulos top-level exclusivos do modo Matriz.
// Adicionados no início do visibleModules quando filialAtiva === null.
export const MATRIZ_MODULES = [
  { id: 'matriz-competicao', label: 'Competição',           group: null },
  { id: 'matriz-avaliacoes', label: 'Central de Avaliação', group: null },
  { id: 'matriz-capital',    label: 'Capital',              group: null },
] as const;

export type MatrizModuleId = typeof MATRIZ_MODULES[number]['id'];
