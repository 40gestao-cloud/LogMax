// Documentos publicados pela Matriz (migr. 476).
//
// A RLS já recorta por unidade — este hook só junta a lista com o que a pessoa
// já confirmou, porque é a diferença entre os dois que faz o modal "Novo
// Documento Disponível" aparecer.
//
// O bucket é privado: baixar passa por URL assinada, que expira. Por isso a
// assinatura é pedida na hora do clique, nunca guardada na lista.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { UserProfile } from './useUserProfile';

export type Documento = {
  id: string;
  titulo: string;
  descricao: string | null;
  arquivo_path: string;
  arquivo_nome: string;
  arquivo_mime: string | null;
  arquivo_tamanho: number | null;
  filial_alvo: string | null;
  publicado_por: string | null;
  publicado_por_nome: string | null;
  ativo: boolean;
  created_at: string;
};

const CAMPOS =
  'id,titulo,descricao,arquivo_path,arquivo_nome,arquivo_mime,arquivo_tamanho,' +
  'filial_alvo,publicado_por,publicado_por_nome,ativo,created_at';

/** URL assinada de 60s — tempo de o navegador começar o download e nada além. */
export async function urlAssinadaDocumento(path: string): Promise<{ url?: string; error?: string }> {
  if (!supabase) return { error: 'Sem conexão.' };
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(path, 60, {
    download: true,
  });
  if (error) return { error: error.message };
  return { url: data?.signedUrl };
}

export function useDocumentos(profile: UserProfile | null) {
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [naoLidos, setNaoLidos] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);

  // Quem publica não entra na própria fila de leitura: o professor não precisa
  // confirmar que leu o que acabou de mandar.
  const ehDestinatario = profile?.role !== 'admin';

  const carregar = useCallback(async () => {
    if (!supabase || !profile) { setDocumentos([]); setNaoLidos([]); setLoading(false); return; }

    const { data } = await supabase
      .from('documentos')
      .select(CAMPOS)
      .eq('ativo', true)
      .order('created_at', { ascending: false });

    const lista = (data ?? []) as unknown as Documento[];
    setDocumentos(lista);

    if (!ehDestinatario || lista.length === 0) {
      setNaoLidos([]); setLoading(false); return;
    }

    const { data: leituras } = await supabase
      .from('documentos_leitura')
      .select('documento_id')
      .eq('user_id', profile.id)
      .in('documento_id', lista.map(d => d.id));

    const lidos = new Set((leituras ?? []).map((l: any) => l.documento_id));
    setNaoLidos(lista.filter(d => !lidos.has(d.id)));
    setLoading(false);
  }, [profile, ehDestinatario]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: documento publicado pela Matriz chega sem F5.
  useEffect(() => {
    if (!supabase || !profile) return;
    const canal = supabase
      .channel('documentos-matriz')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documentos' }, () => { carregar(); })
      .subscribe();
    return () => { supabase!.removeChannel(canal); };
  }, [carregar, profile]);

  const marcarLido = useCallback(async (documentoId: string) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = await supabase.rpc('marcar_documento_lido', { p_documento_id: documentoId });
    if (error) return { error: error.message };
    setNaoLidos(prev => prev.filter(d => d.id !== documentoId));
    return {};
  }, []);

  return { documentos, naoLidos, loading, marcarLido, recarregar: carregar };
}
