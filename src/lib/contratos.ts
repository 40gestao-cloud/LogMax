// Contratos entre unidades (migr. 623).
//
// Parte é uma unidade. A filial é representada pelo gerente dela; a Matriz,
// pelo professor (`role = 'admin'` literal). CEO e conselheiro leem, não
// assinam. A mesma régua mora em `contrato_representa()` no banco — aqui ela
// só decide que botão aparece, quem barra é a RPC.
//
// A assinatura é a eletrônica SIMPLES da Lei 14.063/2020: sessão autenticada,
// hora do banco e o resumo SHA-256 do arquivo. O resumo é calculado AQUI, no
// navegador, sobre os bytes que a pessoa baixou — é o que torna "eu conferi
// este arquivo" verdade, e não uma promessa da tela.

import { supabase } from './supabase';
import type { UserProfile } from '../hooks/useUserProfile';

export const PARTES = ['Matriz', 'SuperMax', 'MaxLook', 'TechMax'] as const;
export type Parte = (typeof PARTES)[number];

export type StatusContrato = 'rascunho' | 'aguardando' | 'vigente' | 'recusado' | 'encerrado' | 'rescindido';

export type Contrato = {
  id: string;
  numero: number;
  titulo: string;
  objeto: string | null;
  parte_a: Parte;
  parte_b: Parte;
  valor: number | null;
  condicoes: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  arquivo_path: string;
  arquivo_nome: string;
  arquivo_mime: string | null;
  arquivo_tamanho: number | null;
  arquivo_sha256: string;
  status: StatusContrato;
  contrato_pai_id: string | null;
  criado_por: string | null;
  criado_por_nome: string | null;
  enviado_em: string | null;
  vigente_desde: string | null;
  encerrado_em: string | null;
  encerrado_por_nome: string | null;
  motivo_encerramento: string | null;
  created_at: string;
};

export type AssinaturaContrato = {
  id: string;
  contrato_id: string;
  parte: Parte;
  nome_snapshot: string;
  cargo_snapshot: string;
  arquivo_sha256: string;
  assinado_em: string;
};

export const CAMPOS_CONTRATO =
  'id,numero,titulo,objeto,parte_a,parte_b,valor,condicoes,vigencia_inicio,vigencia_fim,' +
  'arquivo_path,arquivo_nome,arquivo_mime,arquivo_tamanho,arquivo_sha256,status,contrato_pai_id,' +
  'criado_por,criado_por_nome,enviado_em,vigente_desde,encerrado_em,encerrado_por_nome,' +
  'motivo_encerramento,created_at';

export const STATUS_LABEL: Record<StatusContrato, string> = {
  rascunho:   'Rascunho',
  aguardando: 'Aguardando assinatura',
  vigente:    'Vigente',
  recusado:   'Recusado',
  encerrado:  'Encerrado',
  rescindido: 'Rescindido',
};

export const numeroContrato = (n: number) => `CT-${String(n).padStart(4, '0')}`;

/** Por qual parte a pessoa logada fala — `null` se não representa nenhuma. */
export function parteQueRepresento(profile: Pick<UserProfile, 'role' | 'filial'> | null | undefined): Parte | null {
  if (!profile) return null;
  if (profile.role === 'admin') return 'Matriz';
  if (profile.role === 'gerente' && PARTES.includes(profile.filial as Parte) && profile.filial !== 'Matriz') {
    return profile.filial as Parte;
  }
  return null;
}

/** A outra ponta do contrato, vista de `minha`. */
export const contraparte = (c: Pick<Contrato, 'parte_a' | 'parte_b'>, minha: Parte) =>
  c.parte_a === minha ? c.parte_b : c.parte_a;

/**
 * Venceu pela data, ainda que o status continue 'vigente'. O status só muda por
 * ato de uma das partes (encerrar); o calendário não assina nada. Compara as
 * strings 'YYYY-MM-DD' — coluna `date` não passa por `new Date()`
 * (vide feedback_coluna_date_nao_passa_por_new_date).
 */
export const venceu = (c: Pick<Contrato, 'vigencia_fim'>, hojeIso: string) =>
  !!c.vigencia_fim && c.vigencia_fim < hojeIso;

/** SHA-256 em hex minúsculo — o formato que o CHECK da tabela exige. */
export async function sha256Hex(dados: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Baixa os bytes do contrato do bucket e calcula o resumo. É a conferência de
 * verdade: se alguém tivesse trocado o objeto no storage, o resumo não bateria
 * com o gravado na hora do upload nem com o de cada assinatura.
 */
export async function conferirArquivo(
  c: Pick<Contrato, 'arquivo_path' | 'arquivo_sha256'>,
): Promise<{ hash?: string; confere?: boolean; error?: string }> {
  if (!supabase) return { error: 'Sem conexão.' };
  const { data, error } = await supabase.storage.from('contratos').download(c.arquivo_path);
  if (error || !data) return { error: error?.message || 'Não foi possível baixar o arquivo.' };
  const hash = await sha256Hex(await data.arrayBuffer());
  return { hash, confere: hash === c.arquivo_sha256 };
}

/**
 * Baixa o arquivo com o nome bonito. `download: nome` e âncora clicada, pelas
 * mesmas razões de `baixarDocumento` (nome do caminho e popup bloqueado).
 */
export async function baixarContrato(
  c: Pick<Contrato, 'arquivo_path' | 'arquivo_nome'>,
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Sem conexão.' };
  const { data, error } = await supabase.storage
    .from('contratos')
    .createSignedUrl(c.arquivo_path, 60, { download: c.arquivo_nome });
  if (error || !data?.signedUrl) return { error: error?.message || 'Não foi possível gerar o link.' };
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = c.arquivo_nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return {};
}
