import {
  Presentation, Cpu, GraduationCap, UserCircle, DollarSign, Package, Megaphone,
  ClipboardList, type LucideIcon,
} from 'lucide-react';

// Os 7 tipos de demanda da Competição do Conselho (`matriz_tarefas`).
//
// O ciclo Padrão (`ciclo_tarefas`) NÃO usa mais essa régua: a demanda de lá
// nasce sem categoria, com o tipo fixo `demanda_padrao` (migr. 366). Os 7
// continuam aqui porque a filial lê os dois trilhos na mesma tela (Demandas)
// e porque demanda antiga do Padrão ainda carrega um deles.
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

// Tipo único do ciclo Padrão (migr. 366). Não entra em TIPOS_TAREFA: não é
// opção de select em lugar nenhum, é o valor que a demanda do Padrão grava.
export const TIPO_DEMANDA_PADRAO = 'demanda_padrao';

export const ehDemandaPadrao = (tipo: string) => tipo === TIPO_DEMANDA_PADRAO;

// Fallback pra tipo legado que saiu do mapa — a tela não pode quebrar por
// causa de um registro antigo.
export const metaDoTipo = (tipo: string): TipoTarefaMeta =>
  TIPO_TAREFA_META[tipo as TipoTarefa]
  ?? (tipo === TIPO_DEMANDA_PADRAO
    ? { label: 'Demanda do Ciclo', icon: ClipboardList, color: 'text-sky-400', novoLabel: 'Nova demanda' }
    : { label: tipo, icon: ClipboardList, color: 'text-gray-400', novoLabel: 'Nova demanda' });
