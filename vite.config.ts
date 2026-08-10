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
        // 'autoUpdate' desde 2026-08-10. Era 'prompt' (banner "Nova versão
        // disponível", vide PwaUpdatePrompt.tsx), e o preço apareceu no
        // primeiro fix de service worker: a correção só alcançava quem
        // clicasse no banner, então a turma que adiava continuava rodando o SW
        // com o bug — no caso, o que servia a `aula_config` de antes do Modo
        // Aula. Numa sala de aula ninguém lê banner, e o custo de um reload
        // inesperado é menor que o de metade da turma em outra versão.
        registerType: 'autoUpdate',
        includeAssets: ['icon-logmax.png', 'icon-logmax-modoclaro.png'],
        manifest: false, // usamos o public/manifest.json manual
        workbox: {
          // json incluído para precachear manifest.json e simulador-manifest.json
          // (segundo PWA do /simulador-pagamento — vide SimuladorPagamentoView).
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
          // pdf.js é pesado e só serve quando alguém abre um PDF. Fora do
          // precache para não inflar o payload inicial da PWA de todo mundo — o
          // chunk baixa on-demand (o NetworkFirst do supabase-api não pega
          // ativo estático).
          //
          // As entradas de `vendor-univer-*` saíram em 2026-07-29 com Max Docs e
          // Max Planilhas; sem os dois módulos, nenhum chunk desse nome nasce.
          globIgnores: ['**/vendor-pdfjs-*.js', '**/pdf.worker*.js', '**/pdf.worker*.mjs'],
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
      visualizer({
        filename: 'bundle-stats.html',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }),
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
