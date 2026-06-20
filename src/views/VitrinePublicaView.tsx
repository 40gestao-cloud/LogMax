import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, ImageOff, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState } from '../components/ui';

type Candidato = {
  tipo: 'arte' | 'produto';
  id: string;
  titulo: string;
  descricao: string | null;
  imagem_url: string | null;
  preco_promocional: number | null;
  vitrine_publica: boolean;
  created_at: string;
};

const formatBRL = (v: number | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export const VitrinePublicaView = ({ showToast }: any) => {
  const [items, setItems] = useState<Candidato[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('listar_vitrine_candidatos');
    if (error) {
      showToast(`Erro ao carregar candidatos: ${error.message}`, 'error', true);
      setItems([]);
    } else {
      setItems(Array.isArray(data) ? (data as Candidato[]) : []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const toggle = async (item: Candidato) => {
    if (!supabase) return;
    const key = `${item.tipo}:${item.id}`;
    const novoEstado = !item.vitrine_publica;

    // Optimistic update — reverte se a RPC falhar.
    setItems(prev => prev.map(x => x.id === item.id && x.tipo === item.tipo ? { ...x, vitrine_publica: novoEstado } : x));
    setSaving(key);

    const { error } = await supabase.rpc('marcar_vitrine', {
      p_tipo:    item.tipo,
      p_id:      item.id,
      p_incluir: novoEstado,
    });

    setSaving(null);
    if (error) {
      setItems(prev => prev.map(x => x.id === item.id && x.tipo === item.tipo ? { ...x, vitrine_publica: item.vitrine_publica } : x));
      showToast(`Erro: ${error.message}`, 'error', true);
      return;
    }
    showToast(novoEstado ? 'Adicionado à vitrine.' : 'Removido da vitrine.', 'success', true);
  };

  const ativos    = items.filter(i => i.vitrine_publica).length;
  const naVitrine = items.filter(i => i.vitrine_publica);
  const fora      = items.filter(i => !i.vitrine_publica);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Vitrine Pública</h2>
          <p className="text-sm text-gray-400 mt-1">Escolha quais artes e produtos passam no carrossel da tela de login.</p>
        </div>
        <div className="neu-pressed px-4 py-2 rounded-xl text-xs">
          <span className="text-gray-500 uppercase tracking-widest font-bold">Na vitrine</span>
          <span className="ml-3 text-accent font-bold text-base">{ativos}</span>
          <span className="text-gray-500"> / {items.length}</span>
        </div>
      </div>

      {loading ? <LoadingSpinner /> : items.length === 0 ? (
        <EmptyState message="Nenhuma arte ou produto com imagem encontrado. Publique uma arte em Promoções ou adicione imagem em um produto." />
      ) : (
        <div className="flex flex-col gap-8 overflow-y-auto main-scrollbar pr-2 pb-6">
          {naVitrine.length > 0 && (
            <Section
              titulo="Em destaque"
              subtitulo="Itens que estão aparecendo no carrossel agora."
              items={naVitrine}
              saving={saving}
              onToggle={toggle}
            />
          )}
          {fora.length > 0 && (
            <Section
              titulo="Disponíveis"
              subtitulo="Itens elegíveis para entrar na vitrine."
              items={fora}
              saving={saving}
              onToggle={toggle}
            />
          )}
        </div>
      )}
    </motion.div>
  );
};

function Section({
  titulo, subtitulo, items, saving, onToggle,
}: {
  titulo: string;
  subtitulo: string;
  items: Candidato[];
  saving: string | null;
  onToggle: (item: Candidato) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-bold text-gray-200">{titulo}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{subtitulo}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {items.map(item => (
          <Card key={`${item.tipo}:${item.id}`} item={item} saving={saving} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}

function Card({
  item, saving, onToggle,
}: {
  item: Candidato;
  saving: string | null;
  onToggle: (item: Candidato) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const preco = formatBRL(item.preco_promocional);
  const key = `${item.tipo}:${item.id}`;
  const isSaving = saving === key;
  const ativo = item.vitrine_publica;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="neu-flat rounded-2xl overflow-hidden border border-white/5 flex flex-col"
      style={{ outline: ativo ? '2px solid rgba(212,175,55,0.55)' : 'none' }}
    >
      <div style={{ aspectRatio: '4 / 3', position: 'relative', overflow: 'hidden', background: 'rgba(212,175,55,0.04)' }}>
        {item.imagem_url && !imgError ? (
          <img
            src={item.imagem_url}
            alt={item.titulo}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff size={32} style={{ color: 'rgba(212,175,55,0.3)' }} />
          </div>
        )}
        {ativo && (
          <div
            style={{
              position: 'absolute', top: 8, right: 8,
              background: 'linear-gradient(135deg, #D4AF37, #B8941F)',
              color: '#0A0A0A',
              borderRadius: '999px',
              padding: '0.25rem 0.5rem',
              fontSize: '0.55rem',
              fontWeight: 800,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: '0.25rem',
            }}
          >
            <Sparkles size={10} /> Na vitrine
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1 flex-1">
        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
          {item.tipo === 'arte' ? 'Promoção' : 'Produto'}
        </span>
        <p className="text-sm font-bold text-gray-200 leading-snug line-clamp-2">{item.titulo}</p>
        {preco && <p className="text-sm font-bold text-accent">{preco}</p>}

        <button
          onClick={() => onToggle(item)}
          disabled={isSaving}
          className="mt-auto neu-button py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          style={ativo ? {
            background: 'linear-gradient(135deg, rgba(212,175,55,0.15), rgba(212,175,55,0.05))',
            border: '1px solid rgba(212,175,55,0.4)',
            color: '#D4AF37',
          } : undefined}
        >
          {isSaving ? '...' : ativo ? (<><Check size={12} /> Remover da vitrine</>) : 'Adicionar à vitrine'}
        </button>
      </div>
    </motion.div>
  );
}
