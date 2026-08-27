// Crachá Virtual — a tela do professor, na Matriz.
//
// Aqui a leitura do crachá vira presença. O QR do aluno carrega só o
// `funcionarios.id`: ele NÃO autoriza nada, e quem grava é a RPC
// `registrar_ponto_manual` (migr. 559), que exige RH ou gerente da filial.
// Forjar um crachá não dá a ninguém um poder que quem está com o leitor na mão
// já não tivesse — o crachá substitui a DIGITAÇÃO do nome, não a autorização.
//
// A defesa contra "mostrar o crachá do colega que faltou" é humana, não
// criptográfica: a confirmação exibe a FOTO em tamanho grande antes de gravar,
// e quem lê está olhando para a pessoa.
//
// Escopo Matriz de propósito: o professor lê o crachá de qualquer unidade, e a
// lista aqui não é filtrada por filial. A RLS de `funcionarios` já recorta o
// que cada um pode ver — admin/CEO passam em todas.

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { IdCard, ScanLine, Search, User, Loader2, Clock, AlertTriangle, Building2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { QRScanner } from '../components/QRScanner';
import { CrachaModal, type CrachaPessoa } from '../components/CrachaVirtual';
import { lerCracha } from '../lib/cracha';
import { todayBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';

export const CrachaVirtualView = ({ showToast }: { showToast: any; profile?: UserProfile }) => {
  const { data: funcionarios, isLoading } = useFetchData<any>('/api/funcionariosview');

  const [scannerAberto, setScannerAberto] = useState(false);
  const [crachaAberto, setCrachaAberto] = useState<CrachaPessoa | null>(null);
  const [confirmando, setConfirmando] = useState<CrachaPessoa | null>(null);
  const [gravando, setGravando] = useState(false);
  const [busca, setBusca] = useState('');
  const [lidosAgora, setLidosAgora] = useState<{ nome: string; hora: string }[]>([]);

  const ativos = useMemo(
    () => (funcionarios ?? [])
      .filter((f: any) => (f.status ?? 'Ativo') !== 'Inativo')
      .sort((a: any, b: any) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [funcionarios],
  );

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return ativos;
    return ativos.filter((f: any) =>
      String(f.nome ?? '').toLowerCase().includes(q) ||
      String(f.cargo ?? '').toLowerCase().includes(q) ||
      String(f.filial ?? '').toLowerCase().includes(q));
  }, [ativos, busca]);

  const handleLeitura = (bruto: string) => {
    setScannerAberto(false);
    const funcionarioId = lerCracha(bruto);
    if (!funcionarioId) {
      showToast('Isto não é um crachá do LogMax. Aponte para o QR do crachá.', 'error', true);
      return;
    }
    const achado = ativos.find((f: any) => f.id === funcionarioId);
    if (!achado) {
      showToast('Crachá lido, mas não achei essa pessoa entre os funcionários ativos.', 'error', true);
      return;
    }
    setConfirmando(achado);
  };

  const handleGravar = async () => {
    if (!confirmando || !supabase) return;
    setGravando(true);
    try {
      const hora = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco',
      });
      const { error } = await supabase.rpc('registrar_ponto_manual', {
        p_funcionario_id: confirmando.id,
        p_data:           todayBR(),
        p_status:         'Normal',
        p_entrada:        hora,
        p_observacao:     null,
        p_horas:          null,
        p_origem:         'cracha',
      });
      if (error) throw error;
      showToast(`Presença de ${confirmando.nome} registrada às ${hora}.`, 'success', true);
      setLidosAgora(prev => [{ nome: confirmando.nome, hora }, ...prev].slice(0, 12));
      setConfirmando(null);
      // Reabre o leitor: com a turma em fila, voltar ao botão a cada leitura é
      // o gesto repetido que mais custa.
      setScannerAberto(true);
    } catch (err: any) {
      showToast(err?.message ?? 'Não consegui registrar a presença.', 'error', true);
    } finally {
      setGravando(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <IdCard size={26} /> Crachá Virtual
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Leia o crachá do aluno para registrar a presença de hoje. O lançamento manual
          em Registro de Ponto continua valendo para correções.
        </p>
      </div>

      <div className="neu-flat rounded-3xl p-6 border border-accent/20 flex flex-col sm:flex-row sm:items-center gap-4 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-200">Registrar presença lendo o crachá</p>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            A leitura só identifica quem é. A foto aparece para você conferir antes de gravar,
            e a presença entra como <span className="text-gray-300 font-semibold">Normal</span> no
            dia de hoje, com a hora da leitura.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setScannerAberto(true)}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-widest bg-accent/10 text-accent border border-accent/40 hover:bg-accent/15 transition-colors shrink-0"
        >
          <ScanLine size={14} /> Ler crachá
        </button>
      </div>

      {/* Fila da sessão: quem já passou nesta rodada. Some ao recarregar — a
          verdade continua sendo o Registro de Ponto; isto é só o retorno visual
          de quem está com trinta pessoas na frente. */}
      {lidosAgora.length > 0 && (
        <div className="neu-flat rounded-3xl p-5 border border-emerald-500/20 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/80 mb-3">
            Lidos agora ({lidosAgora.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {lidosAgora.map((l, i) => (
              <span key={`${l.nome}-${i}`}
                className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                {l.nome} · {l.hora}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Crachás da turma ({filtrados.length})
          </p>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar pessoa…"
              className="neu-input rounded-xl pl-8 pr-3 py-2 text-sm w-[200px]"
            />
          </div>
        </div>

        {isLoading ? <LoadingSpinner /> : filtrados.length === 0 ? (
          <EmptyState message="Nenhum funcionário ativo encontrado." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtrados.map((f: any) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setCrachaAberto(f)}
                title="Abrir o crachá"
                className="flex items-center gap-3 p-3 rounded-2xl border border-white/10 hover:border-accent/40 hover:bg-white/5 transition-colors text-left"
              >
                <div className="w-11 h-11 rounded-xl overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center shrink-0">
                  {f.foto_url
                    ? <img src={f.foto_url} alt="" className="w-full h-full object-cover" />
                    : <User size={18} className="text-gray-600" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-200 truncate">{f.nome}</p>
                  <p className="text-[10px] text-gray-500 truncate flex items-center gap-1">
                    {f.filial && <><Building2 size={9} />{f.filial}</>}
                    {f.filial && f.cargo && ' · '}
                    {f.cargo}
                  </p>
                </div>
                <IdCard size={14} className="text-gray-600 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {scannerAberto && (
        <QRScanner onResult={handleLeitura} onClose={() => setScannerAberto(false)} />
      )}

      {crachaAberto && (
        <CrachaModal pessoa={crachaAberto} onClose={() => setCrachaAberto(null)} />
      )}

      {/* Confirmação da leitura — a foto é o controle desta tela. */}
      {confirmando && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !gravando && setConfirmando(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-sm flex flex-col items-center gap-4"
          >
            <div className="w-32 h-32 rounded-2xl overflow-hidden border-2 border-accent/40 bg-black/40 flex items-center justify-center">
              {confirmando.foto_url
                ? <img src={confirmando.foto_url} alt={confirmando.nome} className="w-full h-full object-cover" />
                : <User size={44} className="text-accent/50" />}
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-100 leading-tight">{confirmando.nome}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {[confirmando.filial, confirmando.cargo].filter(Boolean).join(' · ')}
              </p>
            </div>

            {!confirmando.foto_url && (
              <p className="text-[11px] text-amber-400/90 flex items-start gap-1.5 text-center">
                <AlertTriangle size={12} className="shrink-0 mt-px" />
                <span>Esta pessoa não tem foto no cadastro — confira o nome antes de gravar.</span>
              </p>
            )}

            <p className="text-[11px] text-gray-500 text-center">
              É esta pessoa que está na sua frente? A presença de hoje será registrada como
              <span className="text-gray-300 font-semibold"> Normal</span>.
            </p>

            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={() => setConfirmando(null)}
                disabled={gravando}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest border border-white/15 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
              >
                Não é
              </button>
              <button
                type="button"
                onClick={handleGravar}
                disabled={gravando}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest bg-accent/10 text-accent border border-accent/40 hover:bg-accent/15 transition-colors disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                {gravando ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
                Registrar presença
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
