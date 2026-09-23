import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Carrega .env.test em dev local. Em CI as vars vêm de env nativo (GitHub secrets).
config({ path: '.env.test' });

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Há credenciais para falar com o Supabase de verdade?
 *
 * Antes, faltar `.env.test` derrubava as suítes de integração no import, e
 * `npm test` terminava com "5 failed" em toda máquina sem banco à mão. Ruído
 * permanente é pior que teste ausente: quando uma falha real aparecesse, ela
 * estaria no meio das cinco de sempre e ninguém olharia.
 *
 * Agora as suítes que precisam de banco se PULAM sozinhas — mas só fora do CI.
 */
export const TEM_BANCO = !!url && !!serviceKey;

// GitHub Actions define CI=true. Lá as credenciais vêm de secrets, e pular em
// silêncio seria pior ainda: o CI passaria verde sem ter testado nada.
const NO_CI = process.env.CI === 'true' || process.env.CI === '1';

/**
 * `LOGMAX_SUITE=unidade` diz: este job é o de UNIDADE, e a falta de banco aqui
 * é o combinado, não um acidente.
 *
 * Por que isto passou a existir. A regra acima estava certa no princípio e
 * errada no efeito. O `test.yml` tinha um job só, que rodava `npm test`
 * inteiro; sem os secrets cadastrados ele morria AQUI, no import, antes de
 * qualquer teste começar. Resultado medido em 23/09: os oito últimos commits
 * do repo com o CI vermelho, e os ~384 testes que não precisam de banco nenhum
 * nunca executados em CI. Alarme sempre vermelho informa tanto quanto alarme
 * sempre verde — ninguém conseguia olhar o CI e saber se um push quebrou algo.
 *
 * O combinado agora é entre DOIS jobs, e é o outro que protege esta régua:
 *   · `unidade`   — sem segredo, com este opt-out, obrigatório. Verde aqui
 *                   significa "os testes que não precisam de banco passaram",
 *                   o que é uma afirmação verdadeira e útil.
 *   · `integracao`— sem o opt-out. Com secrets, roda de verdade e falha de
 *                   verdade; sem eles, avisa em voz alta no resumo da execução.
 *
 * Ou seja: continua não existindo caminho em que a suíte de integração
 * desapareça em silêncio. O que mudou é que a ausência dela deixou de cegar o
 * resto. Quem mexer nisto tem de manter os dois lados — tirar o job de
 * integração e deixar só o opt-out é o cenário que a régua original proíbe.
 */
const SUITE_UNIDADE = process.env.LOGMAX_SUITE === 'unidade';

if (!TEM_BANCO && NO_CI && !SUITE_UNIDADE) {
  throw new Error(
    'VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no CI. ' +
    'Configure os secrets no GitHub — pular os testes de integração aqui esconderia regressão. ' +
    '(No job de unidade, que roda de propósito sem banco, use LOGMAX_SUITE=unidade.)',
  );
}

if (!TEM_BANCO) {
  console.warn(
    '\n[integração] .env.test ausente — as suítes que falam com o Supabase serão PULADAS.\n' +
    '             Copie .env.test.example para .env.test para rodá-las localmente.\n',
  );
}

// Stub: existe só para o `import { supabase }` não quebrar quando não há
// credenciais. Os testes que o usariam estão pulados, então nenhum método chega
// a ser chamado — e se algum chegar, o erro diz exatamente o que aconteceu em
// vez de estourar um `undefined is not a function` três camadas abaixo.
const semBanco = new Proxy({}, {
  get(_alvo, prop) {
    throw new Error(
      `Supabase indisponível (sem .env.test): tentou usar "${String(prop)}" ` +
      'num teste que deveria estar pulado. Use `describe.skipIf(!TEM_BANCO)`.',
    );
  },
}) as SupabaseClient;

// Service role bypassa RLS — necessário para setup/teardown de testes.
export const supabase: SupabaseClient = TEM_BANCO
  ? createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : semBanco;
