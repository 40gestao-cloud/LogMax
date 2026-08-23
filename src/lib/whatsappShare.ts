// Compartilhamento de relatórios da IA via WhatsApp. Sem backend: link
// wa.me / Web Share API — o usuário escolhe o contato e envia manualmente.
// Não é push (não chega sozinho); pra isso ver caminho 2 (Cloud API) no
// plano combinado.

const LIMITE_WA_ME = 1500;

// Converte markdown (o formato que a IA devolve em ai-bi/ai-competicao/ai-chat)
// pra formatação nativa do WhatsApp: *negrito*, _itálico_, • lista.
export const mdParaTextoWhats = (md: string): string => {
  return md
    .split('\n')
    .map(line => {
      let l = line;
      l = l.replace(/^#{1,6}\s+(.*)$/, '*$1*');
      l = l.replace(/\*\*(.+?)\*\*/g, '*$1*');
      l = l.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_');
      l = l.replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');
      l = l.replace(/^\s*[-*]\s+/, '• ');
      // Linha de tabela markdown ("| a | b |") vira "a · b"; linha
      // separadora ("|---|---|") é descartada.
      if (/^\s*\|.*\|\s*$/.test(l)) {
        if (/^[\s|:-]+$/.test(l)) return null;
        l = l.split('|').map(c => c.trim()).filter(Boolean).join(' · ');
      }
      return l;
    })
    .filter(l => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const montarMensagemWhats = (opts: {
  titulo: string;
  subtitulo?: string;
  corpoMarkdown: string;
  geradoEm?: string;
}): string => {
  const partes = [`*LogMax · ${opts.titulo}*`];
  if (opts.subtitulo) partes.push(`_${opts.subtitulo}_`);
  partes.push('');
  partes.push(mdParaTextoWhats(opts.corpoMarkdown));
  if (opts.geradoEm) {
    partes.push('');
    partes.push(`_Gerado em ${opts.geradoEm}_`);
  }
  return partes.join('\n');
};

export const copiarTexto = async (texto: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(texto);
    return;
  } catch {
    // Fallback pra navegadores/contextos sem Clipboard API (http, iframes).
  }
  const ta = document.createElement('textarea');
  ta.value = texto;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* desiste silenciosamente */ }
  document.body.removeChild(ta);
};

// Abre o WhatsApp (Web Share API no mobile, wa.me no desktop) com o texto
// pronto. Textos longos estouram o limite prático de URL do wa.me — nesse
// caso copia o texto completo pro clipboard e avisa via toast.
export const compartilharWhatsApp = async (
  texto: string,
  showToast?: (msg: string, tipo?: 'success' | 'error' | 'info') => void,
): Promise<void> => {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: texto });
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      // Cai pro link wa.me abaixo se o share nativo falhar por outro motivo.
    }
  }

  if (texto.length > LIMITE_WA_ME) {
    await copiarTexto(texto);
    showToast?.('Relatório longo: copiado pro clipboard, é só colar no WhatsApp.', 'info');
    const corte = texto.slice(0, LIMITE_WA_ME).replace(/\n[^\n]*$/, '');
    window.open(`https://wa.me/?text=${encodeURIComponent(`${corte}\n\n_[texto completo copiado — cole aqui]_`)}`, '_blank');
    return;
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
};
