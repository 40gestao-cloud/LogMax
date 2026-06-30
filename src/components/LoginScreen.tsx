import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, AlertCircle, Eye, EyeOff, LogIn } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { VitrineCarousel } from './VitrineCarousel';

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    return () => {
      if (previous) root.setAttribute('data-theme', previous);
    };
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) { setError('O e-mail é obrigatório.'); return; }
    if (!password.trim()) { setError('A senha é obrigatória.'); return; }

    if (!supabase) {
      setError('Supabase não configurado. Verifique as variáveis de ambiente.');
      return;
    }

    setIsLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(
          authError.message.includes('Invalid login credentials')
            ? 'E-mail ou senha inválidos. Verifique suas credenciais.'
            : authError.message
        );
        return;
      }
      onLoginSuccess();
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center relative overflow-hidden"
      style={{ background: '#000000' }}
    >
      {/* Container central com largura controlada — evita que vitrine e login
          fiquem grudados nas bordas em telas widescreen. Inspirado no Bling:
          conteúdo agrupado no meio, espaço preto sobrando nas laterais. */}
      <div className="w-full max-w-6xl flex flex-col md:flex-row md:min-h-screen items-center">
        {/* Vitrine pública — só desktop. Mobile mantém o card de login centralizado. */}
        <div className="hidden md:flex md:flex-1 md:min-h-screen items-center justify-center">
          <VitrineCarousel />
        </div>

        {/* Coluna do login: flex-1 em ambos os breakpoints. */}
        <div className="flex-1 flex items-center justify-center p-6 md:p-10 w-full">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="w-full"
          style={{
            maxWidth: 420,
            position: 'relative',
            zIndex: 1,
          }}
        >
        {/* Logo — identidade Premium fixa (variante dark) com shimmer.
            Container flat, sem sombra. */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="logo-shimmer"
            style={{
              width: 220,
              height: 220,
              borderRadius: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src="/icon-logmax.png"
              alt="LogMax"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" style={{
              fontSize: '0.65rem', fontWeight: 700,
              color: 'var(--color-text-dim)',
              textTransform: 'uppercase', letterSpacing: '0.15em',
            }}>
              E-mail
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              placeholder="seu@email.com"
              autoComplete="email"
              disabled={isLoading}
              style={{
                background: 'var(--color-input-bg)',
                boxShadow: 'var(--color-input-shadow)',
                border: error && !email.trim() ? '1px solid rgba(239,68,68,0.4)' : '1px solid var(--color-input-border)',
                borderRadius: '0.875rem',
                padding: '0.85rem 1rem',
                color: 'var(--color-input-text)',
                fontSize: '0.875rem',
                outline: 'none',
                width: '100%',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--color-accent) 35%, transparent)'; }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = error && !email.trim()
                  ? 'rgba(239,68,68,0.4)'
                  : 'var(--color-input-border)';
              }}
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" style={{
              fontSize: '0.65rem', fontWeight: 700,
              color: 'var(--color-text-dim)',
              textTransform: 'uppercase', letterSpacing: '0.15em',
            }}>
              Senha
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={isLoading}
                style={{
                  background: 'var(--color-input-bg)',
                  boxShadow: 'var(--color-input-shadow)',
                  border: error && !password.trim() ? '1px solid rgba(239,68,68,0.4)' : '1px solid var(--color-input-border)',
                  borderRadius: '0.875rem',
                  padding: '0.85rem 3rem 0.85rem 1rem',
                  color: 'var(--color-input-text)',
                  fontSize: '0.875rem',
                  outline: 'none',
                  width: '100%',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--color-accent) 35%, transparent)'; }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = error && !password.trim()
                    ? 'rgba(239,68,68,0.4)'
                    : 'var(--color-input-border)';
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={isLoading}
                style={{
                  position: 'absolute', right: '0.875rem', top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none',
                  color: 'var(--color-text-dim)',
                  cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center',
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Error message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 4 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: '0.75rem',
                  padding: '0.75rem 1rem',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  overflow: 'hidden',
                }}
              >
                <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
                <span style={{ fontSize: '0.78rem', color: '#f87171', fontWeight: 600 }}>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit — dourado fixo (#D4AF37) com shimmer. Flat: sem glow/sombra
              borrada — preferência explícita do usuário. */}
          <motion.button
            type="submit"
            disabled={isLoading}
            whileTap={!isLoading ? { scale: 0.97 } : {}}
            className="btn-shimmer login-submit"
            style={{
              marginTop: '0.5rem',
              width: '100%',
              padding: '0.95rem',
              borderRadius: '0.875rem',
              background: isLoading
                ? 'rgba(212, 175, 55, 0.5)'
                : 'linear-gradient(135deg, #D4AF37, #B8941F)',
              boxShadow: 'none',
              border: 'none',
              color: '#0A0A0A',
              fontWeight: 800,
              fontSize: '0.875rem',
              letterSpacing: '0.08em',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '0.5rem',
              transition: 'filter 0.2s, background 0.2s',
            }}
          >
            {isLoading ? (
              <><Loader2 size={16} className="animate-spin" /> Entrando...</>
            ) : (
              <><LogIn size={16} /> Entrar</>
            )}
          </motion.button>
        </form>

        {/* Footer */}
        <div style={{ marginTop: '1.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
          <img
            src="/icon-assinatura.png"
            alt="Assinatura"
            style={{ height: '4rem', width: 'auto', opacity: 0.9 }}
          />
        </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
