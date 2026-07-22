import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Star, Trophy, ChevronRight, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { isConselheiro } from '../lib/rbac';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { AvaliacoesView } from './AvaliacoesView';
import { MatrizAvaliacoesView } from './MatrizAvaliacoesView';

type Card = 'padrao' | 'competicao' | null;

// Wrapper unificado: 2 cards (Padrão / Competição).
// Só mostra landing quando o card "Competição" está disponível pro usuário
// (modo Matriz + admin/CEO/conselheiro). Fora disso vai direto no Padrão.
export function CentralAvaliacaoView({ profile, showToast }: { profile: UserProfile; showToast: any }) {
  const { filialAtiva, escolheu } = useFilial();
  const modoMatriz = escolheu && filialAtiva === null;
  const podeCompeticao = modoMatriz && (profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile));

  const [temCompeticao, setTemCompeticao] = useState(false);
  const [loading, setLoading] = useState(podeCompeticao);
  const [card, setCard] = useState<Card>(null);

  useEffect(() => {
    if (!podeCompeticao) { setLoading(false); return; }
    let cancelou = false;
    (async () => {
      const { data } = await supabase
        .from('competicoes_matriz')
        .select('id')
        .eq('ativo', true)
        .eq('status', 'em_andamento')
        .maybeSingle();
      if (!cancelou) {
        setTemCompeticao(!!data);
        setLoading(false);
      }
    })();
    return () => { cancelou = true; };
  }, [podeCompeticao]);

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  // Sem acesso ao card Competição → não faz sentido mostrar landing de 1 card.
  if (!podeCompeticao) return <AvaliacoesView profile={profile} showToast={showToast} />;

  if (card === 'padrao') {
    return <ComVoltar onBack={() => setCard(null)}><AvaliacoesView profile={profile} showToast={showToast} /></ComVoltar>;
  }
  if (card === 'competicao') {
    return <ComVoltar onBack={() => setCard(null)}><MatrizAvaliacoesView profile={profile} showToast={showToast} /></ComVoltar>;
  }

  return <Landing onSelect={setCard} temCompeticao={temCompeticao} />;
}

function ComVoltar({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onBack}
        className="self-start flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg neu-button text-gray-300 hover:text-accent"
      >
        <ArrowLeft size={12} /> Central de Avaliação
      </button>
      {children}
    </div>
  );
}

function Landing({ onSelect, temCompeticao }: { onSelect: (c: Exclude<Card,null>) => void; temCompeticao: boolean }) {
  const cards = [
    {
      id: 'padrao' as const,
      label: 'Avaliações Padrão',
      hint: 'Ciclos regulares — colaboradores, filiais e feedback do conselho.',
      icon: Star,
      glow: 'bg-sky-500/25',
      iconBg: 'bg-sky-500/10',
      iconRing: 'ring-sky-500/25',
      iconColor: 'text-sky-400',
      disabled: false,
      hintDisabled: '',
    },
    {
      id: 'competicao' as const,
      label: 'Avaliações Competição',
      hint: 'Julgamento do conselho durante a competição — dados das filiais e tarefas da Matriz.',
      icon: Trophy,
      glow: 'bg-amber-500/25',
      iconBg: 'bg-amber-500/10',
      iconRing: 'ring-amber-500/25',
      iconColor: 'text-amber-300',
      disabled: !temCompeticao,
      hintDisabled: 'Sem competição em andamento — abra uma em Matriz → Competição.',
    },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Central de Avaliação</h2>
        <p className="text-sm text-gray-400 mt-1">Escolha entre ciclos padrão ou o julgamento da competição ativa.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map(c => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              onClick={() => !c.disabled && onSelect(c.id)}
              disabled={c.disabled}
              className={`relative neu-flat rounded-2xl p-6 text-left overflow-hidden group transition-all
                ${c.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-accent/40 hover:ring-1 hover:ring-accent/25'}`}
            >
              <div className={`pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full blur-3xl opacity-60 ${c.glow}`} />
              <div className="relative flex items-start justify-between gap-4 mb-5">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ring-1 ${c.iconBg} ${c.iconRing}`}>
                  <Icon size={22} strokeWidth={1.8} className={c.iconColor} />
                </div>
                <ChevronRight size={16} className="text-gray-600 group-hover:text-accent transition-colors" />
              </div>
              <div className="relative">
                <h3 className="text-lg font-black text-gray-100 tracking-tight">{c.label}</h3>
                <p className="text-xs text-gray-400 mt-1 leading-snug">{c.disabled ? c.hintDisabled : c.hint}</p>
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
