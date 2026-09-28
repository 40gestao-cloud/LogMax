import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { FileDown, Loader2, Search, Users, CalendarRange, FileText, Check } from 'lucide-react';
import { SecaoFormulario, FilialBadge } from '../components/ui';
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

  // Agrupado por unidade, na ordem fixa da casa; Matriz (desligados) por último.
  const grupos = useMemo(() => {
    const ordem = ['SuperMax', 'MaxLook', 'TechMax', 'Matriz'];
    const m = new Map<string, Funcionario[]>();
    visiveis.forEach(f => {
      const u = unidadeDe(f);
      if (!m.has(u)) m.set(u, []);
      m.get(u)!.push(f);
    });
    const pos = (u: string) => { const i = ordem.indexOf(u); return i < 0 ? ordem.length - 1 : i; };
    return [...m.entries()].sort((a, b) => pos(a[0]) - pos(b[0]) || a[0].localeCompare(b[0]));
  }, [visiveis]);

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
      //
      // (650) `justificativas_falta.funcionario_id` é a CONTA (auth.users), não
      // o cadastro de funcionário — o filtro por `ids` nunca casava. A ponte é
      // `funcionarios.user_profile_id`. E só a aceita justifica: pendente ou
      // negada não é razão de dia nenhum.
      const funcDaConta = new Map<string, string>();
      alvos.forEach((f: any) => { if (f.user_profile_id) funcDaConta.set(f.user_profile_id, f.id); });
      const { data: justs, error: errJ } = funcDaConta.size
        ? await supabase
          .from('justificativas_falta')
          .select('funcionario_id, data, motivo')
          .in('funcionario_id', [...funcDaConta.keys()])
          .eq('status', 'Aceita')
          .gte('data', inicio)
          .lte('data', fim)
        : { data: [], error: null };
      if (errJ) throw errJ;
      const motivoDe = new Map<string, string>();
      (justs ?? []).forEach((j: any) => {
        const func = funcDaConta.get(j.funcionario_id);
        if (func && j.motivo) motivoDe.set(`${func}|${j.data}`, j.motivo);
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

  // Atalho de período marcado, para o botão aceso dizer o que está valendo.
  const atalhos: { label: string; ini: string; fim: string }[] = (() => {
    const [y, m] = hoje.split('-').map(Number);
    const iniPass = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const fimPass = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
    return [
      { label: 'Hoje',        ini: hoje,                   fim: hoje },
      { label: 'Este mês',    ini: primeiroDiaDoMes(hoje), fim: hoje },
      { label: 'Mês passado', ini: iniPass,                fim: fimPass },
    ];
  })();

  const diasCorridos = inicio <= fim
    ? Math.round((Date.parse(fim + 'T12:00:00Z') - Date.parse(inicio + 'T12:00:00Z')) / 86_400_000) + 1
    : 0;

  const fmt = (iso: string) => iso.split('-').reverse().join('/');

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-5 items-start">

      {/* Esquerda: o que vai no PDF, na ordem em que se decide, e o botão no fim.
          Nem ela fica presa no topo (sticky cortava o card na borda do
          rolamento) nem a lista tem rolagem própria (duas barras prendiam a
          roda do mouse no card): a página rola, e só ela. */}
      <div className="flex flex-col gap-5 min-w-0">
        <SecaoFormulario titulo="Período" icon={CalendarRange} cor="azul"
          extra={diasCorridos > 0 ? `${diasCorridos} dia(s)` : 'datas invertidas'}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <label htmlFor="freq-pdf-inicio" className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">De</label>
              <input id="freq-pdf-inicio" type="date" value={inicio} max={fim}
                onChange={e => setInicio(e.target.value || primeiroDiaDoMes(hoje))}
                className="neu-input rounded-xl px-3 py-2 text-sm tabular-nums w-full" />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label htmlFor="freq-pdf-fim" className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Até</label>
              <input id="freq-pdf-fim" type="date" value={fim} min={inicio}
                onChange={e => setFim(e.target.value || hoje)}
                className="neu-input rounded-xl px-3 py-2 text-sm tabular-nums w-full" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {atalhos.map(a => {
              const on = a.ini === inicio && a.fim === fim;
              return (
                <button key={a.label} type="button" aria-pressed={on}
                  onClick={() => { setInicio(a.ini); setFim(a.fim); }}
                  className={`px-2 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                    on ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                       : 'neu-button border-white/5 text-gray-400 hover:text-gray-200'}`}>
                  {a.label}
                </button>
              );
            })}
          </div>
        </SecaoFormulario>

        <SecaoFormulario titulo="Conteúdo" icon={FileText} cor="verde">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Conteúdo do PDF">
            {([
              [false, 'Só resumo', 'Uma linha por funcionário.'],
              [true,  'Dia a dia', 'Resumo e cada dia lançado.'],
            ] as const).map(([valor, titulo, texto]) => {
              const on = detalhar === valor;
              return (
                <button key={titulo} type="button" role="radio" aria-checked={on}
                  onClick={() => setDetalhar(valor)}
                  className={`px-3 py-2.5 rounded-xl border text-left transition-colors ${
                    on ? 'bg-emerald-500/15 border-emerald-500/40' : 'border-white/10 hover:border-white/20'}`}>
                  <span className={`block text-xs font-bold ${on ? 'text-emerald-300' : 'text-gray-200'}`}>{titulo}</span>
                  <span className="block text-[10px] text-gray-500 leading-snug">{texto}</span>
                </button>
              );
            })}
          </div>
        </SecaoFormulario>

        {/* Conferência antes de baixar: o que o papel vai trazer. */}
        <div className="neu-flat rounded-2xl border border-white/10 p-4 flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-gray-500">Unidade</dt>
            <dd className="text-gray-200 font-semibold text-right truncate">{filial ?? 'Todas as unidades'}</dd>
            <dt className="text-gray-500">Período</dt>
            <dd className="text-gray-200 font-semibold text-right tabular-nums">{fmt(inicio)} a {fmt(fim)}</dd>
            <dt className="text-gray-500">Funcionários</dt>
            <dd className="text-gray-200 font-semibold text-right tabular-nums">
              {alvos.length}{selecionados.size === 0 ? ' (todos)' : ''}
            </dd>
            <dt className="text-gray-500">Conteúdo</dt>
            <dd className="text-gray-200 font-semibold text-right">{detalhar ? 'Resumo + dia a dia' : 'Só resumo'}</dd>
          </dl>
          <button type="button" onClick={baixar} disabled={gerando || diasCorridos === 0 || alvos.length === 0}
            className="btn-solido btn-solido--vermelho w-full justify-center">
            {gerando ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {gerando ? 'Gerando...' : 'Baixar PDF'}
          </button>
        </div>
      </div>

      {/* Direita: quem entra. */}
      <SecaoFormulario titulo="Funcionários" icon={Users} cor="dourado"
        extra={selecionados.size === 0 ? `Todos (${elegiveis.length})` : `${selecionados.size} de ${elegiveis.length}`}>
        <div className="flex flex-col sm:flex-row gap-2 mb-2">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar funcionário..."
              className="neu-input w-full pl-9 pr-3 py-2 rounded-xl text-sm" />
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={() => setSelecionados(prev => new Set([...prev, ...visiveis.map(f => f.id)]))}
              className="neu-button px-3 py-2 rounded-xl text-[11px] font-bold text-gray-400 hover:text-gray-200 border border-white/5">
              Marcar listados
            </button>
            <button type="button" onClick={() => setSelecionados(new Set())} disabled={selecionados.size === 0}
              className="neu-button px-3 py-2 rounded-xl text-[11px] font-bold text-gray-400 hover:text-gray-200 border border-white/5 disabled:opacity-40">
              Limpar
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">Sem ninguém marcado, o PDF sai com todos da lista.</p>

        {visiveis.length === 0 ? (
          <p className="text-xs text-gray-500 py-8 text-center">Nenhum funcionário encontrado.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {grupos.map(([unidade, lista]) => {
              const marcados = lista.filter(f => selecionados.has(f.id)).length;
              const todos = marcados === lista.length;
              return (
                <div key={unidade}>
                  {/* Cabeçalho por unidade só quando há mais de uma: dentro da filial repetiria o título. */}
                  {grupos.length > 1 && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <FilialBadge filial={unidade} />
                      <span className="text-[10px] text-gray-500 tabular-nums">{marcados > 0 ? `${marcados}/` : ''}{lista.length}</span>
                      <div className="flex-1 h-px bg-white/5" />
                      <button type="button"
                        onClick={() => setSelecionados(prev => {
                          const n = new Set(prev);
                          lista.forEach(f => (todos ? n.delete(f.id) : n.add(f.id)));
                          return n;
                        })}
                        className="text-[10px] text-gray-500 hover:text-gray-200 font-bold uppercase tracking-widest transition-colors">
                        {todos ? 'Desmarcar' : 'Marcar'} unidade
                      </button>
                    </div>
                  )}
                  {/* Colunas pela largura do card, não por breakpoint: nome e
                      cargo cabem em ~170px, e três colunas fixas esticavam cada
                      um até o dobro disso. */}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-1.5">
                    {lista.map(f => {
                      const on = selecionados.has(f.id);
                      return (
                        <button key={f.id} type="button" onClick={() => toggle(f.id)} aria-pressed={on}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition min-w-0 ${
                            on ? 'bg-accent/15 border-accent/40' : 'border-white/5 hover:border-white/20 hover:bg-white/5'}`}>
                          <span className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                            on ? 'bg-accent border-accent text-black' : 'border-white/20 text-transparent'}`}>
                            <Check size={11} strokeWidth={3} />
                          </span>
                          <span className="min-w-0" title={[f.nome, f.cargo].filter(Boolean).join(' · ')}>
                            <span className="block text-xs font-semibold text-gray-200 truncate">{f.nome}</span>
                            <span className="block text-[10px] text-gray-500 truncate">{f.cargo || '—'}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SecaoFormulario>
    </motion.div>
  );
};
