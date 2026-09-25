// Matriz → Conteúdo — sorteio do catálogo semente para atividade de cadastro.
//
// Exceção aberta à trava de feature (2026-08-21): professor escolhe nicho +
// quantidade, sorteia produtos de `catalogoNicho.ts` (colhido das 4 turmas,
// não gerado por IA) e baixa uma folha em PDF para o aluno cadastrar em
// Cadastros > Produtos. Sorteio é determinístico por semente — perder a
// folha não perde o sorteio, só pede de novo com a mesma semente.
//
// Não escreve em `produtos`. Só sugere; quem cadastra confere nome, código
// (o próprio botão "Gerar") e preço — igual a qualquer outra fonte de
// catálogo no app.
//
// Acesso restrito a role='admin' literal (não CEO/conselheiro): é ferramenta
// de professor montando atividade, não papel de aluno-dirigente — mesmo
// critério do Cofre de Senhas.

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Dices, Download, RefreshCw, Trash2, Shuffle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NeuButtonAccent, FormField } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { sortear, categoriasDisponiveis, contarDisponiveis, type NichoCatalogo, type ItemSorteado } from '../lib/sorteioCatalogo';
import { formatarConteudo } from '../lib/unidades';
import { exportSorteioCatalogoPDF } from '../lib/catalogoNichoPdf';
import { todayBR } from '../lib/dates';

interface Props {
  profile: UserProfile;
  showToast: (msg: string, type?: string) => void;
}

const NICHOS: NichoCatalogo[] = ['SuperMax', 'MaxLook', 'TechMax'];

export const MatrizConteudoView: React.FC<Props> = ({ profile, showToast }) => {
  const [nichosSel, setNichosSel] = useState<NichoCatalogo[]>(['SuperMax']);
  const [qtd, setQtd] = useState(10);
  const [categoria, setCategoria] = useState('');
  const [pularCadastrados, setPularCadastrados] = useState(false);
  const [cadastrados, setCadastrados] = useState<Set<string> | null>(null);
  const [carregandoCadastrados, setCarregandoCadastrados] = useState(false);
  const [resultado, setResultado] = useState<{ semente: number; itens: ItemSorteado[] } | null>(null);
  // Removeu linha à mão depois de sortear: a semente continua identificando o
  // SORTEIO, mas deixa de reproduzir a FOLHA. O PDF avisa (ver catalogoNichoPdf).
  const [ajustadoAMao, setAjustadoAMao] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  const categorias = useMemo(() => categoriasDisponiveis(nichosSel), [nichosSel]);

  const excluirAtual = pularCadastrados ? cadastrados ?? undefined : undefined;
  const disponiveis = useMemo(
    () => contarDisponiveis({ nichos: nichosSel, categoria: categoria || undefined, excluir: excluirAtual }),
    [nichosSel, categoria, excluirAtual],
  );

  useEffect(() => {
    // Categoria escolhida pode não existir mais depois de trocar nicho.
    if (categoria && !categorias.includes(categoria)) setCategoria('');
  }, [categorias, categoria]);

  const toggleNicho = (n: NichoCatalogo) => {
    setNichosSel(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]);
    setResultado(null);
  };

  // Carrega nome+marca já cadastrados nas 4 unidades, para a opção "não
  // repetir o que a turma já tem". Em modo Matriz a RLS de `produtos` cobre
  // as três filiais operacionais — se algum dia não cobrir, a query volta
  // vazia e a checkbox simplesmente não filtra nada (nunca mente dizendo que
  // filtrou).
  const carregarCadastrados = useCallback(async () => {
    setCarregandoCadastrados(true);
    try {
      if (!supabase) throw new Error('sem conexão');
      const { data, error } = await supabase.from('produtos').select('nome, marca').eq('ativo', true);
      if (error) throw error;
      setCadastrados(new Set((data ?? []).map((p: any) => `${p.nome}|${p.marca ?? ''}`.toLowerCase())));
    } catch {
      // Desmarca a opção junto: deixar o check ligado com urna cheia diria que
      // filtrou sem ter filtrado nada.
      setCadastrados(new Set());
      setPularCadastrados(false);
      showToast('Não foi possível checar o que já está cadastrado — a filtragem ficou desativada.', 'error');
    } finally {
      setCarregandoCadastrados(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (pularCadastrados && cadastrados === null) carregarCadastrados();
  }, [pularCadastrados, cadastrados, carregarCadastrados]);

  const gerar = useCallback((semente?: number) => {
    if (nichosSel.length === 0) {
      showToast('Escolha ao menos um nicho.', 'error');
      return;
    }
    // Sortear antes da lista chegar filtraria NADA e não diria isso — o
    // professor leria a folha como "a turma não cadastrou nada ainda".
    if (pularCadastrados && cadastrados === null) {
      showToast('Ainda conferindo o que já está cadastrado — tente de novo em um instante.', 'info');
      return;
    }
    const r = sortear({
      nichos: nichosSel,
      qtd,
      categoria: categoria || undefined,
      excluir: excluirAtual,
      semente,
    });
    if (r.itens.length === 0) {
      showToast('Nada sobrou pra sortear com esse filtro — ajuste categoria ou desmarque "já cadastrado".', 'error');
      return;
    }
    setResultado(r);
    setAjustadoAMao(false);
  }, [nichosSel, qtd, categoria, pularCadastrados, cadastrados, excluirAtual, showToast]);

  const removerLinha = (idx: number) => {
    if (!resultado) return;
    setResultado({ ...resultado, itens: resultado.itens.filter((_, i) => i !== idx) });
    setAjustadoAMao(true);
  };

  const baixarPdf = useCallback(async () => {
    if (!resultado || resultado.itens.length === 0) return;
    setGerandoPdf(true);
    try {
      await exportSorteioCatalogoPDF(
        resultado.itens,
        resultado.semente,
        `sorteio-catalogo-${todayBR()}`,
        'download',
        profile,
        showToast as any,
        ajustadoAMao,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Falha ao gerar o PDF.', 'error');
    } finally {
      setGerandoPdf(false);
    }
  }, [resultado, ajustadoAMao, profile, showToast]);

  if (profile?.role !== 'admin') {
    return (
      <div className="flex flex-col h-full gap-4">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Conteúdo</h2>
        <p className="text-sm text-gray-400">Restrito ao professor (role admin).</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <Dices size={26} /> Conteúdo — Sorteio de Catálogo
        </h2>
      </div>

      <div className="neu-flat rounded-2xl p-5 flex flex-col gap-4">
        <FormField label="Nicho">
          <div className="flex flex-wrap gap-2">
            {NICHOS.map(n => (
              <button
                key={n}
                type="button"
                onClick={() => toggleNicho(n)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                  nichosSel.includes(n) ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={`Quantidade (${disponiveis} disponível(is) no filtro)`}>
            <input
              type="number"
              min={1}
              max={disponiveis}
              className="neu-input py-2 px-3 rounded-xl text-sm"
              value={qtd}
              onChange={e => setQtd(Math.max(1, Number(e.target.value) || 1))}
            />
            {qtd > disponiveis && (
              <span className="text-xs text-amber-400 mt-1 block">
                O filtro só tem {disponiveis} item(ns) — a folha sai com {disponiveis}.
              </span>
            )}
          </FormField>

          <FormField label="Categoria (opcional)">
            <select
              className="neu-input py-2 px-3 rounded-xl text-sm"
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
            >
              <option value="">Todas</option>
              {categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={pularCadastrados}
            onChange={e => setPularCadastrados(e.target.checked)}
          />
          Não sortear o que a turma já cadastrou {carregandoCadastrados && '(verificando…)'}
        </label>

        <div className="flex gap-3">
          <NeuButtonAccent onClick={() => gerar()} isLoading={carregandoCadastrados}>
            <Shuffle size={16} className="mr-1.5 inline" /> Sortear
          </NeuButtonAccent>
          {resultado && (
            <NeuButtonAccent onClick={() => gerar(resultado.semente)}>
              <RefreshCw size={16} className="mr-1.5 inline" /> Repetir sorteio (mesma semente)
            </NeuButtonAccent>
          )}
        </div>
      </div>

      {resultado && (
        <div className="neu-flat rounded-2xl p-5 flex flex-col gap-4 flex-1 min-h-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <span className="text-sm text-gray-400">
              {resultado.itens.length} produto(s) sorteado(s) · semente {resultado.semente}
              {ajustadoAMao && (
                <span className="text-amber-400"> · lista ajustada à mão (a semente reproduz o sorteio original)</span>
              )}
            </span>
            <button onClick={baixarPdf} disabled={gerandoPdf} className="btn-solido btn-solido--vermelho">
              <Download size={14} /> {gerandoPdf ? 'Gerando...' : 'Baixar PDF'}
            </button>
          </div>

          <div className="overflow-auto flex-1 min-h-0 rounded-xl neu-pressed">
            <table className="tabela w-full text-sm">
              <thead className="sticky top-0 bg-black/40">
                <tr className="text-left text-gray-400">
                  <th className="p-2">Produto</th>
                  <th className="p-2">Marca</th>
                  <th className="p-2">Categoria › Subcategoria</th>
                  <th className="p-2">Conteúdo</th>
                  <th className="p-2">Unid.</th>
                  <th className="p-2">Nicho</th>
                  <th className="p-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {resultado.itens.map((i, idx) => (
                  <tr key={`${i.nome}|${i.marca}`} className="border-t border-white/5 text-gray-200">
                    <td className="p-2">{i.nome}</td>
                    <td className="p-2">{i.marca}</td>
                    <td className="p-2 text-gray-400">{i.categoria} › {i.subcategoria}</td>
                    <td className="p-2">{formatarConteudo(i.peso, i.pesoUnidade) || '—'}</td>
                    <td className="p-2">{i.unidade}</td>
                    <td className="p-2 text-gray-400">{i.nicho}</td>
                    <td className="p-2 text-right">
                      <button type="button" onClick={() => removerLinha(idx)} className="action-btn-delete" title="Remover da lista">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
