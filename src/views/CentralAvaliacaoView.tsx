import { useState } from 'react';
import { Star, Target, Megaphone } from 'lucide-react';
import { isConselheiro } from '../lib/rbac';
import { useFilial } from '../contexts/FilialContext';
import { AbaColorida } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { AvaliacoesView } from './AvaliacoesView';
import { MatrizAvisosView } from './MatrizAvisosView';
import { MetasView } from './MetasView';

type Aba = 'padrao' | 'metas' | 'avisos';

// Central de Avaliação: Padrão (sempre) + Metas (só em Matriz — no modo filial
// Metas migrou pra DemandasView) + Avisos (Matriz, admin/CEO/conselheiro).
// A "Competição do Conselho" saiu daqui em 2026-10-04: virou a aba Avaliação
// da própria Competição (MatrizCompeticaoView). Aqui fica só a avaliação de
// desempenho da empresa — a da competição era outro assunto no mesmo lugar.
export function CentralAvaliacaoView({ profile, showToast, initialTab = 'padrao' }: {
  profile: UserProfile;
  showToast: any;
  initialTab?: Aba;
}) {
  const { filialAtiva, escolheu } = useFilial();
  const modoMatriz = escolheu && filialAtiva === null;
  const ehConselho = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  const podeAvisos = modoMatriz && ehConselho;

  const [aba, setAba] = useState<Aba>(initialTab);
  // Aba que não existe neste modo cai em Padrão: tela em branco é pior que a aba errada.
  const abaEfetiva: Aba =
    (aba === 'metas' && !modoMatriz) || (aba === 'avisos' && !podeAvisos) ? 'padrao' : aba;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        {modoMatriz && (
          <AbaColorida ativa={abaEfetiva === 'metas'} onClick={() => setAba('metas')} icon={Target} cor="verde" label="Metas" />
        )}
        <AbaColorida ativa={abaEfetiva === 'padrao'} onClick={() => setAba('padrao')} icon={Star} cor="azul" label="Padrão" />
        {podeAvisos && (
          <AbaColorida ativa={abaEfetiva === 'avisos'} onClick={() => setAba('avisos')} icon={Megaphone} cor="amarelo" label="Avisos" />
        )}
      </div>
      {abaEfetiva === 'padrao'   && <AvaliacoesView profile={profile} showToast={showToast} />}
      {abaEfetiva === 'metas'    && modoMatriz && <MetasView profile={profile} showToast={showToast} />}
      {abaEfetiva === 'avisos'   && podeAvisos && <MatrizAvisosView profile={profile} showToast={showToast} />}
    </div>
  );
}
