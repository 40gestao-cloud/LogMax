// Cadeado de "estou trabalhando nisto agora" — migr. 537.
//
// Duas telas usam este hook com chaves diferentes: Cotações (escopo
// 'cotacao', chave requisição+fornecedor) e Cadastro de Produtos (escopo
// 'cadastro_produto', chave da origem escolhida). O hook não sabe qual é
// qual — só reserva, renova a cada 60s enquanto a tela está aberta, e solta
// no unmount ou quando a `chave` muda para outra coisa.
//
// Prazo do banco é 3 minutos (migr. 537); o batimento daqui é bem mais curto
// que isso de propósito — perder um batimento por rede lenta não pode custar
// a vaga no meio do preenchimento.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTravaAtualizacao } from './useTravaAtualizacao';

type Dono = { usuario_id: string; usuario_nome: string; minha: boolean } | null;

export function useReservaTrabalho(
  escopo: 'cotacao' | 'cadastro_produto',
  chave: string | null | undefined,
  filial: string | null | undefined,
) {
  const [dono, setDono] = useState<Dono>(null);
  const chaveAtiva = useRef<string | null>(null);
  // Uid uma vez só, do storage local. `getUser()` bate no servidor a cada
  // chamada, e `lerDono` roda a cada evento da tabela — com a turma inteira
  // aberta isso viraria uma ida à rede por movimento de qualquer colega.
  const meuId = useRef<string | null>(null);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      meuId.current = data.session?.user?.id ?? null;
    });
  }, []);

  const liberar = useCallback(async (chaveParaSoltar?: string) => {
    const alvo = chaveParaSoltar ?? chaveAtiva.current;
    if (!supabase || !alvo) return;
    chaveAtiva.current = null;
    setDono(null);
    await supabase.rpc('liberar_trabalho', { p_escopo: escopo, p_chave: alvo });
  }, [escopo]);

  const reservar = useCallback(async () => {
    if (!supabase || !chave || !filial) return;
    const { data, error } = await supabase.rpc('reservar_trabalho', {
      p_escopo: escopo, p_chave: chave, p_filial: filial,
    });
    if (error) return;
    const linha = Array.isArray(data) ? data[0] : data;
    setDono(linha ?? null);
  }, [escopo, chave, filial]);

  // Leitura pura, para reagir ao que os colegas fizeram. Separada de
  // `reservar` de propósito: aquela ESCREVE, e como o canal ouve a tabela
  // inteira, reservar a cada evento alheio faria 45 alunos disparar 45
  // escritas a cada movimento de qualquer um deles.
  const lerDono = useCallback(async () => {
    if (!supabase || !chave) return;
    const { data } = await supabase.from('trabalho_reservas')
      .select('usuario_id, usuario_nome')
      .eq('escopo', escopo).eq('chave', chave)
      .gt('expira_em', new Date().toISOString())
      .maybeSingle();
    setDono(data
      ? { usuario_id: data.usuario_id, usuario_nome: data.usuario_nome,
          minha: !!meuId.current && data.usuario_id === meuId.current }
      : null);
  }, [escopo, chave]);

  useEffect(() => {
    // Trocou de chave (ou zerou): solta a anterior antes de reservar a nova —
    // sem isso, trocar de fornecedor no meio do preenchimento deixaria a
    // reserva velha presa até o prazo vencer sozinho.
    if (chaveAtiva.current && chaveAtiva.current !== chave) {
      void liberar(chaveAtiva.current);
    }
    if (!chave || !filial) { setDono(null); return; }

    chaveAtiva.current = chave;
    void reservar();

    const batimento = window.setInterval(() => {
      if (!supabase || !chaveAtiva.current) return;
      void supabase.rpc('renovar_trabalho', { p_escopo: escopo, p_chave: chaveAtiva.current });
    }, 60_000);

    // Canal com nome único por instância — dois componentes montados ao
    // mesmo tempo (ou StrictMode remontando) não competem pelo mesmo canal.
    //
    // SEM `filter: chave=eq.…` de propósito: a chave do cadastro de produto é
    // `desc:<descrição do item>`, texto livre com espaço e às vezes vírgula, e
    // vírgula é separador na sintaxe de filtro do PostgREST — a inscrição
    // morreria calada justamente nas chaves mais compridas. Ouvir a tabela
    // inteira e filtrar na leitura custa pouco: ela tem uma linha por pessoa
    // trabalhando agora.
    const canalId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const ch = supabase?.channel(`trabalho_reservas_${canalId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trabalho_reservas' },
        () => { void lerDono(); })
      .subscribe();

    // Vencimento não emite evento: sem esta releitura o cadeado do colega
    // ficaria na tela depois de a reserva dele já ter morrido pelo relógio.
    const relogio = window.setInterval(() => { void lerDono(); }, 30_000);

    return () => {
      window.clearInterval(batimento);
      window.clearInterval(relogio);
      ch?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escopo, chave, filial]);

  // Soltar ao fechar a aba/navegar — sendBeacon não serve aqui (é RPC
  // autenticado), então é best-effort: o prazo de 3 minutos é a rede de
  // segurança real para quem simplesmente fecha o notebook.
  useEffect(() => {
    const aoFechar = () => { void liberar(); };
    window.addEventListener('beforeunload', aoFechar);
    return () => {
      window.removeEventListener('beforeunload', aoFechar);
      void liberar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reserva minha viva = trabalho não gravado nesta tela, mesmo sem campo
  // preenchido ainda — a PWA não pode recarregar por cima e derrubar a vaga.
  useTravaAtualizacao(!!dono?.minha, `trabalho-reserva-${escopo}`, 'há uma reserva de trabalho em aberto');

  return {
    dono,
    travado: !!dono && !dono.minha,
    souEu: !!dono?.minha,
    liberar: () => liberar(),
  };
}
