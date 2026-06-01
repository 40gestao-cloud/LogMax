import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useUserProfile } from '../hooks/useUserProfile';

export type UsuarioBasico = { id: string; nome: string; setor: string };

type CtxValue = {
  /** Map<id, {nome, setor}> dos usuários cuja autoria o caller pode revelar.
   *  Admin/CEO veem todos; gerente vê só do(s) seu(s) setor(es); demais
   *  roles ficam com map vazio. */
  usuarios: Map<string, UsuarioBasico>;
  /** True se o caller pode renderizar ícones de auditoria (admin/CEO/gerente). */
  podeVerAuditoria: boolean;
  /** Status do carregamento inicial — UI pode mostrar skeleton se quiser. */
  carregando: boolean;
};

const AuditoriaCtx = createContext<CtxValue>({
  usuarios: new Map(),
  podeVerAuditoria: false,
  carregando: false,
});

/**
 * Provider que faz UMA chamada RPC `usuarios_visiveis_para_auditoria()`
 * por sessão (re-fetch quando troca o usuário logado) e mantém o
 * resultado em memória. O componente `<AuditoriaInspect>` consulta o
 * map sem disparar query nova.
 *
 * O backend (RPC) já aplica o RBAC: admin/CEO recebem todos os
 * user_profiles; gerente recebe só os do seu(s) setor(es); demais
 * recebem array vazio. Assim a UI fica simples — basta checar
 * `usuarios.has(id)` pra saber se a autoria deve ser revelada.
 */
export const AuditoriaProvider = ({ children }: { children: React.ReactNode }) => {
  const { profile } = useUserProfile();
  const [usuarios, setUsuarios] = useState<Map<string, UsuarioBasico>>(new Map());
  const [carregando, setCarregando] = useState(false);

  const podeVerAuditoria = !!profile && ['admin', 'ceo', 'gerente'].includes(profile.role);

  useEffect(() => {
    if (!profile || !supabase || !podeVerAuditoria) {
      setUsuarios(new Map());
      return;
    }
    let cancelado = false;
    setCarregando(true);
    (async () => {
      try {
        const { data, error } = await supabase!.rpc('usuarios_visiveis_para_auditoria');
        if (cancelado) return;
        if (error) {
          console.warn('[AuditoriaContext] RPC falhou:', error.message);
          setUsuarios(new Map());
          return;
        }
        const m = new Map<string, UsuarioBasico>();
        for (const u of (data ?? []) as UsuarioBasico[]) m.set(u.id, u);
        setUsuarios(m);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [profile?.id, profile?.role, podeVerAuditoria]);

  const value = useMemo(
    () => ({ usuarios, podeVerAuditoria, carregando }),
    [usuarios, podeVerAuditoria, carregando],
  );
  return <AuditoriaCtx.Provider value={value}>{children}</AuditoriaCtx.Provider>;
};

export function useAuditoriaContext(): CtxValue {
  return useContext(AuditoriaCtx);
}
