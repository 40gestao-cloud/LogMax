import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Package, Loader2, AlertCircle, Eye, EyeOff, LogIn } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validação básica de campos obrigatórios
    if (!email.trim()) {
      setError('O e-mail é obrigatório.');
      return;
    }
    if (!password.trim()) {
      setError('A senha é obrigatória.');
      return;
    }

    if (!supabase) {
      setError('Supabase não configurado. Verifique as variáveis de ambiente.');
      return;
    }

    setIsLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        if (authError.message.includes('Invalid login credentials')) {
          setError('E-mail ou senha inválidos. Verifique suas credenciais.');
        } else {
          setError(authError.message);
        }
        return;
      }
      onLoginSuccess();
    } catch (err: any) {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center relative overflow-hidden"
      style={{ background: '#0A0A0A' }}
    >
      {/* Background ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(16,185,129,0.04) 0%, transparent 70%)',
          top: '20%',
          right: '15%',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        style={{
          width: '100%',
          maxWidth: 420,
          padding: '2.5rem',
          borderRadius: '2rem',
          background: 'linear-gradient(145deg, #0f0f0f, #080808)',
          boxShadow: '12px 12px 32px #050505, -6px -6px 20px #141414, inset 0 1px 0 rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.04)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #0f0f0f, #070707)',
              boxShadow: '6px 6px 14px #050505, -4px -4px 10px #141414, inset 0 0 0 1px rgba(16,185,129,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
            }}
          >
            <Package size={24} style={{ color: '#10B981' }} />
          </div>
          <h1
            style={{
              fontSize: '2rem',
              fontWeight: 900,
              color: '#10B981',
              letterSpacing: '0.1em',
              lineHeight: 1,
            }}
          >
            LogMax
          </h1>
          <p
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              color: '#4b5563',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              marginTop: '0.4rem',
            }}
          >
            Plataforma de Gestão
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
              }}
            >
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
                background: 'linear-gradient(145deg, #070707, #0d0d0d)',
                boxShadow: 'inset 4px 4px 10px #040404, inset -2px -2px 6px #111111',
                border: error && !email.trim() ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.04)',
                borderRadius: '0.875rem',
                padding: '0.85rem 1rem',
                color: '#e0e0e0',
                fontSize: '0.875rem',
                outline: 'none',
                width: '100%',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(16,185,129,0.35)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = error && !email.trim() ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.04)'; }}
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
              }}
            >
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
                  background: 'linear-gradient(145deg, #070707, #0d0d0d)',
                  boxShadow: 'inset 4px 4px 10px #040404, inset -2px -2px 6px #111111',
                  border: error && !password.trim() ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.04)',
                  borderRadius: '0.875rem',
                  padding: '0.85rem 3rem 0.85rem 1rem',
                  color: '#e0e0e0',
                  fontSize: '0.875rem',
                  outline: 'none',
                  width: '100%',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(16,185,129,0.35)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = error && !password.trim() ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.04)'; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={isLoading}
                style={{
                  position: 'absolute',
                  right: '0.875rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#4b5563',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  overflow: 'hidden',
                }}
              >
                <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
                <span style={{ fontSize: '0.78rem', color: '#f87171', fontWeight: 600 }}>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit */}
          <motion.button
            type="submit"
            disabled={isLoading}
            whileTap={!isLoading ? { scale: 0.97 } : {}}
            style={{
              marginTop: '0.5rem',
              width: '100%',
              padding: '0.95rem',
              borderRadius: '0.875rem',
              background: isLoading
                ? 'rgba(16,185,129,0.5)'
                : 'linear-gradient(135deg, #10B981, #059669)',
              boxShadow: isLoading
                ? 'none'
                : '0 4px 20px rgba(16,185,129,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
              border: 'none',
              color: '#0A0A0A',
              fontWeight: 800,
              fontSize: '0.875rem',
              letterSpacing: '0.08em',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s',
            }}
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Entrando...
              </>
            ) : (
              <>
                <LogIn size={16} />
                Entrar
              </>
            )}
          </motion.button>
        </form>

        {/* Footer note */}
        <p
          style={{
            textAlign: 'center',
            fontSize: '0.65rem',
            color: '#374151',
            marginTop: '1.75rem',
            letterSpacing: '0.05em',
          }}
        >
          Acesso restrito · LogMax © {new Date().getFullYear()}
        </p>
      </motion.div>
    </div>
  );
}
