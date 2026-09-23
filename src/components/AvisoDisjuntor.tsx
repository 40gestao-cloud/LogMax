import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { observarDisjuntor, type EstadoDisjuntor } from '../lib/disjuntor';

// O selo de "a rede está engasgada" no topbar.
//
// Ele não é enfeite: é metade do conserto. O que transformou a queda de 22/09
// em oito minutos foi o F5. O aluno via a tela parada, não tinha nenhuma
// informação de que o sistema sabia disso, e a única saída que a interface
// oferecia era recarregar — e cada recarga são ~9 requisições de boot num
// servidor que já estava afogado. O disjuntor corta o tráfego automático; este
// selo corta o motivo humano de gerar mais.
//
// Por isso o texto fala de espera e não de erro, e por isso ele diz
// explicitamente para não recarregar. "Erro" convida a tentar de novo.
//
// Não é modal, de propósito — vide `naoInterromper.ts`. O aluno pode estar com
// um carrinho de PDV aberto ou um formulário meio preenchido; tirar o foco dele
// para avisar que a rede está lenta é trocar um problema por outro. É um selo
// no topbar, ao lado do sino, e sai sozinho quando o disjuntor fecha.

export function AvisoDisjuntor() {
  const [estado, setEstado] = useState<EstadoDisjuntor>('fechado');
  useEffect(() => observarDisjuntor(setEstado), []);

  if (estado === 'fechado') return null;

  const aberto = estado === 'aberto';
  return (
    <div
      role="status"
      aria-live="polite"
      title={aberto
        ? 'A rede está lenta. O sistema pausou as atualizações automáticas para '
          + 'desafogar, e volta sozinho em alguns segundos. O que você digitar e '
          + 'gravar continua funcionando. Não recarregue a página — recarregar '
          + 'atrasa a volta.'
        : 'Testando a rede. Se estiver boa, as atualizações automáticas voltam já.'}
      className={`neu-flat rounded-2xl h-9 px-3 flex items-center gap-2 shrink-0 border ${
        aberto ? 'border-amber-500/30 text-amber-400' : 'border-white/10 text-gray-400'
      }`}
    >
      <CloudOff size={13} className={aberto ? 'animate-pulse' : ''} />
      <span className="hidden sm:inline text-[10px] font-black uppercase tracking-widest">
        {aberto ? 'Rede lenta' : 'Reconectando'}
      </span>
    </div>
  );
}
