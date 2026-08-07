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

// O bucket tem `allowed_mime_types` com estes quatro e recusa qualquer outro
// com 415. Não dá para confiar no `File.type` do navegador: ele sai vazio
// quando a máquina não tem Office/LibreOffice registrando a extensão (e aí o
// supabase-js manda o default 'text/plain;charset=UTF-8', que o bucket
// rejeita), e o Windows com Excel instalado marca .csv como
// 'application/vnd.ms-excel'. A extensão é o dado confiável aqui — ela já foi
// validada por `extensaoValida` antes de chegar neste mapa.
const MIME_POR_EXTENSAO: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':  'application/vnd.ms-excel',
  '.ods':  'application/vnd.oasis.opendocument.spreadsheet',
  '.csv':  'text/csv',
};
const EXTENSOES = Object.keys(MIME_POR_EXTENSAO);

const mimeDoArquivo = (nome: string): string | undefined => {
  const ext = EXTENSOES.find(e => nome.toLowerCase().endsWith(e));
  return ext ? MIME_POR_EXTENSAO[ext] : undefined;
};

/**
 * Caminho do objeto no bucket. É a chave de tudo: mesmo caminho ⇒ o upsert
 * substitui e a linha de metadado é reaproveitada.
 *
 * Em minúsculas de propósito, para casar com o índice único
 * `(user_id, lower(arquivo_nome)) WHERE ativo`. Enquanto o caminho preservava
 * a caixa, enviar "Produtos.xlsx" depois de "produtos.xlsx" gerava caminho
 * novo, o lookup não achava a linha, o INSERT batia no índice e o aluno
 * recebia o 23505 cru do Postgres — com o arquivo já no bucket, órfão.
 */
const caminhoDe = (userId: string, arquivoNome: string): string =>
  // Sanitiza porque o Storage recusa caractere solto no nome do objeto.
  `${userId}/${arquivoNome.toLowerCase().replace(/[^\w.\-]+/g, '_')}`;

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
 * Lista as planilhas de UM aluno.
 *
 * `userId` é obrigatório de propósito. A versão anterior o tinha como opcional
 * e, sem ele, listava tudo o que a RLS deixasse passar — que para admin, CEO e
 * conselheiro é a turma inteira. Como o modal monta com a sessão ainda
 * resolvendo, o primeiro render passava `undefined` e um docente via, por um
 * instante, as planilhas dos outros dentro de "Minhas planilhas".
 */
export async function listarPlanilhas(userId: string): Promise<PlanilhaTrabalho[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('planilhas_trabalho')
    .select('id, user_id, nome_snapshot, entidade, filial, arquivo_nome, path, tamanho_bytes, versao, updated_at')
    .eq('ativo', true)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
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
  const path = caminhoDe(userId, arquivoNome);

  // A linha é procurada ANTES do upload para sabermos, em caso de falha do
  // metadado, se o objeto que acabamos de enviar era novo (e portanto lixo a
  // recolher) ou a substituição legítima de um que já existia.
  const existente = await supabase.from('planilhas_trabalho')
    .select('id, versao').eq('path', path).maybeSingle();

  const { error: upErr } = await supabase.storage
    .from(PLANILHAS_BUCKET)
    .upload(path, file, { upsert: true, contentType: mimeDoArquivo(arquivoNome) });
  if (upErr) throw new Error(upErr.message);

  if (existente.data?.id) {
    const { error } = await supabase.from('planilhas_trabalho')
      .update({
        // `arquivo_nome` também é atualizado: o caminho é minúsculo, então
        // reenviar "Produtos.xlsx" sobre "produtos.xlsx" é a MESMA planilha, e
        // o que a lista mostra tem de ser o nome do arquivo que está lá agora.
        arquivo_nome: arquivoNome,
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
  if (error) {
    // O arquivo subiu e o metadado não entrou: sem a linha ele é invisível na
    // tela e ninguém mais o alcança. Recolhe antes de reportar o erro.
    await supabase.storage.from(PLANILHAS_BUCKET).remove([path]).catch(() => {});
    throw new Error(error.message);
  }
}

/**
 * Baixa a planilha. O bucket é privado, então o caminho é uma URL assinada de
 * vida curta — link de planilha de aluno não pode virar endereço público.
 *
 * O nome do arquivo vai na opção `download` da assinatura, não só no atributo
 * do link: o `download=` de um <a> é ignorado quando o href aponta para outra
 * origem, e a URL assinada aponta para o domínio do Storage. Sem isso o
 * navegador abria o arquivo em vez de baixá-lo, e o nome salvo seria o do
 * caminho (minúsculo e sanitizado) em vez do nome que o aluno deu.
 */
export async function baixarPlanilha(p: PlanilhaTrabalho): Promise<void> {
  if (!supabase) throw new Error('Sem conexão com o LogMax.');
  const { data, error } = await supabase.storage
    .from(PLANILHAS_BUCKET)
    .createSignedUrl(p.path, 60, { download: p.arquivo_nome });
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Não foi possível gerar o link.');

  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = p.arquivo_nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Remove a planilha: inativa a linha e apaga o objeto.
 *
 * Soft-delete no metadado porque o índice único é parcial (`WHERE ativo`) — o
 * aluno pode excluir e reenviar um arquivo com o mesmo nome no mesmo dia.
 *
 * Nesta ordem: o metadado é o que a tela lê, então é ele que define se a
 * planilha "sumiu". Apagando o objeto primeiro, uma falha no update deixava a
 * linha viva apontando para um arquivo que não existe mais — o aluno via a
 * planilha na lista e o download quebrava. Ao contrário, o pior caso é um
 * objeto órfão no bucket, que o próximo envio com o mesmo nome sobrescreve.
 */
export async function excluirPlanilha(p: PlanilhaTrabalho): Promise<void> {
  if (!supabase) throw new Error('Sem conexão com o LogMax.');
  const { error } = await supabase.from('planilhas_trabalho')
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq('id', p.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(PLANILHAS_BUCKET).remove([p.path]).catch(() => {});
}
