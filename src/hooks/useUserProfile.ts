import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export interface UserProfile {
  id: string;
  nome: string;
  email: string;
  role: 'admin' | 'gerente' | 'colaborador';
  setor: 'all' | 'logistica' | 'vendas' | 'financeiro' | 'rh';
  criado_por: string | null;
  created_at: string;
  funcionario_id?: string | null;
}

export function useUserProfile() {
  const { user, isAuthenticated } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = async () => {
    if (!isAuthenticated || !user || !supabase) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    setProfile(data ?? null);
    setIsLoading(false);
  };

  useEffect(() => { fetchProfile(); }, [user, isAuthenticated]);

  return { profile, isLoading, refetch: fetchProfile };
}
