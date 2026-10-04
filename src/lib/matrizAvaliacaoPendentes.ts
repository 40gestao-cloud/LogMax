import { supabase } from './supabase';

// Card "Avaliações em Aberto" da Início (modo Matriz).
//
// Mede o que o avaliador tem de fato a julgar: participantes das Tarefas da
// Matriz liberadas (status 'aberta') na competição EM ANDAMENTO, e quantos
// deles ainda estão sem a nota dele. É o mesmo universo do "Sem sua nota" da
// Competição › Avaliação e do cartão da Mesa do Gestor.
//
// Até 2026-10-04 isto somava 16 tipos de item (artes, requisições, contas…)
// da avaliação antiga da Matriz, que não é mais feita — o total era enorme,
// nada abatia, e o donut ficava parado em 0%.
//
// Desligado e excluído não entram: saem da tarefa sozinhos (migr. 672/675).

export type ResumoAvaliacaoMatriz = {
  competicaoNome: string | null;
  total: number;
  pendentes: number;
};

export async function contarAvaliacoesPendentesMatriz(profileId: string): Promise<ResumoAvaliacaoMatriz> {
  const vazio: ResumoAvaliacaoMatriz = { competicaoNome: null, total: 0, pendentes: 0 };
  if (!supabase || !profileId) return vazio;

  const { data: competicao } = await supabase
    .from('competicoes_matriz')
    .select('id,nome')
    .eq('ativo', true)
    .eq('status', 'em_andamento')
    .maybeSingle();
  if (!competicao) return vazio;

  const { data: tarefas } = await supabase
    .from('matriz_tarefas')
    .select('id')
    .eq('competicao_id', competicao.id)
    .eq('ativo', true)
    .eq('status', 'aberta');
  const tarefaIds = (tarefas ?? []).map((t: { id: string }) => t.id);
  // Lista vazia viraria `in.()` — e "nenhuma tarefa liberada" é zero, não erro.
  if (tarefaIds.length === 0) return { competicaoNome: competicao.nome, total: 0, pendentes: 0 };

  const [{ data: parts }, { data: minhas }] = await Promise.all([
    supabase
      .from('matriz_tarefa_participantes')
      .select('id')
      .in('tarefa_id', tarefaIds)
      .eq('ativo', true),
    supabase
      .from('avaliacoes_matriz')
      .select('item_id')
      .eq('competicao_id', competicao.id)
      .eq('avaliador_id', profileId)
      .eq('ativo', true)
      .not('nota', 'is', null),
  ]);

  const ids = (parts ?? []).map((p: { id: string }) => p.id);
  const jaNotei = new Set((minhas ?? []).map((a: { item_id: string }) => a.item_id));
  const pendentes = ids.filter(id => !jaNotei.has(id)).length;

  return { competicaoNome: competicao.nome, total: ids.length, pendentes };
}
