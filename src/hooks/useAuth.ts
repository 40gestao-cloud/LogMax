import { useState, useEffect } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    isLoading: true,
  });

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Se Supabase não está configurado, não exige login
      setAuthState({ user: null, session: null, isLoading: false });
      return;
    }

    // Busca a sessão atual ao montar
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setAuthState({ user: session?.user ?? null, session, isLoading: false });
      })
      .catch(() => {
        setAuthState({ user: null, session: null, isLoading: false });
      });

    // Escuta mudanças de estado de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'TOKEN_REFRESHED') {
        // Refresh silencioso: atualiza só o token, preserva a referência de user
        // para não disparar re-fetch de perfil nem re-render global
        setAuthState(prev => ({ ...prev, session }));
        return;
      }
      setAuthState({
        user: session?.user ?? null,
        session,
        isLoading: false,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthState({ user: null, session: null, isLoading: false });
  };

  return {
    user: authState.user,
    session: authState.session,
    isLoading: authState.isLoading,
    isAuthenticated: isSupabaseConfigured ? !!authState.user : true, // sem Supabase, libera acesso
    signOut,
  };
}
