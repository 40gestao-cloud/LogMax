import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Upload, X, CheckCircle2, AlertTriangle, FileSpreadsheet, Loader2 } from 'lucide-react';
import { lerPlanilhaProdutos, gravarProdutosImportados, type LinhaImport } from '../lib/importarProdutos';
import { NeuButtonAccent } from './ui';

// Conferência antes de gravar — o passo que separa import de despejo.
//
// A turma preenche 56 linhas fora do sistema; parte vem com categoria que não
// existe, EAN de 12 dígitos, unidade que aquela unidade de negócio não usa. Se
// o botão gravasse direto, o resultado seria meio catálogo torto e ninguém
// sabendo qual linha estragou. Aqui o arquivo é lido, cada linha diz se entra e
// por quê não, e só então existe o botão de gravar.
//
// Nada é gravado na leitura. `lerPlanilhaProdutos` não escreve.

type Contexto = Parameters<typeof lerPlanilhaProdutos>[2];

export const ImportarProdutosModal = ({ filial, contexto, showToast, onFechar, onImportou }: {
  filial: string;
  contexto: Contexto;
  showToast: any;
  onFechar: () => void;
  /** Chamado quando ao menos um produto entrou — a tela recarrega a listagem. */
  onImportou: (criados: number) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<string>('');
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [progresso, setProgresso] = useState<{ feitas: number; total: number } | null>(null);
  const [linhas, setLinhas] = useState<LinhaImport[]>([]);
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const validas = linhas.filter(l => l.erros.length === 0);
  const recusadas = linhas.filter(l => l.erros.length > 0);

  const escolher = async (file: File | undefined) => {
    if (!file) return;
    setArquivo(file.name);
    setLendo(true);
    setLinhas([]);
    setErroGeral(null);
    try {
      const r = await lerPlanilhaProdutos(file, filial, contexto);
      setLinhas(r.linhas);
      setErroGeral(r.erroGeral);
    } catch (e: any) {
      setErroGeral(e?.message ?? 'Não consegui ler o arquivo.');
    } finally {
      setLendo(false);
    }
  };

  const gravar = async () => {
    if (validas.length === 0) return;
    setGravando(true);
    setProgresso({ feitas: 0, total: validas.length });
    try {
      const r = await gravarProdutosImportados(linhas, (feitas, total) => setProgresso({ feitas, total }));
      if (r.criados > 0) onImportou(r.criados);
      if (r.falhas.length === 0) {
        showToast?.(`${r.criados} produto(s) cadastrado(s) a partir da planilha.`, 'success', true);
        onFechar();
      } else {
        // Falha depois do insert (custo ou saldo) não some: a linha continua na
        // tela com o motivo, porque é ela que a pessoa vai corrigir à mão.
        showToast?.(`${r.criados} cadastrado(s), ${r.falhas.length} com problema — veja a lista.`, 'error', true);
        setLinhas(prev => prev.map(l => {
          const f = r.falhas.find(x => x.linhaNoArquivo === l.linhaNoArquivo);
          return f ? { ...l, erros: [...l.erros, f.motivo] } : l;
        }));
      }
    } catch (e: any) {
      showToast?.(`Falha ao importar: ${e?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setGravando(false);
      setProgresso(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={() => !gravando && onFechar()}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={e => e.stopPropagation()}
        className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-3xl max-h-[88vh] flex flex-col">

        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-sm font-bold text-gray-300">
            Importar planilha de produtos
            <span className="text-accent ml-2">— {filial}</span>
          </h3>
          <button onClick={() => !gravando && onFechar()}
            className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
            <X size={14} />
          </button>
        </div>

        {linhas.length === 0 && !erroGeral && (
          <div className="shrink-0">
            <p className="text-xs text-gray-500 leading-snug mb-4">
              Use o arquivo do <span className="text-gray-300 font-semibold">Modelo de planilha</span> desta unidade —
              a ficha muda de uma unidade para outra, e o import lê exatamente as colunas do modelo.
              Nada é gravado agora: primeiro você confere linha a linha.
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={lendo}
              className="w-full neu-button rounded-2xl border border-dashed border-white/15 py-10 flex flex-col items-center gap-2 text-gray-400 hover:text-accent hover:border-accent/30 transition-colors disabled:opacity-50">
              {lendo
                ? <><Loader2 size={22} className="animate-spin" /><span className="text-xs">Lendo {arquivo}…</span></>
                : <><FileSpreadsheet size={22} /><span className="text-xs font-bold">Escolher arquivo</span>
                    <span className="text-[10px] text-gray-600">.xlsx ou .csv</span></>}
            </button>
            <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden"
              onChange={e => { escolher(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        )}

        {erroGeral && (
          <div className="neu-inset rounded-xl p-4 border border-red-500/20 shrink-0">
            <p className="text-xs text-red-400 leading-snug">{erroGeral}</p>
            <button onClick={() => { setErroGeral(null); setArquivo(''); }}
              className="mt-3 text-[11px] text-gray-400 underline underline-offset-2 hover:text-gray-200">
              Escolher outro arquivo
            </button>
          </div>
        )}

        {linhas.length > 0 && (
          <>
            <div className="flex flex-wrap gap-4 text-xs mb-3 shrink-0">
              <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 size={13} /> {validas.length} pronto(s) para entrar
              </span>
              {recusadas.length > 0 && (
                <span className="text-red-400 font-bold flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {recusadas.length} com problema
                </span>
              )}
              <span className="text-gray-600">{arquivo}</span>
            </div>

            <div className="overflow-y-auto main-scrollbar flex-1 -mx-1 px-1">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-base">
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-2 font-bold px-2 w-14">Linha</th>
                    <th className="pb-2 font-bold px-2">Produto</th>
                    <th className="pb-2 font-bold px-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(l => (
                    <tr key={l.linhaNoArquivo} className="border-b border-white/5 align-top">
                      <td className="py-2 px-2 text-[11px] font-mono text-gray-500">{l.linhaNoArquivo}</td>
                      <td className="py-2 px-2 text-xs text-gray-200">{l.nome}</td>
                      <td className="py-2 px-2 text-[11px] leading-snug">
                        {l.erros.length > 0
                          ? <span className="text-red-400">{l.erros.join(' · ')}</span>
                          : <span className="text-emerald-400">Pronto</span>}
                        {l.avisos.length > 0 && (
                          <div className="text-amber-400/90 mt-0.5">{l.avisos.join(' · ')}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="shrink-0 pt-4 mt-2 border-t border-white/5">
              <p className="text-[10px] text-gray-500 leading-snug mb-3">
                Produto entra com saldo <span className="text-gray-400 font-bold">zero</span>, salvo o que a
                coluna <span className="text-gray-400">Saldo de Abertura</span> trouxer — e abertura não é compra:
                não gera conta a pagar. Linha com problema não entra; corrija na planilha e importe de novo,
                ou cadastre aquela à mão.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={onFechar} disabled={gravando}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={gravar} isLoading={gravando} disabled={validas.length === 0}>
                  <Upload size={14} />
                  {progresso
                    ? `Gravando ${progresso.feitas}/${progresso.total}…`
                    : `Importar ${validas.length} produto(s)`}
                </NeuButtonAccent>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
};
