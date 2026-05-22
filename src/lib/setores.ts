import {
  Building2, ShoppingCart, Package, DollarSign,
  Users, Megaphone, ShoppingBag, Cpu, HardDrive, Truck,
} from 'lucide-react';
import type { AccentColor } from '../contexts/ThemeContext';

// Lista única de setores usada em TI (cards de chamados) e no sininho
// (ícone da notificação de ti_chamado segue a origem). A ordem importa:
// o tema Acessibilidade usa o índice para alternar azul/laranja, então
// os 8 setores reais ficam exatamente 4 + 4 nessa ordem; ia/equipamentos
// no fim continuam o mesmo padrão pra não destoarem visualmente.
export type Setor = {
  id: string;
  label: string;
  icon: any;
  /** Cor padrão (usada fora do tema Acessibilidade). */
  color: string;
};

export const SETOR_GRID: Setor[] = [
  { id: 'empresa',      label: 'Empresa',         icon: Building2,    color: '#10B981' },
  { id: 'compras',      label: 'Compras',         icon: ShoppingCart, color: '#3B82F6' },
  { id: 'estoque',      label: 'Estoque',         icon: Package,      color: '#A855F7' },
  { id: 'logistica',    label: 'Logística',       icon: Truck,        color: '#22C55E' },
  { id: 'financeiro',   label: 'Financeiro',      icon: DollarSign,   color: '#10B981' },
  { id: 'rh',           label: 'RH',              icon: Users,        color: '#FACC15' },
  { id: 'vendas',       label: 'Vendas',          icon: ShoppingBag,  color: '#EC4899' },
  { id: 'marketing',    label: 'Marketing',       icon: Megaphone,    color: '#F97316' },
  { id: 'ia',           label: 'Suporte com IA',  icon: Cpu,          color: '#A855F7' },
  { id: 'equipamentos', label: 'Equipamentos',    icon: HardDrive,    color: '#3B82F6' },
];

const ACESSIVEL_AZUL    = '#7DD3FC'; // sky-300
const ACESSIVEL_LARANJA = '#F97316'; // orange-500

export const getSetor = (id: string): Setor | undefined =>
  SETOR_GRID.find(s => s.id === id);

export const setorLabel = (id: string): string =>
  getSetor(id)?.label ?? id;

/**
 * Cor do setor respeitando o tema. No accent 'acessivel' o ID é resolvido
 * para um par alternado azul-claro/laranja (mesma identidade bicolor do
 * resto do app). Nos demais accents devolve a cor original do setor.
 */
export const corDoSetor = (id: string, accent: AccentColor): string => {
  if (accent !== 'acessivel') return getSetor(id)?.color ?? '#10B981';
  const idx = SETOR_GRID.findIndex(s => s.id === id);
  if (idx < 0) return ACESSIVEL_AZUL;
  return idx % 2 === 0 ? ACESSIVEL_AZUL : ACESSIVEL_LARANJA;
};
