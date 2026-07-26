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
        // 'prompt' permite ao app mostrar banner "Nova versão disponível"
        // em vez de atualizar silenciosamente — vide PwaUpdatePrompt.tsx.
        registerType: 'prompt',
        includeAssets: ['icon-logmax.png', 'icon-logmax-modoclaro.png'],
        manifest: false, // usamos o public/manifest.json manual
        workbox: {
          // json incluído para precachear manifest.json e simulador-manifest.json
          // (segundo PWA do /simulador-pagamento — vide SimuladorPagamentoView).
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
          // Max Planilhas usa Univer (~2-3 MB). Excluir do precache pra não
          // inflar o payload inicial da PWA de todo mundo — o chunk baixa
          // on-demand quando o aluno abre Max Planilhas (Runtime cache do
          // NetworkFirst do supabase-api não pega esse ativo estático).
          globIgnores: ['**/vendor-univer-*.js', '**/vendor-univer-*.css', '**/vendor-pdfjs-*.js', '**/pdf.worker*.js', '**/pdf.worker*.mjs'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api',
                expiration: { maxEntries: 50, maxAgeSeconds: 300 },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
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
            // Max Work — TODO @univerjs/* precisa cair no MESMO chunk. Splittar
            // por sub-package (docs, docs-ui, core, ui...) faz Rollup criar
            // singletons duplicados quando MaxDocEditor importa direto de
            // '@univerjs/docs' alem do preset — o command service da ribbon
            // fica num Univer, o doc no outro, e Bold/Italic/Ctrl+Z/Inserir
            // tabela viram noop.
            if (id.includes('node_modules/@univerjs/') || id.includes('node_modules/@univerjs-pro/')) return 'vendor-univer';
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
