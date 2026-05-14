import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const CHAVE = 'whatsapp_config';

interface WppConfig {
  instance: string;
  token: string;
  phone: string;
}

export function useWhatsApp() {
  const [config, setConfig] = useState<WppConfig>({ instance: '', token: '', phone: '' });
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    if (!supabase) { setIsLoading(false); return; }
    try {
      const { data } = await supabase
        .from('configuracoes')
        .select('valor')
        .eq('chave', CHAVE)
        .maybeSingle();
      if (data?.valor) {
        const parsed: WppConfig = JSON.parse(data.valor);
        setConfig(parsed);
        setIsActive(!!(parsed.instance && parsed.token && parsed.phone));
      }
    } catch {
      // tabela não existe — desativado
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveConfig = async (c: WppConfig) => {
    if (!supabase) return;
    await supabase.from('configuracoes').upsert({ chave: CHAVE, valor: JSON.stringify(c) });
    setConfig(c);
    setIsActive(!!(c.instance && c.token && c.phone));
  };

  const disableIntegration = async () => {
    if (!supabase) return;
    await supabase.from('configuracoes').delete().eq('chave', CHAVE);
    setConfig({ instance: '', token: '', phone: '' });
    setIsActive(false);
  };

  const testConnection = async (c: WppConfig): Promise<{ ok: boolean; error?: string }> => {
    if (!c.instance || !c.token || !c.phone) return { ok: false, error: 'Preencha todos os campos' };
    try {
      const res = await fetch('/api/whatsapp-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance: c.instance,
          token: c.token,
          phone: c.phone,
          message: '✅ *LogMax ERP* — Conexão testada com sucesso! As notificações automáticas estão ativas.',
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) return { ok: false, error: data.error ?? 'Erro na conexão' };
      return { ok: true };
    } catch {
      return { ok: false, error: 'Erro de conexão com a Z-API' };
    }
  };

  const notify = useCallback(async (message: string) => {
    if (!isActive || !config.instance) return;
    try {
      await fetch('/api/whatsapp-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: config.instance, token: config.token, phone: config.phone, message }),
      });
    } catch (err) {
      console.warn('[WhatsApp] Falha na notificação (não crítico):', err);
    }
  }, [config, isActive]);

  return { config, isActive, isLoading, saveConfig, disableIntegration, testConnection, notify };
}
