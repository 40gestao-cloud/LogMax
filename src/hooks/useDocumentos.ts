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

/**
 * Baixa o documento.
 *
 * Duas armadilhas evitadas aqui, as duas já pagas em `planilhasTrabalho.ts`:
 *
 * 1. `download: nome` em vez de `download: true`. Com `true`, o Content-
 *    Disposition usa o caminho do bucket — o aluno salvaria
 *    "1755-regulamento.pdf" em vez de "Regulamento.pdf".
 * 2. Âncora clicada em vez de `window.open`. A URL assinada só existe depois do
 *    await, e popup aberto fora do gesto do usuário é bloqueado por padrão em
 *    boa parte dos navegadores — o clique simplesmente não faria nada.
 */
export async function baixarDocumento(doc: Pick<Documento, 'arquivo_path' | 'arquivo_nome'>): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Sem conexão.' };
  const { data, error } = await supabase.storage
    .from('documentos')
    .createSignedUrl(doc.arquivo_path, 60, { download: doc.arquivo_nome });
  if (error || !data?.signedUrl) return { error: error?.message ?? 'Não foi possível gerar o link.' };

  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = doc.arquivo_nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return {};
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
  //
  // Nome de canal ÚNICO por instância. Este hook roda em dois lugares ao mesmo
  // tempo (a tela e o modal global), e `supabase.channel(nome)` devolve o canal
  // já assinado quando o nome se repete — o segundo `.on()` estoura "cannot add
  // postgres_changes callbacks after subscribe()" e o realtime morre calado.
  // Mesma armadilha já documentada em `useAulaConfig`.
  useEffect(() => {
    if (!supabase || !profile) return;
    const canalId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const canal = supabase
      .channel(`documentos-matriz-${canalId}`)
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
