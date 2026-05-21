import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export interface UserProfile {
  id: string;
  nome: string;
  email: string;
  role: 'admin' | 'ceo' | 'gerente' | 'colaborador';
  setor: 'all' | 'logistica' | 'vendas' | 'financeiro' | 'rh' | 'marketing' | 'ti';
  filial?: string | null;
  criado_por: string | null;
  created_at: string;
  funcionario_id?: string | null;
}

export function useUserProfile() {
  const { user, isAuthenticated } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Evita mostrar loading screen em re-fetches (ex: token refresh)
  const hasLoadedOnce = useRef(false);

  const fetchProfile = async () => {
    if (!isAuthenticated || !user || !supabase) {
      setIsLoading(false);
      return;
    }
    // Só bloqueia a UI na primeira carga; re-fetches são silenciosos
    if (!hasLoadedOnce.current) setIsLoading(true);
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    setProfile(data ?? null);
    setIsLoading(false);
    hasLoadedOnce.current = true;
  };

  // Usa user?.id (string primitiva estável) em vez de user (objeto)
  // para não re-disparar quando o Supabase cria nova referência de objeto
  // no refresh de token — apenas dispara quando o usuário de fato muda
  useEffect(() => {
    fetchProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAuthenticated]);

  return { profile, isLoading, refetch: fetchProfile };
}
