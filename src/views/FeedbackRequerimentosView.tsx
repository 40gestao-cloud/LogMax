import React, { useState } from 'react';
import { motion } from 'motion/react';
import { MessageSquare, FileText } from 'lucide-react';
import type { UserProfile } from '../hooks/useUserProfile';
import { useFilial } from '../contexts/FilialContext';
import { FeedbackOrganizacionalView } from './FeedbackOrganizacionalView';
import { RequerimentosView } from './RequerimentosView';
import { MatrizRequerimentosView } from './MatrizRequerimentosView';

type Tab = 'feedback' | 'requerimentos';

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'feedback',      label: 'Feedback',      icon: MessageSquare },
  { id: 'requerimentos', label: 'Requerimentos', icon: FileText },
];

// Unifica os dois canais "de baixo pra cima" (colaborador/gerente → Matriz)
// numa única tela com abas. Cada aba renderiza a view original — mantém a
// lógica/RLS/tabelas de cada uma intactas, só compartilha o item de menu.
export function FeedbackRequerimentosView({
  profile,
  showToast,
}: {
  profile: UserProfile;
  showToast: (msg: string, t?: string) => void;
}) {
  const { filialAtiva } = useFilial();
  const [tab, setTab] = useState<Tab>('feedback');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-5 overflow-y-auto main-scrollbar pb-6">
      <div className="flex gap-1.5 shrink-0 neu-pressed rounded-2xl p-1.5 w-fit">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                active ? 'neu-flat text-accent border border-accent/20' : 'text-gray-500 hover:text-gray-300'}`}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'feedback' ? (
        <FeedbackOrganizacionalView profile={profile} showToast={showToast} />
      ) : filialAtiva ? (
        <RequerimentosView profile={profile} showToast={showToast} />
      ) : (
        <MatrizRequerimentosView profile={profile} showToast={showToast} />
      )}
    </motion.div>
  );
}
