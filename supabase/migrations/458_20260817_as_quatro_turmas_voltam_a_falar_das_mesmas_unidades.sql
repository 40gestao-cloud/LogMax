-- 458_20260817_as_quatro_turmas_voltam_a_falar_das_mesmas_unidades.sql
--
-- CADA TURMA CHAMAVA A HOLDING DE UM JEITO, E O DRE NÃO TINHA ONDE CLASSIFICAR.
--
-- Encontrado ao conferir a limpeza dos dados de treinamento, comparando as 4
-- turmas lado a lado. Duas tabelas de parametrização ficaram para trás.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. `filiais` — quatro versões da mesma holding
--
--   LogMax-ERP     SuperMax · MaxLook · TechMax          (certo)
--   Aprendiz       Supermax · TechMax LTDA               (MaxLook não existe)
--   Contabilidade  "Super Max " · MaxLook · Techmax      (espaço no fim)
--   Adm            Filial Campinas · Rio · Matriz SP     (seed genérico)
--
-- Isso não quebra a operação: o app não lê esta tabela para operar. O seletor
-- de unidade, o RBAC e o prefixo de SKU saem de `FILIAIS_HOLDING` em
-- `src/lib/filiais.ts`, que é fixa. `filiais` alimenta só a tela Empresa ›
-- Filiais, que é cadastro.
--
-- O estrago é didático, e é o mesmo que esta auditoria vem fechando o dia
-- inteiro: duas verdades sobre o mesmo fato. O aluno da Adm abre o cadastro,
-- lê "Filial Campinas" e opera dentro da SuperMax. E "Super Max " com espaço
-- no fim é a linha que não casa com nada no dia em que alguém cruzar esta
-- tabela com a coluna `filial` das outras.
--
-- O QUE ESTA MIGRAÇÃO PRESERVA
--
-- CNPJ, endereço, representante e telefone são trabalho da turma — a LogMax-ERP
-- tem os três preenchidos com dados de Cruzeiro do Sul. Onde já existe a
-- unidade sob outro nome, o registro é **renomeado**, não recriado: some o
-- apelido, fica o conteúdo. Só entra linha nova onde a marca não existe.
--
-- Nada é apagado. O que não é da holding vira inativo e continua visível para
-- quem quiser entender o que havia antes.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. `centros_custo` — o DRE sem onde pendurar a despesa
--
-- Três turmas com a tabela vazia; a quarta (Adm) com três centros do seed e
-- `grupo_dre` NULO nos três. `gerar_dre` agrupa as despesas por esse campo:
--
--   COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado')
--
-- Sem centro de custo, ou com centro sem grupo, TODA despesa cai em "Não
-- classificado". O relatório roda, fecha a conta certa no total, e não ensina
-- nada — que é a forma mais educada de um relatório ser inútil.
--
-- Sete centros, um por área que de fato gasta no ERP, cada um com o grupo que
-- o DRE espera. Os cinco grupos são os do CHECK da tabela e não se inventam
-- aqui: 'Pessoal', 'Comerciais', 'Administrativas', 'Ocupação', 'Outras'.
--
-- Os centros antigos da Adm são inativados, não apagados — e só porque a
-- limpeza deixou zero referências a eles em `contas_pagar`, `orcamento_itens`,
-- `requisicoes_estoque` e `consumos_material` (conferido antes de escrever).
-- Com lançamento apontando para eles, o certo seria completar o `grupo_dre` e
-- deixar como estão.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. As três unidades da holding, com o nome que o app usa ────────────────

DO $do$
DECLARE
  v_marca text;
  v_id    uuid;
BEGIN
  FOREACH v_marca IN ARRAY ARRAY['SuperMax', 'MaxLook', 'TechMax']
  LOOP
    -- Já existe com o nome exato? Nada a fazer.
    SELECT id INTO v_id
      FROM public.filiais
     WHERE nome = v_marca AND COALESCE(ativo, true)
     LIMIT 1;

    IF v_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    -- Existe sob apelido? "Supermax", "Techmax", "Super Max ", "TechMax LTDA".
    -- Compara sem espaço e sem caixa; a mais antiga ganha, que é a que a turma
    -- vem preenchendo.
    SELECT id INTO v_id
      FROM public.filiais
     WHERE COALESCE(ativo, true)
       AND upper(replace(btrim(nome), ' ', '')) LIKE upper(v_marca) || '%'
     ORDER BY created_at
     LIMIT 1;

    IF v_id IS NOT NULL THEN
      UPDATE public.filiais SET nome = v_marca WHERE id = v_id;
      CONTINUE;
    END IF;

    -- Não existe: entra em branco, para a turma preencher CNPJ e endereço.
    INSERT INTO public.filiais (nome, status, ativo)
    VALUES (v_marca, 'Ativa', true);
  END LOOP;
END
$do$;

-- O que não é da holding sai de cena sem sumir do banco. `Matriz São Paulo` vai
-- junto: a Matriz do LogMax é um modo de operação (migr. 325), não uma linha
-- desta tabela.
UPDATE public.filiais
   SET ativo = false, status = 'Inativa'
 WHERE COALESCE(ativo, true)
   AND nome NOT IN ('SuperMax', 'MaxLook', 'TechMax');

-- ── 2. Centros de custo com grupo de DRE ────────────────────────────────────

INSERT INTO public.centros_custo (codigo, nome, grupo_dre, status, ativo) VALUES
  ('CC-ADM', 'Administrativo',        'Administrativas', 'Ativo', true),
  ('CC-COM', 'Comercial e Vendas',    'Comerciais',      'Ativo', true),
  ('CC-MKT', 'Marketing',             'Comerciais',      'Ativo', true),
  ('CC-LOG', 'Logística e Estoque',   'Administrativas', 'Ativo', true),
  ('CC-RH',  'Pessoal e RH',          'Pessoal',         'Ativo', true),
  ('CC-TI',  'Tecnologia',            'Administrativas', 'Ativo', true),
  ('CC-OCU', 'Ocupação',              'Ocupação',        'Ativo', true)
ON CONFLICT (codigo) DO UPDATE
  SET nome      = EXCLUDED.nome,
      grupo_dre = EXCLUDED.grupo_dre,
      status    = 'Ativo',
      ativo     = true;

-- Centro do seed antigo, sem grupo e sem uso, sai de cena. O `NOT EXISTS`
-- protege o caso em que alguma turma já lançou despesa nele: aí ele fica, e
-- quem completa o grupo é quem sabe do que se trata.
UPDATE public.centros_custo cc
   SET ativo = false, status = 'Inativo'
 WHERE COALESCE(cc.ativo, true)
   AND cc.codigo NOT IN ('CC-ADM','CC-COM','CC-MKT','CC-LOG','CC-RH','CC-TI','CC-OCU')
   AND NOT EXISTS (SELECT 1 FROM public.contas_pagar        x WHERE x.centro_custo_id = cc.id)
   AND NOT EXISTS (SELECT 1 FROM public.orcamento_itens     x WHERE x.centro_custo_id = cc.id)
   AND NOT EXISTS (SELECT 1 FROM public.requisicoes_estoque x WHERE x.centro_custo_id = cc.id)
   AND NOT EXISTS (SELECT 1 FROM public.consumos_material   x WHERE x.centro_custo_id = cc.id);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. as três unidades, com o nome exato — esperado: 3 linhas iguais nas 4
--   SELECT nome, cidade, cnpj FROM filiais WHERE ativo ORDER BY nome;
--
--   -- 2. nenhuma unidade ativa fora da holding — esperado: zero linhas
--   SELECT nome FROM filiais
--    WHERE ativo AND nome NOT IN ('SuperMax','MaxLook','TechMax');
--
--   -- 3. o que a turma preencheu continua lá (na LogMax-ERP, os CNPJs de
--   --    Cruzeiro do Sul) — renomear não devia ter apagado nada
--   SELECT nome, representante, endereco FROM filiais WHERE ativo ORDER BY nome;
--
--   -- 4. sete centros, todos com grupo — esperado: 7 linhas, nenhuma nula
--   SELECT codigo, nome, grupo_dre FROM centros_custo WHERE ativo ORDER BY codigo;
--
--   -- 5. nenhum centro ativo sem grupo (o que faria a despesa cair em
--   --    "Não classificado" no DRE) — esperado: zero linhas
--   SELECT codigo, nome FROM centros_custo
--    WHERE ativo AND COALESCE(btrim(grupo_dre), '') = '';
--
-- O teste que vale a aula: lançar uma conta a pagar em "Ocupação" e outra em
-- "Pessoal e RH", abrir o DRE do mês e ver as duas despesas separadas por
-- grupo em vez de empilhadas em "Não classificado".
-- =================================================================
