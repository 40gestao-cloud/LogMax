# Setup de nova turma (novo Supabase + novo Vercel)

Passo a passo pra subir uma instância nova do LogMax (LogMax-Contabilidade, LogMax-ADM, etc.) partindo do schema atual do **logmax-erp** (projeto de referência).

Substitui o antigo processo de rodar as ~126 migrations em ordem. Objetivo: reduzir setup de "algumas horas ansiedade" pra "20 minutos + um coffee break".

---

## 0. Pré-requisitos (uma vez só)

- Postgres client tools **15+** com `pg_dump` no PATH
  - Windows: [postgresql.org/download/windows](https://www.postgresql.org/download/windows/) → só marca "Command Line Tools" no instalador
  - Verificar: `pg_dump --version` deve mostrar `pg_dump (PostgreSQL) 15.x` ou superior
- Connection string do **logmax-erp** — Supabase Dashboard → Project Settings → Database → Connection string (Session pooler, IPv4)
- Uma conta Vercel com acesso à org do LogMax

---

## 1. Gerar o baseline a partir do logmax-erp

Do repo root:

```powershell
# PowerShell
$env:PGPASSWORD = "senha-do-postgres-do-logmax-erp"
.\scripts\dump-baseline.ps1 -DbUrl "postgresql://postgres.<ref>:...@aws-...supabase.com:6543/postgres"
```

```bash
# Git Bash / Linux / Mac
export PGPASSWORD="senha-do-postgres-do-logmax-erp"
./scripts/dump-baseline.sh "postgresql://postgres.<ref>:...@aws-...supabase.com:6543/postgres"
```

Output: `supabase/baseline_YYYYMMDD.sql` (~2-4k linhas com todo o schema `public`: tabelas, RLS, RPCs, triggers, defaults).

> **Repete só quando quiser rebasear.** Não precisa gerar toda hora — só quando o schema do logmax-erp evolui o bastante pra valer a pena refixar o ponto zero.

---

## 2. Criar o projeto Supabase novo

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Region: **South America (São Paulo)** — mais perto do Acre/Rio Branco
3. Anote:
   - `Project URL` → vira `VITE_SUPABASE_URL`
   - `anon public` key → vira `VITE_SUPABASE_ANON_KEY`
   - `service_role secret` key → vira `SUPABASE_SERVICE_ROLE_KEY`
4. Espera provisionar (~2 min)

---

## 3. Rodar o baseline no novo projeto

No **novo** projeto Supabase → **SQL Editor** → **New query**:

1. Cole o conteúdo de `supabase/baseline_YYYYMMDD.sql` inteiro
2. Run
3. Espera terminar (~30s dependendo do tamanho)

Se der erro de `extension not found` (ex: `uuid-ossp`, `pg_trgm`), habilita em **Database → Extensions** e roda de novo.

---

## 4. Setup dos storage buckets

`pg_dump --schema-only` **não** traz linhas de `storage.buckets` (são dados, não schema). Precisa rodar separado:

No SQL Editor → cole `scripts/setup-buckets.sql` → Run. Cria os 4 buckets do LogMax + policies:

- `produto-imagens` (120 KB, público)
- `perfil-fotos` (150 KB, público, escopado por user_id)
- `banco-logos` (120 KB + SVG, financeiro)
- `categoria-imagens` (1 MB, admin/CEO/logística)

Verificação — deve retornar 4 linhas:

```sql
SELECT id, public, file_size_limit FROM storage.buckets
 WHERE id IN ('produto-imagens','perfil-fotos','banco-logos','categoria-imagens');
```

---

## 5. Criar o Admin Master

1. **Authentication → Users → Add user**
   - Email: email real do admin da turma
   - Password: senha forte
   - **Auto-confirm user** ✅
2. Abre `supabase/migrations/012_20260516_seed_admin_master.sql`, **troca** todas as ocorrências de `admin@example.com` pelo email real
3. Cola no SQL Editor e roda — deve retornar 1 linha com `role=admin, setor=all`

---

## 6. Migrations posteriores ao baseline

Se o `logmax-erp` teve migrations aplicadas **depois** da data do baseline, aplica elas em ordem cronológica na nova instância. Ex.: baseline gerado em `20260701`, aplica todas de `supabase/migrations/2026070*.sql` em diante.

Isso mantém as instâncias em sync sem re-rodar tudo do zero.

---

## 7. Deploy no Vercel

1. [vercel.com](https://vercel.com) → **Import Project** → escolhe o mesmo repo `LogMax`
2. Nome: `logmax-<turma>` (ex: `logmax-contabilidade`)
3. **Environment Variables** — copia de `.env.example` e preenche:
   - `VITE_SUPABASE_URL` — do passo 2
   - `VITE_SUPABASE_ANON_KEY` — do passo 2
   - `SUPABASE_SERVICE_ROLE_KEY` — do passo 2
   - `QR_TOKEN_SECRET` — `openssl rand -hex 32` (ou qualquer 64 hex chars)
   - `VITE_APP_URL` — a URL final do Vercel (após deploy)
   - `GEMINI_API_KEY` — mesma do logmax-erp (compartilhar quota é OK)
   - `GROQ_API_KEY` — mesma
   - `OPENROUTER_API_KEY` — mesma
   - `CRON_SECRET` — `openssl rand -hex 32`
   - `PONTO_*` / `VITE_PONTO_*` — ver `.env.example` + [[project_turmas_e_ponto]] pros horários da turma nova
4. **Deploy**

---

## 8. Sanity check

Depois do deploy:

- [ ] Login com o admin master
- [ ] Cria 1 filial (Empresa → Filiais) — deve refletir imediato
- [ ] Cria 1 usuário colaborador — deve conseguir logar
- [ ] Bate 1 ponto pelo totem — se `PONTO_*` está OK, retorna hora do Acre
- [ ] Abre o Painel BI — deve retornar zeros (sem dados ainda) sem 500
- [ ] Upload de foto no perfil — bucket `perfil-fotos` deve receber

Se tudo passar, a turma está de pé.

---

## Troubleshooting

**"function `auth_in_setor` does not exist"** ao rodar `setup-buckets.sql`
→ os helpers RLS não estão no baseline. Roda antes `supabase/migrations/010_20260516_rls_hardening.sql` e `009_20260516_rls_ceo_role.sql`.

**"permission denied for schema storage"** ao rodar `setup-buckets.sql`
→ você está logado como um role sem privilégio de storage. Use o SQL Editor do Dashboard (roda como service_role automático).

**Painel BI retorna 500 mesmo sem dados**
→ RPC `gerar_painel_bi` está no baseline? `SELECT proname FROM pg_proc WHERE proname='gerar_painel_bi';` — se vazio, roda `086_20260614d_painel_bi.sql`.

**Foto de perfil sobe mas não aparece**
→ o bucket é público (`public=true` em `storage.buckets`)? Sem isso, a URL pública retorna 400.
