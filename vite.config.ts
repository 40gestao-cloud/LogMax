import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // 'prompt' desde 2026-08-24 — mas quem decide quando aplicar é o
        // PwaUpdatePrompt, não o utilizador. Leia o cabeçalho dele: continua
        // automático, só que espera o primeiro momento seguro em vez de
        // recarregar no meio da venda do aluno.
        //
        // Histórico: era 'prompt' até 10/08, quando virou 'autoUpdate' porque
        // a correção só alcançava quem clicasse no banner e metade da turma
        // ficou com o service worker antigo (o que servia `aula_config` de
        // antes do Modo Aula). O 'autoUpdate' resolveu isso e trouxe o outro
        // preço: reload instantâneo apaga carrinho, lote de requisições e
        // contagem de inventário. 'prompt' aqui NÃO significa esperar clique —
        // significa que o reload passa pela nossa régua antes de acontecer.
        registerType: 'prompt',
        includeAssets: ['icon-logmax.png', 'icon-logmax-modoclaro.png'],
        manifest: false, // usamos o public/manifest.json manual
        workbox: {
          // O precache carrega SÓ o que o boot exige. Os ~200 chunks de view
          // ficam de fora de propósito, e o motivo é medido, não estimado.
          //
          // Em 2026-09-09 a cota de edge requests da Vercel estava em 649 mil /
          // 1 milhão no mês. A aba Routes do Observability (logmax-erp, 12h,
          // 2,3 mil requisições) mostrava CADA chunk de view com exatamente 8
          // requisições: RelatoriosComprasView 8, RecrutamentoView 8,
          // RecibosVendasView 8, e assim por ~200 arquivos. Esse 8 uniforme não
          // é uso — é o número de máquinas que instalaram o service worker no
          // período. Todo chunk recebia o mesmo número porque o precache
          // baixava os 200 para todo mundo, independente de quem abria o quê.
          // Eram ~1.600 das 2,3 mil requisições: 70% da cota gasta baixando
          // tela que ninguém abriu.
          //
          // O que sobrou aqui são os 5 arquivos que o index.html referencia no
          // boot (entry, vendor-react, vendor-supabase, vendor-motion, css) —
          // confira com `grep '/assets/' dist/index.html` se mexer nos
          // manualChunks. Se um vendor novo entrar no boot e NÃO for listado
          // aqui, o app deixa de abrir offline: adicione o padrão junto.
          //
          // O preço: uma tela nunca visitada naquela máquina precisa de rede na
          // primeira abertura. Depois disso o CacheFirst de runtimeCaching
          // abaixo a guarda. Cada aluno paga uma vez por tela, por máquina.
          //
          // json incluído para precachear manifest.json e simulador-manifest.json
          // (segundo PWA do /simulador-pagamento — vide SimuladorPagamentoView).
          globPatterns: [
            '**/*.{css,html,svg,png,ico,woff2,json}',
            'assets/entry-*.js',
            'assets/vendor-react-*.js',
            'assets/vendor-supabase-*.js',
            'assets/vendor-motion-*.js',
          ],
          // pdf.js é pesado e só serve quando alguém abre um PDF. Fora do
          // precache para não inflar o payload inicial da PWA de todo mundo — o
          // chunk baixa on-demand (o NetworkFirst do supabase-api não pega
          // ativo estático).
          //
          // As entradas de `vendor-univer-*` saíram em 2026-07-29 com Max Docs e
          // Max Planilhas; sem os dois módulos, nenhum chunk desse nome nasce.
          globIgnores: ['**/vendor-pdfjs-*.js', '**/pdf.worker*.js', '**/pdf.worker*.mjs'],
          runtimeCaching: [
            // Os chunks que saíram do precache acima. CacheFirst é seguro aqui e
            // só aqui: o nome do arquivo carrega o hash do conteúdo, então uma
            // build nova gera um nome novo — nunca existe versão velha servida
            // sob o mesmo endereço. Um chunk baixado é um chunk final.
            //
            // O predicado é deliberadamente estreito (mesma origem E /assets/):
            // ele NÃO pode alcançar o Supabase, pelo motivo escrito logo abaixo.
            //
            // maxEntries poda por LRU o acúmulo de builds antigas; 300 cabe o
            // conjunto de uma build (~215 arquivos) com folga durante a troca.
            {
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && url.pathname.startsWith('/assets/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'chunks-lazy',
                expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
          // NÃO existe runtimeCaching para o Supabase, e é decisão, não esquecimento.
          //
          // Havia um NetworkFirst em `*.supabase.co/*` (cacheName 'supabase-api',
          // maxAge 300s). NetworkFirst devolve o cache quando a rede falha — e na
          // internet da sala isso acontece o tempo todo. Em 2026-08-10 o
          // professor ligou o Modo Aula, a turma abriu o LogMax e continuou
          // vendo TODOS os módulos; só Ctrl+Shift+R corrigia — que é
          // exatamente o recarregamento que ignora o service worker. Uma
          // resposta de `aula_config` gravada antes do interruptor explica
          // essa assinatura.
          //
          // Resposta de API sob RLS não é ativo estático: ela expressa permissão
          // e estado, e servir a versão de cinco minutos atrás é servir a
          // permissão de cinco minutos atrás. Sem entrada de runtimeCaching o
          // workbox nem intercepta essas requisições — vão direto à rede.
        },
        // Service worker DESLIGADO em dev por padrão.
        //
        // Com `enabled: true`, o workbox registra o SW no `vite dev` e passa a
        // interceptar cada request do servidor — e em dev o Vite serve um
        // módulo por arquivo, não os chunks empacotados. São milhares de
        // requests atravessando o SW, mais a revalidação do NetworkFirst do
        // supabase-api por cima. O sintoma é o dev server engasgando em
        // qualquer tela, enquanto a produção (onde o bundle é empacotado) vai
        // bem — que é exatamente a assimetria relatada.
        //
        // Produção não muda nada: `devOptions` só vale para `vite dev`. Para
        // testar banner de atualização/offline, rode com VITE_PWA_DEV=true.
        devOptions: {
          enabled: env.VITE_PWA_DEV === 'true',
        },
      }),
      // Gera bundle-stats.html (project root, fora de /dist) com treemap do
      // que está em cada chunk. Ferramenta de análise local — NÃO deve ser
      // deployada nem incluída no PWA precache.
      //
      // Roda só sob pedido. Estava ligado em TODO build, inclusive o da
      // Vercel, que gerava 1,7 MB de treemap a cada deploy — um artefato que
      // só se abre localmente. O motivo é esse e só esse: não fazer trabalho
      // que ninguém consome no CI.
      //
      // NÃO é otimização de tempo de build. A hipótese era que `gzipSize` +
      // `brotliSize` (que comprimem cada um dos ~3800 módulos) dominassem o
      // tempo, mas a medição não sustenta: 3m33s COM o plugin, 6m19s SEM, na
      // mesma máquina. A variação do hardware é maior que o efeito, então não
      // há ganho demonstrado — e a máquina que interessa é a da Vercel, que
      // daqui não se mede. Se algum dia o tempo de build incomodar, comece
      // por medir lá, não por aqui.
      //
      //   ANALYZE=true npm run build           (bash)
      //   $env:ANALYZE='true'; npm run build   (PowerShell)
      //
      // ou ANALYZE=true no .env, para quem analisa com frequência.
      ...(env.ANALYZE === 'true' ? [visualizer({
        filename: 'bundle-stats.html',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      })] : []),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    // Em build de produção, esbuild remove todas as chamadas console.* e
    // `debugger`. Mantemos os logs no código pra DX em dev (HMR, mode!=='build'
    // mantém intactos), mas o bundle de produção fica limpo — evita vazar
    // payload/PII em telas de QA/cliente e reduz tamanho de bundle.
    // Erros críticos seguem sendo capturados pelo Sentry (lib/sentry.ts) via
    // window.onerror / unhandledrejection, sem depender de console.error.
    esbuild: mode === 'production' ? { drop: ['console', 'debugger'] } : undefined,
    build: {
      rollupOptions: {
        output: {
          // O entry tem nome próprio para o precache do workbox conseguir
          // apontá-lo sozinho. Com o padrão do Rollup ele sai como
          // `index-[hash].js`, e `assets/index-*.js` no globPatterns arrastava
          // junto três chunks lazy de módulos cujo arquivo também se chama
          // index (471 KB baixados por toda máquina, sem uso).
          entryFileNames: 'assets/entry-[hash].js',
          manualChunks(id) {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'vendor-react';
            if (id.includes('node_modules/motion/')) return 'vendor-motion';
            if (id.includes('node_modules/@supabase/')) return 'vendor-supabase';
            // O chunk `vendor-univer` saiu em 2026-07-29 junto com Max Docs e Max
            // Planilhas. Se o Univer voltar algum dia: TODO @univerjs/* precisa
            // cair no MESMO chunk. Separar por sub-package (docs, docs-ui, core,
            // ui...) faz o Rollup criar singletons duplicados quando um editor
            // importa direto de '@univerjs/docs' além do preset — o command
            // service da ribbon fica num Univer, o documento no outro, e Bold,
            // Itálico, Ctrl+Z e Inserir tabela viram noop.
            if (id.includes('node_modules/pdfjs-dist')) return 'vendor-pdfjs';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      port: 3000,
      host: '0.0.0.0',
    },
  };
});
