-- 460_20260817_o_catalogo_da_vizinha_estava_aberto.sql
--
-- QUALQUER USUÁRIO LIA O CATÁLOGO DAS TRÊS UNIDADES, CUSTO INCLUÍDO.
--
--   CREATE POLICY "read_authenticated" ON produtos FOR SELECT
--     TO authenticated USING (true);
--
-- Apareceu na sonda 5 do documento de auditoria (`pg_policies WHERE qual =
-- 'true'`) e passou batido o dia inteiro porque catálogo *parece* dado
-- público. Não é: `produtos` carrega preço de venda, margem e — pela view
-- `produtos_com_custo`, que é `security_invoker` e herda esta mesma policy —
-- o preço de custo.
--
-- Num sistema cujo tema é competição entre filiais, o colaborador da MaxLook
-- consultando o custo da TechMax não é vazamento acidental de dado: é o
-- placar. E a escrita já estava fechada desde sempre — `write_produtos`,
-- `update_produtos` e `delete_produtos` usam `auth_pode_filial(filial)`. Só a
-- leitura ficou para trás, que é o padrão descrito em
-- [[feedback_setor_sem_filial]]: fechar a RPC não fecha a tabela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A RÉGUA É A MESMA DO RESTO DO SISTEMA
--
-- `auth_pode_filial(filial)` — que já é `auth_is_admin() OR auth_user_filial()
-- = p_filial`. Idêntica à de `produto_unidades` (444), `consumos_material`
-- (442) e `movimentacoes_estoque`. Não se inventa régua nova aqui; usa-se a
-- que o sistema já fala.
--
-- `COALESCE(..., false)` porque `auth_user_filial()` nulo faz a comparação
-- devolver NULL, e NULL em policy é o mesmo que negar — mas explícito é melhor
-- que implícito quando o assunto é quem vê o quê.
--
-- QUEM CONTINUA VENDO TUDO, E POR QUÊ
--
--   • admin, CEO e conselheiro — `auth_is_admin()` os cobre. É a régua vigente
--     em todas as outras tabelas; mudá-la só aqui criaria a discordância que
--     esta migração veio desfazer. Vale registrar que isso inclui o
--     conselheiro, que é ALUNO — ver [[feedback_auth_is_admin_inclui_alunos]].
--   • a vitrine e a loja pública — `get_vitrine_publica` e
--     `listar_vitrine_candidatos` são SECURITY DEFINER e não passam por RLS.
--   • o painel de BI e o DRE — idem, SECURITY DEFINER.
--
-- O QUE MUDA PARA QUEM
--
-- Colaborador e gerente passam a enxergar só o catálogo da própria unidade —
-- que é o que as telas já filtravam por conta própria (`useFetchData` com
-- `{ filial }`). Na prática, a tela não muda; o que muda é que agora a régua
-- existe onde não dá para contornar pelo F12.
--
-- ────────────────────────────────────────────────────────────────────────────
-- UM PASSIVO QUE ESTA MIGRAÇÃO TORNA VISÍVEL
--
-- A turma **Contabilidade** tem 5 colaboradores de logística com `filial`
-- NULA. Para eles `auth_pode_filial()` devolve NULL em qualquer unidade, e o
-- catálogo fica vazio depois desta migração.
--
-- Eles JÁ não conseguiam cadastrar, editar nem apagar produto — as três
-- policies de escrita usam a mesma função desde sempre. Estavam operando pela
-- metade sem que ninguém notasse, porque a leitura aberta escondia o problema.
-- A migração não cria a falha; para de encobri-la.
--
-- O conserto é alocar cada um na sua unidade (Usuários → editar → Filial), e
-- é decisão de quem monta a turma. A sonda 3 no rodapé lista quem são.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

DROP POLICY IF EXISTS "read_authenticated" ON public.produtos;
DROP POLICY IF EXISTS "produtos_select_filial" ON public.produtos;

CREATE POLICY "produtos_select_filial" ON public.produtos
  FOR SELECT TO authenticated
  USING (COALESCE(public.auth_pode_filial(filial), false));

COMMENT ON TABLE public.produtos IS
  'Catálogo por unidade de negócio. Leitura, escrita e exclusão pela mesma régua (`auth_pode_filial`) desde a migr. 460 — antes a leitura era aberta a qualquer autenticado, custo incluído.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. a policy trocada, e nenhuma leitura aberta sobrou em produtos
--   SELECT policyname, cmd, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'produtos' AND cmd = 'SELECT';
--   -- esperado: uma linha, produtos_select_filial, com auth_pode_filial
--
--   -- 2. o varredor geral do documento: quem mais lê sem filtrar nada.
--   --    `produtos` não pode mais aparecer aqui.
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND qual = 'true' ORDER BY 1, 2;
--
--   -- 3. PASSIVO: quem ficaria sem catálogo por não ter unidade.
--   --    Na Contabilidade são 5 colaboradores de logística.
--   SELECT id, nome, role, setor FROM user_profiles
--    WHERE filial IS NULL AND role NOT IN ('admin', 'ceo', 'conselheiro')
--    ORDER BY nome;
--
--   -- 4. produto sem unidade também some para quem não é admin. Hoje: zero.
--   SELECT count(*) FROM produtos WHERE filial IS NULL;
--
-- O teste que vale a aula: entrar como colaborador da MaxLook e procurar, no
-- catálogo, um produto que só a TechMax cadastrou. Antes aparecia com custo e
-- margem; agora não existe para ele.
-- =================================================================
