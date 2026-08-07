import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Gavel, Landmark } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { isConselho } from '../lib/rbac';
import { todayBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';

// Painel de governança do Início — "o que é seu".
//
// O problema que ele resolve: depois do bloco G1–G8 o sistema passou a ter
// doze atos deliberativos espalhados por seis telas, e ninguém sabia qual
// deles era seu. Dizer isso por texto nas telas já tinha sido tentado e não
// resolveu — o que resolve é o número: se há 1 orçamento esperando parecer,
// o conselheiro vê "1" e clica.
//
// Duas colunas porque são dois papéis (migrs. 386/387):
//   • EXECUTAR  — CEO e gerente. Propor verba, prestar contas, responder ao
//     questionamento da auditoria. É o lado que age e depois explica.
//   • DELIBERAR — Conselho. Conceder verba, julgar as contas, encerrar
//     questionamento, decidir mandato vencido, pagar bônus, revisar risco.
//
// Quem acumula os dois papéis (o admin/professor) vê as duas colunas, e é
// exatamente o que ele precisa para conduzir a aula.
//
// Some inteiro quando não há nada pendente: painel de zeros vira ruído e
// ensina a ignorar a tela.

type Pendencia = { label: string; count: number; view: string; hint: string };

// Comitê de Auditoria e Matriz de Riscos só existem no modo Matriz (sidebar,
// 2026-08-07). O painel acompanha: em modo filial esses dois atalhos apontariam
// para telas que o menu não oferece mais.
export function PainelGovernanca({
  profile,
  onNavigate,
  matrizMode,
}: {
  profile?: UserProfile;
  onNavigate?: (view: string) => void;
  matrizMode?: boolean;
}) {
  const conselho  = isConselho(profile);
  // Executor = quem responde por uma unidade e presta contas dela.
  const executor  = profile?.role === 'ceo' || profile?.role === 'gerente' || profile?.role === 'admin';

  const [exec, setExec]   = useState<Pendencia[]>([]);
  const [delib, setDelib] = useState<Pendencia[]>([]);

  const carregar = useCallback(async () => {
    if (!supabase || !profile?.id) return;
    const hoje = todayBR();
    // `head: true` + `count: 'exact'`: só o número volta pela rede. A RLS já
    // recorta por filial, então a conta é a de quem está olhando.
    const contar = (q: any) => q.then((r: any) => r.count ?? 0);

    if (executor) {
      const [orc, prest, quest] = await Promise.all([
        contar(supabase.from('orcamentos_periodo').select('id', { count: 'exact', head: true })
          .eq('ativo', true).in('status', ['rascunho', 'devolvido'])),
        contar(supabase.from('prestacoes_contas').select('id', { count: 'exact', head: true })
          .eq('ativo', true).eq('status', 'rascunho')),
        // Responder é do fiscalizado — quem abriu não responde.
        contar(supabase.from('auditoria_revisoes').select('id', { count: 'exact', head: true })
          .eq('status', 'aberta').neq('aberta_por', profile.id)),
      ]);
      setExec([
        { label: 'Orçamento a propor',      count: orc,   view: 'financeiro-orçamentoanual',
          hint: 'Rascunho ou devolvido pelo Conselho — monte as rubricas e submeta.' },
        { label: 'Contas a prestar',        count: prest, view: 'financeiro-prestaçãodecontas',
          hint: 'Rascunho aberto. Enquanto não submeter, o Conselho não tem o que julgar.' },
        { label: 'Auditoria a responder',   count: quest, view: 'comite-auditoria',
          hint: 'O Comitê questionou uma operação e espera a explicação.' },
      ].filter(p => p.count > 0 && (matrizMode || p.view !== 'comite-auditoria')));
    } else {
      setExec([]);
    }

    if (conselho) {
      const [orc, prest, enc, mand, risco, bonus] = await Promise.all([
        // Quem propôs não delibera (migr. 386) — o próprio some da conta.
        contar(supabase.from('orcamentos_periodo').select('id', { count: 'exact', head: true })
          .eq('ativo', true).eq('status', 'submetido')
          .or(`proposto_por.is.null,proposto_por.neq.${profile.id}`)),
        contar(supabase.from('prestacoes_contas').select('id', { count: 'exact', head: true })
          .eq('ativo', true).eq('status', 'submetida')
          .or(`autor_id.is.null,autor_id.neq.${profile.id}`)),
        contar(supabase.from('auditoria_revisoes').select('id', { count: 'exact', head: true })
          .eq('status', 'respondida')),
        // Mandato vencido não cai sozinho: fica aqui até alguém decidir.
        contar(supabase.from('mandatos').select('id', { count: 'exact', head: true })
          .eq('ativo', true).eq('status', 'vigente').lt('data_fim', hoje)
          .neq('user_profile_id', profile.id)),
        contar(supabase.from('riscos').select('id', { count: 'exact', head: true })
          .eq('ativo', true).gte('severidade', 15).neq('status', 'encerrado')),
        contar(supabase.from('apuracoes_bonus').select('id', { count: 'exact', head: true })
          .eq('ativo', true).eq('status', 'calculada')),
      ]);
      setDelib([
        { label: 'Orçamento a deliberar',   count: orc,   view: 'financeiro-orçamentoanual',
          hint: 'A unidade pediu a verba. Corte linha a linha e decida.' },
        { label: 'Contas a julgar',         count: prest, view: 'financeiro-prestaçãodecontas',
          hint: 'Aprovar, ressalvar ou reprovar. Ressalva vira tarefa com prazo.' },
        { label: 'Auditoria a encerrar',    count: enc,   view: 'comite-auditoria',
          hint: 'A unidade já explicou. Conclua como conforme ou não conforme.' },
        { label: 'Mandato vencido',         count: mand,  view: 'rh-mandatos',
          hint: 'Passou do prazo. Reconduza, substitua ou encerre o posto.' },
        { label: 'Risco crítico',           count: risco, view: 'riscos',
          hint: 'Severidade 15+. Revise probabilidade, impacto e mitigação.' },
        { label: 'Bônus a pagar',           count: bonus, view: 'rh-remuneraçãovariável',
          hint: 'Apuração fechada esperando o Conselho mandar creditar.' },
      ].filter(p => p.count > 0
        && (matrizMode || (p.view !== 'comite-auditoria' && p.view !== 'riscos'))));
    } else {
      setDelib([]);
    }
  }, [profile?.id, conselho, executor, matrizMode]);

  useEffect(() => { void carregar(); }, [carregar]);

  if (exec.length === 0 && delib.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2 shrink-0">
      {exec.length > 0 && (
        <Bloco titulo="Executar" subtitulo="Você propõe, executa e explica."
          icone={<Landmark size={16} />} itens={exec} onNavigate={onNavigate} />
      )}
      {delib.length > 0 && (
        <Bloco titulo="Deliberar" subtitulo="O Conselho concede, julga e fiscaliza."
          icone={<Gavel size={16} />} itens={delib} onNavigate={onNavigate} />
      )}
    </div>
  );
}

function Bloco({
  titulo, subtitulo, icone, itens, onNavigate,
}: {
  titulo: string;
  subtitulo: string;
  icone: React.ReactNode;
  itens: Pendencia[];
  onNavigate?: (view: string) => void;
}) {
  return (
    <div className="neu-flat rounded-3xl p-5 border border-white/5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
          {icone}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-bold text-gray-200">{titulo}</div>
          <div className="text-[11px] text-gray-500">{subtitulo}</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {itens.map(p => (
          <button key={p.label} onClick={() => onNavigate?.(p.view)}
            className="w-full neu-button rounded-2xl px-3 py-2.5 flex items-center gap-3 text-left hover:border-accent/30 transition-colors">
            <span className="text-lg font-black text-accent tabular-nums w-7 shrink-0 text-center">
              {p.count}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-bold text-gray-200">{p.label}</span>
              <span className="block text-[11px] text-gray-500 leading-tight">{p.hint}</span>
            </span>
            <ArrowRight size={14} className="text-gray-600 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
