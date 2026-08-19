# LogMax — Mapa de Contexto

ERP PWA didático (React 19 + Vite + Tailwind v4 + Supabase + Vercel). Deploy automático no push para `master` (não rodar `vercel --prod` manual). RBAC por setor + multi-setor já em produção. Operação roda no fuso `America/Rio_Branco` (UTC-5, sem DST).

## O que importa ler

### Código da aplicação (`src/`)
- **`src/App.tsx`** — shell do app: roteamento por `activeView`, sidebar, topbar, sino de notificações, theme toggle, FABs.
- **`src/main.tsx`** + **`src/index.css`** — bootstrap React + estilos globais (variáveis de tema, classes `neu-*` flat, `sidebar-dark`, máscara do ícone de calendário em dark).
- **`src/views/`** — uma view por tela/submenu (~60 arquivos). Cada `*View.tsx` é o ponto de entrada de um módulo (PDV, ControleCaixa, Pedidos, MaxBank/Carteira, Metas, RH, Cadastros, TI etc.). **Comece sempre por aqui** ao mexer numa tela.
- **`src/components/`** — peças globais reutilizadas: `ui.tsx` (design system), `LoginScreen`, `NotificationBell`, `AIAssistantFAB`, `PontoFAB`, `QRScanner`, `PwaUpdatePrompt`, `ErrorBoundary`, `PerfilFotoModal`, `HistoricoOperacoes` (trilha do documento — botão único de auditoria, migr. 331/468).
- **`src/contexts/`** — estado global: `ThemeContext` (dark/light/premium + brightness), `AIAssistantContext` (injeção de contexto da tela no MaxAI).
- **`src/hooks/`** — hooks compartilhados: `useAuth`, `useUserProfile`, `useSupabaseData` (atenção: hard-coded `order('created_at', desc)`), `useNotificacoes` (realtime), `useCaixaAberto`, `useSidebarBadges`, `useGeminiChat`, `useDebouncedValue`.
- **`src/lib/`** — utilitários de domínio. **Ler antes de duplicar lógica**:
  - `supabase.ts` (cliente), `rbac.ts` (`hasSetor`, `hasRole`), `setores.ts`, `sectorAccess.ts`
  - `filiais.ts` (mapa SuperMax/MaxLook/TechMax + prefixo SKU), `cadastrosSelect.ts` (`groupCadastrosParaSelect`)
  - `dates.ts` (fuso Acre), `pontoHorarios.ts`
  - `produtoImagem.ts`, `perfilFoto.ts`, `barcode.ts`, `viewUtils.ts`, `sentry.ts`
- **`src/utils/audioUtils.ts`** — sons de UI (alarm/kaching/timer-end).

### Backend serverless (`api/`)
Endpoints Vercel (Node). Tudo precisa de service-role + checagem RBAC manual:
- `create-user.ts`, `update-user.ts`, `delete-user.ts` — gestão de usuários (admin/CEO).
- `ai-chat.ts`, `ai-models.ts` — MaxAI (cadeia Gemini free `gemini-3.6-flash` → `2.5-flash-lite`, requer `GEMINI_API_KEY`).
- `register-ponto-codigo.ts`, `register-ponto-qr.ts`, `qr-token.ts` — totem de ponto.
- `reverter-promocoes-expiradas.ts` — Vercel Cron (usa `CRON_SECRET` Bearer).

### Libs compartilhadas serverless (`lib/` na raiz)
`auth.ts`, `log.ts`, `ponto.ts` — helpers usados pelos endpoints `api/`. **Não confundir com `src/lib/`** (esse é do frontend).

### Banco de dados (`supabase/migrations/`)
**Fonte da verdade do schema atual.** Arquivos `YYYYMMDD_*.sql` em ordem cronológica. Antes de gerar SQL novo, conferir se já há migração para o assunto — vide [[feedback_migration_nao_aplicada]]. RLS, RPCs (`criar_venda_pdv`, `confirmar_pix_pendente`, `responder_pesquisa`, `dar_feedback_arte`, `reverter_promocoes_expiradas`, `notificar_setor`, `atualizar_avaliacao` etc.) e índices vivem aqui.

### Config e infra
- **`package.json`** — scripts (`dev`, `build`, `lint` = `tsc --noEmit`, `test` = vitest, `drift` = checador de schema).
- **`scripts/schema-drift.mjs`** — `npm run drift` compara o schema das 4 turmas (tabelas, colunas, views, funções, triggers, policies, RLS, grants, constraints, índices, realtime) e sai 1 se algo divergir. Rodar **antes** de escrever migração que dependa de estrutura existente e **depois** de aplicar nos 4. Precisa de `SUPABASE_ACCESS_TOKEN` no `.env`.
- **`vite.config.ts`** — PWA, code-splitting, plugin React, visualizer.
- **`tsconfig.json`**, **`vitest.config.ts`**.
- **`vercel.json`** — rewrites/headers.
- **`index.html`** — meta tags PWA, theme-color anti-FOUC.
- **`public/manifest.json`** + **`public/simulador-manifest.json`** — PWA principal + página `/simulador-pagamento`.
- **`.env.example`** — chaves necessárias (`VITE_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`, `PONTO_*`, `VITE_PONTO_*`).
- **`.github/workflows/test.yml`** — CI (vitest).

### SQL de bootstrap de turma (`docs/setup-turma/`)
15 arquivos SQL + `ordem_execucao_sql.md`. Sequência inicial usada pelo `SETUP_NOVA_TURMA.md` pra criar schema/RLS/seed em cada novo projeto Supabase de turma. **Para schema vigente prefira `supabase/migrations/`** — o bootstrap é um snapshot congelado da fase inicial, não reflete o estado atual do banco.

### Testes (`tests/`)
`pdv.test.ts`, `setup.ts` — cobertura mínima (foco em PDV).

### Docs
- **`docs/plano-auditoria.md`** — escopo de auditoria/RBAC.
- **`STATUS.md`** — snapshot de status (pode estar defasado; conferir git log antes de citar).
- **`CONTEXTO_EVOLUCAO_INTEGRACAO_LOGMAX_MAXBANK.txt`** — notas de integração MaxBank (referência narrativa).

## O que ignorar (em `.claudeignore`)

- `node_modules/`, `dist/`, `dev-dist/`, `.vercel/` — dependências e builds.
- `package-lock.json` — ruído enorme, não edita manualmente.
- `bundle-stats.html` — relatório gerado (1.5 MB).
- `public/sounds/*.mp3`, `public/*.png`, `public/*.svg` — binários/assets.
- `.env`, `.env.test.example` — segredos (manter só `.env.example` legível).
- `.claude/settings.local.json` — preferências pessoais por máquina.
- `.git/` — histórico (usar `git log`/`git diff` via Bash quando precisar).
- `.claudesettings.json.txt` — backup antigo de config.

## Como conversar comigo

Regras de comportamento (calibradas pro Opus 4.8, que por padrão fala demais e pergunta demais):

- **Silêncio entre tool calls é o padrão.** Só escreva texto quando encontrar algo, mudar de direção ou bater num bloqueador — uma frase cada. Sem narração de "Agora vou…", "Deixa eu ver…", "Olhando pra…".
- **Decisões pequenas: decida e siga.** Para escolhas menores (nome de variável, valor default, qual de duas abordagens equivalentes), escolha uma opção razoável e anote em vez de perguntar. Para mudanças de escopo ou ações destrutivas (deletar dados, force push, derrubar migration aplicada), ainda pergunta antes.
