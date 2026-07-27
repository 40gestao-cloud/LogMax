// Sobe um jsPDF (já montado) direto pro Max Show, criando uma apresentação
// tipo='pdf' na tabela max_shows. Mesmo caminho do "Importar PDF" manual do
// MaxShowsView — bucket max-show-anexos (público, 15 MB, mime PDF).
//
// Usado pelos exports de dashboards/relatórios (BI, Competição, Central de
// Avaliação, Avaliações) via parâmetro `destino: 'maxshow'`. Pergunta o
// título ao usuário (default = defaultTitle) e valida tamanho.

import type jsPDF from 'jspdf';
import { supabase } from './supabase';

const MAX_PDF_BYTES = 15 * 1024 * 1024;

export type PdfDestino = 'download' | 'maxshow';

// Entrega o PDF conforme o destino: 'download' salva local (doc.save),
// 'maxshow' sobe pro Max Show. Centraliza o dispatch usado por todos
// os exports (biExports, competicaoPdf, centralAvaliacaoExports,
// avaliacoesPdf).
export async function entregarPdf(
  doc: jsPDF,
  filename: string,
  destino: PdfDestino,
  profile?: { id: string } | null,
  showToast?: (msg: string, tone?: 'success' | 'error' | 'info') => void,
  defaultTitle?: string,
): Promise<void> {
  if (destino === 'maxshow') {
    await enviarPdfAoMaxShow(doc, defaultTitle ?? filename, profile, showToast);
    return;
  }
  doc.save(`${filename}.pdf`);
}

export async function enviarPdfAoMaxShow(
  doc: jsPDF,
  defaultTitle: string,
  profile: { id: string } | null | undefined,
  showToast?: (msg: string, tone?: 'success' | 'error' | 'info') => void,
): Promise<boolean> {
  if (!supabase || !profile?.id) {
    showToast?.('Sem sessão ativa — recarregue e tente de novo.', 'error');
    return false;
  }

  const titulo = window.prompt('Título da apresentação no Max Show:', defaultTitle)?.trim();
  if (!titulo) return false;

  const blob = doc.output('blob') as Blob;
  if (blob.size > MAX_PDF_BYTES) {
    showToast?.(`PDF muito grande (${(blob.size / 1024 / 1024).toFixed(1)} MB, máx 15 MB).`, 'error');
    return false;
  }
  const safeTitle = titulo.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const arquivoNome = `${safeTitle}.pdf`;
  const path = `${profile.id}/${Date.now()}_${arquivoNome}`;

  const { error: upErr } = await supabase.storage
    .from('max-show-anexos')
    .upload(path, blob, { contentType: 'application/pdf', upsert: false });
  if (upErr) {
    showToast?.(`Erro no upload: ${upErr.message}`, 'error');
    return false;
  }

  const { data: pub } = supabase.storage.from('max-show-anexos').getPublicUrl(path);

  const { error: insErr } = await supabase.from('max_shows').insert({
    user_id: profile.id,
    titulo,
    arquivo_url: pub.publicUrl,
    arquivo_nome: arquivoNome,
    arquivo_tamanho: blob.size,
  });
  if (insErr) {
    await supabase.storage.from('max-show-anexos').remove([path]);
    showToast?.(`Erro ao cadastrar no Max Show: ${insErr.message}`, 'error');
    return false;
  }

  showToast?.('Enviado ao Max Show — abra o módulo pra apresentar.', 'success');
  return true;
}
