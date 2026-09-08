import { useState, useEffect } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { ancorarComTokenFresco } from '../lib/horaServidor';

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
        // Token recém-renovado: o `iat` dele é a hora do servidor, de graça.
        // Rede de segurança do relógio para a máquina cuja sondagem falhou.
        // SÓ neste evento (e no login, em LoginScreen): SIGNED_IN também
        // dispara em sessão restaurada do localStorage, cujo token é velho —
        // foi assim que uma primeira versão acusou "relógio adiantado" em
        // celular com a hora certa.
        ancorarComTokenFresco(session?.access_token);
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

  /**
   * Sair DESTA máquina — e só desta.
   *
   * O padrão do supabase-js é `scope: 'global'`, que revoga todas as sessões do
   * usuário em todo lugar. Numa sala de aula isso é o oposto do esperado: o
   * professor abre o app no notebook e na máquina do lab, uma das duas fica
   * ociosa 15 minutos, o logout automático dispara — e a sessão da OUTRA morre
   * junto, no meio do trabalho.
   *
   * Pior: morre em silêncio. O access token continua com assinatura válida, o
   * PostgREST segue respondendo, e só os endpoints em /api recusam (eles
   * conferem a sessão no GoTrue). Foi assim que "Token inválido" apareceu ao
   * salvar setores extras em Usuários, sem nada na tela ligando uma coisa à
   * outra.
   *
   * O que protege a máquina compartilhada não é a revogação no servidor: é a
   * purga do token no boot e o logout por inatividade (`sessaoGuard.ts`), que
   * tiram o token DESTA máquina. Quem sai daqui não precisa derrubar ninguém
   * do outro lado da sala.
   */
  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut({ scope: 'local' });
    setAuthState({ user: null, session: null, isLoading: false });
  };

  return {
    user: authState.user,
    session: authState.session,
    isLoading: authState.isLoading,
    // Sem Supabase configurado o sistema está fora do ar — não "libera acesso".
    // App.tsx detecta isSupabaseConfigured=false e mostra tela explícita
    // de manutenção em vez do LoginScreen (que falharia ao tentar logar).
    isAuthenticated: isSupabaseConfigured && !!authState.user,
    signOut,
  };
}
