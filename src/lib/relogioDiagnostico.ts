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
import { aguardarMedicao, aoMedir, idDaMaquina } from './horaServidor';
import { isDispositivoCompartilhado } from './sessaoGuard';

let jaReportou = false;

function plataforma(): string | null {
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
  return ua.userAgentData?.platform ?? navigator.platform ?? null;
}

/** Grava a linha desta estação. Falha em silêncio: é diagnóstico, não operação. */
async function gravar(offsetMs: number): Promise<boolean> {
  const maquina = idDaMaquina();
  if (!maquina || !supabase) return false;  // modo privado: sem id estável

  const { error } = await supabase.rpc('registrar_relogio_maquina', {
    p_maquina_id:    maquina,
    p_offset_ms:     Math.round(offsetMs),
    p_navegador:     navigator.userAgent.slice(0, 120),
    p_plataforma:    plataforma(),
    p_compartilhada: isDispositivoCompartilhado(),
  });
  return !error;
}

export async function reportarRelogioDaMaquina(): Promise<void> {
  if (jaReportou || !supabase) return;
  jaReportou = true;

  const medido = await aguardarMedicao();

  // Medição do boot falhou (rede ainda subindo, caso comum no laboratório).
  // Registrar 0 aqui seria dizer "esta máquina está certa" quando o que houve
  // foi falta de rede — então espera-se a medição tardia, a que acontece quando
  // a conexão volta. Sem isto a estação de rede instável, que é a mais
  // suspeita, sumia do painel a sessão inteira.
  if (medido === null) {
    const cancelar = aoMedir(offset => {
      cancelar();
      void gravar(offset).then(ok => { if (!ok) jaReportou = false; });
    });
    return;
  }

  if (!await gravar(medido)) jaReportou = false;  // a próxima sessão tenta de novo
}
