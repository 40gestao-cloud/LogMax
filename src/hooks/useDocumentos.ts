// Documentos publicados pela Matriz (migr. 476).
//
// A RLS já recorta por unidade — este hook só junta a lista com o que a pessoa
// já confirmou, porque é a diferença entre os dois que faz o modal "Novo
// Documento Disponível" aparecer.
//
// O bucket é privado: ver e baixar passam por URL assinada, que expira. Por
// isso a assinatura é pedida na hora do clique, nunca guardada na lista.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
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
  /** Migr. 513 — NULL = rascunho, só o professor enxerga. */
  publicado_em: string | null;
  created_at: string;
};

const CAMPOS =
  'id,titulo,descricao,arquivo_path,arquivo_nome,arquivo_mime,arquivo_tamanho,' +
  'filial_alvo,publicado_por,publicado_por_nome,ativo,publicado_em,created_at';

/** Rascunho: existe no sistema, ainda não foi ao ar (migr. 513). */
export const ehRascunho = (d: Pick<Documento, 'publicado_em'>) => !d.publicado_em;

/** O que o navegador consegue mostrar sem converter nada.
 *
 * PDF e imagem ele desenha sozinho. Word, não: renderizar .docx exigiria ou
 * converter no servidor ou mandar o arquivo para um visualizador de terceiros
 * — e o documento da Matriz não sai daqui. Para esses o caminho continua sendo
 * baixar e abrir no Word, que é o que o aluno faria no trabalho de qualquer
 * jeito.
 */
export function podeVisualizar(doc: Pick<Documento, 'arquivo_mime' | 'arquivo_nome'>): boolean {
  const mime = String(doc.arquivo_mime ?? '');
  if (mime.startsWith('image/') || mime === 'application/pdf') return true;
  // `arquivo_mime` é nullable (documento anterior à migr. 476 ter a coluna, ou
  // upload que gravou vazio). A extensão do nome bonito é o desempate, mesmo
  // critério do upload em DocumentosView.
  const ext = doc.arquivo_nome.slice(doc.arquivo_nome.lastIndexOf('.') + 1).toLowerCase();
  return ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
}

/** Excluído pela Matriz entre o carregamento da lista e o clique. A policy de
 *  leitura resolve pela linha em `documentos`, então some a linha, some o
 *  acesso — e o erro cru do storage ("Object not found") não diz isso a
 *  ninguém. Vale a tradução: quem lê a tela precisa saber que o documento saiu
 *  de circulação, não que o sistema quebrou. */
function traduzErro(cru: string): { error: string; sumiu: boolean } {
  const sumiu = /not found|does not exist|404/i.test(cru);
  return {
    error: sumiu
      ? 'Este documento foi removido pela Matriz e não está mais disponível.'
      : (cru || 'Não foi possível gerar o link.'),
    sumiu,
  };
}

/**
 * URL assinada para MOSTRAR o arquivo na tela — sem `download`, que é a única
 * diferença para a de baixar: com ele o storage manda `Content-Disposition:
 * attachment` e o navegador salva em vez de desenhar, dentro do iframe
 * inclusive.
 *
 * Cinco minutos, e não os 60s do download: aquele é um clique e acabou, este
 * fica aberto enquanto a pessoa lê. O visor de PDF do navegador refaz pedidos
 * de faixa do arquivo conforme a rolagem — com a assinatura vencida no meio da
 * leitura, a página 4 vem em branco.
 */
export async function urlDeVisualizacao(
  doc: Pick<Documento, 'arquivo_path'>,
): Promise<{ url?: string; error?: string; sumiu?: boolean }> {
  if (!supabase) return { error: 'Sem conexão.' };
  const { data, error } = await supabase.storage
    .from('documentos')
    .createSignedUrl(doc.arquivo_path, 300);
  if (error || !data?.signedUrl) return traduzErro(error?.message ?? '');
  return { url: data.signedUrl };
}

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
export async function baixarDocumento(
  doc: Pick<Documento, 'arquivo_path' | 'arquivo_nome'>,
): Promise<{ error?: string; sumiu?: boolean }> {
  if (!supabase) return { error: 'Sem conexão.' };
  const { data, error } = await supabase.storage
    .from('documentos')
    .createSignedUrl(doc.arquivo_path, 60, { download: doc.arquivo_nome });

  if (error || !data?.signedUrl) return traduzErro(error?.message ?? '');

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
  //
  // Migr. 528: com o gerente publicando, o papel deixou de bastar. Ele é
  // destinatário do que a Matriz manda E autor do que manda para a equipe —
  // sem o filtro de autoria abaixo, o FAB o cobraria de confirmar a leitura da
  // escala que ele mesmo acabou de publicar.
  const ehDestinatario = profile?.role !== 'admin';

  const carregar = useCallback(async () => {
    if (!supabase || !profile) { setDocumentos([]); setNaoLidos([]); setLoading(false); return; }

    const { data } = await supabase
      .from('documentos')
      .select(CAMPOS)
      .eq('ativo', true)
      // Rascunho no topo da lista do professor (NULLS FIRST no DESC) — é o que
      // está esperando decisão. Para as unidades a RLS não devolve rascunho
      // nenhum, então elas só veem a ordem de publicação. `created_at` desempata
      // o que foi publicado no mesmo instante.
      .order('publicado_em', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: false });

    const lista = (data ?? []) as unknown as Documento[];
    setDocumentos(lista);

    // A fila de não-lidos é só do que está no ar. A RLS já esconde rascunho de
    // quem não é admin; o filtro aqui é o que impede o próprio professor de ver
    // "documento novo" do que ele mesmo ainda não publicou, se um dia ele deixar
    // de ser exceção logo abaixo.
    const publicados = lista.filter(d => !!d.publicado_em && d.publicado_por !== profile.id);

    if (!ehDestinatario || publicados.length === 0) {
      setNaoLidos([]); setLoading(false); return;
    }

    const { data: leituras } = await supabase
      .from('documentos_leitura')
      .select('documento_id')
      .eq('user_id', profile.id)
      .in('documento_id', publicados.map(d => d.id));

    const lidos = new Set((leituras ?? []).map((l: any) => l.documento_id));
    setNaoLidos(publicados.filter(d => !lidos.has(d.id)));
    setLoading(false);
  }, [profile, ehDestinatario]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: o que a Matriz publica CHEGA, e o que ela exclui SOME — nos dois
  // sentidos sem F5. O evento é ignorado de propósito (só serve de gatilho) e a
  // lista é relida inteira: no DELETE o payload traz apenas a chave primária,
  // então reconciliar item a item seria trabalho a mais para o mesmo resultado.
  //
  // Nome de canal ÚNICO por instância. Este hook roda em dois lugares ao mesmo
  // tempo (a tela e o modal global), e `supabase.channel(nome)` devolve o canal
  // já assinado quando o nome se repete — o segundo `.on()` estoura "cannot add
  // postgres_changes callbacks after subscribe()" e o realtime morre calado.
  // Mesma armadilha já documentada em `useAulaConfig`.
  useEffect(() => {
    if (!profile) return;
    // A releitura na reconexão do websocket (ponto cego: o que mudou enquanto
    // o socket esteve fora não é reenviado; sem ela, quem fechou a tampa do
    // notebook volta com documento já excluído na tela e clica em Baixar num
    // arquivo que não existe) agora mora no `assinarRealtime`, junto com a
    // janela que impede a turma de reler tudo no mesmo instante.
    const parar = assinarRealtime({
      nome: 'documentos-matriz',
      alvos: ['documentos'],
      aoMudar: () => { carregar(); },
    });

    // Mesma janela pelo lado do navegador: aba em segundo plano suspende o
    // socket sem avisar, e voltar pra aba não dispara reassinatura sozinho.
    // Fica aqui porque é evento de UMA máquina — não forma manada.
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', carregar);

    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', carregar);
      parar();
    };
  }, [carregar, profile]);

  const marcarLido = useCallback(async (documentoId: string) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = await supabase.rpc('marcar_documento_lido', { p_documento_id: documentoId });
    if (error) return { error: error.message };
    setNaoLidos(prev => prev.filter(d => d.id !== documentoId));
    return {};
  }, []);

  // Publicar é o momento em que o documento sai da gaveta e chega nas unidades
  // (migr. 513). Quem carimba a hora é o banco, não o navegador — a fila de
  // não-lidos e o "chegou agora" se penduram nessa hora.
  const publicar = useCallback(async (documentoId: string) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = await supabase.rpc('publicar_documento', { p_documento_id: documentoId });
    if (error) return { error: error.message };
    await carregar();
    return {};
  }, [carregar]);

  return { documentos, naoLidos, loading, marcarLido, publicar, recarregar: carregar };
}
