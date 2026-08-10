// Atividade da aula — o lado do professor (Modo Aula › Fluxos de operação).
//
// O fluxo já dava a whitelist e o diagrama; aqui ele vira o enunciado que a
// turma recebe. Três coisas em uma tela, na ordem em que a aula acontece:
//   1. o roteiro nasce pronto do próprio fluxo (sem IA, sem rede);
//   2. o MaxAI, se chamado, reescreve as tarefas como enunciado situado;
//   3. o professor revisa, baixa em PDF e/ou publica para as filiais.
//
// O passo 3 é o único irreversível, e é o único que exige confirmação — o
// resto se refaz clicando de novo.

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  X, Sparkles, Download, Send, Trash2, Loader2, AlertTriangle, Users, Clock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { authFetch } from '../lib/authFetch';
import { useConfirm } from '../contexts/ConfirmContext';
import type { AulaFluxo } from '../lib/aulaFluxos';
import {
  roteiroDoFluxo, tituloPadraoAtividade, nomeArquivoAtividade, normalizarRoteiro,
  type AtividadeRoteiro, type AtividadeTarefa,
} from '../lib/aulaAtividade';
import { exportAtividadePDF } from '../lib/aulaAtividadePdf';
import type { UserProfile } from '../hooks/useUserProfile';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;

const PUBLICO_OPCOES: { id: 'todos' | 'gerentes' | 'colaboradores'; label: string }[] = [
  { id: 'todos',         label: 'Gerentes e colaboradores' },
  { id: 'gerentes',      label: 'Somente gerentes' },
  { id: 'colaboradores', label: 'Somente colaboradores' },
];

// Acre não tem DST: subtrair 5h do UTC dá a hora de parede local, no formato
// que o <input type="datetime-local"> espera. (Mesma conversão de MatrizAvisosView.)
const paraInputAcre = (d: Date) => new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 16);
const doInputAcre = (v: string) => new Date(`${v}:00-05:00`).toISOString();

interface Props {
  fluxo: AulaFluxo;
  profile: UserProfile;
  showToast: (msg: string, type?: string) => void;
  onClose: () => void;
  /** O fluxo inteiro está na whitelist atual? */
  coberturaCompleta: boolean;
  /** O Modo Aula está ligado e salvo? */
  aulaAtiva: boolean;
}

export const AulaAtividadeModal: React.FC<Props> = ({
  fluxo, profile, showToast, onClose, coberturaCompleta, aulaAtiva,
}) => {
  const confirmar = useConfirm();

  const [titulo, setTitulo] = useState(tituloPadraoAtividade(fluxo));
  const [objetivo, setObjetivo] = useState('');
  const [roteiro, setRoteiro] = useState<AtividadeRoteiro>(() => roteiroDoFluxo(fluxo));
  const [observacao, setObservacao] = useState('');
  const [geradoPorIa, setGeradoPorIa] = useState(false);
  const [modeloIa, setModeloIa] = useState<string | null>(null);

  // Padrão de prazo: fim do dia seguinte. Aula que termina hoje e atividade que
  // vence hoje deixam a turma sem consulta na hora de estudar em casa.
  const [prazo, setPrazo] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return paraInputAcre(d);
  });
  const [filiais, setFiliais] = useState<string[]>([]);
  const [publico, setPublico] = useState<'todos' | 'gerentes' | 'colaboradores'>('todos');

  const [gerando, setGerando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [publicando, setPublicando] = useState(false);

  const atividade = useMemo(() => ({
    titulo: titulo.trim() || tituloPadraoAtividade(fluxo),
    fluxoId: fluxo.id,
    fluxoNome: fluxo.nome,
    objetivo: objetivo.trim() || null,
    roteiro,
    criador: profile.nome ?? null,
    expiraEm: prazo ? doInputAcre(prazo) : null,
    geradoPorIa,
  }), [titulo, objetivo, roteiro, prazo, geradoPorIa, fluxo, profile.nome]);

  const editarTarefa = (i: number, campo: keyof AtividadeTarefa, valor: string) =>
    setRoteiro(r => ({
      ...r,
      tarefas: r.tarefas.map((t, idx) => (idx === i ? { ...t, [campo]: valor } : t)),
    }));

  const removerTarefa = (i: number) =>
    setRoteiro(r => ({
      ...r,
      tarefas: r.tarefas.filter((_, idx) => idx !== i).map((t, idx) => ({ ...t, ordem: idx + 1 })),
    }));

  const restaurarBase = () => {
    setRoteiro(roteiroDoFluxo(fluxo));
    setGeradoPorIa(false);
    setModeloIa(null);
  };

  const gerarComIA = async () => {
    setGerando(true);
    try {
      const resp = await authFetch('/api/ai-aula-atividade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fluxo_nome: fluxo.nome,
          fluxo_resumo: fluxo.resumo,
          etapas: roteiroDoFluxo(fluxo).etapas,
          prerequisitos: roteiro.prerequisitos,
          // Uma filial só faz o cenário citar produto e cliente daquela loja.
          // Com mais de uma, genérico é mais honesto que escolher por elas.
          filial: filiais.length === 1 ? filiais[0] : '',
          observacao: observacao.trim(),
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error ?? 'Falha ao gerar a atividade.');

      // As etapas e os pré-requisitos continuam sendo os do fluxo — a IA só
      // reescreve as tarefas. Assim o documento nunca contradiz a cadeia real.
      setRoteiro(r => normalizarRoteiro({ ...r, tarefas: json.tarefas }));
      if (json.titulo) setTitulo(json.titulo);
      if (json.objetivo) setObjetivo(json.objetivo);
      setGeradoPorIa(true);
      setModeloIa(json.modelo_ia ?? null);
      showToast('Atividade montada pelo MaxAI. Revise antes de enviar.', 'success');
    } catch (err: any) {
      showToast(err?.message ?? 'Falha ao falar com o MaxAI.', 'error');
    } finally {
      setGerando(false);
    }
  };

  const baixarPdf = async () => {
    setBaixando(true);
    try {
      await exportAtividadePDF(atividade, nomeArquivoAtividade(atividade), 'download', profile, showToast as any);
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível gerar o PDF.', 'error');
    } finally {
      setBaixando(false);
    }
  };

  const publicar = async () => {
    if (!supabase) { showToast('Supabase não configurado', 'error'); return; }
    if (roteiro.tarefas.length === 0) {
      showToast('A atividade precisa de pelo menos uma tarefa.', 'error');
      return;
    }
    if (!prazo || doInputAcre(prazo) <= new Date().toISOString()) {
      showToast('O prazo precisa ser no futuro.', 'error');
      return;
    }

    const destino = filiais.length === 0 ? 'todas as filiais' : filiais.join(', ');
    if (!await confirmar({
      message: `Enviar "${atividade.titulo}" para ${destino}?\n\n`
        + `${roteiro.tarefas.length} tarefa(s). A turma passa a ver o roteiro na tela `
        + '"Atividade da aula" e pode baixar o PDF.',
      confirmLabel: 'Enviar',
    })) return;

    setPublicando(true);
    try {
      const { error } = await supabase.rpc('publicar_atividade_aula', {
        p_titulo: atividade.titulo,
        p_fluxo_id: fluxo.id,
        p_fluxo_nome: fluxo.nome,
        p_roteiro: roteiro,
        p_expira_em: doInputAcre(prazo),
        p_objetivo: atividade.objetivo,
        p_filiais: filiais,
        p_publico: publico,
        p_gerado_por_ia: geradoPorIa,
        p_modelo_ia: modeloIa,
      });
      if (error) throw error;
      showToast('Atividade enviada para a turma.', 'success');
      onClose();
    } catch (err: any) {
      showToast(err?.message ?? 'Falha ao enviar a atividade.', 'error');
    } finally {
      setPublicando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="neu-flat rounded-3xl border border-white/10 bg-base w-full max-w-3xl flex flex-col gap-5 p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-100">Atividade da aula</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">{fluxo.nome}</p>
          </div>
          <button type="button" onClick={onClose}
            className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-200 shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Avisos que mudam o que a turma consegue fazer. Vêm antes do formulário
            porque depois de escrever o enunciado ninguém volta a lê-los. */}
        {!coberturaCompleta && (
          <div className="flex items-start gap-2 rounded-xl border border-yellow-500/30 px-3 py-2">
            <AlertTriangle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-yellow-300/90 leading-relaxed">
              A whitelist atual não cobre o fluxo inteiro. Publicar assim manda a turma
              para telas que o próprio Modo Aula esconde — use «Montar» neste fluxo antes de enviar.
            </p>
          </div>
        )}
        {!aulaAtiva && (
          <div className="flex items-start gap-2 rounded-xl border border-white/10 px-3 py-2">
            <AlertTriangle size={13} className="text-gray-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-gray-500 leading-relaxed">
              O Modo Aula está desligado. A atividade chega à turma mesmo assim, mas as telas
              do fluxo seguem a permissão normal de setor até você ligar o interruptor.
            </p>
          </div>
        )}

        {/* MaxAI */}
        <div className="rounded-2xl border border-accent/20 bg-accent/5 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Montar com o MaxAI</h3>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            O roteiro abaixo já sai pronto do fluxo. O MaxAI reescreve as tarefas como enunciado
            situado — cenário, o que entregar e como você confere. As etapas da cadeia não mudam.
          </p>
          <input
            type="text"
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            maxLength={200}
            placeholder="O que esta turma precisa treinar hoje (opcional) — ex.: foco em segregação de funções"
            className="neu-input rounded-xl px-3 py-2.5 text-sm"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={gerarComIA} disabled={gerando}
              className="neu-button px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50">
              {gerando ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {gerando ? 'Montando…' : geradoPorIa ? 'Gerar de novo' : 'Gerar tarefas'}
            </button>
            {geradoPorIa && (
              <button type="button" onClick={restaurarBase}
                className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-300">
                Voltar ao roteiro do fluxo
              </button>
            )}
            {modeloIa && <span className="text-[10px] text-gray-600">{modeloIa}</span>}
          </div>
        </div>

        {/* Cabeçalho da atividade */}
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Título</label>
            <input
              type="text"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              maxLength={200}
              className="neu-input rounded-xl px-3 py-2.5 text-sm w-full mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Objetivo <span className="text-gray-600 font-normal normal-case">(o que a turma deve entender)</span>
            </label>
            <textarea
              value={objetivo}
              onChange={e => setObjetivo(e.target.value)}
              rows={2}
              maxLength={800}
              className="neu-input rounded-xl px-3 py-2.5 text-sm w-full mt-1 resize-y"
            />
          </div>
        </div>

        {/* Tarefas */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-200">
              Tarefas <span className="text-gray-600 font-normal">({roteiro.tarefas.length})</span>
            </h3>
          </div>
          {roteiro.tarefas.length === 0 && (
            <p className="text-[11px] text-yellow-300/90">
              Sem tarefas não há o que enviar. Use «Gerar tarefas» ou «Voltar ao roteiro do fluxo».
            </p>
          )}
          <div className="flex flex-col gap-3">
            {roteiro.tarefas.map((t, i) => (
              <div key={i} className="rounded-2xl border border-white/5 bg-black/20 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full border border-accent/50 text-accent text-[9px] font-black flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={t.titulo}
                    onChange={e => editarTarefa(i, 'titulo', e.target.value)}
                    className="neu-input rounded-lg px-2.5 py-1.5 text-xs font-bold flex-1 min-w-0"
                  />
                  <button type="button" onClick={() => removerTarefa(i)} title="Remover tarefa"
                    className="neu-button w-7 h-7 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 shrink-0">
                    <Trash2 size={12} />
                  </button>
                </div>
                <input
                  type="text"
                  value={t.papel}
                  onChange={e => editarTarefa(i, 'papel', e.target.value)}
                  placeholder="Quem executa"
                  className="neu-input rounded-lg px-2.5 py-1.5 text-[11px] text-accent"
                />
                <textarea
                  value={t.enunciado}
                  onChange={e => editarTarefa(i, 'enunciado', e.target.value)}
                  rows={3}
                  placeholder="O que o aluno faz e o que ele deve observar"
                  className="neu-input rounded-lg px-2.5 py-1.5 text-[11px] resize-y"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={t.entregavel ?? ''}
                    onChange={e => editarTarefa(i, 'entregavel', e.target.value)}
                    placeholder="Entregar"
                    className="neu-input rounded-lg px-2.5 py-1.5 text-[11px]"
                  />
                  <input
                    type="text"
                    value={t.criterio ?? ''}
                    onChange={e => editarTarefa(i, 'criterio', e.target.value)}
                    placeholder="Como você confere"
                    className="neu-input rounded-lg px-2.5 py-1.5 text-[11px]"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Envio */}
        <div className="rounded-2xl border border-white/5 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Quem recebe</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {OP_FILIAIS.map(f => {
              const on = filiais.includes(f);
              return (
                <button key={f} type="button"
                  onClick={() => setFiliais(prev => on ? prev.filter(x => x !== f) : [...prev, f])}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                    on ? 'bg-accent/15 text-accent border-accent/30'
                       : 'neu-button border-white/5 text-gray-500 hover:text-gray-300'}`}>
                  {f}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-600">
            {filiais.length === 0
              ? 'Nenhuma marcada — a atividade vai para as três filiais.'
              : `Só ${filiais.join(', ')}.`}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Público</label>
              <select
                value={publico}
                onChange={e => setPublico(e.target.value as any)}
                className="neu-input rounded-xl px-3 py-2.5 text-sm w-full mt-1"
              >
                {PUBLICO_OPCOES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1">
                <Clock size={10} /> Prazo
              </label>
              <input
                type="datetime-local"
                value={prazo}
                onChange={e => setPrazo(e.target.value)}
                className="neu-input rounded-xl px-3 py-2.5 text-sm w-full mt-1"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 flex-wrap">
          <button type="button" onClick={baixarPdf} disabled={baixando}
            className="neu-button px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 flex items-center gap-1.5 disabled:opacity-50">
            <Download size={12} /> {baixando ? 'Gerando…' : 'Baixar PDF'}
          </button>
          <button type="button" onClick={publicar} disabled={publicando || roteiro.tarefas.length === 0}
            className="neu-button px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50">
            {publicando ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {publicando ? 'Enviando…' : 'Enviar para a turma'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
