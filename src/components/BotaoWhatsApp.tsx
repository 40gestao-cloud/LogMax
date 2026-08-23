import { MessageCircle } from 'lucide-react';
import { compartilharWhatsApp } from '../lib/whatsappShare';

type Props = {
  getTexto: () => string;
  label?: string;
  showToast?: (msg: string, tipo?: 'success' | 'error' | 'info') => void;
  className?: string;
};

export const BotaoWhatsApp = ({ getTexto, label = 'WhatsApp', showToast, className }: Props) => (
  <button
    onClick={() => compartilharWhatsApp(getTexto(), showToast)}
    title="Enviar este relatório pelo WhatsApp"
    className={className ?? 'inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest border border-white/10 hover:border-accent/40 rounded-lg px-3 py-2 text-gray-300 hover:text-accent transition-colors'}
  >
    <MessageCircle size={12} />{label}
  </button>
);
