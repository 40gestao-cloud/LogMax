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
        includeAssets: ['icon.png', 'logo-login.png'],
        manifest: false, // usamos o public/manifest.json manual
        workbox: {
          // json incluído para precachear manifest.json e simulador-manifest.json
          // (segundo PWA do /simulador-pagamento — vide SimuladorPagamentoView).
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
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
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-motion': ['motion/react'],
            'vendor-supabase': ['@supabase/supabase-js'],
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
