# Plano: igualar a ordem física das colunas nas 4 turmas

**Situação em 27/09/2026:** adiado. O professor decidiu deixar como está por ora e fazer em outro momento.

## Por que fazer

As 4 turmas rodam o mesmo aplicativo e devem ter um banco idêntico. Hoje o `npm run drift` diz "igual nos 4" em tudo, menos numa nota informativa: em 8 tabelas as colunas estão gravadas em ordem diferente.

As colunas são as mesmas nas 4 turmas, com o mesmo nome, tipo, default e nulidade. O que muda é só a posição (`attnum`). Isso vem de `ADD COLUMN`, que sempre acrescenta no fim: as colunas entraram em ordens diferentes em cada banco (bootstrap, correções manuais, migrações aplicadas em sequências distintas).

O app não percebe a diferença, porque o PostgREST acessa as colunas pelo nome. Ela aparece em três casos:
- `CREATE OR REPLACE VIEW` com `SELECT *` pode falhar numa turma e passar em outra (42P16, ver memória `feedback_view_coluna_so_no_fim`);
- `SELECT *` e `COPY` saem em ordens diferentes (exportações, dumps);
- o drift nunca fica 100% limpo, e a nota vira ruído que esconde divergência de verdade.

## Por que não é trivial

O Postgres não tem `ALTER TABLE ... REORDER`. O único jeito de mudar a ordem é **reconstruir a tabela**. Em cada tabela reconstruída é preciso refazer tudo o que depende dela. Contagem na turma Adm:

| Tabela | FKs que apontam para ela | Policies | Gatilhos | Views dependentes |
|---|---|---|---|---|
| produtos | 18 | 7 | 13 | 1 |
| clientes | 7 | 5 | 3 | 0 |
| vendas | 6 | 6 | 5 | 1 |
| fornecedores | 5 | 5 | 3 | 0 |
| pedidos | 3 | 5 | 7 | 1 |
| filiais | 1 | 7 | 2 | 0 |
| marketing_artes | 1 | 7 | 2 | 0 |
| marketing_tarefas | 0 | 7 | 0 | 0 |

Também é preciso refazer os índices, os grants, o `security_invoker` das views, a publicação do realtime, os defaults de sequência e identity e os gatilhos de auditoria (migr. 468).

## Ordem-alvo (qual turma é a referência)

A referência de cada tabela foi escolhida para reconstruir o menor número de bancos. (LogMax-ERP = ERP, Aprendiz e Contabilidade = Apr/Cont.)

| Tabela | Situação hoje | Referência | Reconstruir em |
|---|---|---|---|
| clientes | 3 ordens distintas | Apr/Cont | ERP, Adm |
| filiais | ERP+Adm ≠ Apr/Cont | ERP+Adm | Apr, Cont |
| fornecedores | 3 ordens distintas | Apr/Cont | ERP, Adm |
| marketing_artes | só Adm diverge | ERP | Adm |
| marketing_tarefas | só Adm diverge | ERP | Adm |
| pedidos | ERP+Adm ≠ Apr/Cont | ERP+Adm | Apr, Cont |
| produtos | 3 ordens distintas | Apr/Cont | ERP, Adm |
| vendas | só Adm diverge | ERP | Adm |

São **14 reconstruções**, a maior parte na Adm (que é livre para testar: começar por ela).

Antes de executar, reler a ordem exata de cada banco. Não confiar nesta lista, porque migração nova com `ADD COLUMN` muda o fim de todas:

```sql
select table_name, string_agg(column_name, ',' order by ordinal_position)
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('clientes','filiais','fornecedores','marketing_artes',
                      'marketing_tarefas','pedidos','produtos','vendas')
 group by 1 order by 1;
```

## Como fazer (por tabela, por banco)

1. **Janela fora de aula** (manhã 12:40–16:20 UTC e tarde 18:20–21:50 UTC são horário de aula). A reconstrução segura `ACCESS EXCLUSIVE` na tabela e nas que têm FK para ela.
2. **Backup antes**, com `pg_dump` do banco inteiro. As turmas não têm backup automático.
3. **Capturar a DDL dependente do banco, não do repo**: `pg_get_constraintdef`, `pg_get_triggerdef`, `pg_get_indexdef`, policies (`pg_policies`), `pg_get_viewdef`, grants (`information_schema.role_table_grants`), publicação (`pg_publication_tables`), `relreplident`, comentários. Ver a memória `feedback_replace_function_copiar_do_banco`.
4. Numa transação só:
   - `CREATE TABLE <t>_nova (...)` na ordem-alvo, com os mesmos tipos, defaults e NOT NULL;
   - `INSERT INTO <t>_nova (cols) SELECT cols FROM <t>`, listando as colunas explicitamente e nunca com `*`;
   - derrubar as views dependentes, as FKs de entrada e a tabela antiga, e renomear `<t>_nova` para `<t>`;
   - recriar PK, constraints, índices, FKs de entrada, gatilhos, policies, `ENABLE ROW LEVEL SECURITY`, grants, views (com `security_invoker`), publicação do realtime e replica identity;
   - acertar a posse das sequências (`ALTER SEQUENCE ... OWNED BY`) e o `setval`.
5. Validar ainda dentro da transação: contagem de linhas igual, `md5` do conteúdo ordenado por `id` igual, número de FKs, policies e gatilhos igual ao capturado no passo 3.
6. Depois de cada tabela: `npm run drift`, `npm run rls:check` e `NOTIFY pgrst, 'reload schema'`.
7. Registrar como migração numerada no repo (mesmo sendo só para alguns bancos), dizendo em qual banco ela roda.

**Ordem sugerida:** começar pelas tabelas pequenas e sem FK de entrada (`marketing_tarefas` e `marketing_artes`, na Adm), depois `filiais`, e deixar `produtos` por último, porque é a que tem mais dependências.

## Quando terminar

- Tirar o `informativo: true` do check `ordem_colunas` em `scripts/schema-drift.mjs`, para que divergência de ordem passe a reprovar.
- Regra para migrações novas: `ADD COLUMN` sempre na mesma sequência nos 4 bancos (já é o caso quando se aplica a mesma migração nos 4).
