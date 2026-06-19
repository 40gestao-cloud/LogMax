import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageOff } from 'lucide-react';
import { supabase } from '../lib/supabase';

type VitrineItem = {
  tipo: 'arte' | 'produto';
  id: string;
  titulo: string;
  descricao: string | null;
  imagem_url: string | null;
  preco_promocional: number | null;
  data_inicio: string | null;
  data_fim: string | null;
  created_at: string;
};

const ROTATE_MS = 5000;

const formatBRL = (v: number | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// Carrossel público — sem login necessário. Lê via RPC `get_vitrine_publica`
// que devolve artes + produtos com imagem. Desenhado pra LoginScreen no tema
// Premium (preto + dourado), mas reusável em outras vitrines.
export function VitrineCarousel() {
  const [items, setItems] = useState<VitrineItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // prefers-reduced-motion: respeita preferência do SO e desliga auto-rotação.
  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!supabase) { setLoaded(true); return; }
    supabase.rpc('get_vitrine_publica').then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.warn('[VitrineCarousel] RPC error:', error.message);
        setItems([]);
      } else {
        setItems(Array.isArray(data) ? (data as VitrineItem[]) : []);
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Auto-advance. Pausa quando hover/foco no carrossel ou prefers-reduced.
  useEffect(() => {
    if (paused || reducedMotion || items.length <= 1) return;
    const t = setInterval(() => {
      setIdx(i => (i + 1) % items.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, reducedMotion, items.length]);

  // Reseta para o índice 0 quando os itens mudam pra evitar idx fora de range.
  useEffect(() => { setIdx(0); }, [items.length]);

  if (!loaded || items.length === 0) {
    // Sem dados: estado neutro discreto. Não atrapalha o login se a vitrine
    // estiver vazia (banco recém-resetado, etc.).
    return (
      <div
        className="hidden md:flex flex-col items-center justify-center w-full h-full p-12"
        style={{ color: 'rgba(212, 175, 55, 0.35)' }}
        aria-hidden="true"
      >
        <img
          src="/icon-logmax.png"
          alt=""
          style={{ width: 180, height: 180, opacity: 0.4, objectFit: 'cover', borderRadius: '1.5rem' }}
        />
      </div>
    );
  }

  const current = items[idx];

  return (
    <div
      className="hidden md:flex relative w-full h-full overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      role="region"
      aria-label="Vitrine de destaques"
      aria-roledescription="carrossel"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.6 }}
          className="absolute inset-0"
        >
          <Slide item={current} />
        </motion.div>
      </AnimatePresence>

      {/* Dots — clicável pra ir direto. Só aparece se há >= 2 itens. */}
      {items.length > 1 && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2"
          style={{ zIndex: 2 }}
        >
          {items.map((it, i) => (
            <button
              key={it.id}
              onClick={() => setIdx(i)}
              aria-label={`Slide ${i + 1} de ${items.length}`}
              aria-current={i === idx}
              style={{
                width: i === idx ? 28 : 8,
                height: 8,
                borderRadius: 999,
                border: 'none',
                background: i === idx
                  ? 'linear-gradient(135deg, #D4AF37, #B8941F)'
                  : 'rgba(255,255,255,0.25)',
                cursor: 'pointer',
                transition: 'width 0.3s, background 0.3s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Slide({ item }: { item: VitrineItem }) {
  const [imgError, setImgError] = useState(false);
  const preco = formatBRL(item.preco_promocional);

  return (
    <div className="relative w-full h-full">
      {item.imagem_url && !imgError ? (
        <img
          src={item.imagem_url}
          alt={item.titulo}
          onError={() => setImgError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{ background: 'rgba(212, 175, 55, 0.05)' }}
        >
          <ImageOff size={64} style={{ color: 'rgba(212, 175, 55, 0.3)' }} />
        </div>
      )}

      {/* Overlay gradiente + texto. Garante legibilidade sobre qualquer imagem. */}
      <div
        className="absolute inset-0 flex flex-col justify-end p-10 pb-20"
        style={{
          background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.85) 100%)',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            alignSelf: 'flex-start',
            fontSize: '0.6rem',
            fontWeight: 800,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#D4AF37',
            padding: '0.35rem 0.75rem',
            borderRadius: '999px',
            background: 'rgba(212, 175, 55, 0.1)',
            border: '1px solid rgba(212, 175, 55, 0.3)',
            marginBottom: '0.75rem',
          }}
        >
          {item.tipo === 'arte' ? 'Promoção' : 'Produto'}
        </span>
        <h3
          style={{
            fontSize: '1.5rem',
            fontWeight: 800,
            color: '#fff',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {item.titulo}
        </h3>
        {item.descricao && (
          <p
            style={{
              marginTop: '0.5rem',
              color: 'rgba(255,255,255,0.7)',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              maxWidth: 460,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.descricao}
          </p>
        )}
        {preco && (
          <p
            style={{
              marginTop: '0.75rem',
              fontSize: '1.25rem',
              fontWeight: 800,
              color: '#D4AF37',
              letterSpacing: '0.02em',
            }}
          >
            {preco}
          </p>
        )}
      </div>
    </div>
  );
}
