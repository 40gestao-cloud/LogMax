import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Gavel } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { isConselho } from '../lib/rbac';
import { todayBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';

// Painel de governança do Início — "o que é seu".
//
// O problema que ele resolve: depois do bloco G1–G8 o sistema passou a ter
// doze atos deliberativos espalhados por seis telas, e ninguém sabia qual
// deles era seu. Dizer isso por texto nas telas já tinha sido tentado e não
// resolveu — o que resolve é o número: se há 1 mandato vencido, o conselheiro
// vê "1" e clica.
//
// Some inteiro quando não há nada pendente: painel de zeros vira ruído e
// ensina a ignorar a tela.

type Pendencia = { label: string; count: number; view: string; hint: string };

// O painel encolheu com o produto. Saíram: Auditoria (Comitê + trilha) e
// Matriz de Riscos em 2026-08-08, Remuneração Variável em 2026-08-09 e, em
// 2026-08-17, os três atos de deliberação de VALOR — Orçamento Anual,
// Prestação de Contas e Destinação do Resultado (migr. 441). Com eles saiu a
// coluna "Executar" inteira: propor verba e prestar contas dela eram as duas
// pendências que o CEO/gerente tinha aqui.
//
// Sobra Mandatos, que é ato de Conselho sobre o posto, não sobre dinheiro.
// `matrizMode` existe por causa dele: a tela virou Matriz-only em 2026-08-09,
// então a pendência que aponta pra ela não pode aparecer com filial ativa —
// daria um clique que o próprio guarda de modo desfaz.
export function PainelGovernanca({
  profile,
  onNavigate,
  matrizMode = false,
}: {
  profile?: UserProfile;
  onNavigate?: (view: string) => void;
  matrizMode?: boolean;
}) {
  const conselho = isConselho(profile);

  const [delib, setDelib] = useState<Pendencia[]>([]);

  const carregar = useCallback(async () => {
    if (!supabase || !profile?.id) return;
    if (!conselho || !matrizMode) { setDelib([]); return; }

    const hoje = todayBR();
    // `head: true` + `count: 'exact'`: só o número volta pela rede. A RLS já
    // recorta por filial, então a conta é a de quem está olhando.
    // Mandato vencido não cai sozinho: fica aqui até alguém decidir. O próprio
    // titular não se reconduz — some da conta, como em todo ato de Conselho.
    const { count } = await supabase.from('mandatos')
      .select('id', { count: 'exact', head: true })
      .eq('ativo', true).eq('status', 'vigente').lt('data_fim', hoje)
      .neq('user_profile_id', profile.id);

    setDelib([
      { label: 'Mandato vencido', count: count ?? 0, view: 'rh-mandatos',
        hint: 'Passou do prazo. Reconduza, substitua ou encerre o posto.' },
    ].filter(p => p.count > 0));
  }, [profile?.id, conselho, matrizMode]);

  useEffect(() => { void carregar(); }, [carregar]);

  if (delib.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2 shrink-0">
      <Bloco titulo="Deliberar" subtitulo="O Conselho decide quem responde pelo posto."
        icone={<Gavel size={16} />} itens={delib} onNavigate={onNavigate} />
    </div>
  );
}

function Bloco({
  titulo, subtitulo, icone, itens, onNavigate,
}: {
  titulo: string;
  subtitulo: string;
  icone: React.ReactNode;
  itens: Pendencia[];
  onNavigate?: (view: string) => void;
}) {
  return (
    <div className="neu-flat rounded-3xl p-5 border border-white/5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
          {icone}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-bold text-gray-200">{titulo}</div>
          <div className="text-[11px] text-gray-500">{subtitulo}</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {itens.map(p => (
          <button key={p.label} onClick={() => onNavigate?.(p.view)}
            className="w-full neu-button rounded-2xl px-3 py-2.5 flex items-center gap-3 text-left hover:border-accent/30 transition-colors">
            <span className="text-lg font-black text-accent tabular-nums w-7 shrink-0 text-center">
              {p.count}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-bold text-gray-200">{p.label}</span>
              <span className="block text-[11px] text-gray-500 leading-tight">{p.hint}</span>
            </span>
            <ArrowRight size={14} className="text-gray-600 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
