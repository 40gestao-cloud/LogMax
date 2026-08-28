// Reporte do relógio da estação para a tela de TI.
//
// O app já não depende do relógio local (`horaServidor.ts` ancora o `Date` no
// servidor). Mas "não depender" esconde o defeito: a máquina segue com a hora
// errada para tudo o que não é o LogMax, e ninguém fica sabendo. Este módulo
// entrega a medição que já foi feita no boot para
// `Sessões Gerais → TI & Suporte → Relógio das Máquinas`, onde o professor vê
// o parque inteiro sem depender de aluno relatando sintoma.
//
// Uma vez por sessão, depois do perfil carregado — antes disso a RPC recusaria
// (ela lê `auth.uid()` para carimbar quem estava na máquina).

import { supabase } from './supabase';
import { aguardarMedicao, idDaMaquina } from './horaServidor';
import { isDispositivoCompartilhado } from './sessaoGuard';

let jaReportou = false;

function plataforma(): string | null {
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
  return ua.userAgentData?.platform ?? navigator.platform ?? null;
}

export async function reportarRelogioDaMaquina(): Promise<void> {
  if (jaReportou || !supabase) return;
  jaReportou = true;

  const medido = await aguardarMedicao();
  // Sem medição não há notícia: registrar 0 aqui seria dizer "esta máquina está
  // certa" quando o que houve foi falta de rede.
  if (medido === null) { jaReportou = false; return; }

  const maquina = idDaMaquina();
  if (!maquina) return;  // navegador em modo privado: sem id estável

  // Falha de rede/RLS aqui não pode atrapalhar quem está usando o sistema —
  // é diagnóstico, não operação.
  const { error } = await supabase.rpc('registrar_relogio_maquina', {
    p_maquina_id:    maquina,
    p_offset_ms:     Math.round(medido),
    p_navegador:     navigator.userAgent.slice(0, 120),
    p_plataforma:    plataforma(),
    p_compartilhada: isDispositivoCompartilhado(),
  });
  if (error) jaReportou = false;  // deixa a próxima sessão tentar de novo
}
