import { useEffect, useState } from 'react';
import { Star, Trophy, Target } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { isConselheiro } from '../lib/rbac';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { AvaliacoesView } from './AvaliacoesView';
import { MatrizAvaliacoesView } from './MatrizAvaliacoesView';
import { MetasView } from './MetasView';

type Aba = 'padrao' | 'metas' | 'competicao';

// Central de Avaliação: hub único com Padrão + Metas (sempre) e Competição
// (só quando há competição ativa + admin/CEO/conselheiro em modo Matriz).
export function CentralAvaliacaoView({ profile, showToast, initialTab = 'padrao' }: {
  profile: UserProfile;
  showToast: any;
  initialTab?: Aba;
}) {
  const { filialAtiva, escolheu } = useFilial();
  const modoMatriz = escolheu && filialAtiva === null;
  const podeCompeticao = modoMatriz && (profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile));

  const [temCompeticao, setTemCompeticao] = useState(false);
  const [loading, setLoading] = useState(podeCompeticao);
  const [aba, setAba] = useState<Aba>(initialTab);

  useEffect(() => {
    if (!podeCompeticao || !supabase) { setLoading(false); return; }
    let cancelou = false;

    // Inclui `aguardando_encerramento` — durante a votação do conselho a aba
    // continua útil pra revisitar itens/tarefas já pontuados. Some só quando
    // encerrada de fato.
    const verificar = async () => {
      const { data } = await supabase!
        .from('competicoes_matriz')
        .select('id')
        .eq('ativo', true)
        .in('status', ['em_andamento', 'aguardando_encerramento'])
        .maybeSingle();
      if (!cancelou) {
        setTemCompeticao(!!data);
        setLoading(false);
      }
    };

    verificar();

    // Realtime: aba aparece/some sem precisar recarregar quando admin cria/encerra.
    const canal = supabase
      .channel('central-avaliacao-competicao')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competicoes_matriz' }, () => {
        verificar();
      })
      .subscribe();

    return () => { cancelou = true; supabase!.removeChannel(canal); };
  }, [podeCompeticao]);

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  const mostrarCompeticao = podeCompeticao && temCompeticao;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 neu-pressed rounded-xl p-1 self-start flex-wrap">
        <TabBtn active={aba === 'metas'}  onClick={() => setAba('metas')}  icon={<Target size={12} className="text-emerald-300" />} label="Metas" />
        <TabBtn active={aba === 'padrao'} onClick={() => setAba('padrao')} icon={<Star size={12} />} label="Padrão" />
        {mostrarCompeticao && (
          <TabBtn active={aba === 'competicao'} onClick={() => setAba('competicao')} icon={<Trophy size={12} className="text-amber-300" />} label="Competição do Conselho" />
        )}
      </div>
      {aba === 'padrao'   && <AvaliacoesView profile={profile} showToast={showToast} />}
      {aba === 'metas'    && <MetasView profile={profile} showToast={showToast} />}
      {aba === 'competicao' && mostrarCompeticao && <MatrizAvaliacoesView profile={profile} showToast={showToast} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
        active ? 'neu-button text-accent ring-1 ring-accent/30' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
