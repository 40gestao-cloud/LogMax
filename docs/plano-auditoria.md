# Plano — Auditoria de quem fez a ação (LogMax)

> **Estado em 2026-08-18 (migr. 468).** As colunas de auditoria descritas aqui
> (`criado_por`, `atualizado_por`, `updated_at`) continuam em uso e valendo. O
> **componente `AuditoriaInspect` foi aposentado**: a trilha
> `historico_operacoes` (migr. 331/332/337/468) cobre todas as tabelas que ele
> atendia, já traz a criação como primeira linha e é lida por quem opera a
> unidade — e não só pela Matriz. Quem for implementar autoria numa tela nova
> deve usar `<HistoricoOperacoes>`, não recriar o popover deste plano.

## Contexto e decisões já tomadas

- **Escopo**: módulos críticos primeiro — Financeiro, Vendas/PDV, Estoque, Compras. Marketing/RH/TI ficam para uma fase posterior.
- **Informações exibidas**: quem criou + data/hora + quem editou pela última vez + data/hora da edição.
- **RBAC do gerente**: o ícone só revela informação quando o autor da ação pertence ao mesmo setor do gerente (ou setores extras dele). Admin/CEO veem tudo. Quando o autor não está no setor do gerente, o ícone simplesmente não renderiza naquela linha.
- Padrão atual no schema é inconsistente: `criado_por` existe só em `ti_chamados`, `desenvolvimentos_ia`, `user_profiles`; o resto não rastreia autoria. Será necessário SQL.

## Tabelas no escopo da Fase 1

| Módulo | Tabelas |
|---|---|
| **Financeiro** | `contas_pagar`, `contas_receber`, `controle_caixa`, `previsoes`, `duplicatas`, `caixa_bancos`, `folha_pagamento`, `vencimentos_estoque` |
| **Vendas/PDV** | `vendas`, `orcamentos`, `pedidos_venda` (itens filhos seguem o pai — não auditamos `itens_venda` separado) |
| **Estoque** | `movimentacoes_estoque`, `requisicoes_estoque`, `expedicao`, `inventarios` |
| **Compras** | `requisicoes`, `cotacoes`, `pedidos`, `recebimentos`, `notas_recebidas` |

Total: ~21 tabelas.

## Mudanças de schema (1 migração idempotente)

`supabase/migrations/2026XXXX_auditoria_quem_fez.sql`:

```sql
-- 1) Função reutilizável (idempotente)
CREATE OR REPLACE FUNCTION set_auditoria_campos()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.criado_por     := COALESCE(NEW.criado_por,     auth.uid());
    NEW.atualizado_por := NEW.criado_por;
    NEW.created_at     := COALESCE(NEW.created_at, now());
    NEW.updated_at     := NEW.created_at;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.atualizado_por := auth.uid();
    NEW.updated_at     := now();
  END IF;
  RETURN NEW;
END $$;

-- 2) Para cada tabela:
ALTER TABLE <tab> ADD COLUMN IF NOT EXISTS criado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE <tab> ADD COLUMN IF NOT EXISTS atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE <tab> ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now();
-- (created_at já existe em todas — índices em 027_20260522b)
DROP TRIGGER IF EXISTS trg_auditoria ON <tab>;
CREATE TRIGGER trg_auditoria
  BEFORE INSERT OR UPDATE ON <tab>
  FOR EACH ROW EXECUTE FUNCTION set_auditoria_campos();
```

Aplicado para as 21 tabelas. SET NULL evita que excluir um usuário derrube o histórico.

**Risco**: `updated_at` pode já existir em algumas tabelas com nome diferente. Antes de rodar, audito coluna-a-coluna (script de verificação no início da migração).

## Componente UI reutilizável

`src/components/AuditoriaInspect.tsx`:

```tsx
type Props = {
  criadoPor?: string | null;       // uuid
  criadoEm?: string | null;        // ISO
  atualizadoPor?: string | null;
  atualizadoEm?: string | null;
};
export const AuditoriaInspect: React.FC<Props> = ({ ... }) => {
  const { canSee, dados } = useAuditoriaVisivel({ criadoPor, atualizadoPor });
  if (!canSee) return null;       // gerente fora do setor: ícone some
  // Ícone pequeno (Lucide Info / History) + popover com:
  //   "Criado por <nome do criador> · <data/hora Acre>"
  //   "Última edição por <nome> · <data/hora Acre>"
  return <Popover anchor={<History size={12} />}>...</Popover>;
};
```

- Estilo neu-* coerente com o resto da UI.
- Datas formatadas com `formatDataAcre` (já existe na lib).
- `useAuditoriaVisivel` é um novo hook em `src/hooks/`.

## Hook de permissão

`src/hooks/useAuditoriaVisivel.ts`:

```ts
export function useAuditoriaVisivel({ criadoPor, atualizadoPor }) {
  const { profile } = useUserProfile();
  // admin/CEO sempre veem
  if (profile?.role === 'admin' || profile?.role === 'ceo') return { canSee: true, ... };
  if (profile?.role !== 'gerente') return { canSee: false };
  // Gerente: precisa que TANTO o criador QUANTO o último editor estejam no setor dele.
  // Faz um cache RPC `usuarios_por_setor()` que devolve {id, nome, setor} dos
  // colaboradores que o gerente vê (segue allSetores(profile)).
  const visiveis = useColaboradoresVisiveis(profile);
  const ok = (uid?: string|null) => !uid || visiveis.has(uid);
  return { canSee: ok(criadoPor) && ok(atualizadoPor), ... };
}
```

RPC `usuarios_visiveis_para_gerente()` em SQL devolve apenas users dos setores em que o gerente atua (caching de 5 min no client).

## Onde encaixar o ícone

Padrão: na ÚLTIMA coluna de cada tabela das listagens, ao lado dos botões de ação (Editar/Excluir). Em telas de detalhe (Pedido, Venda), no header da card ao lado do código.

Inserções pontuais (~12 arquivos):

- `ContasPagarView`, `ContasReceberView`, `ControleCaixaView`, `PrevisoesView` (genérica), `DuplicatasView`, `CaixaBancosView`, `FolhaPagamentoView`, `VencimentosEstoqueView`
- `HistoricoVendasView`, `OrcamentosView`, `PedidosVendaView`, `PDVView` (no detalhe da venda)
- `MovimentacoesEstoqueView`, `RequisicoesEstoqueView`, `ExpedicaoView`, `InventariosView`
- `RequisicoesView`, `CotacoesView`, `PedidosView`, `RecebimentosView`, `NotasRecebidasView`

Cada inserção é `<AuditoriaInspect criadoPor={row.criado_por} criadoEm={row.created_at} ... />` — uma linha.

## RLS

Mantém policies atuais. Os campos novos são lidos com o restante da linha. O hook `useAuditoriaVisivel` filtra **apresentação**, não segurança — a RLS não precisa mudar.

## Endpoints

Os endpoints `/api/<view>` em `api/` usam `select=*` (passa colunas novas direto). Verificar se algum endpoint customizado faz select explícito por coluna e precisaria adicionar `criado_por,atualizado_por,updated_at`.

## Fases de entrega

1. **Migração SQL + RPC `usuarios_visiveis_para_gerente`** — uma PR isolada, com script de verificação.
2. **Componente + hook** — uma PR só com a infraestrutura; fácil de revisar isolado.
3. **Encaixe nas Views** — 4 PRs por módulo (Financeiro, Vendas, Estoque, Compras), permitindo reverter por módulo se algo der errado.

## Riscos / pontos abertos

- **Triggers ativos em produção**: a migração toca 21 tabelas. Idempotente, mas vale rodar em janela combinada.
- **Linhas legadas**: `criado_por` ficará NULL nas linhas existentes. O componente trata `null` exibindo "Autor desconhecido (linha legada)".
- **Performance do popover**: cada linha faz lookup do nome. Resolver via mesmo cache do `usuarios_visiveis_para_gerente` + um `usuarios_basic()` que devolve `{id, nome}` para admin/CEO (eles não têm o filtro de setor).
- **Marketing/RH/TI fora desta fase**: confirmar que está ok não rastrear ainda — caso contrário, expandir a lista de tabelas.

## Não-objetivos desta fase

- **Histórico completo de edições (diffs)** — descartado nas perguntas iniciais.
- **Auditoria de DELETE** — soft-delete já cobre o "quem inativou" via `atualizado_por` no momento do `ativo=false`. Hard delete não é coberto (não há linha pra mostrar).
- **Auditoria de leitura** — fora de escopo.
