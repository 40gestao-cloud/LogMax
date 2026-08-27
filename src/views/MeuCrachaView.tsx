// Meu Crachá — a tela do aluno.
//
// Módulo de primeiro nível, e não um botão escondido no topo: o crachá é o que
// o aluno mostra quando chega, então tem de estar onde a mão vai sozinha.
//
// De propósito FORA da whitelist do Modo Aula: uma aula que não listasse este
// módulo tiraria o crachá da tela justamente no dia em que ele é usado.

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { IdCard, AlertTriangle, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from '../components/ui';
import { CrachaVirtual, type CrachaPessoa } from '../components/CrachaVirtual';
import type { UserProfile } from '../hooks/useUserProfile';

export const MeuCrachaView = ({ profile }: { profile: UserProfile }) => {
  const [pessoa, setPessoa] = useState<CrachaPessoa | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const funcionarioId = profile?.funcionario_id ?? null;

  useEffect(() => {
    if (!supabase || !funcionarioId) { setCarregando(false); return; }
    let cancelado = false;
    // A policy `func_self` deixa cada um ler a própria linha de `funcionarios`
    // — é por isso que o aluno monta o próprio crachá sem passar pelo RH.
    supabase
      .from('funcionarios')
      .select('id, nome, cargo, filial, foto_url')
      .eq('id', funcionarioId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) setErro(error.message);
        else if (!data) setErro('Não encontrei seu cadastro de funcionário.');
        else setPessoa(data as CrachaPessoa);
        setCarregando(false);
      });
    return () => { cancelado = true; };
  }, [funcionarioId]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <IdCard size={26} /> Meu Crachá
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Mostre este QR para registrar sua presença. Ele identifica você — a presença
          só é gravada por quem faz a leitura.
        </p>
      </div>

      {carregando ? <LoadingSpinner /> : !funcionarioId ? (
        <div className="neu-flat rounded-3xl p-8 border border-amber-500/20 flex items-start gap-3 max-w-xl">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-gray-200">Sua conta ainda não está ligada a um funcionário</p>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              O crachá nasce do cadastro de funcionário, que é o que carrega nome, cargo,
              unidade e foto. Peça ao RH ou ao professor para fazer o vínculo em Usuários.
            </p>
          </div>
        </div>
      ) : erro ? (
        <div className="neu-flat rounded-3xl p-8 border border-red-500/20 flex items-start gap-3 max-w-xl">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-300">{erro}</p>
        </div>
      ) : pessoa && (
        <div className="flex flex-col items-center gap-4 shrink-0">
          <div className="w-full max-w-[320px]">
            <CrachaVirtual pessoa={pessoa} />
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="cracha-controles inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-white/15 text-gray-400 hover:text-accent hover:border-accent/40 transition-colors"
          >
            <Printer size={12} /> Imprimir
          </button>
          <p className="text-[11px] text-gray-600 text-center max-w-sm leading-relaxed">
            Não precisa imprimir: mostrar a tela do celular basta. O papel serve para o dia
            em que o celular ficar sem bateria.
          </p>
        </div>
      )}
    </motion.div>
  );
};
