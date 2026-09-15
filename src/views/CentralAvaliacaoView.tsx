import { useEffect, useState } from 'react';
import { Star, Trophy, Target, Megaphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { isConselheiro } from '../lib/rbac';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { AvaliacoesView } from './AvaliacoesView';
import { MatrizAvaliacoesView } from './MatrizAvaliacoesView';
import { MatrizAvisosView } from './MatrizAvisosView';
import { MetasView } from './MetasView';

type Aba = 'padrao' | 'metas' | 'competicao' | 'avisos';

// Central de Avaliação: Padrão (sempre) + Metas (só em Matriz — no modo filial
// Metas migrou pra DemandasView) + Avisos (Matriz, admin/CEO/conselheiro) +
// Competição (só quando há competição ativa + admin/CEO/conselheiro em modo
// Matriz).
export function CentralAvaliacaoView({ profile, showToast, initialTab = 'padrao' }: {
  profile: UserProfile;
  showToast: any;
  initialTab?: Aba;
}) {
  const { filialAtiva, escolheu } = useFilial();
  const modoMatriz = escolheu && filialAtiva === null;
  const ehConselho = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  const podeCompeticao = modoMatriz && ehConselho;
  const podeAvisos = modoMatriz && ehConselho;

  const [temCompeticao, setTemCompeticao] = useState(false);
  const [loading, setLoading] = useState(podeCompeticao);
  const [aba, setAba] = useState<Aba>(initialTab);

  useEffect(() => {
    if (!podeCompeticao || !supabase) { setLoading(false); return; }
    let cancelou = false;

    // Inclui `encerrada`: a aba sumir ao declarar a vencedora tornava tarefas,
    // notas e participantes inalcançáveis — é justamente quando se consulta.
    // Fora de 'em_andamento' a tela abre em leitura, que ela já sabe fazer.
    // `maybeSingle` saiu porque encerrada há várias.
    const verificar = async () => {
      const { data } = await supabase!
        .from('competicoes_matriz')
        .select('id')
        .eq('ativo', true)
        .in('status', ['em_andamento', 'aguardando_encerramento', 'encerrada'])
        .limit(1);
      if (!cancelou) {
        setTemCompeticao((data ?? []).length > 0);
        setLoading(false);
      }
    };

    verificar();

    // Realtime: aba aparece/some sem precisar recarregar quando admin cria/encerra.
    const parar = assinarRealtime({
      nome: 'central-avaliacao-competicao',
      alvos: ['competicoes_matriz'],
      aoMudar: () => { verificar(); },
    });

    return () => { cancelou = true; parar(); };
  }, [podeCompeticao]);

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  const mostrarCompeticao = podeCompeticao && temCompeticao;
  // Quem chega por `matriz-avaliacoes` pede a aba de Competição. Se ela não
  // existe (sem competição, ou fora do conselho), cai em Padrão em vez de
  // renderizar nada — tela em branco é pior que a aba errada.
  const abaEfetiva: Aba = aba === 'competicao' && !mostrarCompeticao ? 'padrao' : aba;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 neu-pressed rounded-xl p-1 self-start flex-wrap">
        {modoMatriz && (
          <TabBtn active={abaEfetiva === 'metas'}  onClick={() => setAba('metas')}  icon={<Target size={12} className="text-emerald-300" />} label="Metas" />
        )}
        <TabBtn active={abaEfetiva === 'padrao'} onClick={() => setAba('padrao')} icon={<Star size={12} />} label="Padrão" />
        {podeAvisos && (
          <TabBtn active={abaEfetiva === 'avisos'} onClick={() => setAba('avisos')} icon={<Megaphone size={12} className="text-amber-300" />} label="Avisos" />
        )}
        {mostrarCompeticao && (
          <TabBtn active={abaEfetiva === 'competicao'} onClick={() => setAba('competicao')} icon={<Trophy size={12} className="text-amber-300" />} label="Competição do Conselho" />
        )}
      </div>
      {abaEfetiva === 'padrao'   && <AvaliacoesView profile={profile} showToast={showToast} />}
      {abaEfetiva === 'metas'    && modoMatriz && <MetasView profile={profile} showToast={showToast} />}
      {abaEfetiva === 'avisos'   && podeAvisos && <MatrizAvisosView profile={profile} showToast={showToast} />}
      {abaEfetiva === 'competicao' && mostrarCompeticao && <MatrizAvaliacoesView profile={profile} showToast={showToast} />}
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
