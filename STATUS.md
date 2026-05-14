# LogMax — Status do Projeto (2026-05-13)

## Resumo rápido

| Área | Estado |
|---|---|
| Auth (login/logout) | ✅ Feito |
| CRUD de dados (Supabase) | ✅ Feito |
| Exportação PDF/Excel | ✅ Feito |
| Validação de formulários | ✅ Feito |
| Dashboard conectado a dados reais | ✅ Feito |
| Tela Início conectada a dados reais | ✅ Feito |
| Código morto (`ENDPOINTS` mock) removido | ✅ Feito |
| Configuração Supabase (conta + `.env`) | ❌ Pendente |
| 9 views ainda são Placeholder | ❌ Pendente |
| Layout responsivo (mobile) | ✅ Feito |
| Deploy Netlify | ❌ Pendente |
| Code splitting (bundle) | ⚠️ Opcional |
| RLS no Supabase | ⚠️ Opcional |

---

## O que está feito

### Fase 2 — entregue
- **Auth guard** — `useAuth.ts` verifica sessão Supabase antes de renderizar o app
- **LoginScreen** — tela de login com validação de campos, tratamento de erros de autenticação
- **Logout funcional** — botão "Sair" na sidebar e no header chama `signOut()` do Supabase
- **Header com usuário logado** — mostra o e-mail/nome da sessão ativa
- **`useFetchData`** lê do Supabase real via `ENDPOINT_TABLE_MAP` (não usa mais mock de `setTimeout`)
- **`dbInsert` / `dbUpdate` / `dbDelete` / `dbSetStatus`** — funções CRUD completas para todas as views
- **Validação de formulários** — hook `useFormValidation` + componente `FormField` com erro inline
- **Exportação PDF** — `jsPDF + autoTable`, com header timbrado LogMax
- **Exportação Excel** — `xlsx`, sheet nomeado
- **PWA** — `manifest.json` + `vite-plugin-pwa` instalado
- **Supabase client graceful** — app abre normalmente sem `.env` (não quebra, avisa no console)

### Correções de bugs (2026-05-13)
- **`DashboardAnalyticsView` conectada** — substituiu `useFetchData('/api/dashboard')` (endpoint inexistente) por 4 fetches reais (`contas_receber`, `contas_pagar`, `pedidos`, `produtos`); cards, gráfico mensal e feed de movimentações calculados no frontend
- **`InicioView` conectada** — substituiu `data = null` hardcoded por 3 fetches reais (`contas_receber`, `notas_recebidas`, `pedidos`); seção "Resumo Diário" agora sempre aparece com dados reais
- **`ENDPOINTS` mock removido** — bloco de código morto (42 entradas, ~42 linhas) deletado de `App.tsx`

### Menu mobile (2026-05-13)
- **Sidebar responsiva** — desktop: `hidden lg:flex` (sempre visível); mobile: oculta por padrão
- **Overlay animado** — `motion.aside` com slide-in da esquerda + backdrop `bg-black/60`; fecha ao clicar fora, no X ou em qualquer item de menu
- **Botão hamburger** — `Menu` icon no header, visível apenas em `< lg` (`lg:hidden`)

---

## O que falta fazer

### 1. Configurar Supabase (bloqueante para tudo)

Sem isso, todos os dados aparecem vazios.

**Passos:**
1. Criar conta em [supabase.com](https://supabase.com) e criar um novo projeto
2. No SQL Editor do Supabase, rodar o arquivo `logmax_supabase_schema.sql` (já existe na raiz)
3. Criar o arquivo `.env` na raiz do projeto com:
   ```
   VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co
   VITE_SUPABASE_ANON_KEY=<sua-anon-key>
   ```
4. Criar um usuário em **Authentication → Users → Invite** no painel Supabase
5. Reiniciar o dev server (`npm run dev`)

---

### 2. Implementar as 9 views que ainda são Placeholder

Todas retornam a tela "Módulo em Desenvolvimento":

| Menu | Submenu | Endpoint necessário |
|---|---|---|
| Compras | Sugestões de Compras | `/api/sugestoescomprasview` |
| Compras | Planejamento Orçamentário | `/api/orcamento` |
| Compras | Gerenciamento | `/api/gerenciamentocomprasview` |
| Compras | Relatórios | `/api/relatorioscomprasview` |
| Estoque | Gerenciamento | `/api/gerenciamentoestoqueview` |
| Estoque | Relatórios | `/api/relatoriosestoqueview` |
| Financeiro | Integração Bancária | `/api/integracaobancariaview` |
| Financeiro | Gerenciamento | `/api/gerenciamentofinanceiroview` |
| Financeiro | Relatórios | `/api/relatoriosfinanceiroview` |

> As views de Relatórios e Gerenciamento podem ser implementadas como `GenericCRUDView` ou views somente-leitura com filtros, pois o padrão já existe no código.

---

### 3. Deploy no Netlify

**Passos:**
1. Criar conta em [netlify.com](https://netlify.com)
2. Conectar o repositório (ou fazer upload da pasta `dist` após `npm run build`)
3. Definir as variáveis de ambiente no painel:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Criar `netlify.toml` na raiz para que o roteamento SPA funcione:
   ```toml
   [[redirects]]
     from = "/*"
     to = "/index.html"
     status = 200
   ```
5. Fazer o deploy

> Sem o `netlify.toml`, qualquer refresh ou link direto na aplicação retorna 404.

---

## Itens opcionais (Fase 3)

| Item | Esforço | Impacto |
|---|---|---|
| Code splitting — dividir App.tsx em arquivos separados | Alto | Performance do bundle inicial |
| RLS (Row Level Security) no Supabase | Médio | Segurança multi-tenant |
| Integração Bitrix24 (card na tela Início) | Alto | Feature nova |
| Sugestões de compras automáticas | Alto | Feature nova |
| Filtros de período no Dashboard | Médio | UX |

---

## Ordem recomendada de execução

```
1. Criar conta Supabase + rodar schema SQL + criar .env   (desbloqueador — ação do usuário)
2. Criar usuário no Supabase Auth e testar login           (ação do usuário)
3. Implementar as 9 views Placeholder (uma por uma)
4. Criar netlify.toml                                      (arquivo simples, 3 linhas)
5. Deploy no Netlify + variáveis de ambiente               (ação do usuário)
```
