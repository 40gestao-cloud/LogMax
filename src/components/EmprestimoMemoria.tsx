// Memória de cálculo do empréstimo — a conta inteira, aberta.
//
// Existe porque um aluno da SuperMax refez a conta da parcela (R$ 30.056,92)
// com a taxa que a tela mostrava e não bateu: a coluna guardava 0,63% quando o
// contrato tinha sido fechado a 0,625% (migr. 613). O arredondamento sumiu,
// mas a lição ficou — num ERP didático não basta o número estar certo, o aluno
// precisa conseguir REFAZER o número.
//
// Então aqui não se mostra só o resultado: mostra-se a fórmula com os valores
// daquele contrato, a conferência pela primeira parcela (a única sem
// arredondamento acumulado), o que é despesa e o que é devolução de principal,
// e a tabela de amortização completa.
//
// As parcelas vêm do banco, nunca recalculadas na tela: `parcelas_emprestimo` é
// o que virou título a pagar de verdade. Refazer a Price aqui criaria um
// segundo número para o mesmo fato — exatamente o que esta tela combate.

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Calculator, TrendingDown, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './ui';

type ParcelaMemoria = {
  id: string;
  num_parcela: number;
  valor_parcela: number;
  data_vencimento: string;
  status: string;
  juros: number | null;
  amortizacao: number | null;
  saldo_devedor: number | null;
};

export type EmprestimoMemoriaProps = {
  emprestimo: {
    id: string;
    filial: string;
    valor: number;
    taxa_juros: number;
    num_parcelas: number;
    banco_nome?: string | null;
  };
  onClose: () => void;
};

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Taxa com até 3 casas, sem zero à toa: 0,625% e 1% — não "1,000%".
const PCT = (v: number, casas = 3) =>
  `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas })}%`;

const NUM = (v: number, casas = 8) =>
  Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { timeZone: 'America/Rio_Branco' });

function Bloco({ titulo, icone: Icone, children }: {
  titulo: string; icone?: any; children: React.ReactNode;
}) {
  return (
    <div className="neu-pressed rounded-2xl p-4 flex flex-col gap-2">
      <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5">
        {Icone && <Icone size={12} />}{titulo}
      </span>
      {children}
    </div>
  );
}

function Linha({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={`tabular-nums ${destaque ? 'font-black text-gray-100' : 'font-bold text-gray-200'}`}>
        {valor}
      </span>
    </div>
  );
}

export default function EmprestimoMemoria({ emprestimo, onClose }: EmprestimoMemoriaProps) {
  const [parcelas, setParcelas] = useState<ParcelaMemoria[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!supabase) return;
      const { data } = await supabase
        .from('parcelas_emprestimo')
        .select('id,num_parcela,valor_parcela,data_vencimento,status,juros,amortizacao,saldo_devedor')
        .eq('emprestimo_id', emprestimo.id)
        .order('num_parcela', { ascending: true });
      if (vivo) {
        setParcelas((data ?? []) as ParcelaMemoria[]);
        setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [emprestimo.id]);

  const P = Number(emprestimo.valor) || 0;
  const taxa = Number(emprestimo.taxa_juros) || 0;
  const i = taxa / 100;
  const n = Number(emprestimo.num_parcelas) || parcelas.length || 1;

  const fator = Math.pow(1 + i, n);
  // Equivalente anual composto — o número que o aluno reconhece do banco.
  const anual = (Math.pow(1 + i, 12) - 1) * 100;

  const primeira = parcelas[0];
  const ultima = parcelas[parcelas.length - 1];
  const totalPago = parcelas.reduce((s, p) => s + Number(p.valor_parcela ?? 0), 0);
  const totalJuros = parcelas.reduce((s, p) => s + Number(p.juros ?? 0), 0);
  const pagas = parcelas.filter(p => p.status === 'Paga');
  const jurosPagos = pagas.reduce((s, p) => s + Number(p.juros ?? 0), 0);

  // Onde a amortização passa a ser maior que o juro. Em taxa baixa é já na
  // primeira; em taxa alta demora, e é isso que mostra que o contrato caro
  // quase não abate saldo no começo.
  const virada = parcelas.find(p => Number(p.amortizacao ?? 0) > Number(p.juros ?? 0));

  const ultimaDifere = !!(primeira && ultima
    && Number(ultima.valor_parcela) !== Number(primeira.valor_parcela));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl w-full max-w-2xl max-h-[88vh] border border-accent/20 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5">
              <Calculator size={12} /> Memória de cálculo
            </span>
            <span className="text-sm font-bold text-gray-100 truncate">
              {emprestimo.filial}
              {emprestimo.banco_nome ? ` · ${emprestimo.banco_nome}` : ''}
            </span>
          </div>
          <button onClick={onClose} className="modal-close-btn shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto main-scrollbar flex flex-col gap-3">
          <Bloco titulo="O que foi contratado">
            <Linha label="Principal (o que entrou no caixa)" valor={BRL(P)} destaque />
            <Linha label="Juros ao mês" valor={PCT(taxa)} />
            <Linha label="Equivalente ao ano" valor={PCT(anual, 2)} />
            <Linha label="Prazo" valor={`${n} parcelas mensais`} />
            {primeira && <Linha label="1º vencimento" valor={fmtDate(primeira.data_vencimento)} />}
            {ultima && <Linha label="Último vencimento" valor={fmtDate(ultima.data_vencimento)} />}
            <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
              Sistema <strong className="text-gray-400">Tabela Price</strong>: a parcela é fixa, e dentro
              dela o juro cai mês a mês enquanto a amortização sobe.
            </p>
          </Bloco>

          {i > 0 && (
            <Bloco titulo="Como a parcela sai desses números" icone={Calculator}>
              <div className="font-mono text-[11px] leading-relaxed text-gray-300 bg-black/30 rounded-xl p-3 overflow-x-auto">
                <div className="text-gray-500">PMT = P × i × (1+i)ⁿ ÷ ((1+i)ⁿ − 1)</div>
                <div className="mt-2">i = {PCT(taxa)} ÷ 100 = {NUM(i, 5)}</div>
                <div>(1 + {NUM(i, 5)})<sup>{n}</sup> = {NUM(fator)}</div>
                <div className="mt-2">
                  PMT = {BRL(P)} × {NUM(i, 5)} × {NUM(fator)} ÷ ({NUM(fator)} − 1)
                </div>
                <div className="text-accent font-bold mt-1">
                  PMT = {primeira ? BRL(Number(primeira.valor_parcela)) : '—'}
                </div>
              </div>
              {primeira && primeira.juros !== null && (
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  <strong className="text-gray-400">Conferência pela 1ª parcela</strong> — é a única sem
                  arredondamento acumulado: juros = {BRL(P)} × {PCT(taxa)} ={' '}
                  <span className="tabular-nums text-gray-300">{BRL(Number(primeira.juros))}</span>.
                  Se esse número bate, a taxa exibida é mesmo a taxa usada.
                </p>
              )}
            </Bloco>
          )}

          <Bloco titulo="O que isso custa">
            <Linha label="Parcela" valor={primeira ? BRL(Number(primeira.valor_parcela)) : '—'} destaque />
            <Linha label="Total a pagar" valor={BRL(totalPago)} />
            <Linha
              label="Juros do contrato inteiro"
              valor={`${BRL(totalJuros)}${P > 0 ? ` · ${PCT((totalJuros / P) * 100, 1)} do principal` : ''}`}
            />
            {P > 0 && (
              <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
                Cada R$ 1,00 emprestado volta como{' '}
                <strong className="text-gray-300">
                  {(totalPago / P).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>{' '}
                ao longo dos {n} meses.
              </p>
            )}
            {pagas.length > 0 && (
              <Linha label={`Juros já pagos (${pagas.length} de ${n})`} valor={BRL(jurosPagos)} />
            )}
          </Bloco>

          <Bloco titulo="Da parcela, só o juro é despesa" icone={TrendingDown}>
            {primeira && primeira.juros !== null && (
              <div className="font-mono text-[11px] text-gray-300 bg-black/30 rounded-xl p-3 leading-relaxed">
                <div>
                  juros <span className="text-red-400">{BRL(Number(primeira.juros))}</span>
                  {'  '}(despesa no DRE)
                </div>
                <div>
                  amortização <span className="text-emerald-400">{BRL(Number(primeira.amortizacao ?? 0))}</span>
                  {'  '}(principal voltando)
                </div>
                <div className="border-t border-white/10 mt-1 pt-1">
                  parcela {BRL(Number(primeira.valor_parcela))}
                </div>
              </div>
            )}
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Pagar a parcela tira dinheiro do <strong className="text-gray-400">caixa</strong> inteiro, mas
              só a fatia de juro entra no <strong className="text-gray-400">resultado</strong>. Devolver o
              principal não é custo de nada — é a dívida diminuindo. Por isso a unidade pode ter lucro no mês
              e mesmo assim sentir o caixa apertado: são duas contas diferentes.
            </p>
            {virada && (
              <p className="text-[11px] text-gray-500 leading-relaxed">
                A partir da parcela <strong className="text-gray-400">{virada.num_parcela}</strong> a
                amortização passa a ser maior que o juro
                {virada.num_parcela === 1
                  ? ' — já na primeira, sinal de taxa baixa para o prazo.'
                  : ` — antes dela, a maior parte do que se paga é só juro, e o saldo devedor quase não cai.`}
              </p>
            )}
          </Bloco>

          {ultimaDifere && primeira && ultima && (
            <Bloco titulo="Por que a última parcela é diferente" icone={Info}>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                As {n - 1} primeiras são de {BRL(Number(primeira.valor_parcela))} e a última é de{' '}
                <strong className="text-gray-300">{BRL(Number(ultima.valor_parcela))}</strong>. A diferença é
                o resto dos centavos: cada parcela foi arredondada, e a última amortiza o saldo que sobrou
                para a dívida fechar exatamente em zero. Sem isso, sobraria saldo vivo ou se pagaria a mais.
              </p>
            </Bloco>
          )}

          <Bloco titulo={`Tabela de amortização (${parcelas.length})`}>
            {carregando ? (
              <LoadingSpinner />
            ) : parcelas.length === 0 ? (
              <p className="text-xs text-gray-500 py-2">
                Sem parcelas registradas — o contrato ainda não foi aprovado, ou é de uma turma anterior.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-[40vh] overflow-y-auto main-scrollbar -mx-1 px-1">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="sticky top-0 bg-[#0e0e0e]">
                    <tr className="text-gray-500 text-left">
                      <th className="py-1.5 pr-2 font-bold">#</th>
                      <th className="py-1.5 pr-2 font-bold">Vencimento</th>
                      <th className="py-1.5 pr-2 font-bold text-right">Parcela</th>
                      <th className="py-1.5 pr-2 font-bold text-right">Juros</th>
                      <th className="py-1.5 pr-2 font-bold text-right">Amortização</th>
                      <th className="py-1.5 font-bold text-right">Saldo devedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcelas.map(p => {
                      const paga = p.status === 'Paga';
                      return (
                        <tr key={p.id} className={`border-t border-white/5 ${paga ? 'text-gray-600' : 'text-gray-300'}`}>
                          <td className="py-1.5 pr-2">{p.num_parcela}</td>
                          <td className="py-1.5 pr-2">
                            {fmtDate(p.data_vencimento)}
                            {paga && <span className="text-emerald-600 ml-1">✓</span>}
                          </td>
                          <td className="py-1.5 pr-2 text-right font-bold">{BRL(Number(p.valor_parcela))}</td>
                          <td className="py-1.5 pr-2 text-right text-red-400/80">
                            {p.juros !== null ? BRL(Number(p.juros)) : '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-right text-emerald-400/80">
                            {p.amortizacao !== null ? BRL(Number(p.amortizacao)) : '—'}
                          </td>
                          <td className="py-1.5 text-right">
                            {p.saldo_devedor !== null ? BRL(Number(p.saldo_devedor)) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-gray-600 leading-relaxed mt-1">
              Cada linha desta tabela virou uma conta a pagar da unidade e uma conta a receber da Matriz, com
              o mesmo vencimento. Pagar a parcela em Financeiro baixa as duas pontas.
            </p>
          </Bloco>
        </div>
      </motion.div>
    </div>
  );
}
