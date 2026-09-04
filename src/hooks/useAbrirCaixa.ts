import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { formatBRL, parseBRL } from '../lib/viewUtils';

// =================================================================
// Abertura de caixa pelo operador do PDV
// =================================================================
// Nasceu dentro do PDV SuperMax e ficou só lá: MaxLook e TechMax mandavam o
// operador chamar o Financeiro para abrir o caixa, o que travava a aula
// inteira das duas unidades num passo que a RLS sempre permitiu — a policy
// `caixa_filial_write` (migr. 172) libera `auth_in_setor('financeiro',
// 'vendas')` em qualquer filial que `auth_pode_filial` autorize, sem recorte
// por nicho.
//
// A lógica mora aqui, e não copiada em cada PDV, porque é regra de dinheiro:
// as três unidades têm de abrir caixa do mesmo jeito. A APARÊNCIA continua
// de cada tela (o SuperMax imita um caixa de mercado; os outros seguem o
// design do app), só o comportamento é compartilhado.
//
// O Financeiro não deixa de saber: o gatilho da migr. 581 avisa a abertura
// e o fechamento, e dispara no INSERT venha ele de onde vier.

export type AbrirCaixaDeps = {
  filial: string;
  /** id do usuário autenticado (auth.users). */
  userId?: string | null;
  /** Nome que fica gravado em `aberto_por_nome`. */
  operadorNome?: string | null;
  showToast?: (msg: string, tipo?: string, persistente?: boolean) => void;
  /** Rebusca o caixa do dia — chamado no sucesso E no conflito. */
  refreshCaixa: () => void | Promise<void>;
};

export function useAbrirCaixa({ filial, userId, operadorNome, showToast, refreshCaixa }: AbrirCaixaDeps) {
  const [valor, setValor] = useState('');
  const [obs, setObs]     = useState('');
  const [abrindo, setAbrindo] = useState(false);

  const valorNumerico = parseBRL(valor);
  const podeAbrir = valorNumerico > 0 && !abrindo;

  /** Máscara R$ do projeto: `type=text inputMode=numeric`, nunca `type=number`. */
  const onChangeValor = (bruto: string) => setValor(formatBRL(parseBRL(bruto)));

  const abrir = async () => {
    if (valorNumerico <= 0) {
      showToast?.('Informe o fundo de troco para abrir o caixa.', 'error', true);
      return;
    }
    if (!supabase) { showToast?.('Supabase indisponível.', 'error', true); return; }
    setAbrindo(true);
    try {
      const { error } = await supabase.from('controle_caixa').insert({
        data:            todayBR(),
        filial,
        valor_abertura:  valorNumerico,
        status:          'Aberto',
        aberto_por:      userId ?? null,
        aberto_por_nome: operadorNome ?? 'Operador',
        aberto_em:       new Date().toISOString(),
        observacao:      obs.trim() || null,
      });
      if (error) {
        // 23505: o índice cobre só o caixa EM OPERAÇÃO (migr. 580), então aqui
        // isto significa mesmo que há um caixa ABERTO — outro operador chegou
        // primeiro. Antes o índice pegava também o caixa já FECHADO, e esta
        // mensagem mentia: dizia "já existe caixa aberto" para um caixa
        // fechado, sem saída nenhuma para o operador.
        if (error.code === '23505') {
          showToast?.(`Outro operador já abriu o caixa de ${filial} — atualizando a tela.`, 'error', true);
        } else throw error;
      } else {
        showToast?.(`Caixa aberto com ${formatBRL(valorNumerico)} de fundo de troco.`, 'success');
        setValor('');
        setObs('');
      }
      await refreshCaixa();
    } catch (err: any) {
      showToast?.(`Erro ao abrir o caixa: ${err?.message ?? '—'}`, 'error', true);
    } finally {
      setAbrindo(false);
    }
  };

  return { valor, setValor, onChangeValor, obs, setObs, abrindo, podeAbrir, abrir };
}
