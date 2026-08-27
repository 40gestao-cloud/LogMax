// Meu Crachá — o crachá de quem está logado.
//
// Módulo de primeiro nível, e não um botão escondido no topo: o crachá é o que
// o aluno mostra quando chega, então tem de estar onde a mão vai sozinha.
//
// Aberto a todo mundo. Quem ainda não tem cadastro de funcionário ligado à
// conta continua tendo identidade no sistema; o que não tem é como registrar
// presença, e o cartão sai sem QR dizendo isso — com o caminho do conserto,
// porque na turma a falta do vínculo é acidente de cadastro, não regra: CEO e
// conselheiro são alunos como os outros e batem ponto igual.
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

// O papel serve de "cargo" no crachá de quem não tem cadastro de funcionário.
const ROTULO_PAPEL: Record<string, string> = {
  admin:       'Professor',
  ceo:         'CEO',
  conselheiro: 'Conselheiro',
  gerente:     'Gerente',
  colaborador: 'Colaborador',
};

export const MeuCrachaView = ({ profile }: { profile: UserProfile }) => {
  const [pessoa, setPessoa] = useState<CrachaPessoa | null>(null);
  // Vínculo encerrado: o crachá continua existindo como identificação, mas o QR
  // sai de cena. A leitura do professor já recusaria essa pessoa (a lista dele
  // só traz ativos) — sem este aviso, o aluno levaria o crachá até a fila para
  // ouvir "não achei essa pessoa", que é a mensagem errada para o que está
  // acontecendo.
  const [inativo, setInativo] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const funcionarioId = profile?.funcionario_id ?? null;

  // Sem cadastro de funcionário o crachá ainda existe — só não registra ponto,
  // porque a presença é lançada por `funcionario_id`. O cartão sai sem QR em
  // vez de sair com um código que a leitura recusaria.
  const semFuncionario = !funcionarioId;
  const pessoaDoPerfil: CrachaPessoa = {
    id: profile?.id ?? '',
    nome: profile?.nome ?? '',
    cargo: ROTULO_PAPEL[profile?.role ?? ''] ?? null,
    filial: profile?.filial ?? null,
    foto_url: profile?.foto_url ?? null,
  };

  useEffect(() => {
    if (!supabase || !funcionarioId) { setCarregando(false); return; }
    setCarregando(true);
    let cancelado = false;
    // A policy `func_self` deixa cada um ler a própria linha de `funcionarios`
    // — é por isso que o aluno monta o próprio crachá sem passar pelo RH.
    supabase
      .from('funcionarios')
      .select('id, nome, cargo, filial, foto_url, status, ativo')
      .eq('id', funcionarioId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) setErro(error.message);
        else if (!data) setErro('Não encontrei seu cadastro de funcionário.');
        else {
          // A foto do cadastro de funcionário (RH) manda; se estiver vazia — o
          // caso comum, porque o formulário do RH grava string vazia e quase
          // ninguém sobe foto por lá — vale a foto de perfil do próprio aluno,
          // a mesma que ele vê no topo da tela. Sem esta ponte o crachá saía
          // com o boneco cinza mesmo para quem já tinha foto no sistema.
          setPessoa({ ...(data as CrachaPessoa), foto_url: data.foto_url || profile?.foto_url || null });
          setInativo(data.ativo === false || (data.status ?? 'Ativo') === 'Inativo');
        }
        setCarregando(false);
      });
    return () => { cancelado = true; };
  }, [funcionarioId, profile?.foto_url]);

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

      {carregando ? <LoadingSpinner /> : erro ? (
        <div className="neu-flat rounded-3xl p-8 border border-red-500/20 flex items-start gap-3 max-w-xl">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-300">{erro}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 shrink-0">
          <div className="w-full max-w-[320px]">
            <CrachaVirtual pessoa={pessoa ?? pessoaDoPerfil} semQr={semFuncionario || inativo} />
          </div>

          {inativo && !semFuncionario && (
            <div className="neu-flat rounded-2xl p-4 border border-amber-500/20 flex items-start gap-2.5 max-w-sm">
              <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Seu cadastro de funcionário está <span className="text-gray-300 font-semibold">inativo</span>,
                então este crachá não registra presença. Procure o RH ou o professor.
              </p>
            </div>
          )}

          {semFuncionario && (
            <div className="neu-flat rounded-2xl p-4 border border-amber-500/20 flex items-start gap-2.5 max-w-sm">
              <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Sua conta ainda não está ligada a um cadastro de funcionário, então este crachá
                identifica você mas <span className="text-gray-300 font-semibold">não registra
                presença</span>. Peça ao professor para fazer o vínculo em Usuários — feito isso,
                o QR aparece aqui sozinho.
              </p>
            </div>
          )}
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
