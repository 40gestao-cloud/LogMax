import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ImageOff } from 'lucide-react';
import { supabase } from '../lib/supabase';

type VitrineItem = {
  // 'institucional' = peça do professor (migr. 541). Sem esse terceiro caso o
  // rótulo caía no `else` e um banner de boas-vindas aparecia etiquetado
  // "Produto" na tela de login.
  tipo: 'arte' | 'produto' | 'institucional';
  id: string;
  titulo: string;
  descricao: string | null;
  imagem_url: string | null;
  imagem_fallback: string | null;  // produto.imagem_url quando arte_url existir mas quebrar
  preco_promocional: number | null;
  data_inicio: string | null;
  data_fim: string | null;
  created_at: string;
};

const ROTATE_MS = 4500;

const formatBRL = (v: number | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// Carrossel público — card contido, sem ocupar a tela inteira. Lê via RPC
// `get_vitrine_publica` (só itens marcados como vitrine pelo Marketing).
// Tema Premium (preto + dourado) compatível com a LoginScreen.
export function VitrineCarousel() {
  const [items, setItems] = useState<VitrineItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // tick incrementa a cada slide pra reiniciar a animação da barra de progresso.
  const tickRef = useRef(0);

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

  // Auto-rotação acontece SEMPRE (o ponto de uma vitrine é mover).
  // prefers-reduced-motion só afeta a duração da transição visual abaixo —
  // não desliga o avanço. Antes desligava, e usuários com Windows
  // Accessibility > Animation effects = OFF viam carrossel estático.
  useEffect(() => {
    if (items.length <= 1) return;
    const t = setInterval(() => {
      tickRef.current += 1;
      setIdx(i => (i + 1) % items.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [items.length]);

  useEffect(() => { setIdx(0); tickRef.current = 0; }, [items.length]);

  if (!loaded || items.length === 0) {
    return (
      <div
        className="hidden md:flex flex-col items-center justify-center w-full h-full"
        aria-hidden="true"
      >
        <img
          src="/icon-logmax.png"
          alt=""
          style={{ width: 160, height: 160, opacity: 0.35, objectFit: 'cover', borderRadius: '1.5rem' }}
        />
      </div>
    );
  }

  const current = items[idx];

  return (
    <div
      className="hidden md:flex flex-col items-center justify-center w-full h-full p-10"
      role="region"
      aria-label="Vitrine de destaques"
      aria-roledescription="carrossel"
    >
      {/* Card contido — largura controlada, não estoura a coluna.
          A borda dourada vem do ::before animado de `.vitrine-card-shimmer`
          (conic-gradient rotativo); sem `border:` inline para não dobrar. */}
      <div
        className="vitrine-card-shimmer"
        style={{
          width: '100%',
          maxWidth: 460,
          aspectRatio: '4 / 5',
          borderRadius: '1.5rem',
          overflow: 'hidden',
          position: 'relative',
          background: 'linear-gradient(180deg, rgba(212,175,55,0.04), rgba(212,175,55,0.01))',
          boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02) inset',
        }}
      >
        {/* Sem AnimatePresence mode="wait" — bug do motion travava exit em
            alguns casos, fazendo o DOM ficar parado mesmo com idx mudando.
            Aqui cada slide eh montado com fade-in via key={idx}; o anterior
            desmonta instantaneamente. Simples e infalivel. */}
        <motion.div
          key={current.id}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
        >
          <Slide item={current} />
        </motion.div>

        {/* Barra de progresso no topo do card — pista visual de que está rotacionando. */}
        {items.length > 1 && (
          <div
            key={`progress-${idx}-${tickRef.current}`}
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0,
              height: 3,
              background: 'rgba(255,255,255,0.08)',
              zIndex: 3,
              overflow: 'hidden',
            }}
          >
            <motion.div
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: ROTATE_MS / 1000, ease: 'linear' }}
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, #D4AF37, #F4D070)',
              }}
            />
          </div>
        )}
      </div>

      {/* Dots fora do card, perto pra dar sensação de controle imediato. */}
      {items.length > 1 && (
        <div className="flex gap-2 mt-6">
          {items.map((it, i) => (
            <button
              key={it.id}
              onClick={() => { setIdx(i); tickRef.current += 1; }}
              aria-label={`Slide ${i + 1} de ${items.length}`}
              aria-current={i === idx}
              style={{
                width: i === idx ? 28 : 8,
                height: 8,
                borderRadius: 999,
                border: 'none',
                background: i === idx
                  ? 'linear-gradient(135deg, #D4AF37, #B8941F)'
                  : 'rgba(255,255,255,0.18)',
                cursor: 'pointer',
                transition: 'width 0.3s, background 0.3s',
              }}
            />
          ))}
        </div>
      )}

      {/* Tagline pequena abaixo. Reforça que o LogMax tem vida. */}
      <p
        style={{
          marginTop: '1.25rem',
          textAlign: 'center',
          fontSize: '0.7rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'rgba(212,175,55,0.55)',
          fontWeight: 700,
        }}
      >
        Vitrine LogMax
      </p>
    </div>
  );
}

function Slide({ item }: { item: VitrineItem }) {
  // Tenta imagem_url primeiro; se falhar, troca pra fallback (produto.imagem_url).
  // Se ambas falharem, marca erro e mostra ImageOff.
  const [imgSrc, setImgSrc] = useState<string | null>(item.imagem_url);
  const [usedFallback, setUsedFallback] = useState(false);
  const [imgError, setImgError] = useState(false);

  const handleError = () => {
    if (!usedFallback && item.imagem_fallback && item.imagem_fallback !== imgSrc) {
      setImgSrc(item.imagem_fallback);
      setUsedFallback(true);
    } else {
      setImgError(true);
    }
  };

  const preco = formatBRL(item.preco_promocional);

  return (
    <>
      {/* A imagem fica com todo o espaço que sobra do texto (antes era fatia
          fixa de 52%, e o bloco de texto esticava mesmo com uma linha só —
          arte pequena embaixo, vazio enorme em cima). */}
      <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {imgSrc && !imgError ? (
          <>
            {/* Cópia borrada preenchendo a caixa: a arte de cima usa `contain`
                (nada de corte — 512x512 numa caixa mais larga sobrava faixa),
                e essa camada evita a barra preta lateral. */}
            <img
              src={imgSrc}
              alt=""
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'blur(28px) saturate(1.2)',
                transform: 'scale(1.15)',
                opacity: 0.45,
              }}
            />
            <img
              src={imgSrc}
              alt={item.titulo}
              onError={handleError}
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </>
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: 'rgba(212, 175, 55, 0.05)' }}
          >
            <ImageOff size={48} style={{ color: 'rgba(212, 175, 55, 0.3)' }} />
          </div>
        )}
      </div>

      {/* Bloco de texto abaixo da imagem — não overlay. Mais legível.
          `flex: 0 0 auto`: ocupa só a altura do próprio conteúdo. */}
      <div
        style={{
          flex: '0 0 auto',
          padding: '1.1rem 1.5rem 1.35rem',
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <span
          style={{
            alignSelf: 'flex-start',
            fontSize: '0.7rem',
            fontWeight: 800,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#D4AF37',
            padding: '0.35rem 0.85rem',
            borderRadius: '999px',
            background: 'rgba(212, 175, 55, 0.1)',
            border: '1px solid rgba(212, 175, 55, 0.3)',
          }}
        >
          {item.tipo === 'arte' ? 'Promoção' : item.tipo === 'institucional' ? 'Destaque' : 'Produto'}
        </span>
        <h3
          style={{
            fontSize: '1.3rem',
            fontWeight: 800,
            color: '#fff',
            margin: 0,
            lineHeight: 1.2,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {item.titulo}
        </h3>
        {item.descricao && (
          <p
            style={{
              margin: 0,
              color: 'rgba(255,255,255,0.72)',
              fontSize: '0.9rem',
              lineHeight: 1.4,
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
              marginTop: '0.4rem',
              fontSize: '1.7rem',
              fontWeight: 800,
              color: '#D4AF37',
              letterSpacing: '0.02em',
            }}
          >
            {preco}
          </p>
        )}
      </div>
    </>
  );
}
