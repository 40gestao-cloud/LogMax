import {
  Presentation, Cpu, GraduationCap, UserCircle, DollarSign, Package, Megaphone,
  ClipboardList, type LucideIcon,
} from 'lucide-react';

// Os 7 tipos de demanda que a Matriz publica pras filiais. A mesma régua
// vale na Competição do Conselho (`matriz_tarefas`) e no ciclo Padrão
// (`ciclo_tarefas`, migr. 361) — por isso o mapa mora aqui e não dentro
// de uma view.
export type TipoTarefa =
  | 'tarefa_apresentacao'
  | 'tarefa_treinamento_ia'
  | 'tarefa_treinamento_vendas'
  | 'tarefa_rh'
  | 'tarefa_financeiro'
  | 'tarefa_logistica'
  | 'tarefa_marketing';

export type TipoTarefaMeta = {
  label: string;
  icon: LucideIcon;
  color: string;
  novoLabel: string;
};

export const TIPO_TAREFA_META: Record<TipoTarefa, TipoTarefaMeta> = {
  tarefa_apresentacao:       { label: 'Apresentação Profissional', icon: Presentation,  color: 'text-amber-300',    novoLabel: 'Nova apresentação' },
  tarefa_treinamento_ia:     { label: 'Desenvolvimento com IA',    icon: Cpu,           color: 'text-orange-400',   novoLabel: 'Nova atividade de Desenvolvimento com IA' },
  tarefa_treinamento_vendas: { label: 'Vendas e Atendimento',      icon: GraduationCap, color: 'text-blue-400',     novoLabel: 'Nova atividade de Vendas e Atendimento' },
  tarefa_rh:                 { label: 'Recursos Humanos',          icon: UserCircle,    color: 'text-sky-400',      novoLabel: 'Nova atividade de Recursos Humanos' },
  tarefa_financeiro:         { label: 'Financeiro',                icon: DollarSign,    color: 'text-rose-400',     novoLabel: 'Nova atividade de Financeiro' },
  tarefa_logistica:          { label: 'Logística',                 icon: Package,       color: 'text-emerald-400',  novoLabel: 'Nova atividade de Logística' },
  tarefa_marketing:          { label: 'Marketing',                 icon: Megaphone,     color: 'text-pink-400',     novoLabel: 'Nova atividade de Marketing' },
};

// Ordem canônica dos tipos — usada no select de criação e na listagem.
export const TIPOS_TAREFA: TipoTarefa[] = [
  'tarefa_apresentacao',
  'tarefa_treinamento_ia',
  'tarefa_rh',
  'tarefa_financeiro',
  'tarefa_logistica',
  'tarefa_marketing',
  'tarefa_treinamento_vendas',
];

// Fallback pra tipo legado que saiu do mapa — a tela não pode quebrar por
// causa de um registro antigo.
export const metaDoTipo = (tipo: string): TipoTarefaMeta =>
  TIPO_TAREFA_META[tipo as TipoTarefa]
  ?? { label: tipo, icon: ClipboardList, color: 'text-gray-400', novoLabel: 'Nova demanda' };
