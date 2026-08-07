// Planilhas de trabalho do aluno guardadas no LogMax (migração 389).
//
// O problema: o aluno baixa o modelo, preenche em casa e depende de pendrive,
// WhatsApp ou Drive pessoal para reencontrar o arquivo na aula seguinte.
//
// O desenho mais barato que resolvia: bucket privado + tabela de metadados.
// Sem endpoint novo — o Vercel Hobby está em 12/12 functions —, sem editor e
// sem sincronização. Envia, fica guardado, baixa de volta em qualquer máquina.
//
// O arquivo é do ALUNO: a pasta é o `auth.uid()`, e a policy de storage confere
// isso pelo primeiro nível do caminho. Trocar de filial não faz perder nada.

import { supabase } from './supabase';
import type { ModeloEntidade } from './modelosPlanilha';

export const PLANILHAS_BUCKET = 'planilhas-turma';

/** 5 MB — o mesmo teto do bucket. Barrar aqui evita subir para levar 413. */
export const PLANILHA_TAMANHO_MAX = 5 * 1024 * 1024;

const EXTENSOES = ['.xlsx', '.xls', '.ods', '.csv'];

export type PlanilhaTrabalho = {
  id: string;
  user_id: string;
  nome_snapshot: string | null;
  entidade: ModeloEntidade | 'outro';
  filial: string | null;
  arquivo_nome: string;
  path: string;
  tamanho_bytes: number;
  versao: number;
  updated_at: string;
};

export const extensaoValida = (nome: string): boolean =>
  EXTENSOES.some(e => nome.toLowerCase().endsWith(e));

export const formatarTamanho = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Lista as planilhas de um aluno. Sem `userId`, lista as de quem está logado —
 * e para o docente a RLS abre o resto, que é como a aba dele funciona.
 */
export async function listarPlanilhas(userId?: string): Promise<PlanilhaTrabalho[]> {
  if (!supabase) return [];
  let q = supabase.from('planilhas_trabalho')
    .select('id, user_id, nome_snapshot, entidade, filial, arquivo_nome, path, tamanho_bytes, versao, updated_at')
    .eq('ativo', true)
    .order('updated_at', { ascending: false });
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanilhaTrabalho[];
}

/**
 * Envia (ou substitui) uma planilha.
 *
 * Reenviar o MESMO nome sobrescreve o objeto e incrementa `versao`, em vez de
 * criar "produtos (2) final FINAL.xlsx". É a operação que o aluno realmente
 * faz: continuar o mesmo arquivo toda aula.
 */
export async function salvarPlanilha(opts: {
  file: File;
  userId: string;
  nome: string;
  entidade: ModeloEntidade | 'outro';
  filial: string | null;
}): Promise<void> {
  if (!supabase) throw new Error('Sem conexão com o LogMax.');
  const { file, userId, nome, entidade, filial } = opts;

  if (!extensaoValida(file.name)) {
    throw new Error('Envie uma planilha (.xlsx, .xls, .ods ou .csv).');
  }
  if (file.size > PLANILHA_TAMANHO_MAX) {
    throw new Error(`A planilha tem ${formatarTamanho(file.size)} e o limite é 5 MB.`);
  }

  const arquivoNome = file.name;
  // Caminho determinístico: mesma pasta, mesmo nome ⇒ `upsert` substitui em vez
  // de acumular. O nome é sanitizado porque o Storage recusa caractere solto.
  const seguro = arquivoNome.replace(/[^\w.\-]+/g, '_');
  const path = `${userId}/${seguro}`;

  const { error: upErr } = await supabase.storage
    .from(PLANILHAS_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (upErr) throw new Error(upErr.message);

  const existente = await supabase.from('planilhas_trabalho')
    .select('id, versao').eq('path', path).maybeSingle();

  if (existente.data?.id) {
    const { error } = await supabase.from('planilhas_trabalho')
      .update({
        tamanho_bytes: file.size,
        versao: (existente.data.versao ?? 1) + 1,
        entidade, filial, updated_at: new Date().toISOString(), ativo: true,
      })
      .eq('id', existente.data.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from('planilhas_trabalho').insert({
    user_id: userId, nome_snapshot: nome || null,
    entidade, filial, arquivo_nome: arquivoNome, path,
    tamanho_bytes: file.size,
  });
  if (error) throw new Error(error.message);
}

/**
 * Baixa a planilha. O bucket é privado, então o caminho é uma URL assinada de
 * vida curta — link de planilha de aluno não pode virar endereço público.
 */
export async function baixarPlanilha(p: PlanilhaTrabalho): Promise<void> {
  if (!supabase) throw new Error('Sem conexão com o LogMax.');
  const { data, error } = await supabase.storage
    .from(PLANILHAS_BUCKET)
    .createSignedUrl(p.path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Não foi possível gerar o link.');

  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = p.arquivo_nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Remove a planilha: apaga o objeto e inativa a linha.
 *
 * Soft-delete no metadado porque o índice único é parcial (`WHERE ativo`) — o
 * aluno pode excluir e reenviar um arquivo com o mesmo nome no mesmo dia.
 */
export async function excluirPlanilha(p: PlanilhaTrabalho): Promise<void> {
  if (!supabase) throw new Error('Sem conexão com o LogMax.');
  const { error: rmErr } = await supabase.storage.from(PLANILHAS_BUCKET).remove([p.path]);
  if (rmErr) throw new Error(rmErr.message);
  const { error } = await supabase.from('planilhas_trabalho')
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq('id', p.id);
  if (error) throw new Error(error.message);
}
