// Configurações de Marketing — os dois números que o professor mexe.
//
// Sessões Gerais → Marketing → Configurações. Só `role = 'admin'` literal
// chega aqui (o submenu tem `requireRole`, e a policy de UPDATE da migr. 539
// recusa qualquer outro — CEO e conselheiro são alunos, e estes números
// existem para limitá-los).
//
// Os dois limites moram juntos porque quem decide é a mesma pessoa na mesma
// conversa. Mas quem SENTE cada um é diferente, e por isso cada campo diz
// onde o efeito aparece — número configurado num lugar e sentido em outro é
// como se produz o "mudei e não aconteceu nada".

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Settings, Save, Image, Monitor } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, NeuButtonAccent } from '../components/ui';

export const MarketingConfigView = ({ showToast }: any) => {
  const [maxArtes, setMaxArtes] = useState(3);
  const [maxVitrine, setMaxVitrine] = useState(12);
  const [usoVitrine, setUsoVitrine] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let cancelado = false;
    (async () => {
      const { data } = await supabase!.from('marketing_config')
        .select('max_artes_por_produto, max_vitrine').eq('id', 1).maybeSingle();
      if (cancelado) return;
      if (data) {
        setMaxArtes(data.max_artes_por_produto ?? 3);
        setMaxVitrine(data.max_vitrine ?? 12);
      }
      // Quantos já estão na vitrine: baixar o teto abaixo disso não tira
      // ninguém (a régua só vale na inclusão), e o professor precisa saber.
      const [{ count: a }, { count: p }] = await Promise.all([
        supabase!.from('marketing_artes').select('id', { count: 'exact', head: true }).eq('vitrine_publica', true),
        supabase!.from('produtos').select('id', { count: 'exact', head: true }).eq('vitrine_publica', true),
      ]);
      if (!cancelado) setUsoVitrine((a ?? 0) + (p ?? 0));
      if (!cancelado) setLoading(false);
    })();
    return () => { cancelado = true; };
  }, []);

  const salvar = async () => {
    if (!supabase) return;
    setSaving(true);
    // `.select()` não é enfeite: sem ele, um UPDATE que não acha a linha (ou
    // que a RLS recusa em silêncio) volta sem erro, e a tela diria "salvo"
    // sem ter salvado nada.
    const { data, error } = await supabase.from('marketing_config')
      .update({
        max_artes_por_produto: maxArtes,
        max_vitrine: maxVitrine,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', 1)
      .select();
    setSaving(false);
    if (error) { showToast(`Não foi possível salvar: ${error.message}`, 'error', true); return; }
    if (!data || data.length === 0) {
      showToast('Nada foi salvo — a linha de configuração não foi encontrada ou a permissão foi negada.', 'error', true);
      return;
    }
    showToast('Configurações salvas.', 'success', true);
  };

  if (loading) return <LoadingSpinner />;

  const baixouDemais = usoVitrine != null && maxVitrine < usoVitrine;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <Settings size={24} /> Configurações de Marketing
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Dois limites da turma. Valem para todas as unidades.
        </p>
      </div>

      <div className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-2">
        <label htmlFor="max-artes" className="text-sm font-bold text-gray-200 flex items-center gap-2">
          <Image size={14} className="text-pink-400" /> Artes por produto
        </label>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Quantas artes a turma pode publicar para o <span className="text-gray-400">mesmo produto</span>, somando
          todas as campanhas dele. Sentido pelo aluno em <span className="text-gray-400">Marketing → Promoções</span>,
          na hora de publicar.
        </p>
        <input id="max-artes" type="number" min={1} max={20}
          value={maxArtes}
          onChange={e => setMaxArtes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          className="neu-input rounded-xl px-3 py-2 text-sm w-28 mt-1" />
        <p className="text-[10px] text-gray-600">
          Entre 1 e 20. Com 1, a segunda campanha do mesmo produto já não consegue publicar arte.
        </p>
      </div>

      <div className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-2">
        <label htmlFor="max-vitrine" className="text-sm font-bold text-gray-200 flex items-center gap-2">
          <Monitor size={14} className="text-accent" /> Itens no carrossel do login
        </label>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Quantos itens cabem na vitrine da tela de login, somando artes e produtos. Sentido por você
          em <span className="text-gray-400">Marketing → Vitrine da Tela de Login</span>, ao incluir.
        </p>
        <input id="max-vitrine" type="number" min={1} max={40}
          value={maxVitrine}
          onChange={e => setMaxVitrine(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
          className="neu-input rounded-xl px-3 py-2 text-sm w-28 mt-1" />
        <p className="text-[10px] text-gray-600">
          Entre 1 e 40. A 4,5s por slide, 12 itens já dão quase um minuto de volta completa.
          {usoVitrine != null && <> Hoje há <span className="text-gray-400">{usoVitrine}</span> na vitrine.</>}
        </p>
        {baixouDemais && (
          <p className="text-[11px] text-yellow-400 leading-relaxed">
            O limite ficou abaixo dos {usoVitrine} itens já incluídos. Nenhum é removido — mas o carrossel
            passa a mostrar só os {maxVitrine} mais recentes até você tirar os que sobram.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <NeuButtonAccent variant="" onClick={salvar} disabled={saving}>
          <Save size={13} /> {saving ? 'Salvando…' : 'Salvar'}
        </NeuButtonAccent>
      </div>
    </motion.div>
  );
};
