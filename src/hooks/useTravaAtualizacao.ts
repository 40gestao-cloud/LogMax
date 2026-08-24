// Declara que ESTA tela está a segurar trabalho não gravado, e por isso o
// reload automático da PWA tem de esperar. Vide src/lib/naoInterromper.ts.
//
// Uso: useTravaAtualizacao(cart.length > 0, 'venda-pdv', 'há uma venda aberta no caixa')

import { useEffect } from 'react';
import { travarAtualizacao, destravarAtualizacao } from '../lib/naoInterromper';

export function useTravaAtualizacao(ativa: boolean, chave: string, motivo: string): void {
  useEffect(() => {
    if (!ativa) { destravarAtualizacao(chave); return; }
    travarAtualizacao(chave, motivo);
    // Desmontar destrava sempre: tela fechada não segura reload nenhum, e sem
    // isto uma trava sobreviveria à navegação e a versão nova nunca entraria.
    return () => destravarAtualizacao(chave);
  }, [ativa, chave, motivo]);
}
