import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, ArrowRight, Boxes } from 'lucide-react';
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Legend,
} from 'recharts';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';

export const InicioView = ({ onNavigate, showToast }: { onNavigate?: (view: string) => void; showToast?: (msg: string, type?: string) => void }) => {
  const { data: contasReceber, isLoading: loadingCR } = useFetchData<any>('/api/contasreceberview');
  const { data: notasRecebidas, isLoading: loadingNR } = useFetchData<any>('/api/notasrecebidasview');
  const { data: pedidos, isLoading: loadingPed } = useFetchData<any>('/api/pedidosview');
  const isLoading = loadingCR || loadingNR || loadingPed;

  const contasAberto = contasReceber.filter((c: any) => c.status !== 'Pago');
  const contasReceberCount = contasAberto.length;
  const contasReceberValor = contasAberto
    .reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const notasCount = notasRecebidas.length;
  const chartData = (() => {
    const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const compra = pedidos.filter((p: any) => {
        const pd = new Date(p.created_at);
        return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
      }).length;
      return { name: MESES[d.getMonth()], compra, pedido: compra };
    });
  })();

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-8 h-full">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 shrink-0">
        <div className="lg:col-span-5 neu-flat rounded-3xl p-8 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-gray-200">Primeiros Passos</h3>
          </div>
          <div className="mb-6">
            <div className="flex justify-between text-xs font-semibold mb-3">
              <span className="text-accent tracking-wide">8/6 tarefas completadas</span>
              <span className="text-gray-400">100%</span>
            </div>
            <div className="h-2 w-full rounded-full neu-progress-bar">
              <div className="h-full rounded-full neu-progress-fill w-full"></div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {["Conheça a plataforma", "Adicione membros", "Adicione filiais", "Conheça a operação"].map((text, i) => (
              <div key={i} className="neu-pressed rounded-2xl p-4 flex items-center justify-between group cursor-pointer border border-transparent hover:border-white/5 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 neu-circle flex items-center justify-center bg-accent shrink-0">
                    <CheckCircle2 size={12} className="text-[#0A0A0A]" />
                  </div>
                  <span className="text-xs font-semibold text-gray-300 group-hover:text-white transition-colors">{text}</span>
                </div>
                <div className="w-7 h-3.5 rounded-full bg-[#111] relative flex items-center px-0.5 shrink-0 shadow-inner">
                  <div className="w-2.5 h-2.5 rounded-full bg-accent absolute right-0.5 shadow-[0_0_5px_var(--color-accent)]"></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 neu-flat rounded-3xl p-8 flex flex-col justify-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 bg-accent/5 rounded-full blur-3xl group-hover:bg-accent/10 transition-colors pointer-events-none"></div>
          <div className="flex items-center gap-4 mb-8 relative z-10">
            <div className="w-14 h-14 neu-circle flex items-center justify-center text-accent">
              <Boxes size={24} />
            </div>
            <h3 className="text-xl font-bold text-gray-200">Integração com o Bitrix24</h3>
          </div>
          <h2 className="text-3xl font-bold text-white mb-6 leading-snug relative z-10">
            Ative fluxos de trabalho e realize <span className="text-accent block mt-1">aprovações diretamente no Bitrix24</span>
          </h2>
          <button onClick={() => showToast?.('Integração Bitrix24 em breve.', 'info')} className="mt-6 neu-button-accent py-4 px-8 rounded-2xl text-base font-bold flex items-center justify-center gap-3 self-start relative z-10">
            Ativar integração <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : (
        <div className="flex flex-col gap-6 shrink-0 mb-8">
          <h3 className="text-xl font-bold text-gray-200 pl-3 border-l-4 border-accent tracking-wide">Resumo Diário</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="neu-flat rounded-3xl p-8 flex flex-col items-center justify-center relative border border-white/5">
              <h4 className="text-xs font-bold text-gray-400 mb-8 self-start uppercase tracking-widest">Contas a Receber</h4>
              <div className="w-28 h-28 rounded-full neu-flat flex items-center justify-center mb-8 border-[3px] border-[#0A0A0A] relative">
                <div className="absolute inset-0 rounded-full border-t-[3px] border-accent animate-spin-slow" style={{ animationDuration: '6s' }}></div>
                <span className="text-4xl font-black text-accent drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">{contasReceberCount}</span>
              </div>
              <div className="text-center mt-auto">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Valor Total</span>
                <span className="text-3xl font-bold text-gray-100">{contasReceberValor}</span>
              </div>
            </div>
            <div className="neu-flat rounded-3xl p-8 flex flex-col items-center justify-center text-center relative border border-white/5">
              <h4 className="text-xs font-bold text-gray-400 mb-8 w-full text-left uppercase tracking-widest">Notas Fiscais</h4>
              <span className="text-7xl font-black text-white mb-2 tracking-tighter drop-shadow-md mt-4">{notasCount}</span>
              <span className="text-xs font-medium text-gray-500 mb-10 tracking-wide">Notas fiscais capturadas</span>
              <button onClick={() => onNavigate?.('compras-notasrecebidas')} className="neu-button-accent w-full py-4 rounded-xl font-bold text-sm mt-auto">Ver notas recebidas</button>
            </div>
            <div className="neu-flat rounded-3xl p-6 flex flex-col border border-white/5">
              <h4 className="text-xs font-bold text-gray-400 mb-4 pl-2 uppercase tracking-widest">Pedidos de Compra</h4>
              <div className="flex-1 min-h-[140px] w-full mb-6">
                <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                  <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                    <XAxis dataKey="name" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#0A0A0A', border: '1px solid #1a1a1a', borderRadius: '12px', boxShadow: '8px 8px 16px #000' }} itemStyle={{ color: '#e0e0e0', fontWeight: 'bold', fontSize: '12px' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', color: '#9ca3af', paddingTop: '10px' }} />
                    <Bar dataKey="compra" fill="#1f2937" radius={[4, 4, 0, 0]} activeBar={{ fill: '#374151' }} stroke="#111827" strokeWidth={1} name="Compra" />
                    <Line type="monotone" dataKey="pedido" stroke="#10B981" strokeWidth={3} dot={{ r: 3, fill: '#0A0A0A', strokeWidth: 2 }} activeDot={{ r: 5, fill: '#10B981', strokeWidth: 0 }} name="Pedido" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-4 mt-auto">
                <button onClick={() => onNavigate?.('compras-pedidos')} className="flex-1 neu-pressed py-3.5 rounded-xl font-bold text-[10px] text-gray-400 hover:text-white transition-colors">SAIBA MAIS</button>
                <button onClick={() => onNavigate?.('compras-cotações')} className="flex-1 neu-button py-3.5 rounded-xl font-bold text-[10px] text-accent hover:text-white transition-colors">MAPA DE COTAÇÃO</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
