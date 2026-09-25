import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { FileDown, Loader2, Search, Users, CalendarRange } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { exportFrequenciaPDF, type FrequenciaFuncionarioPdf, type FrequenciaStatusPdf } from '../lib/frequenciaPdf';
import type { UserProfile } from '../hooks/useUserProfile';

/**
 * Aba "Relatório" de Registro de Ponto — escolhe quem e quando, e baixa a
 * frequência em PDF.
 *
 * A apuração NÃO reaproveita a lista carregada pela aba Registros: aquela é
 * recortada pelo mês da tela, e o relatório tem período próprio. A busca é
 * feita aqui, na hora de gerar, e paginada — um trimestre de turma cheia passa
 * do teto de linhas do PostgREST, e a diferença entre "sem falta" e "página
 * cortada" não aparece em lugar nenhum do papel.
 */

type Funcionario = {
  id: string; nome: string; status: string | null;
  cargo: string | null; departamento: string | null; filial: string | null;
};

const PAGE = 1000;

/** Desligado segue com presença lançada, pela Matriz (migr. 357) — mesma régua
 *  da grade de lançamento. Os demais status saem da lista. */
const contaNaFrequencia = (f: Funcionario) => {
  const st = f?.status ?? 'Ativo';
  return st === 'Ativo' || st === 'Desligado';
};

const unidadeDe = (f: Funcionario) =>
  f?.status === 'Desligado' ? 'Matriz' : (f?.filial ?? 'Matriz');

/** Vocabulário do ponto → vocabulário da frequência. Atraso não é status no
 *  banco (é 'Normal' com entrada depois do alvo) e, para este papel, é
 *  presença — então tudo que não é Falta nem Justificado vira Presença. */
const statusDaFrequencia = (s: string | null): FrequenciaStatusPdf => {
  if (s === 'Falta') return 'Falta';
  if (s === 'Justificado') return 'Justificada';
  return 'Presença';
};

const primeiroDiaDoMes = (d: string) => `${d.slice(0, 7)}-01`;

export const FrequenciaRelatorioTab = ({
  funcionarios, filial, profile, showToast,
}: {
  funcionarios: Funcionario[];
  filial: string | null;
  profile: UserProfile;
  showToast: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}) => {
  const hoje = todayBR();
  const [inicio, setInicio] = useState(() => primeiroDiaDoMes(hoje));
  const [fim, setFim] = useState(hoje);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  const [detalhar, setDetalhar] = useState(true);
  const [gerando, setGerando] = useState(false);

  const elegiveis = useMemo(
    () => (funcionarios ?? [])
      .filter(contaNaFrequencia)
      .sort((a, b) => (a.nome ?? '').trim().localeCompare((b.nome ?? '').trim(), 'pt-BR', { sensitivity: 'base' })),
    [funcionarios],
  );

  const visiveis = useMemo(() => {
    const s = busca.trim().toLowerCase();
    if (!s) return elegiveis;
    return elegiveis.filter(f => (f.nome ?? '').toLowerCase().includes(s));
  }, [elegiveis, busca]);

  // Ninguém marcado = todos. É o default pedido: quem abre a tela e clica em
  // baixar leva a unidade inteira, sem ter que marcar nome por nome.
  const alvos = selecionados.size === 0
    ? elegiveis
    : elegiveis.filter(f => selecionados.has(f.id));

  const toggle = (id: string) => setSelecionados(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const baixar = async () => {
    if (!supabase) return;
    if (inicio > fim) { showToast('A data inicial é depois da final.', 'error'); return; }
    if (!alvos.length) { showToast('Nenhum funcionário para apurar.', 'error'); return; }

    setGerando(true);
    try {
      const ids = alvos.map(f => f.id);

      // Paginação explícita: o `select` sem range para no teto do PostgREST e
      // devolveria meio período em silêncio.
      const pontos: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('ponto_eletronico')
          .select('funcionario_id, data, status, entrada, observacao')
          .in('funcionario_id', ids)
          .gte('data', inicio)
          .lte('data', fim)
          .order('data', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        pontos.push(...(data ?? []));
        if ((data?.length ?? 0) < PAGE) break;
      }

      // Motivo da justificada: a observação do ponto é a fonte, mas o dia que
      // veio de afastamento ou de justificativa enviada pelo colaborador não
      // tem observação — sem este segundo caminho o papel sairia com
      // "Justificada" e nenhuma razão ao lado.
      const { data: justs, error: errJ } = await supabase
        .from('justificativas_falta')
        .select('funcionario_id, data, motivo')
        .in('funcionario_id', ids)
        .gte('data', inicio)
        .lte('data', fim);
      if (errJ) throw errJ;
      const motivoDe = new Map<string, string>();
      (justs ?? []).forEach((j: any) => {
        if (j.motivo) motivoDe.set(`${j.funcionario_id}|${j.data}`, j.motivo);
      });

      const porFunc = new Map<string, FrequenciaFuncionarioPdf>();
      alvos.forEach(f => porFunc.set(f.id, {
        nome: f.nome, cargo: f.cargo, unidade: unidadeDe(f), dias: [],
      }));
      pontos.forEach(p => {
        const alvo = porFunc.get(p.funcionario_id);
        if (!alvo) return;
        const status = statusDaFrequencia(p.status);
        alvo.dias.push({
          data: p.data,
          status,
          entrada: p.entrada ?? null,
          justificativa: p.observacao?.trim()
            || (status === 'Justificada' ? motivoDe.get(`${p.funcionario_id}|${p.data}`) ?? null : null),
        });
      });

      const escopo = filial ?? 'Todas as unidades';
      await exportFrequenciaPDF(
        {
          escopo,
          inicio, fim,
          geradoEm: new Date().toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' }),
          detalhar,
          funcionarios: [...porFunc.values()],
        },
        `frequencia-${escopo.toLowerCase().replace(/\s+/g, '-')}-${inicio}-a-${fim}`,
        'download',
        profile,
        showToast,
      );
      showToast('PDF da frequência gerado.', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Falha ao gerar o PDF da frequência.', 'error');
    } finally {
      setGerando(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
      {/* Período */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarRange size={14} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-300">Período do relatório</h3>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="freq-pdf-inicio" className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">De</label>
            <input id="freq-pdf-inicio" type="date" value={inicio} max={fim}
              onChange={e => setInicio(e.target.value || primeiroDiaDoMes(hoje))}
              className="neu-input rounded-xl px-3 py-2 text-sm tabular-nums" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="freq-pdf-fim" className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Até</label>
            <input id="freq-pdf-fim" type="date" value={fim} min={inicio}
              onChange={e => setFim(e.target.value || hoje)}
              className="neu-input rounded-xl px-3 py-2 text-sm tabular-nums" />
          </div>
          <div className="flex gap-2">
            {([
              ['Este mês', () => { setInicio(primeiroDiaDoMes(hoje)); setFim(hoje); }],
              ['Mês passado', () => {
                const [y, m] = hoje.split('-').map(Number);
                const ini = new Date(Date.UTC(y, m - 2, 1));
                const f = new Date(Date.UTC(y, m - 1, 0));
                setInicio(ini.toISOString().slice(0, 10));
                setFim(f.toISOString().slice(0, 10));
              }],
              ['Hoje', () => { setInicio(hoje); setFim(hoje); }],
            ] as [string, () => void][]).map(([label, fn]) => (
              <button key={label} type="button" onClick={fn}
                className="neu-button px-3 py-2 rounded-xl text-[11px] font-bold text-gray-400 hover:text-gray-200 border border-white/5">
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Funcionários */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <Users size={14} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-300">Funcionários</h3>
          <span className="text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
            {selecionados.size === 0 ? `Todos (${elegiveis.length})` : `${selecionados.size} selecionado(s)`}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setSelecionados(new Set(visiveis.map(f => f.id)))}
              className="text-[11px] text-gray-500 hover:text-gray-200 font-bold uppercase tracking-widest transition-colors">
              Marcar listados
            </button>
            <button type="button" onClick={() => setSelecionados(new Set())}
              className="text-[11px] text-gray-500 hover:text-gray-200 font-bold uppercase tracking-widest transition-colors">
              Limpar
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mb-4">Sem ninguém marcado, o PDF sai com todos os funcionários da lista.</p>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar funcionário..."
            className="neu-input w-full pl-9 pr-3 py-2 rounded-xl text-sm" />
        </div>

        {visiveis.length === 0 ? (
          <p className="text-xs text-gray-500 py-6 text-center">Nenhum funcionário encontrado.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto main-scrollbar grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {visiveis.map(f => {
              const on = selecionados.has(f.id);
              return (
                <button key={f.id} type="button" onClick={() => toggle(f.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition ${
                    on ? 'bg-accent/15 border-accent/30' : 'border-white/5 hover:border-white/20 hover:bg-white/5'}`}>
                  <span className={`w-4 h-4 rounded-md border flex items-center justify-center text-[10px] font-black shrink-0 ${
                    on ? 'bg-accent/30 border-accent/50 text-accent' : 'border-white/20 text-transparent'}`}>✓</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-gray-200 truncate">{f.nome}</span>
                    <span className="block text-[10px] text-gray-500 truncate">
                      {[unidadeDe(f), f.cargo].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Saída */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input type="checkbox" checked={detalhar} onChange={e => setDetalhar(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-accent)]" />
          <span className="text-xs text-gray-300">
            Detalhar dia a dia
            <span className="block text-[10px] text-gray-500">Sem isso, o PDF sai só com o resumo por funcionário.</span>
          </span>
        </label>
        <button type="button" onClick={baixar} disabled={gerando}
          className="btn-solido btn-solido--vermelho">
          {gerando ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
          {gerando ? 'Gerando...' : 'Baixar PDF'}
        </button>
      </div>
    </motion.div>
  );
};
