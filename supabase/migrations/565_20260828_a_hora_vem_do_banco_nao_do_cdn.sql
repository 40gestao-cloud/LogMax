-- A hora de referência passa a vir do banco, não do CDN.
--
-- A migr. 563 pôs de pé a tela "Relógio das Máquinas", e ela mentiu no primeiro
-- dia: celulares e desktops com a hora certa apareciam "10 min atrasados".
--
-- A culpa era da fonte. O cliente media o desvio contra o header `Date` de uma
-- resposta do próprio domínio, e esse caminho passa pelo CDN da Vercel — onde
-- `Date` não é relógio. Medido em 28/08, a MESMA rota devolveu:
--
--   • `X-Vercel-Cache: HIT`, `Age: 901`, `Date` preservado e 15 min no passado;
--   • `X-Vercel-Cache: HIT`, `Age: 770`, `Date` fresco (hora real).
--
-- Somar o `Age` acerta o primeiro caso e erra o segundo em 13 min; ignorá-lo
-- faz o inverso. Não existe fórmula que sirva para os dois, porque a informação
-- que falta (o carimbo é do objeto ou da resposta?) não vem na resposta.
--
-- O corpo de uma resposta ninguém reescreve no caminho. Esta função devolve o
-- `now()` do Postgres, e o cliente compara com o relógio dele descontando meia
-- viagem de rede. De quebra, o relógio consultado passa a ser o MESMO que
-- assina o `exp` do token de sessão — que é a conta que derruba o aluno de
-- volta para a tela de login quando a máquina está adiantada.
--
-- `anon` executa de propósito: a ancoragem acontece no boot, antes de existir
-- sessão. O que vaza é a hora do servidor, que qualquer resposta HTTP já
-- entrega. STABLE e sem argumentos — nada a injetar.

BEGIN;

CREATE OR REPLACE FUNCTION public.hora_servidor()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT now();
$function$;

COMMENT ON FUNCTION public.hora_servidor() IS
  'Hora do servidor para o cliente ancorar o próprio relógio (src/lib/horaServidor.ts). No corpo, e não em header, porque o header Date passa pelo CDN e não é confiável.';

REVOKE ALL ON FUNCTION public.hora_servidor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hora_servidor() TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
