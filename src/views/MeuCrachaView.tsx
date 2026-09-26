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
  //
  // "Sem cadastro" é conclusão, não premissa: o vínculo é gravado nos DOIS
  // lados (`user_profiles.funcionario_id` e `funcionarios.user_profile_id`) e
  // houve turma inteira em que só o segundo estava preenchido — e todos os 39
  // alunos viam "sua conta não está ligada a um cadastro", com crachá sem QR,
  // no dia em que o crachá é usado. Por isso a busca tenta os dois lados
  // (migr. 561 abriu a `func_self` para o segundo) e só depois disso a tela
  // conclui que não há vínculo.
  const semFuncionario = !pessoa;

  const pessoaDoPerfil: CrachaPessoa = {
    id: profile?.id ?? '',
    nome: profile?.nome ?? '',
    cargo: ROTULO_PAPEL[profile?.role ?? ''] ?? null,
    filial: profile?.filial ?? null,
    foto_url: profile?.foto_url ?? null,
  };

  useEffect(() => {
    if (!supabase || (!funcionarioId && !profile?.id)) { setCarregando(false); return; }
    setCarregando(true);
    let cancelado = false;
    // A policy `func_self` deixa cada um ler a própria linha de `funcionarios`
    // — é por isso que o aluno monta o próprio crachá sem passar pelo RH.
    const base = supabase
      .from('funcionarios')
      .select('id, nome, cargo, filial, foto_url, status, ativo');
    const busca = funcionarioId
      ? base.eq('id', funcionarioId)
      : base.eq('user_profile_id', profile!.id);
    busca
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        // Vínculo ausente não é erro de sistema: quando o perfil não aponta
        // para funcionário nenhum e o outro lado também não aponta de volta, a
        // tela tem uma mensagem própria — com o caminho do conserto — em vez de
        // uma caixa vermelha.
        if (error) setErro(error.message);
        else if (!data && funcionarioId) setErro('Não encontrei seu cadastro de funcionário.');
        else if (data) {
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
  }, [funcionarioId, profile?.id, profile?.foto_url]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <IdCard size={26} /> Meu Crachá
        </h2>
        {!carregando && !erro && (
          <button type="button" onClick={() => window.print()}
            className="cracha-controles btn-solido btn-solido--cinza">
            <Printer size={15} /> Imprimir
          </button>
        )}
      </div>

      {carregando ? <LoadingSpinner /> : erro ? (
        <div className="neu-flat rounded-2xl p-6 border border-red-500/20 flex items-start gap-3 max-w-xl">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-300">{erro}</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 shrink-0 py-2">
          {/* Aviso antes do cartão: explica por que ele saiu sem QR. */}
          {(semFuncionario || inativo) && (
            <div className="w-full max-w-[340px] rounded-xl px-4 py-3 bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5">
              <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-100/90 leading-snug">
                {semFuncionario
                  ? <>Sem vínculo com o RH: o crachá <b>não registra presença</b>. Peça o vínculo ao professor.</>
                  : <>Cadastro <b>inativo</b>: o crachá não registra presença. Procure o RH.</>}
              </p>
            </div>
          )}
          <div className="w-full max-w-[340px]" style={{ maxWidth: 'min(340px, 52vh)' }}>
            <CrachaVirtual pessoa={pessoa ?? pessoaDoPerfil} semQr={semFuncionario || inativo} />
          </div>
        </div>
      )}
    </motion.div>
  );
};
