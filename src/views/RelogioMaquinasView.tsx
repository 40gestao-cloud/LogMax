import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlarmClock, RefreshCw, Monitor, Smartphone, ShieldCheck, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FilialBadge } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';

// Sessões Gerais → TI & Suporte → Relógio das Máquinas.
//
// Nasce do caso de 28/08: turma inteira caindo de volta na tela de login porque
// UMA estação estava com o relógio adiantado — o `auth-js` comparava o `exp` do
// token (tempo do servidor) com o `Date.now()` dela, achava todo token vencido,
// renovava em laço e estourava o limite por IP, derrubando junto quem estava com
// a hora certa. O app deixou de depender desse relógio (`lib/horaServidor.ts`),
// e esta tela é o outro lado: mostrar QUAL máquina está fora de hora, sem
// depender de aluno relatando sintoma.
//
// Cada linha é uma estação, alimentada pela medição que o app já faz no boot
// (migr. 563). `offset_ms` é quanto falta somar ao relógio da máquina para
// chegar no do servidor — negativo é máquina ADIANTADA, que é o caso que
// derruba a sessão.

type Maquina = {
  maquina_id: string;
  offset_ms: number;
  medido_em: string;
  ultimo_usuario: string | null;
  filial: string | null;
  navegador: string | null;
  plataforma: string | null;
  compartilhada: boolean | null;
};

/** Abaixo disto é ruído de rede, não desregulagem. */
const TOLERANCIA_MS = 60_000;

/**
 * A partir daqui o login entra em laço: `jwt_exp` (3600 s) menos a margem de
 * 90 s do `auth-js`. Adiantada além disso, a estação recebe token que já nasce
 * vencido.
 */
const LIMITE_SESSAO_MS = (3600 - 90) * 1000;

type Gravidade = 'ok' | 'atencao' | 'grave';

function gravidade(offsetMs: number): Gravidade {
  const desvio = Math.abs(offsetMs);
  // Só o relógio ADIANTADO (offset negativo) derruba a sessão; atrasado
  // estraga horário de ponto e lançamento, que é sério mas não expulsa.
  if (offsetMs < 0 && desvio > LIMITE_SESSAO_MS) return 'grave';
  if (desvio > TOLERANCIA_MS) return 'atencao';
  return 'ok';
}

const ESTILO: Record<Gravidade, { chip: string; texto: string; rotulo: string }> = {
  ok:      { chip: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30', texto: 'text-emerald-400', rotulo: 'Na hora' },
  atencao: { chip: 'bg-yellow-400/15 text-yellow-400 border border-yellow-400/30',    texto: 'text-yellow-400',  rotulo: 'Fora de hora' },
  grave:   { chip: 'bg-red-500/15 text-red-400 border border-red-500/30',             texto: 'text-red-400',     rotulo: 'Derruba a sessão' },
};

/** "1 h 4 min adiantado" — o sinal é lido aqui, não decorado pelo leitor. */
function descreveDesvio(offsetMs: number): string {
  const seg = Math.round(Math.abs(offsetMs) / 1000);
  if (seg < 60) return `${seg} s`;
  const horas = Math.floor(seg / 3600);
  const min = Math.round((seg % 3600) / 60);
  const partes = [horas > 0 ? `${horas} h` : null, min > 0 || horas === 0 ? `${min} min` : null].filter(Boolean);
  // offset negativo = precisa TIRAR do relógio da máquina para chegar no
  // servidor, ou seja, a máquina está adiantada.
  return `${partes.join(' ')} ${offsetMs < 0 ? 'adiantada' : 'atrasada'}`;
}

/** Nome curto do navegador — o user agent inteiro não cabe e não informa. */
function navegadorCurto(ua: string | null): string {
  if (!ua) return '—';
  if (/Edg\//.test(ua))     return 'Edge';
  if (/OPR\//.test(ua))     return 'Opera';
  if (/Chrome\//.test(ua))  return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua))  return 'Safari';
  return 'Outro';
}

function quandoFoi(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1)    return 'agora';
  if (min < 60)   return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24)     return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export function RelogioMaquinasView({ profile }: { profile: UserProfile | null }) {
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!supabase) return;
    setCarregando(true);
    const { data, error } = await supabase
      .from('ti_relogio_maquinas')
      .select('maquina_id, offset_ms, medido_em, ultimo_usuario, filial, navegador, plataforma, compartilhada')
      .order('medido_em', { ascending: false });
    setErro(error?.message ?? null);
    setMaquinas((data as Maquina[]) ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Pior desvio primeiro: a tela existe para achar a máquina problemática, não
  // para listar as saudáveis em ordem alfabética.
  const ordenadas = useMemo(
    () => [...maquinas].sort((a, b) => Math.abs(b.offset_ms) - Math.abs(a.offset_ms)),
    [maquinas],
  );

  const foraDeHora = ordenadas.filter(m => gravidade(m.offset_ms) !== 'ok').length;
  const graves     = ordenadas.filter(m => gravidade(m.offset_ms) === 'grave').length;

  // A RLS já recusa quem não é da Matriz; isto é só para a tela explicar em vez
  // de mostrar uma lista vazia sem motivo.
  const podeVer = profile?.role === 'admin' || profile?.role === 'ceo'
    || profile?.role === 'conselheiro' || profile?.is_conselheiro === true;

  if (!podeVer) {
    return (
      <div className="p-6">
        <EmptyState message="Esta tela é da Matriz: só direção e conselho enxergam o parque de máquinas." />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <AlarmClock size={20} className="text-red-400" />
            Relógio das Máquinas
          </h2>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-relaxed">
            Desvio entre o relógio de cada estação e o do servidor, medido no boot do app.
            Estação muito <strong>adiantada</strong> recebe token de sessão que já nasce vencido:
            ela renova em laço, estoura o limite do servidor e derruba a sessão de quem está
            na mesma rede — inclusive de quem está com a hora certa.
          </p>
        </div>
        <button
          onClick={carregar}
          className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-300 hover:text-accent transition-colors flex items-center gap-2"
        >
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { rotulo: 'Estações vistas', valor: ordenadas.length, cor: 'text-gray-200', Icone: Monitor },
          { rotulo: 'Fora de hora',    valor: foraDeHora,       cor: foraDeHora ? 'text-yellow-400' : 'text-emerald-400', Icone: foraDeHora ? AlertTriangle : ShieldCheck },
          { rotulo: 'Derrubam sessão', valor: graves,           cor: graves ? 'text-red-400' : 'text-emerald-400', Icone: graves ? AlertTriangle : ShieldCheck },
        ].map(({ rotulo, valor, cor, Icone }) => (
          <div key={rotulo} className="neu-card rounded-2xl p-4">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              <Icone size={13} /> {rotulo}
            </div>
            <div className={`text-2xl font-black mt-1 ${cor}`}>{valor}</div>
          </div>
        ))}
      </div>

      {carregando ? (
        <LoadingSpinner />
      ) : ordenadas.length === 0 ? (
        <EmptyState
          message="Nenhuma estação registrada ainda. Cada máquina aparece aqui depois que alguém entrar nela."
          error={erro}
        />
      ) : (
        <div className="space-y-2">
          {ordenadas.map((m, i) => {
            const g = gravidade(m.offset_ms);
            const estilo = ESTILO[g];
            const Icone = m.compartilhada === false ? Smartphone : Monitor;
            return (
              <motion.div
                key={m.maquina_id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
                className="neu-card rounded-2xl p-4 flex items-center gap-4 flex-wrap"
              >
                <div className="w-9 h-9 rounded-xl neu-pressed flex items-center justify-center shrink-0">
                  <Icone size={16} className={estilo.texto} />
                </div>

                <div className="flex-1 min-w-[10rem]">
                  <div className="text-sm font-bold text-gray-200 flex items-center gap-2 flex-wrap">
                    {/* O id inteiro é um uuid: os 8 primeiros já distinguem as
                        máquinas de uma turma e cabem na linha. */}
                    <span className="font-mono">{m.maquina_id.slice(0, 8)}</span>
                    <span className="text-[11px] font-medium text-gray-500">
                      {navegadorCurto(m.navegador)}{m.plataforma ? ` · ${m.plataforma}` : ''}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>Último acesso: {m.ultimo_usuario ?? '—'}</span>
                    {m.filial && <FilialBadge filial={m.filial} />}
                    <span>· medido {quandoFoi(m.medido_em)}</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className={`text-sm font-black ${estilo.texto}`}>
                    {g === 'ok' ? 'Na hora' : descreveDesvio(m.offset_ms)}
                  </div>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-lg text-[10px] font-bold ${estilo.chip}`}>
                    {estilo.rotulo}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-gray-500 leading-relaxed max-w-2xl">
        O LogMax funciona mesmo na estação fora de hora — ele ancora a própria noção de tempo
        no servidor. O que continua errado é o Windows dela: horário de arquivo, de e-mail e de
        qualquer outro programa. Correção na máquina: <strong>Configurações → Hora e idioma →
        Data e hora</strong>, fuso <strong>(UTC-05:00) Rio Branco</strong> e sincronizar.
      </p>
    </div>
  );
}
