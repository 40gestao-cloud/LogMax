# Mapa por tela (menu › submenu)

> **Gerado por `npm run mapa` — não edite à mão.** Rode de novo depois de mexer em tela, RPC, gatilho ou policy; o `git diff` desta pasta mostra a ligação nova.
> Banco lido: `jvqsaccupxkvezriiede` (as 4 turmas são idênticas — `npm run drift`). Detecção estática: SQL dinâmico e endpoint passado por variável não aparecem.

Para cada tela: o que ela lê e grava, as funções do banco que chama, e **quem mais mexe nas mesmas tabelas** — é a lista do "se mexer aqui, confira também".

## Empresa

<a id="s-empresa-filiais"></a>
### Empresa › Filiais

- **Rota:** `empresa-filiais` · **Componente:** `FiliaisView` ([src/views/FiliaisView.tsx](../../src/views/FiliaisView.tsx))
- **Lê:** [centros_custo](tabelas.md#t-centros_custo), [clientes](tabelas.md#t-clientes), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [filiais](tabelas.md#t-filiais), [filial_investimentos](tabelas.md#t-filial_investimentos), [historico_operacoes](tabelas.md#t-historico_operacoes), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [filiais](tabelas.md#t-filiais), [filial_investimentos](tabelas.md#t-filial_investimentos)
- **Chama (RPC):** [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [pedidos_venda](tabelas.md#t-pedidos_venda), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [contas_receber](tabelas.md#t-contas_receber): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [filial_investimentos](tabelas.md#t-filial_investimentos): [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
  - por [produtos](tabelas.md#t-produtos): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [produtos_custo](tabelas.md#t-produtos_custo): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/components/MontagemFinanceiro.tsx`, `src/hooks/useUserProfile.ts`, `src/views/FiliaisView.tsx`

<a id="s-empresa-formasdepagamento"></a>
### Empresa › Formas de pagamento

- **Rota:** `empresa-formasdepagamento` · **Componente:** `FormasPagamentoView` ([src/views/FormasPagamentoView.tsx](../../src/views/FormasPagamentoView.tsx))
- **Lê:** [formas_pagamento](tabelas.md#t-formas_pagamento), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Grava direto:** [formas_pagamento](tabelas.md#t-formas_pagamento)
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/views/FormasPagamentoView.tsx`

<a id="s-empresa-projetos"></a>
### Empresa › Projetos

- **Rota:** `empresa-projetos` · **Componente:** `GenericCRUDView` ([src/views/GenericCRUDView.tsx](../../src/views/GenericCRUDView.tsx))
- **Lê:** [historico_operacoes](tabelas.md#t-historico_operacoes), [projetos](tabelas.md#t-projetos)
- **Grava direto:** [projetos](tabelas.md#t-projetos)
- **Chama (RPC):** —

## Requisições

<a id="s-requisicoes-dosetor"></a>
### Requisições › Do Setor

- **Rota:** `requisicoes-dosetor` · **Componente:** `RequisicoesSetorView` ([src/views/RequisicoesSetorView.tsx](../../src/views/RequisicoesSetorView.tsx))
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto), [centros_custo](tabelas.md#t-centros_custo), [fornecedores](tabelas.md#t-fornecedores), [historico_operacoes](tabelas.md#t-historico_operacoes), [planilhas_trabalho](tabelas.md#t-planilhas_trabalho), [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [servicos](tabelas.md#t-servicos), [subcategorias_produto](tabelas.md#t-subcategorias_produto), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [planilhas_trabalho](tabelas.md#t-planilhas_trabalho)
- **Chama (RPC):** [criar_requisicao_estoque](funcoes.md#f-criar_requisicao_estoque), [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote), [reenviar_requisicao_corrigida](funcoes.md#f-reenviar_requisicao_corrigida), [reenviar_requisicao_estoque_corrigida](funcoes.md#f-reenviar_requisicao_estoque_corrigida)
- **Grava via RPC:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [notificacoes](tabelas.md#t-notificacoes), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aprovacoes_compras](tabelas.md#t-aprovacoes_compras): [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
  - por [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque): [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
  - por [requisicoes](tabelas.md#t-requisicoes): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
  - por [requisicoes_estoque](tabelas.md#t-requisicoes_estoque): [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/lib/modelosPlanilha.ts`, `src/lib/planilhasTrabalho.ts`, `src/views/RequisicoesSetorView.tsx`

<a id="s-requisicoes-aprovações"></a>
### Requisições › Aprovações

- **Rota:** `requisicoes-aprovações` · **Componente:** `AprovacoesComprasView` ([src/views/AprovacoesComprasView.tsx](../../src/views/AprovacoesComprasView.tsx))
- **Lê:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [historico_operacoes](tabelas.md#t-historico_operacoes), [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [devolver_requisicao_para_correcao](funcoes.md#f-devolver_requisicao_para_correcao), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque)
- **Grava via RPC:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [cotacoes](tabelas.md#t-cotacoes), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [notificacoes](tabelas.md#t-notificacoes), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Gatilhos levam a mudança até:** [consumos_material](tabelas.md#t-consumos_material), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aprovacoes_compras](tabelas.md#t-aprovacoes_compras): [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
  - por [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque): [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
  - por [cotacoes](tabelas.md#t-cotacoes): [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [requisicoes](tabelas.md#t-requisicoes): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
  - por [requisicoes_estoque](tabelas.md#t-requisicoes_estoque): [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/AprovacoesComprasView.tsx`, `src/views/AprovacoesEstoqueView.tsx`

## Cadastros

<a id="s-cadastros-categorias"></a>
### Cadastros › Categorias

- **Rota:** `cadastros-categorias` · **Componente:** `CategoriasProdutoView` ([src/views/CategoriasProdutoView.tsx](../../src/views/CategoriasProdutoView.tsx))
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto), [subcategorias_produto](tabelas.md#t-subcategorias_produto)
- **Grava direto:** [categorias_produto](tabelas.md#t-categorias_produto), [subcategorias_produto](tabelas.md#t-subcategorias_produto)
- **Chama (RPC):** —
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [categorias_produto](tabelas.md#t-categorias_produto): [Financeiro › Precificação](telas.md#s-financeiro-precificação)

<a id="s-cadastros-produtos"></a>
### Cadastros › Produtos

- **Rota:** `cadastros-produtos` · **Componente:** `ProdutosView` ([src/views/ProdutosView.tsx](../../src/views/ProdutosView.tsx))
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto), [centros_custo](tabelas.md#t-centros_custo), [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [historico_operacoes](tabelas.md#t-historico_operacoes), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos](tabelas.md#t-pedidos), [planilhas_trabalho](tabelas.md#t-planilhas_trabalho), [produtos](tabelas.md#t-produtos), [produtos_com_custo](tabelas.md#t-produtos_com_custo), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes), [subcategorias_produto](tabelas.md#t-subcategorias_produto), [trabalho_reservas](tabelas.md#t-trabalho_reservas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [planilhas_trabalho](tabelas.md#t-planilhas_trabalho), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **Chama (RPC):** [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [concluir_correcao_produto](funcoes.md#f-concluir_correcao_produto), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [liberar_codigo_produto](funcoes.md#f-liberar_codigo_produto), [liberar_trabalho](funcoes.md#f-liberar_trabalho), [movimentar_estoque](funcoes.md#f-movimentar_estoque), [parametros_precificacao](funcoes.md#f-parametros_precificacao), [renovar_trabalho](funcoes.md#f-renovar_trabalho), [reservar_codigo_produto](funcoes.md#f-reservar_codigo_produto), [reservar_trabalho](funcoes.md#f-reservar_trabalho), [salvar_lucro_servico](funcoes.md#f-salvar_lucro_servico), [salvar_parametros_precificacao](funcoes.md#f-salvar_parametros_precificacao), [vincular_produto_requisicao](funcoes.md#f-vincular_produto_requisicao)
- **Grava via RPC:** [filial_precificacao](tabelas.md#t-filial_precificacao), [produtos_codigo_reserva](tabelas.md#t-produtos_codigo_reserva), [requisicoes](tabelas.md#t-requisicoes), [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Escuta em tempo real:** [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Gatilhos levam a mudança até:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [consumos_material](tabelas.md#t-consumos_material)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [filial_precificacao](tabelas.md#t-filial_precificacao): [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Financeiro › Precificação](telas.md#s-financeiro-precificação)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [produtos](tabelas.md#t-produtos): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [produtos_custo](tabelas.md#t-produtos_custo): [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
  - por [requisicoes](tabelas.md#t-requisicoes): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/components/produtos/ComposicaoCusto.tsx`, `src/hooks/useParametrosPrecificacao.ts`, `src/hooks/useReservaTrabalho.ts`, `src/hooks/useUserProfile.ts`, `src/lib/importarProdutos.ts`, `src/lib/modelosPlanilha.ts`, `src/lib/planilhasTrabalho.ts`, `src/lib/reservasTrabalho.ts`, `src/views/ProdutosView.tsx`

<a id="s-cadastros-fornecedores"></a>
### Cadastros › Fornecedores

- **Rota:** `cadastros-fornecedores` · **Componente:** `CRMView` ([src/views/CRMView.tsx](../../src/views/CRMView.tsx))
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto), [centros_custo](tabelas.md#t-centros_custo), [clientes](tabelas.md#t-clientes), [fornecedores](tabelas.md#t-fornecedores), [historico_operacoes](tabelas.md#t-historico_operacoes), [planilhas_trabalho](tabelas.md#t-planilhas_trabalho), [produtos](tabelas.md#t-produtos), [subcategorias_produto](tabelas.md#t-subcategorias_produto)
- **Grava direto:** [fornecedores](tabelas.md#t-fornecedores), [planilhas_trabalho](tabelas.md#t-planilhas_trabalho)
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/lib/modelosPlanilha.ts`, `src/lib/planilhasTrabalho.ts`, `src/views/CRMView.tsx`

<a id="s-cadastros-serviços"></a>
### Cadastros › Serviços

- **Rota:** `cadastros-serviços` · **Componente:** `ServicosView` ([src/views/ServicosView.tsx](../../src/views/ServicosView.tsx))
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto), [centros_custo](tabelas.md#t-centros_custo), [fornecedores](tabelas.md#t-fornecedores), [planilhas_trabalho](tabelas.md#t-planilhas_trabalho), [produtos](tabelas.md#t-produtos), [servicos](tabelas.md#t-servicos), [subcategorias_produto](tabelas.md#t-subcategorias_produto)
- **Grava direto:** [planilhas_trabalho](tabelas.md#t-planilhas_trabalho), [servicos](tabelas.md#t-servicos)
- **Chama (RPC):** [parametros_precificacao](funcoes.md#f-parametros_precificacao), [salvar_lucro_servico](funcoes.md#f-salvar_lucro_servico), [salvar_parametros_precificacao](funcoes.md#f-salvar_parametros_precificacao)
- **Grava via RPC:** [filial_precificacao](tabelas.md#t-filial_precificacao)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [filial_precificacao](tabelas.md#t-filial_precificacao): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- **Arquivos que acessam dados:** `src/hooks/useParametrosPrecificacao.ts`, `src/lib/modelosPlanilha.ts`, `src/lib/planilhasTrabalho.ts`, `src/views/ServicosView.tsx`

<a id="s-cadastros-lixeira"></a>
### Cadastros › Lixeira

- **Rota:** `cadastros-lixeira` · **Componente:** `LixeiraView` ([src/views/LixeiraView.tsx](../../src/views/LixeiraView.tsx))
- **Lê:** [vendas](tabelas.md#t-vendas)
- **Grava direto:** —
- **Chama (RPC):** [lixeira_expurgar](funcoes.md#f-lixeira_expurgar), [lixeira_listar](funcoes.md#f-lixeira_listar), [lixeira_restaurar](funcoes.md#f-lixeira_restaurar)
- **Arquivos que acessam dados:** `src/contexts/AIAssistantContext.tsx`, `src/views/LixeiraView.tsx`

## Compras

<a id="s-compras-requisiçõesdecompra"></a>
### Compras › Requisições de Compra

- **Rota:** `compras-requisiçõesdecompra` · **Componente:** `RequisicoesView` ([src/views/RequisicoesView.tsx](../../src/views/RequisicoesView.tsx))
- **Lê:** [historico_operacoes](tabelas.md#t-historico_operacoes), [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao)
- **Grava via RPC:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [requisicoes](tabelas.md#t-requisicoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aprovacoes_compras](tabelas.md#t-aprovacoes_compras): [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
  - por [requisicoes](tabelas.md#t-requisicoes): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/RequisicoesView.tsx`

<a id="s-compras-cotações"></a>
### Compras › Cotações

- **Rota:** `compras-cotações` · **Componente:** `CotacoesView` ([src/views/CotacoesView.tsx](../../src/views/CotacoesView.tsx))
- **Lê:** [alcadas_compra](tabelas.md#t-alcadas_compra), [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [historico_operacoes](tabelas.md#t-historico_operacoes), [notificacoes](tabelas.md#t-notificacoes), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes), [servicos](tabelas.md#t-servicos), [trabalho_reservas](tabelas.md#t-trabalho_reservas), [user_profiles](tabelas.md#t-user_profiles), [v_fornecedor_desempenho](tabelas.md#t-v_fornecedor_desempenho)
- **Grava direto:** [cotacoes](tabelas.md#t-cotacoes)
- **Chama (RPC):** [decidir_cotacao](funcoes.md#f-decidir_cotacao), [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [liberar_trabalho](funcoes.md#f-liberar_trabalho), [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [notificar_setor](funcoes.md#f-notificar_setor), [reabrir_cotacao](funcoes.md#f-reabrir_cotacao), [reenviar_cotacao_corrigida](funcoes.md#f-reenviar_cotacao_corrigida), [renovar_trabalho](funcoes.md#f-renovar_trabalho), [reservar_trabalho](funcoes.md#f-reservar_trabalho)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [notificacoes](tabelas.md#t-notificacoes), [notificacoes_lidas](tabelas.md#t-notificacoes_lidas), [pedidos](tabelas.md#t-pedidos), [requisicoes](tabelas.md#t-requisicoes), [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Escuta em tempo real:** [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [cotacoes](tabelas.md#t-cotacoes): [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
  - por [pedidos](tabelas.md#t-pedidos): [Compras › Pedidos](telas.md#s-compras-pedidos), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
  - por [requisicoes](tabelas.md#t-requisicoes): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Arquivos que acessam dados:** `src/components/FornecedorDesempenho.tsx`, `src/components/HistoricoOperacoes.tsx`, `src/hooks/useNotificacoes.ts`, `src/hooks/useReservaTrabalho.ts`, `src/hooks/useUserProfile.ts`, `src/lib/notificar.ts`, `src/lib/reservasTrabalho.ts`, `src/views/CotacoesView.tsx`

<a id="s-compras-pedidos"></a>
### Compras › Pedidos

- **Rota:** `compras-pedidos` · **Componente:** `PedidosView` ([src/views/PedidosView.tsx](../../src/views/PedidosView.tsx))
- **Lê:** [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [historico_operacoes](tabelas.md#t-historico_operacoes), [notificacoes](tabelas.md#t-notificacoes), [pedidos](tabelas.md#t-pedidos), [requisicoes](tabelas.md#t-requisicoes)
- **Grava direto:** [pedidos](tabelas.md#t-pedidos)
- **Chama (RPC):** [cancelar_pedido_compra](funcoes.md#f-cancelar_pedido_compra), [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [notificar_setor](funcoes.md#f-notificar_setor)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [notificacoes](tabelas.md#t-notificacoes), [notificacoes_lidas](tabelas.md#t-notificacoes_lidas), [requisicoes](tabelas.md#t-requisicoes)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [pedidos](tabelas.md#t-pedidos): [Compras › Cotações](telas.md#s-compras-cotações), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
  - por [requisicoes](tabelas.md#t-requisicoes): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useNotificacoes.ts`, `src/lib/notificar.ts`, `src/views/PedidosView.tsx`

<a id="s-compras-notasrecebidas"></a>
### Compras › Notas recebidas

- **Rota:** `compras-notasrecebidas` · **Componente:** `NotasRecebidasView` ([src/views/NotasRecebidasView.tsx](../../src/views/NotasRecebidasView.tsx))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [fornecedores](tabelas.md#t-fornecedores), [historico_operacoes](tabelas.md#t-historico_operacoes), [notas_recebidas](tabelas.md#t-notas_recebidas)
- **Grava direto:** [notas_recebidas](tabelas.md#t-notas_recebidas)
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/views/NotasRecebidasView.tsx`

<a id="s-compras-sugestõesdecompras"></a>
### Compras › Sugestões de compras

- **Rota:** `compras-sugestõesdecompras` · **Componente:** `SugestoesComprasView` ([src/views/SugestoesComprasView.tsx](../../src/views/SugestoesComprasView.tsx))
- **Lê:** [produtos_com_custo](tabelas.md#t-produtos_com_custo)
- **Grava direto:** —
- **Chama (RPC):** [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote)
- **Grava via RPC:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [requisicoes](tabelas.md#t-requisicoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aprovacoes_compras](tabelas.md#t-aprovacoes_compras): [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
  - por [requisicoes](tabelas.md#t-requisicoes): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)

<a id="s-compras-gerenciamento"></a>
### Compras › Gerenciamento

- **Rota:** `compras-gerenciamento` · **Componente:** `GerenciamentoComprasView` ([src/views/GerenciamentoComprasView.tsx](../../src/views/GerenciamentoComprasView.tsx))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes)
- **Grava direto:** —
- **Chama (RPC):** —

<a id="s-compras-relatórios"></a>
### Compras › Relatórios

- **Rota:** `compras-relatórios` · **Componente:** `RelatoriosComprasView` ([src/views/RelatoriosComprasView.tsx](../../src/views/RelatoriosComprasView.tsx))
- **Lê:** [fornecedores](tabelas.md#t-fornecedores), [notas_recebidas](tabelas.md#t-notas_recebidas), [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes)
- **Grava direto:** —
- **Chama (RPC):** —

## Estoque

<a id="s-estoque-requisiçõesdematerial"></a>
### Estoque › Requisições de Material

- **Rota:** `estoque-requisiçõesdematerial` · **Componente:** `RequisicoesEstoqueView` ([src/views/RequisicoesEstoqueView.tsx](../../src/views/RequisicoesEstoqueView.tsx))
- **Lê:** [historico_operacoes](tabelas.md#t-historico_operacoes), [produtos](tabelas.md#t-produtos), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Grava direto:** [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Chama (RPC):** [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque)
- **Grava via RPC:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque): [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
  - por [requisicoes_estoque](tabelas.md#t-requisicoes_estoque): [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/views/RequisicoesEstoqueView.tsx`

<a id="s-estoque-liberarrequisições"></a>
### Estoque › Liberar Requisições

- **Rota:** `estoque-liberarrequisições` · **Componente:** `AprovacoesEstoqueView` ([src/views/AprovacoesEstoqueView.tsx](../../src/views/AprovacoesEstoqueView.tsx))
- **Lê:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [historico_operacoes](tabelas.md#t-historico_operacoes), [produtos](tabelas.md#t-produtos), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque)
- **Grava via RPC:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [notificacoes](tabelas.md#t-notificacoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Gatilhos levam a mudança até:** [consumos_material](tabelas.md#t-consumos_material), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque): [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [requisicoes_estoque](tabelas.md#t-requisicoes_estoque): [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/AprovacoesEstoqueView.tsx`

<a id="s-estoque-recebimentos"></a>
### Estoque › Recebimentos

- **Rota:** `estoque-recebimentos` · **Componente:** `RecebimentosView` ([src/views/RecebimentosView.tsx](../../src/views/RecebimentosView.tsx))
- **Lê:** [devolucoes_fornecedor](tabelas.md#t-devolucoes_fornecedor), [historico_operacoes](tabelas.md#t-historico_operacoes), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [recebimentos](tabelas.md#t-recebimentos), [servicos](tabelas.md#t-servicos), [v_pedido_saldo](tabelas.md#t-v_pedido_saldo), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Grava direto:** [recebimentos](tabelas.md#t-recebimentos), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Chama (RPC):** [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [registrar_unidades_recebidas](funcoes.md#f-registrar_unidades_recebidas), [resumo_recebimentos](funcoes.md#f-resumo_recebimentos)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [devolucoes_fornecedor](tabelas.md#t-devolucoes_fornecedor), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos](tabelas.md#t-pedidos), [produto_unidades](tabelas.md#t-produto_unidades)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [pedidos](tabelas.md#t-pedidos): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
  - por [vencimentos_estoque](tabelas.md#t-vencimentos_estoque): [Estoque › Validades](telas.md#s-estoque-validades)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/views/RecebimentosView.tsx`

<a id="s-estoque-expedição"></a>
### Estoque › Expedição

- **Rota:** `estoque-expedição` · **Componente:** `ExpedicaoView` ([src/views/ExpedicaoView.tsx](../../src/views/ExpedicaoView.tsx))
- **Lê:** [expedicao](tabelas.md#t-expedicao), [historico_operacoes](tabelas.md#t-historico_operacoes), [produtos](tabelas.md#t-produtos), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Grava direto:** [expedicao](tabelas.md#t-expedicao)
- **Chama (RPC):** [expedir](funcoes.md#f-expedir)
- **Grava via RPC:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Gatilhos levam a mudança até:** [consumos_material](tabelas.md#t-consumos_material), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/views/ExpedicaoView.tsx`

<a id="s-estoque-movimentações"></a>
### Estoque › Movimentações

- **Rota:** `estoque-movimentações` · **Componente:** `MovimentacoesEstoqueView` ([src/views/MovimentacoesEstoqueView.tsx](../../src/views/MovimentacoesEstoqueView.tsx))
- **Lê:** [historico_operacoes](tabelas.md#t-historico_operacoes), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Chama (RPC):** [devolver_movimentacao_para_correcao](funcoes.md#f-devolver_movimentacao_para_correcao), [movimentar_estoque](funcoes.md#f-movimentar_estoque)
- **Grava via RPC:** [notificacoes](tabelas.md#t-notificacoes), [produtos](tabelas.md#t-produtos)
- **Gatilhos levam a mudança até:** [consumos_material](tabelas.md#t-consumos_material), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [produtos](tabelas.md#t-produtos): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/MovimentacoesEstoqueView.tsx`

<a id="s-estoque-saldos"></a>
### Estoque › Saldos

- **Rota:** `estoque-saldos` · **Componente:** `SaldosEstoqueView` ([src/views/SaldosEstoqueView.tsx](../../src/views/SaldosEstoqueView.tsx))
- **Lê:** [produtos](tabelas.md#t-produtos), [vendas](tabelas.md#t-vendas)
- **Grava direto:** —
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/contexts/AIAssistantContext.tsx`, `src/views/SaldosEstoqueView.tsx`

<a id="s-estoque-validades"></a>
### Estoque › Validades

- **Rota:** `estoque-validades` · **Componente:** `ValidadesView` ([src/views/ValidadesView.tsx](../../src/views/ValidadesView.tsx))
- **Lê:** [historico_operacoes](tabelas.md#t-historico_operacoes), [produtos](tabelas.md#t-produtos), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Grava direto:** [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Chama (RPC):** [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [encerrar_lote_consumido](funcoes.md#f-encerrar_lote_consumido)
- **Grava via RPC:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Gatilhos levam a mudança até:** [consumos_material](tabelas.md#t-consumos_material), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [vencimentos_estoque](tabelas.md#t-vencimentos_estoque): [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/views/ValidadesView.tsx`

<a id="s-estoque-inventários"></a>
### Estoque › Inventários

- **Rota:** `estoque-inventários` · **Componente:** `InventariosView` ([src/views/InventariosView.tsx](../../src/views/InventariosView.tsx))
- **Lê:** [historico_operacoes](tabelas.md#t-historico_operacoes), [inventarios](tabelas.md#t-inventarios), [produtos](tabelas.md#t-produtos)
- **Grava direto:** [inventarios](tabelas.md#t-inventarios)
- **Chama (RPC):** [fechar_inventario](funcoes.md#f-fechar_inventario)
- **Grava via RPC:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Gatilhos levam a mudança até:** [consumos_material](tabelas.md#t-consumos_material), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/views/InventariosView.tsx`

<a id="s-estoque-pedidosdevenda"></a>
### Estoque › Pedidos de Venda

- **Rota:** `estoque-pedidosdevenda` · **Componente:** `PedidosVendaView` ([src/views/PedidosVendaView.tsx](../../src/views/PedidosVendaView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [historico_operacoes](tabelas.md#t-historico_operacoes), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [pedidos_venda](tabelas.md#t-pedidos_venda)
- **Chama (RPC):** [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda)
- **Grava via RPC:** [contas_receber](tabelas.md#t-contas_receber), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [orcamentos](tabelas.md#t-orcamentos), [vendas](tabelas.md#t-vendas)
- **Gatilhos levam a mudança até:** [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [marketing_cupons](tabelas.md#t-marketing_cupons), [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [orcamentos](tabelas.md#t-orcamentos): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [pedidos_venda](tabelas.md#t-pedidos_venda): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [vendas](tabelas.md#t-vendas): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/PedidosVendaView.tsx`

<a id="s-estoque-gerenciamento"></a>
### Estoque › Gerenciamento

- **Rota:** `estoque-gerenciamento` · **Componente:** `GerenciamentoEstoqueView` ([src/views/GerenciamentoEstoqueView.tsx](../../src/views/GerenciamentoEstoqueView.tsx))
- **Lê:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [expedicao](tabelas.md#t-expedicao), [inventarios](tabelas.md#t-inventarios), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produtos](tabelas.md#t-produtos), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Grava direto:** —
- **Chama (RPC):** —

<a id="s-estoque-relatórios"></a>
### Estoque › Relatórios

- **Rota:** `estoque-relatórios` · **Componente:** `RelatoriosEstoqueView` ([src/views/RelatoriosEstoqueView.tsx](../../src/views/RelatoriosEstoqueView.tsx))
- **Lê:** [inventarios](tabelas.md#t-inventarios), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produtos](tabelas.md#t-produtos), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Grava direto:** —
- **Chama (RPC):** —

## Financeiro

<a id="s-financeiro-controledecaixa"></a>
### Financeiro › Controle de Caixa

- **Rota:** `financeiro-controledecaixa` · **Componente:** `ControleCaixaView` ([src/views/ControleCaixaView.tsx](../../src/views/ControleCaixaView.tsx))
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa), [historico_operacoes](tabelas.md#t-historico_operacoes), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Chama (RPC):** [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [confirmar_fechamento_caixa](funcoes.md#f-confirmar_fechamento_caixa), [fechar_caixa_conferido](funcoes.md#f-fechar_caixa_conferido), [reabrir_caixa](funcoes.md#f-reabrir_caixa), [registrar_movimentacao_caixa](funcoes.md#f-registrar_movimentacao_caixa)
- **Grava via RPC:** [controle_caixa_reaberturas](tabelas.md#t-controle_caixa_reaberturas), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [controle_caixa](tabelas.md#t-controle_caixa): [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa): [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useCaixaAberto.ts`, `src/hooks/useUserProfile.ts`, `src/views/ControleCaixaView.tsx`

<a id="s-financeiro-contasareceber"></a>
### Financeiro › Contas a receber

- **Rota:** `financeiro-contasareceber` · **Componente:** `ContasReceberView` ([src/views/ContasReceberView.tsx](../../src/views/ContasReceberView.tsx))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [clientes](tabelas.md#t-clientes), [contas_receber](tabelas.md#t-contas_receber), [financeiro_config](tabelas.md#t-financeiro_config), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Grava direto:** [contas_receber](tabelas.md#t-contas_receber)
- **Chama (RPC):** [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [contas_receber_baixas](tabelas.md#t-contas_receber_baixas): [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/lib/juros.ts`, `src/views/ContasReceberView.tsx`

<a id="s-financeiro-contasapagar"></a>
### Financeiro › Contas a pagar

- **Rota:** `financeiro-contasapagar` · **Componente:** `ContasPagarView` ([src/views/ContasPagarView.tsx](../../src/views/ContasPagarView.tsx))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_pagar](tabelas.md#t-contas_pagar), [financeiro_config](tabelas.md#t-financeiro_config), [fornecedores](tabelas.md#t-fornecedores), [historico_operacoes](tabelas.md#t-historico_operacoes), [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos)
- **Grava direto:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Chama (RPC):** [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [cancelar_frete_compra](funcoes.md#f-cancelar_frete_compra), [conferir_nota_fiscal](funcoes.md#f-conferir_nota_fiscal), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [total_pendente_contas_pagar](funcoes.md#f-total_pendente_contas_pagar)
- **Grava via RPC:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas), [contas_receber](tabelas.md#t-contas_receber), [fretes_compra](tabelas.md#t-fretes_compra), [fretes_compra_rateio](tabelas.md#t-fretes_compra_rateio), [produtos_custo](tabelas.md#t-produtos_custo)
- **Gatilhos levam a mudança até:** [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [pedidos_venda](tabelas.md#t-pedidos_venda), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas): [Financeiro › Capital](telas.md#s-financeiro-capital)
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [produtos_custo](tabelas.md#t-produtos_custo): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
- **Arquivos que acessam dados:** `src/components/FreteCompraModal.tsx`, `src/components/HistoricoOperacoes.tsx`, `src/lib/juros.ts`, `src/views/ContasPagarView.tsx`

<a id="s-financeiro-caixabancos"></a>
### Financeiro › Caixa / Bancos

- **Rota:** `financeiro-caixabancos` · **Componente:** `CaixaBancosView` ([src/views/CaixaBancosView.tsx](../../src/views/CaixaBancosView.tsx))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [filial_caixa_config](tabelas.md#t-filial_caixa_config), [historico_operacoes](tabelas.md#t-historico_operacoes), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [filial_caixa_config](tabelas.md#t-filial_caixa_config)
- **Chama (RPC):** [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [transferir_entre_contas](funcoes.md#f-transferir_entre_contas)
- **Grava via RPC:** [caixa_bancos](tabelas.md#t-caixa_bancos)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [caixa_bancos](tabelas.md#t-caixa_bancos): [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital), [Usuários](telas.md#s-usuarios)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/CaixaBancosView.tsx`

<a id="s-financeiro-conciliaçãodamaquininha"></a>
### Financeiro › Conciliação da Maquininha

- **Rota:** `financeiro-conciliaçãodamaquininha` · **Componente:** `ConciliacaoMaquininhaView` ([src/views/ConciliacaoMaquininhaView.tsx](../../src/views/ConciliacaoMaquininhaView.tsx))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [conciliacao_maquininha_itens](tabelas.md#t-conciliacao_maquininha_itens), [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha), [contas_receber](tabelas.md#t-contas_receber), [formas_pagamento](tabelas.md#t-formas_pagamento), [historico_operacoes](tabelas.md#t-historico_operacoes), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha)
- **Grava via RPC:** [conciliacao_maquininha_itens](tabelas.md#t-conciliacao_maquininha_itens), [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [contas_receber_baixas](tabelas.md#t-contas_receber_baixas): [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/ConciliacaoMaquininhaView.tsx`

<a id="s-financeiro-patrimônio"></a>
### Financeiro › Patrimônio

- **Rota:** `financeiro-patrimônio` · **Componente:** `PatrimonioView` ([src/views/PatrimonioView.tsx](../../src/views/PatrimonioView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [produtos_com_custo](tabelas.md#t-produtos_com_custo)
- **Grava direto:** —
- **Chama (RPC):** [dar_baixa_patrimonio](funcoes.md#f-dar_baixa_patrimonio), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [filial_investimentos](tabelas.md#t-filial_investimentos), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [pedidos_venda](tabelas.md#t-pedidos_venda), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [filial_investimentos](tabelas.md#t-filial_investimentos): [Empresa › Filiais](telas.md#s-empresa-filiais)
  - por [produtos](tabelas.md#t-produtos): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [produtos_custo](tabelas.md#t-produtos_custo): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **Arquivos que acessam dados:** `src/components/MontagemFinanceiro.tsx`, `src/views/PatrimonioView.tsx`

<a id="s-financeiro-centrosdecusto"></a>
### Financeiro › Centros de Custo

- **Rota:** `financeiro-centrosdecusto` · **Componente:** `GenericCRUDView` ([src/views/GenericCRUDView.tsx](../../src/views/GenericCRUDView.tsx))
- **Lê:** [centros_custo](tabelas.md#t-centros_custo), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Grava direto:** [centros_custo](tabelas.md#t-centros_custo)
- **Chama (RPC):** —

<a id="s-financeiro-dre"></a>
### Financeiro › DRE

- **Rota:** `financeiro-dre` · **Componente:** `DREView` ([src/views/DREView.tsx](../../src/views/DREView.tsx))
- **Lê:** —
- **Grava direto:** —
- **Chama (RPC):** [gerar_dre](funcoes.md#f-gerar_dre)

<a id="s-financeiro-precificação"></a>
### Financeiro › Precificação

- **Rota:** `financeiro-precificação` · **Componente:** `PrecificacaoView` ([src/views/PrecificacaoView.tsx](../../src/views/PrecificacaoView.tsx))
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto), [produtos_com_custo](tabelas.md#t-produtos_com_custo)
- **Grava direto:** [categorias_produto](tabelas.md#t-categorias_produto)
- **Chama (RPC):** [apurar_das](funcoes.md#f-apurar_das), [das_competencias](funcoes.md#f-das_competencias), [parametros_precificacao](funcoes.md#f-parametros_precificacao), [salvar_lucro_servico](funcoes.md#f-salvar_lucro_servico), [salvar_parametros_precificacao](funcoes.md#f-salvar_parametros_precificacao)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [das_apuracoes](tabelas.md#t-das_apuracoes), [filial_precificacao](tabelas.md#t-filial_precificacao)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [categorias_produto](tabelas.md#t-categorias_produto): [Cadastros › Categorias](telas.md#s-cadastros-categorias)
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [filial_precificacao](tabelas.md#t-filial_precificacao): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços)
- **Arquivos que acessam dados:** `src/hooks/useParametrosPrecificacao.ts`, `src/views/PrecificacaoView.tsx`

<a id="s-financeiro-juros&multa"></a>
### Financeiro › Juros & Multa

- **Rota:** `financeiro-juros&multa` · **Componente:** `ConfigJurosView` ([src/views/ConfigJurosView.tsx](../../src/views/ConfigJurosView.tsx))
- **Lê:** [financeiro_config](tabelas.md#t-financeiro_config)
- **Grava direto:** [financeiro_config](tabelas.md#t-financeiro_config)
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/lib/juros.ts`, `src/views/ConfigJurosView.tsx`

<a id="s-financeiro-aprovaçõesdecotação"></a>
### Financeiro › Aprovações de Cotação

- **Rota:** `financeiro-aprovaçõesdecotação` · **Componente:** `CotacoesView` ([src/views/CotacoesView.tsx](../../src/views/CotacoesView.tsx))
- **Lê:** [alcadas_compra](tabelas.md#t-alcadas_compra), [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [historico_operacoes](tabelas.md#t-historico_operacoes), [notificacoes](tabelas.md#t-notificacoes), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes), [servicos](tabelas.md#t-servicos), [trabalho_reservas](tabelas.md#t-trabalho_reservas), [user_profiles](tabelas.md#t-user_profiles), [v_fornecedor_desempenho](tabelas.md#t-v_fornecedor_desempenho)
- **Grava direto:** [cotacoes](tabelas.md#t-cotacoes)
- **Chama (RPC):** [decidir_cotacao](funcoes.md#f-decidir_cotacao), [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [liberar_trabalho](funcoes.md#f-liberar_trabalho), [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [notificar_setor](funcoes.md#f-notificar_setor), [reabrir_cotacao](funcoes.md#f-reabrir_cotacao), [reenviar_cotacao_corrigida](funcoes.md#f-reenviar_cotacao_corrigida), [renovar_trabalho](funcoes.md#f-renovar_trabalho), [reservar_trabalho](funcoes.md#f-reservar_trabalho)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [notificacoes](tabelas.md#t-notificacoes), [notificacoes_lidas](tabelas.md#t-notificacoes_lidas), [pedidos](tabelas.md#t-pedidos), [requisicoes](tabelas.md#t-requisicoes), [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Escuta em tempo real:** [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [cotacoes](tabelas.md#t-cotacoes): [Compras › Cotações](telas.md#s-compras-cotações), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
  - por [pedidos](tabelas.md#t-pedidos): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
  - por [requisicoes](tabelas.md#t-requisicoes): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Arquivos que acessam dados:** `src/components/FornecedorDesempenho.tsx`, `src/components/HistoricoOperacoes.tsx`, `src/hooks/useNotificacoes.ts`, `src/hooks/useReservaTrabalho.ts`, `src/hooks/useUserProfile.ts`, `src/lib/notificar.ts`, `src/lib/reservasTrabalho.ts`, `src/views/CotacoesView.tsx`

<a id="s-financeiro-aprovaçõesdeorçamento"></a>
### Financeiro › Aprovações de Orçamento

- **Rota:** `financeiro-aprovaçõesdeorçamento` · **Componente:** `OrcamentosView` ([src/views/OrcamentosView.tsx](../../src/views/OrcamentosView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [formas_pagamento](tabelas.md#t-formas_pagamento), [historico_operacoes](tabelas.md#t-historico_operacoes), [notificacoes](tabelas.md#t-notificacoes), [orcamentos](tabelas.md#t-orcamentos), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos_com_custo](tabelas.md#t-produtos_com_custo), [servicos](tabelas.md#t-servicos), [user_profiles](tabelas.md#t-user_profiles), [v_promocao_vigente](tabelas.md#t-v_promocao_vigente)
- **Grava direto:** [orcamentos](tabelas.md#t-orcamentos)
- **Chama (RPC):** [cliente_saldo_devedor](funcoes.md#f-cliente_saldo_devedor), [cliente_titulos_vencidos](funcoes.md#f-cliente_titulos_vencidos), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [notificar_setor](funcoes.md#f-notificar_setor)
- **Grava via RPC:** [contas_receber](tabelas.md#t-contas_receber), [itens_venda](tabelas.md#t-itens_venda), [notas_emitidas](tabelas.md#t-notas_emitidas), [notificacoes](tabelas.md#t-notificacoes), [notificacoes_lidas](tabelas.md#t-notificacoes_lidas), [pedidos_venda](tabelas.md#t-pedidos_venda), [vendas](tabelas.md#t-vendas), [vendas_pagamentos](tabelas.md#t-vendas_pagamentos)
- **Gatilhos levam a mudança até:** [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [marketing_cupons](tabelas.md#t-marketing_cupons), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [itens_venda](tabelas.md#t-itens_venda): [Usuários](telas.md#s-usuarios), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [notas_emitidas](tabelas.md#t-notas_emitidas): [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [orcamentos](tabelas.md#t-orcamentos): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [pedidos_venda](tabelas.md#t-pedidos_venda): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [vendas](tabelas.md#t-vendas): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [vendas_pagamentos](tabelas.md#t-vendas_pagamentos): [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useNotificacoes.ts`, `src/hooks/useUserProfile.ts`, `src/lib/notificar.ts`, `src/views/OrcamentosView.tsx`

<a id="s-financeiro-aprovaçõesdepromoções"></a>
### Financeiro › Aprovações de Promoções

- **Rota:** `financeiro-aprovaçõesdepromoções` · **Componente:** `AprovacoesPromocaoFinanceiroView` ([src/views/AprovacoesPromocaoFinanceiroView.tsx](../../src/views/AprovacoesPromocaoFinanceiroView.tsx))
- **Lê:** [itens_campanha](tabelas.md#t-itens_campanha), [marketing_campanhas](tabelas.md#t-marketing_campanhas), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [produtos_com_custo](tabelas.md#t-produtos_com_custo)
- **Grava direto:** [itens_campanha](tabelas.md#t-itens_campanha), [marketing_campanhas](tabelas.md#t-marketing_campanhas)
- **Chama (RPC):** [analisar_promocao_financeiro](funcoes.md#f-analisar_promocao_financeiro), [aprovar_promocao](funcoes.md#f-aprovar_promocao), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [reprovar_promocao](funcoes.md#f-reprovar_promocao), [reverter_promocoes_expiradas](funcoes.md#f-reverter_promocoes_expiradas)
- **Grava via RPC:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Gatilhos levam a mudança até:** [marketing_artes](tabelas.md#t-marketing_artes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [itens_campanha](tabelas.md#t-itens_campanha): [Marketing › Campanhas](telas.md#s-marketing-campanhas)
  - por [marketing_campanhas](tabelas.md#t-marketing_campanhas): [Marketing › Campanhas](telas.md#s-marketing-campanhas)
  - por [marketing_promocoes](tabelas.md#t-marketing_promocoes): [Marketing › Promoções](telas.md#s-marketing-promoções)

<a id="s-financeiro-aprovaçõesdeconteúdo"></a>
### Financeiro › Aprovações de Conteúdo

- **Rota:** `financeiro-aprovaçõesdeconteúdo` · **Componente:** `AprovacoesConteudoMarketingView` ([src/views/AprovacoesConteudoMarketingView.tsx](../../src/views/AprovacoesConteudoMarketingView.tsx))
- **Lê:** [marketing_tarefas](tabelas.md#t-marketing_tarefas)
- **Grava direto:** [marketing_tarefas](tabelas.md#t-marketing_tarefas)
- **Chama (RPC):** —
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [marketing_tarefas](tabelas.md#t-marketing_tarefas): [Matriz › Briefing Diário](telas.md#s-briefing-diario)

<a id="s-financeiro-alçadas"></a>
### Financeiro › Alçadas

- **Rota:** `financeiro-alçadas` · **Componente:** `AlcadasView` ([src/views/AlcadasView.tsx](../../src/views/AlcadasView.tsx))
- **Lê:** [alcadas_compra](tabelas.md#t-alcadas_compra), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [alcadas_compra](tabelas.md#t-alcadas_compra)
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/AlcadasView.tsx`

<a id="s-financeiro-pedidosdevenda"></a>
### Financeiro › Pedidos de Venda

- **Rota:** `financeiro-pedidosdevenda` · **Componente:** `PedidosVendaView` ([src/views/PedidosVendaView.tsx](../../src/views/PedidosVendaView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [historico_operacoes](tabelas.md#t-historico_operacoes), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [pedidos_venda](tabelas.md#t-pedidos_venda)
- **Chama (RPC):** [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda)
- **Grava via RPC:** [contas_receber](tabelas.md#t-contas_receber), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [orcamentos](tabelas.md#t-orcamentos), [vendas](tabelas.md#t-vendas)
- **Gatilhos levam a mudança até:** [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [marketing_cupons](tabelas.md#t-marketing_cupons), [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [orcamentos](tabelas.md#t-orcamentos): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [pedidos_venda](tabelas.md#t-pedidos_venda): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [vendas](tabelas.md#t-vendas): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/PedidosVendaView.tsx`

<a id="s-financeiro-recibosdevendas"></a>
### Financeiro › Recibos de Vendas

- **Rota:** `financeiro-recibosdevendas` · **Componente:** `RecibosVendasView` ([src/views/RecibosVendasView.tsx](../../src/views/RecibosVendasView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [itens_venda](tabelas.md#t-itens_venda), [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles), [vendas](tabelas.md#t-vendas)
- **Grava direto:** —
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/RecibosVendasView.tsx`

<a id="s-financeiro-notasemitidas"></a>
### Financeiro › Notas Emitidas

- **Rota:** `financeiro-notasemitidas` · **Componente:** `NotasEmitidasView` ([src/views/NotasEmitidasView.tsx](../../src/views/NotasEmitidasView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [historico_operacoes](tabelas.md#t-historico_operacoes), [notas_emitidas](tabelas.md#t-notas_emitidas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [emitir_nota](funcoes.md#f-emitir_nota)
- **Grava via RPC:** [notas_emitidas](tabelas.md#t-notas_emitidas)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [notas_emitidas](tabelas.md#t-notas_emitidas): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/NotasEmitidasView.tsx`

<a id="s-financeiro-capital"></a>
### Financeiro › Capital

- **Rota:** `financeiro-capital` · **Componente:** `FilialCapitalView` ([src/views/FilialCapitalView.tsx](../../src/views/FilialCapitalView.tsx))
- **Lê:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras), [bancos_investimento](tabelas.md#t-bancos_investimento), [caixa_bancos](tabelas.md#t-caixa_bancos), [capital_config](tabelas.md#t-capital_config), [distribuicoes_lucro](tabelas.md#t-distribuicoes_lucro), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [emprestimos_filial](tabelas.md#t-emprestimos_filial)
- **Chama (RPC):** [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao)
- **Grava via RPC:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras), [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_pagar](tabelas.md#t-contas_pagar), [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas), [contas_receber](tabelas.md#t-contas_receber), [historico_operacoes](tabelas.md#t-historico_operacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras): [Capital](telas.md#s-matriz-capital)
  - por [caixa_bancos](tabelas.md#t-caixa_bancos): [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos), [Capital](telas.md#s-matriz-capital), [Usuários](telas.md#s-usuarios)
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas): [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [emprestimos_filial](tabelas.md#t-emprestimos_filial): [Capital](telas.md#s-matriz-capital), [Usuários](telas.md#s-usuarios)
  - por [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo): [Capital](telas.md#s-matriz-capital), [Usuários](telas.md#s-usuarios)
- **Arquivos que acessam dados:** `src/components/AplicacoesPanel.tsx`, `src/components/EmprestimoMemoria.tsx`, `src/hooks/useUserProfile.ts`, `src/views/FilialCapitalView.tsx`

<a id="s-financeiro-gerenciamento"></a>
### Financeiro › Gerenciamento

- **Rota:** `financeiro-gerenciamento` · **Componente:** `GerenciamentoFinanceiroView` ([src/views/GerenciamentoFinanceiroView.tsx](../../src/views/GerenciamentoFinanceiroView.tsx))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [clientes](tabelas.md#t-clientes), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [fornecedores](tabelas.md#t-fornecedores), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/GerenciamentoFinanceiroView.tsx`

<a id="s-financeiro-relatórios"></a>
### Financeiro › Relatórios

- **Rota:** `financeiro-relatórios` · **Componente:** `RelatoriosFinanceirosView` ([src/views/RelatoriosFinanceirosView.tsx](../../src/views/RelatoriosFinanceirosView.tsx))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [clientes](tabelas.md#t-clientes), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [fornecedores](tabelas.md#t-fornecedores)
- **Grava direto:** —
- **Chama (RPC):** —

## Recursos Humanos

<a id="s-rh-funcionários"></a>
### Recursos Humanos › Funcionários

- **Rota:** `rh-funcionários` · **Componente:** `FuncionariosView` ([src/views/FuncionariosView.tsx](../../src/views/FuncionariosView.tsx))
- **Lê:** [beneficios](tabelas.md#t-beneficios), [cargos](tabelas.md#t-cargos), [departamentos](tabelas.md#t-departamentos), [funcionario_beneficios](tabelas.md#t-funcionario_beneficios), [funcionarios](tabelas.md#t-funcionarios), [historico_operacoes](tabelas.md#t-historico_operacoes), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [funcionario_beneficios](tabelas.md#t-funcionario_beneficios), [funcionarios](tabelas.md#t-funcionarios)
- **Chama (RPC):** —
- **Gatilhos levam a mudança até:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [funcionarios](tabelas.md#t-funcionarios): [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção), [Usuários](telas.md#s-usuarios)
- **Arquivos que acessam dados:** `src/components/FuncionarioBeneficiosModal.tsx`, `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/FuncionariosView.tsx`

<a id="s-rh-departamentos"></a>
### Recursos Humanos › Departamentos

- **Rota:** `rh-departamentos` · **Componente:** `GenericCRUDView` ([src/views/GenericCRUDView.tsx](../../src/views/GenericCRUDView.tsx))
- **Lê:** [departamentos](tabelas.md#t-departamentos), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Grava direto:** [departamentos](tabelas.md#t-departamentos)
- **Chama (RPC):** —

<a id="s-rh-cargos"></a>
### Recursos Humanos › Cargos

- **Rota:** `rh-cargos` · **Componente:** `GenericCRUDView` ([src/views/GenericCRUDView.tsx](../../src/views/GenericCRUDView.tsx))
- **Lê:** [cargos](tabelas.md#t-cargos), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Grava direto:** [cargos](tabelas.md#t-cargos)
- **Chama (RPC):** —

<a id="s-rh-registrodeponto"></a>
### Recursos Humanos › Registro de Ponto

- **Rota:** `rh-registrodeponto` · **Componente:** `PontoEletronicoView` ([src/views/PontoEletronicoView.tsx](../../src/views/PontoEletronicoView.tsx))
- **Lê:** [configuracoes](tabelas.md#t-configuracoes), [funcionarios](tabelas.md#t-funcionarios), [justificativas_falta](tabelas.md#t-justificativas_falta), [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [ponto_jornada](tabelas.md#t-ponto_jornada), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows)
- **Chama (RPC):** [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [definir_excecao_calendario](funcoes.md#f-definir_excecao_calendario), [definir_ponto_jornada](funcoes.md#f-definir_ponto_jornada), [dias_letivos_periodo](funcoes.md#f-dias_letivos_periodo), [parecer_justificativa_falta](funcoes.md#f-parecer_justificativa_falta), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [remover_excecao_calendario](funcoes.md#f-remover_excecao_calendario), [remover_ponto](funcoes.md#f-remover_ponto)
- **Grava via RPC:** [justificativas_falta](tabelas.md#t-justificativas_falta), [notificacoes](tabelas.md#t-notificacoes), [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [ponto_jornada](tabelas.md#t-ponto_jornada)
- **Storage:** `max-show-anexos`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [justificativas_falta](tabelas.md#t-justificativas_falta): [Meu Crachá](telas.md#s-meu-cracha)
  - por [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ponto_eletronico](tabelas.md#t-ponto_eletronico): [Crachá Virtual](telas.md#s-cracha-virtual), [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos)
  - por [ponto_jornada](tabelas.md#t-ponto_jornada): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Arquivos que acessam dados:** `src/hooks/useJornadaTurma.ts`, `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/FrequenciaRelatorioTab.tsx`, `src/views/FrequenciaTrabalhoView.tsx`, `src/views/JornadaTurmaConfig.tsx`, `src/views/JustificativasFaltaTab.tsx`, `src/views/PontoEletronicoView.tsx`

<a id="s-rh-férias"></a>
### Recursos Humanos › Férias

- **Rota:** `rh-férias` · **Componente:** `FeriasView` ([src/views/FeriasView.tsx](../../src/views/FeriasView.tsx))
- **Lê:** [ferias](tabelas.md#t-ferias), [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [ferias](tabelas.md#t-ferias)
- **Chama (RPC):** —
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [ferias](tabelas.md#t-ferias): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/FeriasView.tsx`

<a id="s-rh-afastamentos"></a>
### Recursos Humanos › Afastamentos

- **Rota:** `rh-afastamentos` · **Componente:** `AfastamentosView` ([src/views/AfastamentosView.tsx](../../src/views/AfastamentosView.tsx))
- **Lê:** [afastamentos](tabelas.md#t-afastamentos), [configuracoes](tabelas.md#t-configuracoes), [funcionarios](tabelas.md#t-funcionarios), [ponto_jornada](tabelas.md#t-ponto_jornada), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [afastamentos](tabelas.md#t-afastamentos)
- **Chama (RPC):** [aplicar_afastamento_no_ponto](funcoes.md#f-aplicar_afastamento_no_ponto), [dias_letivos_periodo](funcoes.md#f-dias_letivos_periodo)
- **Grava via RPC:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [ponto_eletronico](tabelas.md#t-ponto_eletronico): [Crachá Virtual](telas.md#s-cracha-virtual), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Arquivos que acessam dados:** `src/hooks/useJornadaTurma.ts`, `src/hooks/useUserProfile.ts`, `src/views/AfastamentosView.tsx`

<a id="s-rh-desligamento"></a>
### Recursos Humanos › Desligamento

- **Rota:** `rh-desligamento` · **Componente:** `DesligamentosView` ([src/views/DesligamentosView.tsx](../../src/views/DesligamentosView.tsx))
- **Lê:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [rescisoes](tabelas.md#t-rescisoes), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [calcular_rescisao](funcoes.md#f-calcular_rescisao), [decidir_desligamento](funcoes.md#f-decidir_desligamento), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [processar_rescisao](funcoes.md#f-processar_rescisao), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [rescisoes](tabelas.md#t-rescisoes), [user_profiles](tabelas.md#t-user_profiles)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [caixa_bancos](tabelas.md#t-caixa_bancos), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [funcionarios](tabelas.md#t-funcionarios): [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção), [Usuários](telas.md#s-usuarios)
  - por [user_profiles](tabelas.md#t-user_profiles): [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos), [Usuários](telas.md#s-usuarios)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/DesligamentosView.tsx`

<a id="s-rh-recrutamentoeseleção"></a>
### Recursos Humanos › Recrutamento e Seleção

- **Rota:** `rh-recrutamentoeseleção` · **Componente:** `RecrutamentoView` ([src/views/RecrutamentoView.tsx](../../src/views/RecrutamentoView.tsx))
- **Lê:** [candidatura_etapas](tabelas.md#t-candidatura_etapas), [candidaturas](tabelas.md#t-candidaturas), [cargos](tabelas.md#t-cargos), [departamentos](tabelas.md#t-departamentos), [funcionarios](tabelas.md#t-funcionarios), [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [user_profiles](tabelas.md#t-user_profiles), [vaga_convites](tabelas.md#t-vaga_convites), [vagas](tabelas.md#t-vagas)
- **Grava direto:** —
- **Chama (RPC):** [abrir_vaga](funcoes.md#f-abrir_vaga), [abrir_vaga_interna](funcoes.md#f-abrir_vaga_interna), [cancelar_convite_vaga](funcoes.md#f-cancelar_convite_vaga), [cancelar_vaga](funcoes.md#f-cancelar_vaga), [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [decidir_vaga](funcoes.md#f-decidir_vaga), [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios), [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [marcar_acesso_ajustado](funcoes.md#f-marcar_acesso_ajustado), [mover_candidatura](funcoes.md#f-mover_candidatura), [registrar_candidatura](funcoes.md#f-registrar_candidatura), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [vincular_acesso_funcionario](funcoes.md#f-vincular_acesso_funcionario)
- **Grava via RPC:** [candidatura_etapas](tabelas.md#t-candidatura_etapas), [candidaturas](tabelas.md#t-candidaturas), [funcionarios](tabelas.md#t-funcionarios), [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [notificacoes](tabelas.md#t-notificacoes), [vaga_convites](tabelas.md#t-vaga_convites), [vagas](tabelas.md#t-vagas)
- **API do servidor:** `/api/users`
- **Storage:** `curriculos`
- **Gatilhos levam a mudança até:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [funcionarios](tabelas.md#t-funcionarios): [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários), [Usuários](telas.md#s-usuarios)
  - por [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira): [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/RecrutamentoView.tsx`

<a id="s-rh-folhadepagamento"></a>
### Recursos Humanos › Folha de Pagamento

- **Rota:** `rh-folhadepagamento` · **Componente:** `FolhaPagamentoView` ([src/views/FolhaPagamentoView.tsx](../../src/views/FolhaPagamentoView.tsx))
- **Lê:** [configuracoes](tabelas.md#t-configuracoes), [folha_pagamento](tabelas.md#t-folha_pagamento), [folha_rubricas](tabelas.md#t-folha_rubricas), [funcionarios](tabelas.md#t-funcionarios), [historico_operacoes](tabelas.md#t-historico_operacoes), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [ponto_jornada](tabelas.md#t-ponto_jornada), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [folha_pagamento](tabelas.md#t-folha_pagamento)
- **Chama (RPC):** [beneficios_do_funcionario](funcoes.md#f-beneficios_do_funcionario), [dias_letivos_periodo](funcoes.md#f-dias_letivos_periodo), [excluir_transacao_maxbank](funcoes.md#f-excluir_transacao_maxbank), [pagar_folha](funcoes.md#f-pagar_folha), [processar_folha](funcoes.md#f-processar_folha), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [recompute_saldos_maxbank](funcoes.md#f-recompute_saldos_maxbank), [reverter_folha_maxbank](funcoes.md#f-reverter_folha_maxbank)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_rubricas](tabelas.md#t-folha_rubricas), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [notificacoes](tabelas.md#t-notificacoes)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [fretes_compra](tabelas.md#t-fretes_compra), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [maxbank_contas](tabelas.md#t-maxbank_contas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
  - por [maxbank_transacoes](tabelas.md#t-maxbank_transacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useJornadaTurma.ts`, `src/hooks/useUserProfile.ts`, `src/views/FolhaPagamentoView.tsx`

<a id="s-rh-mandatos"></a>
### Recursos Humanos › Mandatos

- **Rota:** `rh-mandatos` · **Componente:** `MandatosView` ([src/views/MandatosView.tsx](../../src/views/MandatosView.tsx))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz), [mandatos](tabelas.md#t-mandatos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [encerrar_mandato](funcoes.md#f-encerrar_mandato), [nomear_mandato](funcoes.md#f-nomear_mandato)
- **Grava via RPC:** [mandatos](tabelas.md#t-mandatos), [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [user_profiles](tabelas.md#t-user_profiles)
- **Gatilhos levam a mudança até:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [funcionarios](tabelas.md#t-funcionarios), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [maxbank_contas](tabelas.md#t-maxbank_contas)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira): [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
  - por [user_profiles](tabelas.md#t-user_profiles): [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Usuários](telas.md#s-usuarios)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/MandatosView.tsx`

<a id="s-rh-benefícios"></a>
### Recursos Humanos › Benefícios

- **Rota:** `rh-benefícios` · **Componente:** `GenericCRUDView` ([src/views/GenericCRUDView.tsx](../../src/views/GenericCRUDView.tsx))
- **Lê:** [beneficios](tabelas.md#t-beneficios), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Grava direto:** [beneficios](tabelas.md#t-beneficios)
- **Chama (RPC):** —

<a id="s-rh-treinamentos"></a>
### Recursos Humanos › Treinamentos

- **Rota:** `rh-treinamentos` · **Componente:** `TreinamentosView` ([src/views/TreinamentosView.tsx](../../src/views/TreinamentosView.tsx))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [notificacoes](tabelas.md#t-notificacoes), [treinamento_inscricoes](tabelas.md#t-treinamento_inscricoes), [treinamentos](tabelas.md#t-treinamentos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [treinamento_inscricoes](tabelas.md#t-treinamento_inscricoes), [treinamentos](tabelas.md#t-treinamentos)
- **Chama (RPC):** [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [notificar_setor](funcoes.md#f-notificar_setor)
- **Grava via RPC:** [notificacoes](tabelas.md#t-notificacoes), [notificacoes_lidas](tabelas.md#t-notificacoes_lidas)
- **Arquivos que acessam dados:** `src/components/TreinamentoInscricoesModal.tsx`, `src/hooks/useNotificacoes.ts`, `src/lib/notificar.ts`, `src/views/TreinamentosView.tsx`

<a id="s-rh-pesquisas"></a>
### Recursos Humanos › Pesquisas

- **Rota:** `rh-pesquisas` · **Componente:** `PesquisasView` ([src/views/PesquisasView.tsx](../../src/views/PesquisasView.tsx))
- **Lê:** [pesquisa_perguntas](tabelas.md#t-pesquisa_perguntas), [pesquisa_resposta_itens](tabelas.md#t-pesquisa_resposta_itens), [pesquisa_respostas](tabelas.md#t-pesquisa_respostas), [pesquisas](tabelas.md#t-pesquisas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [pesquisa_perguntas](tabelas.md#t-pesquisa_perguntas), [pesquisas](tabelas.md#t-pesquisas)
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/PesquisasView.tsx`

<a id="s-rh-gerenciamento"></a>
### Recursos Humanos › Gerenciamento

- **Rota:** `rh-gerenciamento` · **Componente:** `GerenciamentoRHView` ([src/views/GerenciamentoRHView.tsx](../../src/views/GerenciamentoRHView.tsx))
- **Lê:** [ferias](tabelas.md#t-ferias), [folha_pagamento](tabelas.md#t-folha_pagamento), [funcionarios](tabelas.md#t-funcionarios), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [treinamentos](tabelas.md#t-treinamentos)
- **Grava direto:** —
- **Chama (RPC):** —

<a id="s-rh-relatórios"></a>
### Recursos Humanos › Relatórios

- **Rota:** `rh-relatórios` · **Componente:** `RelatoriosRHView` ([src/views/RelatoriosRHView.tsx](../../src/views/RelatoriosRHView.tsx))
- **Lê:** [ferias](tabelas.md#t-ferias), [folha_pagamento](tabelas.md#t-folha_pagamento), [funcionarios](tabelas.md#t-funcionarios), [treinamentos](tabelas.md#t-treinamentos)
- **Grava direto:** —
- **Chama (RPC):** —

## Vendas

<a id="s-vendas-pdv"></a>
### Vendas › PDV

- **Rota:** `vendas-pdv` · **Componente:** `PDVView` ([src/views/PDVView.tsx](../../src/views/PDVView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [controle_caixa](tabelas.md#t-controle_caixa), [itens_venda](tabelas.md#t-itens_venda), [produtos](tabelas.md#t-produtos), [servicos](tabelas.md#t-servicos), [user_profiles](tabelas.md#t-user_profiles), [v_promocao_vigente](tabelas.md#t-v_promocao_vigente), [v_venda_saldo_devolucao](tabelas.md#t-v_venda_saldo_devolucao), [vendas](tabelas.md#t-vendas)
- **Grava direto:** [cartao_pendentes](tabelas.md#t-cartao_pendentes), [controle_caixa](tabelas.md#t-controle_caixa), [pix_pendentes](tabelas.md#t-pix_pendentes), [vendas](tabelas.md#t-vendas)
- **Chama (RPC):** [cliente_saldo_devedor](funcoes.md#f-cliente_saldo_devedor), [cliente_titulos_vencidos](funcoes.md#f-cliente_titulos_vencidos), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [fechar_caixa_conferido](funcoes.md#f-fechar_caixa_conferido), [pdv_registrar_credito_misto](funcoes.md#f-pdv_registrar_credito_misto), [previa_fechamento_caixa](funcoes.md#f-previa_fechamento_caixa), [registrar_movimentacao_caixa](funcoes.md#f-registrar_movimentacao_caixa), [solicitar_fechamento_caixa](funcoes.md#f-solicitar_fechamento_caixa), [suspender_caixa](funcoes.md#f-suspender_caixa), [validar_cupom](funcoes.md#f-validar_cupom)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [devolucoes](tabelas.md#t-devolucoes), [itens_devolucao](tabelas.md#t-itens_devolucao), [itens_venda](tabelas.md#t-itens_venda), [marketing_cupons](tabelas.md#t-marketing_cupons), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [notas_emitidas](tabelas.md#t-notas_emitidas), [vendas_pagamentos](tabelas.md#t-vendas_pagamentos)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [pedidos_venda](tabelas.md#t-pedidos_venda), [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções)
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [controle_caixa](tabelas.md#t-controle_caixa): [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa)
  - por [devolucoes](tabelas.md#t-devolucoes): [Vendas › Devoluções](telas.md#s-vendas-devoluções)
  - por [itens_devolucao](tabelas.md#t-itens_devolucao): [Vendas › Devoluções](telas.md#s-vendas-devoluções)
  - por [itens_venda](tabelas.md#t-itens_venda): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Usuários](telas.md#s-usuarios), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [marketing_cupons](tabelas.md#t-marketing_cupons): [Marketing › Cupons](telas.md#s-marketing-cupons), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa): [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Vendas › Devoluções](telas.md#s-vendas-devoluções)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [notas_emitidas](tabelas.md#t-notas_emitidas): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [vendas](tabelas.md#t-vendas): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [vendas_pagamentos](tabelas.md#t-vendas_pagamentos): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/PDVFecharCaixa.tsx`, `src/hooks/useAbrirCaixa.ts`, `src/hooks/useCaixaAberto.ts`, `src/hooks/useUserProfile.ts`, `src/lib/credito.ts`, `src/lib/pdv/cobranca.ts`, `src/views/PDVView.tsx`, `src/views/PDVViewSupermax.tsx`

<a id="s-vendas-clientes"></a>
### Vendas › Clientes

- **Rota:** `vendas-clientes` · **Componente:** `CRMView` ([src/views/CRMView.tsx](../../src/views/CRMView.tsx))
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto), [centros_custo](tabelas.md#t-centros_custo), [clientes](tabelas.md#t-clientes), [fornecedores](tabelas.md#t-fornecedores), [historico_operacoes](tabelas.md#t-historico_operacoes), [planilhas_trabalho](tabelas.md#t-planilhas_trabalho), [produtos](tabelas.md#t-produtos), [subcategorias_produto](tabelas.md#t-subcategorias_produto)
- **Grava direto:** [clientes](tabelas.md#t-clientes), [planilhas_trabalho](tabelas.md#t-planilhas_trabalho)
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/lib/modelosPlanilha.ts`, `src/lib/planilhasTrabalho.ts`, `src/views/CRMView.tsx`

<a id="s-vendas-orçamentos"></a>
### Vendas › Orçamentos

- **Rota:** `vendas-orçamentos` · **Componente:** `OrcamentosView` ([src/views/OrcamentosView.tsx](../../src/views/OrcamentosView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [formas_pagamento](tabelas.md#t-formas_pagamento), [historico_operacoes](tabelas.md#t-historico_operacoes), [notificacoes](tabelas.md#t-notificacoes), [orcamentos](tabelas.md#t-orcamentos), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos_com_custo](tabelas.md#t-produtos_com_custo), [servicos](tabelas.md#t-servicos), [user_profiles](tabelas.md#t-user_profiles), [v_promocao_vigente](tabelas.md#t-v_promocao_vigente)
- **Grava direto:** [orcamentos](tabelas.md#t-orcamentos)
- **Chama (RPC):** [cliente_saldo_devedor](funcoes.md#f-cliente_saldo_devedor), [cliente_titulos_vencidos](funcoes.md#f-cliente_titulos_vencidos), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [notificar_setor](funcoes.md#f-notificar_setor)
- **Grava via RPC:** [contas_receber](tabelas.md#t-contas_receber), [itens_venda](tabelas.md#t-itens_venda), [notas_emitidas](tabelas.md#t-notas_emitidas), [notificacoes](tabelas.md#t-notificacoes), [notificacoes_lidas](tabelas.md#t-notificacoes_lidas), [pedidos_venda](tabelas.md#t-pedidos_venda), [vendas](tabelas.md#t-vendas), [vendas_pagamentos](tabelas.md#t-vendas_pagamentos)
- **Gatilhos levam a mudança até:** [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [marketing_cupons](tabelas.md#t-marketing_cupons), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [itens_venda](tabelas.md#t-itens_venda): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Usuários](telas.md#s-usuarios), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [notas_emitidas](tabelas.md#t-notas_emitidas): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [orcamentos](tabelas.md#t-orcamentos): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [pedidos_venda](tabelas.md#t-pedidos_venda): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [vendas](tabelas.md#t-vendas): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [vendas_pagamentos](tabelas.md#t-vendas_pagamentos): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useNotificacoes.ts`, `src/hooks/useUserProfile.ts`, `src/lib/notificar.ts`, `src/views/OrcamentosView.tsx`

<a id="s-vendas-pedidosdevenda"></a>
### Vendas › Pedidos de Venda

- **Rota:** `vendas-pedidosdevenda` · **Componente:** `PedidosVendaView` ([src/views/PedidosVendaView.tsx](../../src/views/PedidosVendaView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [historico_operacoes](tabelas.md#t-historico_operacoes), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [pedidos_venda](tabelas.md#t-pedidos_venda)
- **Chama (RPC):** [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda)
- **Grava via RPC:** [contas_receber](tabelas.md#t-contas_receber), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [orcamentos](tabelas.md#t-orcamentos), [vendas](tabelas.md#t-vendas)
- **Gatilhos levam a mudança até:** [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [marketing_cupons](tabelas.md#t-marketing_cupons), [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [orcamentos](tabelas.md#t-orcamentos): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
  - por [pedidos_venda](tabelas.md#t-pedidos_venda): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
  - por [vendas](tabelas.md#t-vendas): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/PedidosVendaView.tsx`

<a id="s-vendas-pedidosonline"></a>
### Vendas › Pedidos Online

- **Rota:** `vendas-pedidosonline` · **Componente:** `PedidosOnlineView` ([src/views/PedidosOnlineView.tsx](../../src/views/PedidosOnlineView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [loja_config](tabelas.md#t-loja_config), [pedidos_online](tabelas.md#t-pedidos_online), [pedidos_online_itens](tabelas.md#t-pedidos_online_itens), [produtos](tabelas.md#t-produtos)
- **Grava direto:** [loja_config](tabelas.md#t-loja_config), [pedidos_online](tabelas.md#t-pedidos_online), [produtos](tabelas.md#t-produtos)
- **Chama (RPC):** [cancelar_pedido_online](funcoes.md#f-cancelar_pedido_online), [confirmar_pedido_online](funcoes.md#f-confirmar_pedido_online)
- **Grava via RPC:** [contas_receber](tabelas.md#t-contas_receber), [itens_venda](tabelas.md#t-itens_venda), [marketing_cupons](tabelas.md#t-marketing_cupons), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [notas_emitidas](tabelas.md#t-notas_emitidas), [vendas](tabelas.md#t-vendas), [vendas_pagamentos](tabelas.md#t-vendas_pagamentos)
- **Gatilhos levam a mudança até:** [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [pedidos_venda](tabelas.md#t-pedidos_venda), [produto_unidades](tabelas.md#t-produto_unidades), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [itens_venda](tabelas.md#t-itens_venda): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Usuários](telas.md#s-usuarios), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [marketing_cupons](tabelas.md#t-marketing_cupons): [Marketing › Cupons](telas.md#s-marketing-cupons), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [notas_emitidas](tabelas.md#t-notas_emitidas): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [produtos](tabelas.md#t-produtos): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
  - por [vendas](tabelas.md#t-vendas): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
  - por [vendas_pagamentos](tabelas.md#t-vendas_pagamentos): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv)

<a id="s-vendas-históricodevendas"></a>
### Vendas › Histórico de Vendas

- **Rota:** `vendas-históricodevendas` · **Componente:** `HistoricoVendasView` ([src/views/HistoricoVendasView.tsx](../../src/views/HistoricoVendasView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [historico_operacoes](tabelas.md#t-historico_operacoes), [itens_venda](tabelas.md#t-itens_venda), [pedidos_online](tabelas.md#t-pedidos_online), [vendas](tabelas.md#t-vendas)
- **Grava direto:** [vendas](tabelas.md#t-vendas)
- **Chama (RPC):** —
- **Gatilhos levam a mudança até:** [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [contas_receber](tabelas.md#t-contas_receber), [marketing_cupons](tabelas.md#t-marketing_cupons), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos_venda](tabelas.md#t-pedidos_venda), [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [vendas](tabelas.md#t-vendas): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/contexts/AIAssistantContext.tsx`, `src/views/HistoricoVendasView.tsx`

<a id="s-vendas-devoluções"></a>
### Vendas › Devoluções

- **Rota:** `vendas-devoluções` · **Componente:** `DevolucoesView` ([src/views/DevolucoesView.tsx](../../src/views/DevolucoesView.tsx))
- **Lê:** [devolucoes](tabelas.md#t-devolucoes), [historico_operacoes](tabelas.md#t-historico_operacoes), [user_profiles](tabelas.md#t-user_profiles), [v_venda_saldo_devolucao](tabelas.md#t-v_venda_saldo_devolucao), [vendas](tabelas.md#t-vendas)
- **Grava direto:** —
- **Chama (RPC):** [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [devolucoes](tabelas.md#t-devolucoes), [itens_devolucao](tabelas.md#t-itens_devolucao), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [consumos_material](tabelas.md#t-consumos_material), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [pedidos_venda](tabelas.md#t-pedidos_venda), [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [devolucoes](tabelas.md#t-devolucoes): [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [itens_devolucao](tabelas.md#t-itens_devolucao): [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa): [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/components/HistoricoOperacoes.tsx`, `src/hooks/useUserProfile.ts`, `src/views/DevolucoesView.tsx`

<a id="s-vendas-treinamento"></a>
### Vendas › Treinamento

- **Rota:** `vendas-treinamento` · **Componente:** `TreinamentoVendasView` ([src/views/TreinamentoVendasView.tsx](../../src/views/TreinamentoVendasView.tsx))
- **Lê:** —
- **Grava direto:** —
- **Chama (RPC):** —

## Marketing

<a id="s-marketing-redessociais"></a>
### Marketing › Redes Sociais

- **Rota:** `marketing-redessociais` · **Componente:** `MetricasRedesSociaisView` ([src/views/MetricasRedesSociaisView.tsx](../../src/views/MetricasRedesSociaisView.tsx))
- **Lê:** [metricas_redes_sociais](tabelas.md#t-metricas_redes_sociais), [redes_sociais_links](tabelas.md#t-redes_sociais_links), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [metricas_redes_sociais](tabelas.md#t-metricas_redes_sociais), [redes_sociais_links](tabelas.md#t-redes_sociais_links)
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/MetricasRedesSociaisView.tsx`

<a id="s-marketing-campanhas"></a>
### Marketing › Campanhas

- **Rota:** `marketing-campanhas` · **Componente:** `CampanhasMarketingView` ([src/views/CampanhasMarketingView.tsx](../../src/views/CampanhasMarketingView.tsx))
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto), [itens_campanha](tabelas.md#t-itens_campanha), [marketing_campanhas](tabelas.md#t-marketing_campanhas), [produtos](tabelas.md#t-produtos), [subcategorias_produto](tabelas.md#t-subcategorias_produto), [user_profiles](tabelas.md#t-user_profiles), [v_campanha_roi](tabelas.md#t-v_campanha_roi)
- **Grava direto:** [itens_campanha](tabelas.md#t-itens_campanha), [marketing_campanhas](tabelas.md#t-marketing_campanhas)
- **Chama (RPC):** —
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [itens_campanha](tabelas.md#t-itens_campanha): [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções)
  - por [marketing_campanhas](tabelas.md#t-marketing_campanhas): [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/CampanhasMarketingView.tsx`

<a id="s-marketing-promoções"></a>
### Marketing › Promoções

- **Rota:** `marketing-promoções` · **Componente:** `PromocoesMarketingView` ([src/views/PromocoesMarketingView.tsx](../../src/views/PromocoesMarketingView.tsx))
- **Lê:** [marketing_artes](tabelas.md#t-marketing_artes), [marketing_campanhas](tabelas.md#t-marketing_campanhas), [marketing_config](tabelas.md#t-marketing_config), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [notificacoes](tabelas.md#t-notificacoes), [produtos_com_custo](tabelas.md#t-produtos_com_custo), [servicos](tabelas.md#t-servicos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [marketing_artes](tabelas.md#t-marketing_artes), [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Chama (RPC):** [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [notificar_setor](funcoes.md#f-notificar_setor), [reverter_promocoes_expiradas](funcoes.md#f-reverter_promocoes_expiradas)
- **Grava via RPC:** [notificacoes](tabelas.md#t-notificacoes), [notificacoes_lidas](tabelas.md#t-notificacoes_lidas)
- **API do servidor:** `/api/ai-legenda`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [marketing_artes](tabelas.md#t-marketing_artes): [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
  - por [marketing_promocoes](tabelas.md#t-marketing_promocoes): [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções)
- **Arquivos que acessam dados:** `src/hooks/useNotificacoes.ts`, `src/hooks/useUserProfile.ts`, `src/lib/notificar.ts`, `src/views/PromocoesMarketingView.tsx`

<a id="s-marketing-cupons"></a>
### Marketing › Cupons

- **Rota:** `marketing-cupons` · **Componente:** `CuponsMarketingView` ([src/views/CuponsMarketingView.tsx](../../src/views/CuponsMarketingView.tsx))
- **Lê:** [marketing_campanhas](tabelas.md#t-marketing_campanhas), [marketing_cupons](tabelas.md#t-marketing_cupons), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [marketing_cupons](tabelas.md#t-marketing_cupons)
- **Chama (RPC):** —
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [marketing_cupons](tabelas.md#t-marketing_cupons): [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/CuponsMarketingView.tsx`

<a id="s-marketing-calendário"></a>
### Marketing › Calendário

- **Rota:** `marketing-calendário` · **Componente:** `CalendarioEditorialView` ([src/views/CalendarioEditorialView.tsx](../../src/views/CalendarioEditorialView.tsx))
- **Lê:** [marketing_calendario](tabelas.md#t-marketing_calendario), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [marketing_calendario](tabelas.md#t-marketing_calendario)
- **Chama (RPC):** —
- **API do servidor:** `/api/ai-legenda`
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/CalendarioEditorialView.tsx`

## TI & Suporte

<a id="s-ti-desenvolvimentocomia"></a>
### TI & Suporte › Desenvolvimento com IA

- **Rota:** `ti-desenvolvimentocomia` · **Componente:** `DesenvolvimentoIAView` ([src/views/DesenvolvimentoIAView.tsx](../../src/views/DesenvolvimentoIAView.tsx))
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [desenvolvimentos_ia](tabelas.md#t-desenvolvimentos_ia), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [desenvolvimentos_ia](tabelas.md#t-desenvolvimentos_ia)
- **Chama (RPC):** [criar_avaliacao_ti_dev_ia](funcoes.md#f-criar_avaliacao_ti_dev_ia), [listar_pessoas_treinamento_ia](funcoes.md#f-listar_pessoas_treinamento_ia)
- **Grava via RPC:** [avaliacoes](tabelas.md#t-avaliacoes), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [avaliacoes](tabelas.md#t-avaliacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Usuários](telas.md#s-usuarios)
  - por [criterios_avaliacao](tabelas.md#t-criterios_avaliacao): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [desenvolvimentos_ia](tabelas.md#t-desenvolvimentos_ia): [Usuários](telas.md#s-usuarios)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/DesenvolvimentoIAView.tsx`

## Matriz › Governança

<a id="s-vendas-clienteespecial"></a>
### Matriz › Governança › Cliente Especial

- **Rota:** `vendas-clienteespecial` · **Componente:** `ClienteEspecialView` ([src/views/ClienteEspecialView.tsx](../../src/views/ClienteEspecialView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [notificacoes](tabelas.md#t-notificacoes), [orcamentos](tabelas.md#t-orcamentos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [orcamentos](tabelas.md#t-orcamentos)
- **Chama (RPC):** [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [notificar_setor](funcoes.md#f-notificar_setor)
- **Grava via RPC:** [notificacoes](tabelas.md#t-notificacoes), [notificacoes_lidas](tabelas.md#t-notificacoes_lidas)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [orcamentos](tabelas.md#t-orcamentos): [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
- **Arquivos que acessam dados:** `src/hooks/useNotificacoes.ts`, `src/hooks/useUserProfile.ts`, `src/lib/notificar.ts`, `src/views/ClienteEspecialView.tsx`

## Outras telas (barra lateral, hubs, atalhos)

<a id="s-analise-ia"></a>
### Análise com IA

- **Rota:** `analise-ia` · **Componente:** `HubView` ([src/views/SessoesGeraisView.tsx](../../src/views/SessoesGeraisView.tsx))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** —

<a id="s-artes-promocionais"></a>
### Artes promocionais *(rota artes-promocionais)*

- **Rota:** `artes-promocionais` · **Componente:** `ArtesPromocionaisView` ([src/views/ArtesPromocionaisView.tsx](../../src/views/ArtesPromocionaisView.tsx))
- **Lê:** [marketing_artes](tabelas.md#t-marketing_artes)
- **Grava direto:** —
- **Chama (RPC):** —

<a id="s-aula-atividade"></a>
### Atividade da aula

- **Rota:** `aula-atividade` · **Componente:** `AulaAtividadeView` ([src/views/AulaAtividadeView.tsx](../../src/views/AulaAtividadeView.tsx))
- **Lê:** [aula_atividades](tabelas.md#t-aula_atividades), [aula_atividades_ciencia](tabelas.md#t-aula_atividades_ciencia), [aula_config](tabelas.md#t-aula_config), [aula_tarefas_realizadas](tabelas.md#t-aula_tarefas_realizadas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows)
- **Chama (RPC):** [dar_ciencia_atividade](funcoes.md#f-dar_ciencia_atividade)
- **Grava via RPC:** [aula_atividades_ciencia](tabelas.md#t-aula_atividades_ciencia)
- **Storage:** `max-show-anexos`
- **Escuta em tempo real:** [aula_config](tabelas.md#t-aula_config)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aula_atividades_ciencia](tabelas.md#t-aula_atividades_ciencia): [Modo Aula](telas.md#s-aula-modo)
- **Arquivos que acessam dados:** `src/hooks/useAulaAtividades.ts`, `src/hooks/useAulaConfig.ts`, `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`

<a id="s-aula-modo"></a>
### Modo Aula

- **Rota:** `aula-modo` · **Componente:** `AulaModoView` ([src/views/AulaModoView.tsx](../../src/views/AulaModoView.tsx))
- **Lê:** [aula_atividades](tabelas.md#t-aula_atividades), [aula_atividades_ciencia](tabelas.md#t-aula_atividades_ciencia), [aula_config](tabelas.md#t-aula_config), [aula_grupo_apoio](tabelas.md#t-aula_grupo_apoio), [aula_grupo_apoio_config](tabelas.md#t-aula_grupo_apoio_config), [aula_sessoes](tabelas.md#t-aula_sessoes), [aula_tarefas_realizadas](tabelas.md#t-aula_tarefas_realizadas), [blackout_config](tabelas.md#t-blackout_config), [trabalho_reservas](tabelas.md#t-trabalho_reservas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [aula_config](tabelas.md#t-aula_config), [aula_grupo_apoio](tabelas.md#t-aula_grupo_apoio), [aula_grupo_apoio_config](tabelas.md#t-aula_grupo_apoio_config), [comandos_turma](tabelas.md#t-comandos_turma), [max_shows](tabelas.md#t-max_shows)
- **Chama (RPC):** [alternar_simulacao_perda](funcoes.md#f-alternar_simulacao_perda), [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [dar_ciencia_atividade](funcoes.md#f-dar_ciencia_atividade), [liberar_trabalho_forcado](funcoes.md#f-liberar_trabalho_forcado), [listar_pendencias](funcoes.md#f-listar_pendencias), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [marcar_tarefa_aula](funcoes.md#f-marcar_tarefa_aula), [nomear_sessao_aula](funcoes.md#f-nomear_sessao_aula), [publicar_atividade_aula](funcoes.md#f-publicar_atividade_aula), [remover_atividade_aula](funcoes.md#f-remover_atividade_aula), [vincular_sessao_aula](funcoes.md#f-vincular_sessao_aula)
- **Grava via RPC:** [aula_atividades](tabelas.md#t-aula_atividades), [aula_atividades_ciencia](tabelas.md#t-aula_atividades_ciencia), [aula_sessoes](tabelas.md#t-aula_sessoes), [aula_tarefas_realizadas](tabelas.md#t-aula_tarefas_realizadas), [blackout_config](tabelas.md#t-blackout_config), [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Storage:** `max-show-anexos`
- **Escuta em tempo real:** [aula_config](tabelas.md#t-aula_config), [blackout_config](tabelas.md#t-blackout_config), [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aula_atividades_ciencia](tabelas.md#t-aula_atividades_ciencia): [Atividade da aula](telas.md#s-aula-atividade)
  - por [comandos_turma](tabelas.md#t-comandos_turma): [TI & Suporte › Relógiodasmáquinas *(rota ti-relógiodasmáquinas)*](telas.md#s-ti-relógiodasmáquinas)
- **Arquivos que acessam dados:** `src/components/BotaoRecarregarTurma.tsx`, `src/hooks/useAulaAtividades.ts`, `src/hooks/useAulaConfig.ts`, `src/hooks/useBlackout.ts`, `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/lib/reservasTrabalho.ts`, `src/views/AulaAtividadeModal.tsx`, `src/views/AulaAtividadesPublicadas.tsx`, `src/views/AulaConferenciaFluxo.tsx`, `src/views/AulaGrupoApoio.tsx`, `src/views/AulaHistorico.tsx`, `src/views/AulaModoView.tsx`, `src/views/AulaPainelControle.tsx`, `src/views/PendenciasView.tsx`

<a id="s-avaliacoes"></a>
### Central de Avaliação

- **Rota:** `avaliacoes` · **Componente:** `CentralAvaliacaoView` ([src/views/CentralAvaliacaoView.tsx](../../src/views/CentralAvaliacaoView.tsx))
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [avisos_matriz](tabelas.md#t-avisos_matriz), [avisos_matriz_ciencia](tabelas.md#t-avisos_matriz_ciencia), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao), [evidencias-avaliacao](tabelas.md#t-evidencias-avaliacao), [funcionarios](tabelas.md#t-funcionarios), [metas_estrategicas](tabelas.md#t-metas_estrategicas), [pdi_itens](tabelas.md#t-pdi_itens), [treinamentos](tabelas.md#t-treinamentos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [avaliacoes](tabelas.md#t-avaliacoes), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao), [max_shows](tabelas.md#t-max_shows), [metas_estrategicas](tabelas.md#t-metas_estrategicas), [pdi_itens](tabelas.md#t-pdi_itens)
- **Chama (RPC):** [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [atualizar_avaliacao](funcoes.md#f-atualizar_avaliacao), [atualizar_ciclo_tarefa](funcoes.md#f-atualizar_ciclo_tarefa), [avaliar_ciclo_tarefa](funcoes.md#f-avaliar_ciclo_tarefa), [calcular_placar_competicao](funcoes.md#f-calcular_placar_competicao), [calcular_placar_padrao](funcoes.md#f-calcular_placar_padrao), [cancelar_meta_estrategica](funcoes.md#f-cancelar_meta_estrategica), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [criar_avaliacao](funcoes.md#f-criar_avaliacao), [criar_avaliacao_filial](funcoes.md#f-criar_avaliacao_filial), [criar_aviso_matriz](funcoes.md#f-criar_aviso_matriz), [criar_ciclo_tarefa](funcoes.md#f-criar_ciclo_tarefa), [criar_meta_estrategica](funcoes.md#f-criar_meta_estrategica), [dar_ciencia_aviso](funcoes.md#f-dar_ciencia_aviso), [definir_avaliadores_ciclo_tarefa](funcoes.md#f-definir_avaliadores_ciclo_tarefa), [editar_meta_estrategica](funcoes.md#f-editar_meta_estrategica), [pausar_meta_estrategica](funcoes.md#f-pausar_meta_estrategica), [publicar_meta_estrategica](funcoes.md#f-publicar_meta_estrategica), [reabrir_meta_estrategica](funcoes.md#f-reabrir_meta_estrategica), [remover_aviso_matriz](funcoes.md#f-remover_aviso_matriz)
- **Grava via RPC:** [avisos_matriz](tabelas.md#t-avisos_matriz), [avisos_matriz_ciencia](tabelas.md#t-avisos_matriz_ciencia), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [ferias](tabelas.md#t-ferias), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Storage:** `evidencias-avaliacao`, `max-show-anexos`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [avaliacoes](tabelas.md#t-avaliacoes): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia), [Usuários](telas.md#s-usuarios)
  - por [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ciclo_tarefas](tabelas.md#t-ciclo_tarefas): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [criterios_avaliacao](tabelas.md#t-criterios_avaliacao): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
  - por [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ferias](tabelas.md#t-ferias): [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Férias](telas.md#s-rh-férias)
  - por [maxbank_contas](tabelas.md#t-maxbank_contas): [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas): [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
  - por [maxbank_transacoes](tabelas.md#t-maxbank_transacoes): [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [metas_estrategicas](tabelas.md#t-metas_estrategicas): [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
  - por [pdi_itens](tabelas.md#t-pdi_itens): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [tarefas_taticas](tabelas.md#t-tarefas_taticas): [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Arquivos que acessam dados:** `src/components/PDISection.tsx`, `src/hooks/useAvisosMatriz.ts`, `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/AvaliacoesView.tsx`, `src/views/CicloTarefasPanel.tsx`, `src/views/MatrizAvisosView.tsx`, `src/views/MetasView.tsx`

## Matriz › Briefing Diário

<a id="s-briefing-diario"></a>
### Matriz › Briefing Diário

- **Rota:** `briefing-diario` · **Componente:** `BriefingDiarioView` ([src/views/BriefingDiarioView.tsx](../../src/views/BriefingDiarioView.tsx))
- **Lê:** [briefings_diarios](tabelas.md#t-briefings_diarios), [notificacoes](tabelas.md#t-notificacoes), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [briefings_diarios](tabelas.md#t-briefings_diarios), [marketing_tarefas](tabelas.md#t-marketing_tarefas), [tarefas](tabelas.md#t-tarefas)
- **Chama (RPC):** [descartar_tarefa_briefing](funcoes.md#f-descartar_tarefa_briefing), [editar_tarefa_briefing](funcoes.md#f-editar_tarefa_briefing), [excluir_briefing_cascade](funcoes.md#f-excluir_briefing_cascade), [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [notificar_setor](funcoes.md#f-notificar_setor)
- **Grava via RPC:** [notificacoes](tabelas.md#t-notificacoes), [notificacoes_lidas](tabelas.md#t-notificacoes_lidas)
- **API do servidor:** `/api/ai-briefing`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [marketing_tarefas](tabelas.md#t-marketing_tarefas): [Financeiro › Aprovações de Conteúdo](telas.md#s-financeiro-aprovaçõesdeconteúdo)
- **Arquivos que acessam dados:** `src/hooks/useNotificacoes.ts`, `src/hooks/useUserProfile.ts`, `src/lib/notificar.ts`, `src/views/BriefingDiarioView.tsx`

## Outras telas (barra lateral, hubs, atalhos)

<a id="s-catalogo-produtos"></a>
### Catálogo

- **Rota:** `catalogo-produtos` · **Componente:** `CatalogoProdutosView` ([src/views/CatalogoProdutosView.tsx](../../src/views/CatalogoProdutosView.tsx))
- **Lê:** [produtos_com_custo](tabelas.md#t-produtos_com_custo), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/CatalogoProdutosView.tsx`

<a id="s-central-tempo"></a>
### Central tempo *(rota central-tempo)*

- **Rota:** `central-tempo` · **Componente:** `CentralTempoView` ([src/views/CentralTempoView.tsx](../../src/views/CentralTempoView.tsx))
- **Lê:** [alarmes_turma](tabelas.md#t-alarmes_turma), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [alarmes_turma](tabelas.md#t-alarmes_turma)
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/hooks/useAlarmesTurma.ts`, `src/hooks/useUserProfile.ts`

<a id="s-contratos"></a>
### Contratos

- **Rota:** `contratos` · **Componente:** `ContratosView` ([src/views/ContratosView.tsx](../../src/views/ContratosView.tsx))
- **Lê:** [contratos](tabelas.md#t-contratos), [contratos_assinaturas](tabelas.md#t-contratos_assinaturas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [contratos](tabelas.md#t-contratos), [max_shows](tabelas.md#t-max_shows)
- **Chama (RPC):** [assinar_contrato](funcoes.md#f-assinar_contrato), [encerrar_contrato](funcoes.md#f-encerrar_contrato), [recusar_contrato](funcoes.md#f-recusar_contrato)
- **Grava via RPC:** [contratos_assinaturas](tabelas.md#t-contratos_assinaturas)
- **Storage:** `contratos`, `max-show-anexos`
- **Arquivos que acessam dados:** `src/hooks/useContratos.ts`, `src/hooks/useUserProfile.ts`, `src/lib/contratos.ts`, `src/lib/maxShowUpload.ts`, `src/views/ContratosView.tsx`

<a id="s-cracha-virtual"></a>
### Crachá Virtual

- **Rota:** `cracha-virtual` · **Componente:** `CrachaVirtualView` ([src/views/CrachaVirtualView.tsx](../../src/views/CrachaVirtualView.tsx))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Chama (RPC):** [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [ponto_eletronico](tabelas.md#t-ponto_eletronico): [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/CrachaVirtualView.tsx`

<a id="s-dashboard"></a>
### Dashboard

- **Rota:** `dashboard` · **Componente:** `DashboardAnalyticsView` ([src/views/DashboardAnalyticsView.tsx](../../src/views/DashboardAnalyticsView.tsx))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles), [vendas](tabelas.md#t-vendas)
- **Grava direto:** —
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/DashboardAnalyticsView.tsx`

<a id="s-demandas"></a>
### Demandas

- **Rota:** `demandas` · **Componente:** `DemandasView` ([src/views/DemandasView.tsx](../../src/views/DemandasView.tsx))
- **Lê:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows), [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Chama (RPC):** [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [cancelar_meta_estrategica](funcoes.md#f-cancelar_meta_estrategica), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [criar_meta_estrategica](funcoes.md#f-criar_meta_estrategica), [editar_meta_estrategica](funcoes.md#f-editar_meta_estrategica), [media_participantes_ciclo](funcoes.md#f-media_participantes_ciclo), [media_participantes_competicao](funcoes.md#f-media_participantes_competicao), [pausar_meta_estrategica](funcoes.md#f-pausar_meta_estrategica), [publicar_meta_estrategica](funcoes.md#f-publicar_meta_estrategica), [reabrir_meta_estrategica](funcoes.md#f-reabrir_meta_estrategica)
- **Grava via RPC:** [ferias](tabelas.md#t-ferias), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Storage:** `max-show-anexos`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [ferias](tabelas.md#t-ferias): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Férias](telas.md#s-rh-férias)
  - por [maxbank_contas](tabelas.md#t-maxbank_contas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
  - por [maxbank_transacoes](tabelas.md#t-maxbank_transacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [metas_estrategicas](tabelas.md#t-metas_estrategicas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
  - por [tarefas_taticas](tabelas.md#t-tarefas_taticas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/DemandasView.tsx`, `src/views/MetasView.tsx`

<a id="s-demandas-conselho"></a>
### Demandas conselho *(rota demandas-conselho)*

- **Rota:** `demandas-conselho` · **Componente:** `DemandasView` ([src/views/DemandasView.tsx](../../src/views/DemandasView.tsx))
- **Lê:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows), [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Chama (RPC):** [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [cancelar_meta_estrategica](funcoes.md#f-cancelar_meta_estrategica), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [criar_meta_estrategica](funcoes.md#f-criar_meta_estrategica), [editar_meta_estrategica](funcoes.md#f-editar_meta_estrategica), [media_participantes_ciclo](funcoes.md#f-media_participantes_ciclo), [media_participantes_competicao](funcoes.md#f-media_participantes_competicao), [pausar_meta_estrategica](funcoes.md#f-pausar_meta_estrategica), [publicar_meta_estrategica](funcoes.md#f-publicar_meta_estrategica), [reabrir_meta_estrategica](funcoes.md#f-reabrir_meta_estrategica)
- **Grava via RPC:** [ferias](tabelas.md#t-ferias), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Storage:** `max-show-anexos`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [ferias](tabelas.md#t-ferias): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Férias](telas.md#s-rh-férias)
  - por [maxbank_contas](tabelas.md#t-maxbank_contas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
  - por [maxbank_transacoes](tabelas.md#t-maxbank_transacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [metas_estrategicas](tabelas.md#t-metas_estrategicas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
  - por [tarefas_taticas](tabelas.md#t-tarefas_taticas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/DemandasView.tsx`, `src/views/MetasView.tsx`

<a id="s-demandas-metas"></a>
### Demandas metas *(rota demandas-metas)*

- **Rota:** `demandas-metas` · **Componente:** `DemandasView` ([src/views/DemandasView.tsx](../../src/views/DemandasView.tsx))
- **Lê:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows), [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Chama (RPC):** [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [cancelar_meta_estrategica](funcoes.md#f-cancelar_meta_estrategica), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [criar_meta_estrategica](funcoes.md#f-criar_meta_estrategica), [editar_meta_estrategica](funcoes.md#f-editar_meta_estrategica), [media_participantes_ciclo](funcoes.md#f-media_participantes_ciclo), [media_participantes_competicao](funcoes.md#f-media_participantes_competicao), [pausar_meta_estrategica](funcoes.md#f-pausar_meta_estrategica), [publicar_meta_estrategica](funcoes.md#f-publicar_meta_estrategica), [reabrir_meta_estrategica](funcoes.md#f-reabrir_meta_estrategica)
- **Grava via RPC:** [ferias](tabelas.md#t-ferias), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Storage:** `max-show-anexos`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [ferias](tabelas.md#t-ferias): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Férias](telas.md#s-rh-férias)
  - por [maxbank_contas](tabelas.md#t-maxbank_contas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Metas *(rota metas)*](telas.md#s-metas)
  - por [maxbank_transacoes](tabelas.md#t-maxbank_transacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [metas_estrategicas](tabelas.md#t-metas_estrategicas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Metas *(rota metas)*](telas.md#s-metas)
  - por [tarefas_taticas](tabelas.md#t-tarefas_taticas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Metas *(rota metas)*](telas.md#s-metas)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/DemandasView.tsx`, `src/views/MetasView.tsx`

<a id="s-documentos"></a>
### Documentos

- **Rota:** `documentos` · **Componente:** `DocumentosView` ([src/views/DocumentosView.tsx](../../src/views/DocumentosView.tsx))
- **Lê:** [documentos](tabelas.md#t-documentos), [documentos_leitura](tabelas.md#t-documentos_leitura), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [documentos](tabelas.md#t-documentos)
- **Chama (RPC):** [marcar_documento_lido](funcoes.md#f-marcar_documento_lido), [publicar_documento](funcoes.md#f-publicar_documento)
- **Grava via RPC:** [documentos_leitura](tabelas.md#t-documentos_leitura)
- **Storage:** `documentos`
- **Arquivos que acessam dados:** `src/hooks/useDocumentos.ts`, `src/hooks/useUserProfile.ts`, `src/views/DocumentosView.tsx`

<a id="s-feedback-org"></a>
### Feedback & Requerimentos

- **Rota:** `feedback-org` · **Componente:** `FeedbackRequerimentosView` ([src/views/FeedbackRequerimentosView.tsx](../../src/views/FeedbackRequerimentosView.tsx))
- **Lê:** [feedbacks_organizacao](tabelas.md#t-feedbacks_organizacao), [requerimentos](tabelas.md#t-requerimentos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [feedbacks_organizacao](tabelas.md#t-feedbacks_organizacao), [requerimentos](tabelas.md#t-requerimentos)
- **Chama (RPC):** [enviar_feedback_anonimo](funcoes.md#f-enviar_feedback_anonimo)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/FeedbackOrganizacionalView.tsx`, `src/views/MatrizRequerimentosView.tsx`, `src/views/RequerimentosView.tsx`

## Financeiro

<a id="s-financeiro-rateioadministrativo"></a>
### Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*

- **Rota:** `financeiro-rateioadministrativo` · **Componente:** `RateioAdministrativoView` ([src/views/RateioAdministrativoView.tsx](../../src/views/RateioAdministrativoView.tsx))
- **Lê:** [rateio_administrativo](tabelas.md#t-rateio_administrativo), [rateio_administrativo_itens](tabelas.md#t-rateio_administrativo_itens), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [aplicar_rateio_administrativo](funcoes.md#f-aplicar_rateio_administrativo), [apurar_rateio_administrativo](funcoes.md#f-apurar_rateio_administrativo), [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo)
- **Grava via RPC:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [rateio_administrativo](tabelas.md#t-rateio_administrativo), [rateio_administrativo_itens](tabelas.md#t-rateio_administrativo_itens)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [caixa_bancos](tabelas.md#t-caixa_bancos), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/RateioAdministrativoView.tsx`

## Outras telas (barra lateral, hubs, atalhos)

<a id="s-inicio"></a>
### Início

- **Rota:** `inicio` · **Componente:** `InicioView` ([src/views/InicioView.tsx](../../src/views/InicioView.tsx))
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [clientes](tabelas.md#t-clientes), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [frequencia_trabalho_com_filial](tabelas.md#t-frequencia_trabalho_com_filial), [mandatos](tabelas.md#t-mandatos), [marketing_artes](tabelas.md#t-marketing_artes), [marketing_campanhas](tabelas.md#t-marketing_campanhas), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [metricas_redes_sociais](tabelas.md#t-metricas_redes_sociais), [orcamentos](tabelas.md#t-orcamentos), [pesquisa_respostas](tabelas.md#t-pesquisa_respostas), [pesquisas](tabelas.md#t-pesquisas), [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes), [servicos](tabelas.md#t-servicos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** —
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/lib/matrizAvaliacaoPendentes.ts`, `src/views/InicioView.tsx`, `src/views/PainelGovernanca.tsx`

## Marketing

<a id="s-marketing-configurações"></a>
### Marketing › Configurações *(rota marketing-configurações)*

- **Rota:** `marketing-configurações` · **Componente:** `MarketingConfigView` ([src/views/MarketingConfigView.tsx](../../src/views/MarketingConfigView.tsx))
- **Lê:** [marketing_artes](tabelas.md#t-marketing_artes), [marketing_config](tabelas.md#t-marketing_config), [produtos](tabelas.md#t-produtos)
- **Grava direto:** [marketing_config](tabelas.md#t-marketing_config)
- **Chama (RPC):** —

<a id="s-marketing-vitrinedateladelogin"></a>
### Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*

- **Rota:** `marketing-vitrinedateladelogin` · **Componente:** `VitrinePublicaView` ([src/views/VitrinePublicaView.tsx](../../src/views/VitrinePublicaView.tsx))
- **Lê:** [marketing_config](tabelas.md#t-marketing_config), [vitrine_institucional](tabelas.md#t-vitrine_institucional)
- **Grava direto:** [vitrine_institucional](tabelas.md#t-vitrine_institucional)
- **Chama (RPC):** [listar_vitrine_candidatos](funcoes.md#f-listar_vitrine_candidatos), [marcar_vitrine](funcoes.md#f-marcar_vitrine)
- **Grava via RPC:** [marketing_artes](tabelas.md#t-marketing_artes), [produtos](tabelas.md#t-produtos)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [marketing_artes](tabelas.md#t-marketing_artes): [Marketing › Promoções](telas.md#s-marketing-promoções), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
  - por [produtos](tabelas.md#t-produtos): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [vitrine_institucional](tabelas.md#t-vitrine_institucional): [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)

<a id="s-marketing-vitrinepública"></a>
### Marketing › Vitrinepública *(rota marketing-vitrinepública)*

- **Rota:** `marketing-vitrinepública` · **Componente:** `VitrinePublicaView` ([src/views/VitrinePublicaView.tsx](../../src/views/VitrinePublicaView.tsx))
- **Lê:** [marketing_config](tabelas.md#t-marketing_config), [vitrine_institucional](tabelas.md#t-vitrine_institucional)
- **Grava direto:** [vitrine_institucional](tabelas.md#t-vitrine_institucional)
- **Chama (RPC):** [listar_vitrine_candidatos](funcoes.md#f-listar_vitrine_candidatos), [marcar_vitrine](funcoes.md#f-marcar_vitrine)
- **Grava via RPC:** [marketing_artes](tabelas.md#t-marketing_artes), [produtos](tabelas.md#t-produtos)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [marketing_artes](tabelas.md#t-marketing_artes): [Marketing › Promoções](telas.md#s-marketing-promoções), [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin)
  - por [produtos](tabelas.md#t-produtos): [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [vitrine_institucional](tabelas.md#t-vitrine_institucional): [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin)

## Outras telas (barra lateral, hubs, atalhos)

<a id="s-matriz-avaliacoes"></a>
### Matriz avaliacoes *(rota matriz-avaliacoes)*

- **Rota:** `matriz-avaliacoes` · **Componente:** `MatrizCompeticaoView` ([src/views/MatrizCompeticaoView.tsx](../../src/views/MatrizCompeticaoView.tsx))
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [competicao_votos](tabelas.md#t-competicao_votos), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao), [evidencias-avaliacao](tabelas.md#t-evidencias-avaliacao), [funcionarios](tabelas.md#t-funcionarios), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [pdi_itens](tabelas.md#t-pdi_itens), [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes), [ponto_jornada](tabelas.md#t-ponto_jornada), [treinamentos](tabelas.md#t-treinamentos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [avaliacoes](tabelas.md#t-avaliacoes), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [competicao_votos](tabelas.md#t-competicao_votos), [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao), [max_shows](tabelas.md#t-max_shows), [pdi_itens](tabelas.md#t-pdi_itens)
- **Chama (RPC):** [adicionar_matriz_participante](funcoes.md#f-adicionar_matriz_participante), [atualizar_avaliacao](funcoes.md#f-atualizar_avaliacao), [atualizar_ciclo_tarefa](funcoes.md#f-atualizar_ciclo_tarefa), [atualizar_competicao](funcoes.md#f-atualizar_competicao), [atualizar_matriz_tarefa](funcoes.md#f-atualizar_matriz_tarefa), [avaliar_ciclo_tarefa](funcoes.md#f-avaliar_ciclo_tarefa), [avaliar_item_matriz](funcoes.md#f-avaliar_item_matriz), [calcular_placar_competicao](funcoes.md#f-calcular_placar_competicao), [calcular_placar_padrao](funcoes.md#f-calcular_placar_padrao), [contar_votantes_matriz](funcoes.md#f-contar_votantes_matriz), [criar_avaliacao](funcoes.md#f-criar_avaliacao), [criar_avaliacao_filial](funcoes.md#f-criar_avaliacao_filial), [criar_ciclo_tarefa](funcoes.md#f-criar_ciclo_tarefa), [criar_competicao](funcoes.md#f-criar_competicao), [criar_matriz_tarefa](funcoes.md#f-criar_matriz_tarefa), [declarar_vencedora](funcoes.md#f-declarar_vencedora), [definir_avaliadores_ciclo_tarefa](funcoes.md#f-definir_avaliadores_ciclo_tarefa), [definir_excecao_calendario](funcoes.md#f-definir_excecao_calendario), [definir_ponto_jornada](funcoes.md#f-definir_ponto_jornada), [encerrar_competicao_agora](funcoes.md#f-encerrar_competicao_agora), [encerrar_matriz_tarefa](funcoes.md#f-encerrar_matriz_tarefa), [excluir_competicao_matriz](funcoes.md#f-excluir_competicao_matriz), [frequencia_filiais_competicao](funcoes.md#f-frequencia_filiais_competicao), [liberar_matriz_tarefa](funcoes.md#f-liberar_matriz_tarefa), [participantes_sem_nota_competicao](funcoes.md#f-participantes_sem_nota_competicao), [progresso_avaliacao_matriz](funcoes.md#f-progresso_avaliacao_matriz), [progresso_votacao_competicao](funcoes.md#f-progresso_votacao_competicao), [reabrir_competicao](funcoes.md#f-reabrir_competicao), [reabrir_matriz_tarefa](funcoes.md#f-reabrir_matriz_tarefa), [remover_avaliacao_matriz](funcoes.md#f-remover_avaliacao_matriz), [remover_excecao_calendario](funcoes.md#f-remover_excecao_calendario), [remover_matriz_participante](funcoes.md#f-remover_matriz_participante), [remover_matriz_tarefa](funcoes.md#f-remover_matriz_tarefa)
- **Grava via RPC:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [notificacoes](tabelas.md#t-notificacoes), [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes), [ponto_jornada](tabelas.md#t-ponto_jornada)
- **API do servidor:** `/api/ai-briefing-tarefa`, `/api/ai-competicao`
- **Storage:** `evidencias-avaliacao`, `max-show-anexos`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [avaliacoes](tabelas.md#t-avaliacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Competição](telas.md#s-matriz-competicao), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia), [Usuários](telas.md#s-usuarios)
  - por [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz): [Competição](telas.md#s-matriz-competicao)
  - por [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores): [Central de Avaliação](telas.md#s-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes): [Central de Avaliação](telas.md#s-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ciclo_tarefas](tabelas.md#t-ciclo_tarefas): [Central de Avaliação](telas.md#s-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao): [Central de Avaliação](telas.md#s-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [competicao_votos](tabelas.md#t-competicao_votos): [Competição](telas.md#s-matriz-competicao)
  - por [competicoes_matriz](tabelas.md#t-competicoes_matriz): [Competição](telas.md#s-matriz-competicao)
  - por [criterios_avaliacao](tabelas.md#t-criterios_avaliacao): [Central de Avaliação](telas.md#s-avaliacoes), [Competição](telas.md#s-matriz-competicao), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
  - por [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao): [Central de Avaliação](telas.md#s-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes): [Competição](telas.md#s-matriz-competicao)
  - por [matriz_tarefas](tabelas.md#t-matriz_tarefas): [Competição](telas.md#s-matriz-competicao)
  - por [pdi_itens](tabelas.md#t-pdi_itens): [Central de Avaliação](telas.md#s-avaliacoes), [Competição](telas.md#s-matriz-competicao)
  - por [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes): [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
  - por [ponto_jornada](tabelas.md#t-ponto_jornada): [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Arquivos que acessam dados:** `src/components/PDISection.tsx`, `src/hooks/useUserProfile.ts`, `src/lib/centralAvaliacaoExports.ts`, `src/lib/maxShowUpload.ts`, `src/views/AvaliacaoFilialPanel.tsx`, `src/views/AvaliacoesView.tsx`, `src/views/CicloTarefasPanel.tsx`, `src/views/FrequenciaFiliaisCard.tsx`, `src/views/MatrizAvaliacoesView.tsx`, `src/views/MatrizCompeticaoView.tsx`, `src/views/MatrizTarefasPanel.tsx`

<a id="s-matriz-capital"></a>
### Capital

- **Rota:** `matriz-capital` · **Componente:** `MatrizCapitalView` ([src/views/MatrizCapitalView.tsx](../../src/views/MatrizCapitalView.tsx))
- **Lê:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras), [bancos_investimento](tabelas.md#t-bancos_investimento), [caixa_bancos](tabelas.md#t-caixa_bancos), [capital_config](tabelas.md#t-capital_config), [capital_filial](tabelas.md#t-capital_filial), [distribuicoes_lucro](tabelas.md#t-distribuicoes_lucro), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [notas_emitidas](tabelas.md#t-notas_emitidas), [notas_recebidas](tabelas.md#t-notas_recebidas), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [bancos_investimento](tabelas.md#t-bancos_investimento), [capital_config](tabelas.md#t-capital_config), [capital_filial](tabelas.md#t-capital_filial)
- **Chama (RPC):** [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [conceder_mutuo_capital](funcoes.md#f-conceder_mutuo_capital), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [estornar_aporte_capital](funcoes.md#f-estornar_aporte_capital), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [negar_emprestimo](funcoes.md#f-negar_emprestimo), [registrar_aporte_capital](funcoes.md#f-registrar_aporte_capital), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao)
- **Grava via RPC:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras), [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [distribuicoes_lucro](tabelas.md#t-distribuicoes_lucro), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [historico_operacoes](tabelas.md#t-historico_operacoes), [notificacoes](tabelas.md#t-notificacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Gatilhos levam a mudança até:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [das_apuracoes](tabelas.md#t-das_apuracoes), [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [fretes_compra](tabelas.md#t-fretes_compra), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos_custo](tabelas.md#t-produtos_custo), [rescisoes](tabelas.md#t-rescisoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras): [Financeiro › Capital](telas.md#s-financeiro-capital)
  - por [caixa_bancos](tabelas.md#t-caixa_bancos): [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos), [Financeiro › Capital](telas.md#s-financeiro-capital), [Usuários](telas.md#s-usuarios)
  - por [contas_pagar](tabelas.md#t-contas_pagar): [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
  - por [contas_receber](tabelas.md#t-contas_receber): [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [emprestimos_filial](tabelas.md#t-emprestimos_filial): [Financeiro › Capital](telas.md#s-financeiro-capital), [Usuários](telas.md#s-usuarios)
  - por [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo): [Financeiro › Capital](telas.md#s-financeiro-capital), [Usuários](telas.md#s-usuarios)
- **Arquivos que acessam dados:** `src/components/AplicacoesPanel.tsx`, `src/components/EmprestimoMemoria.tsx`, `src/hooks/useUserProfile.ts`, `src/views/MatrizCapitalView.tsx`

<a id="s-matriz-competicao"></a>
### Competição

- **Rota:** `matriz-competicao` · **Componente:** `MatrizCompeticaoView` ([src/views/MatrizCompeticaoView.tsx](../../src/views/MatrizCompeticaoView.tsx))
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [competicao_votos](tabelas.md#t-competicao_votos), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao), [evidencias-avaliacao](tabelas.md#t-evidencias-avaliacao), [funcionarios](tabelas.md#t-funcionarios), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [pdi_itens](tabelas.md#t-pdi_itens), [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes), [ponto_jornada](tabelas.md#t-ponto_jornada), [treinamentos](tabelas.md#t-treinamentos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [avaliacoes](tabelas.md#t-avaliacoes), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [competicao_votos](tabelas.md#t-competicao_votos), [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao), [max_shows](tabelas.md#t-max_shows), [pdi_itens](tabelas.md#t-pdi_itens)
- **Chama (RPC):** [adicionar_matriz_participante](funcoes.md#f-adicionar_matriz_participante), [atualizar_avaliacao](funcoes.md#f-atualizar_avaliacao), [atualizar_ciclo_tarefa](funcoes.md#f-atualizar_ciclo_tarefa), [atualizar_competicao](funcoes.md#f-atualizar_competicao), [atualizar_matriz_tarefa](funcoes.md#f-atualizar_matriz_tarefa), [avaliar_ciclo_tarefa](funcoes.md#f-avaliar_ciclo_tarefa), [avaliar_item_matriz](funcoes.md#f-avaliar_item_matriz), [calcular_placar_competicao](funcoes.md#f-calcular_placar_competicao), [calcular_placar_padrao](funcoes.md#f-calcular_placar_padrao), [contar_votantes_matriz](funcoes.md#f-contar_votantes_matriz), [criar_avaliacao](funcoes.md#f-criar_avaliacao), [criar_avaliacao_filial](funcoes.md#f-criar_avaliacao_filial), [criar_ciclo_tarefa](funcoes.md#f-criar_ciclo_tarefa), [criar_competicao](funcoes.md#f-criar_competicao), [criar_matriz_tarefa](funcoes.md#f-criar_matriz_tarefa), [declarar_vencedora](funcoes.md#f-declarar_vencedora), [definir_avaliadores_ciclo_tarefa](funcoes.md#f-definir_avaliadores_ciclo_tarefa), [definir_excecao_calendario](funcoes.md#f-definir_excecao_calendario), [definir_ponto_jornada](funcoes.md#f-definir_ponto_jornada), [encerrar_competicao_agora](funcoes.md#f-encerrar_competicao_agora), [encerrar_matriz_tarefa](funcoes.md#f-encerrar_matriz_tarefa), [excluir_competicao_matriz](funcoes.md#f-excluir_competicao_matriz), [frequencia_filiais_competicao](funcoes.md#f-frequencia_filiais_competicao), [liberar_matriz_tarefa](funcoes.md#f-liberar_matriz_tarefa), [participantes_sem_nota_competicao](funcoes.md#f-participantes_sem_nota_competicao), [progresso_avaliacao_matriz](funcoes.md#f-progresso_avaliacao_matriz), [progresso_votacao_competicao](funcoes.md#f-progresso_votacao_competicao), [reabrir_competicao](funcoes.md#f-reabrir_competicao), [reabrir_matriz_tarefa](funcoes.md#f-reabrir_matriz_tarefa), [remover_avaliacao_matriz](funcoes.md#f-remover_avaliacao_matriz), [remover_excecao_calendario](funcoes.md#f-remover_excecao_calendario), [remover_matriz_participante](funcoes.md#f-remover_matriz_participante), [remover_matriz_tarefa](funcoes.md#f-remover_matriz_tarefa)
- **Grava via RPC:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [notificacoes](tabelas.md#t-notificacoes), [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes), [ponto_jornada](tabelas.md#t-ponto_jornada)
- **API do servidor:** `/api/ai-briefing-tarefa`, `/api/ai-competicao`
- **Storage:** `evidencias-avaliacao`, `max-show-anexos`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [avaliacoes](tabelas.md#t-avaliacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia), [Usuários](telas.md#s-usuarios)
  - por [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [ciclo_tarefas](tabelas.md#t-ciclo_tarefas): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [competicao_votos](tabelas.md#t-competicao_votos): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [competicoes_matriz](tabelas.md#t-competicoes_matriz): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [criterios_avaliacao](tabelas.md#t-criterios_avaliacao): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
  - por [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [matriz_tarefas](tabelas.md#t-matriz_tarefas): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [pdi_itens](tabelas.md#t-pdi_itens): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
  - por [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
  - por [ponto_jornada](tabelas.md#t-ponto_jornada): [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Arquivos que acessam dados:** `src/components/PDISection.tsx`, `src/hooks/useUserProfile.ts`, `src/lib/centralAvaliacaoExports.ts`, `src/lib/maxShowUpload.ts`, `src/views/AvaliacaoFilialPanel.tsx`, `src/views/AvaliacoesView.tsx`, `src/views/CicloTarefasPanel.tsx`, `src/views/FrequenciaFiliaisCard.tsx`, `src/views/MatrizAvaliacoesView.tsx`, `src/views/MatrizCompeticaoView.tsx`, `src/views/MatrizTarefasPanel.tsx`

<a id="s-matriz-conteudo"></a>
### Conteúdo

- **Rota:** `matriz-conteudo` · **Componente:** `MatrizConteudoView` ([src/views/MatrizConteudoView.tsx](../../src/views/MatrizConteudoView.tsx))
- **Lê:** [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows)
- **Chama (RPC):** —
- **Storage:** `max-show-anexos`
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/MatrizConteudoView.tsx`

<a id="s-max-show"></a>
### Max Show

- **Rota:** `max-show` · **Componente:** `MaxShowsView` ([src/views/MaxShowsView.tsx](../../src/views/MaxShowsView.tsx))
- **Lê:** [max_shows](tabelas.md#t-max_shows), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows)
- **Chama (RPC):** —
- **Storage:** `max-show-anexos`
- **Arquivos que acessam dados:** `src/views/MaxShowEditor.tsx`, `src/views/MaxShowsView.tsx`

<a id="s-max-work-show"></a>
### Max work show *(rota max-work-show)*

- **Rota:** `max-work-show` · **Componente:** `MaxShowsView` ([src/views/MaxShowsView.tsx](../../src/views/MaxShowsView.tsx))
- **Lê:** [max_shows](tabelas.md#t-max_shows), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows)
- **Chama (RPC):** —
- **Storage:** `max-show-anexos`
- **Arquivos que acessam dados:** `src/views/MaxShowEditor.tsx`, `src/views/MaxShowsView.tsx`

<a id="s-mesa-gestor"></a>
### Mesa gestor *(rota mesa-gestor)*

- **Rota:** `mesa-gestor` · **Componente:** `MesaGestorView` ([src/views/MesaGestorView.tsx](../../src/views/MesaGestorView.tsx))
- **Lê:** [mesa_anotacoes](tabelas.md#t-mesa_anotacoes), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows), [mesa_anotacoes](tabelas.md#t-mesa_anotacoes)
- **Chama (RPC):** [contar_minha_mesa](funcoes.md#f-contar_minha_mesa), [listar_pendencias](funcoes.md#f-listar_pendencias), [minha_mesa](funcoes.md#f-minha_mesa)
- **Storage:** `max-show-anexos`
- **Arquivos que acessam dados:** `src/components/MesaAnotacoes.tsx`, `src/hooks/useContadorMesa.ts`, `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/MesaGestorView.tsx`

<a id="s-metas"></a>
### Metas *(rota metas)*

- **Rota:** `metas` · **Componente:** `DemandasView` ([src/views/DemandasView.tsx](../../src/views/DemandasView.tsx))
- **Lê:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows), [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Chama (RPC):** [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [cancelar_meta_estrategica](funcoes.md#f-cancelar_meta_estrategica), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [criar_meta_estrategica](funcoes.md#f-criar_meta_estrategica), [editar_meta_estrategica](funcoes.md#f-editar_meta_estrategica), [media_participantes_ciclo](funcoes.md#f-media_participantes_ciclo), [media_participantes_competicao](funcoes.md#f-media_participantes_competicao), [pausar_meta_estrategica](funcoes.md#f-pausar_meta_estrategica), [publicar_meta_estrategica](funcoes.md#f-publicar_meta_estrategica), [reabrir_meta_estrategica](funcoes.md#f-reabrir_meta_estrategica)
- **Grava via RPC:** [ferias](tabelas.md#t-ferias), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Storage:** `max-show-anexos`
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [ferias](tabelas.md#t-ferias): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Recursos Humanos › Férias](telas.md#s-rh-férias)
  - por [maxbank_contas](tabelas.md#t-maxbank_contas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas)
  - por [maxbank_transacoes](tabelas.md#t-maxbank_transacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
  - por [metas_estrategicas](tabelas.md#t-metas_estrategicas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas)
  - por [tarefas_taticas](tabelas.md#t-tarefas_taticas): [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/DemandasView.tsx`, `src/views/MetasView.tsx`

<a id="s-meu-cracha"></a>
### Meu Crachá

- **Rota:** `meu-cracha` · **Componente:** `MeuCrachaView` ([src/views/MeuCrachaView.tsx](../../src/views/MeuCrachaView.tsx))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [justificativas_falta](tabelas.md#t-justificativas_falta), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [minha_frequencia](funcoes.md#f-minha_frequencia)
- **Grava via RPC:** [justificativas_falta](tabelas.md#t-justificativas_falta), [notificacoes](tabelas.md#t-notificacoes)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [justificativas_falta](tabelas.md#t-justificativas_falta): [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Arquivos que acessam dados:** `src/components/MinhaFrequencia.tsx`, `src/hooks/useUserProfile.ts`, `src/views/MeuCrachaView.tsx`

<a id="s-minhas-pesquisas"></a>
### Minhas pesquisas *(rota minhas-pesquisas)*

- **Rota:** `minhas-pesquisas` · **Componente:** `MinhasPesquisasView` ([src/views/MinhasPesquisasView.tsx](../../src/views/MinhasPesquisasView.tsx))
- **Lê:** [pesquisa_perguntas](tabelas.md#t-pesquisa_perguntas), [pesquisa_respostas](tabelas.md#t-pesquisa_respostas), [pesquisas](tabelas.md#t-pesquisas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** [responder_pesquisa](funcoes.md#f-responder_pesquisa)
- **Grava via RPC:** [pesquisa_resposta_itens](tabelas.md#t-pesquisa_resposta_itens), [pesquisa_respostas](tabelas.md#t-pesquisa_respostas)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/MinhasPesquisasView.tsx`

## Matriz › Painel de BI

<a id="s-painel-bi"></a>
### Matriz › Painel de BI

- **Rota:** `painel-bi` · **Componente:** `PainelBIView` ([src/views/PainelBIView.tsx](../../src/views/PainelBIView.tsx))
- **Lê:** [relatorios_bi](tabelas.md#t-relatorios_bi), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows)
- **Chama (RPC):** —
- **API do servidor:** `/api/ai-bi`
- **Storage:** `max-show-anexos`
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/PainelBIView.tsx`

## Outras telas (barra lateral, hubs, atalhos)

<a id="s-pendencias"></a>
### Pendências

- **Rota:** `pendencias` · **Componente:** `PendenciasView` ([src/views/PendenciasView.tsx](../../src/views/PendenciasView.tsx))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [max_shows](tabelas.md#t-max_shows)
- **Chama (RPC):** [listar_pendencias](funcoes.md#f-listar_pendencias)
- **Storage:** `max-show-anexos`
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/lib/maxShowUpload.ts`, `src/views/PendenciasView.tsx`

## Matriz › Vendas

<a id="s-relatorio-vendas"></a>
### Matriz › Vendas

- **Rota:** `relatorio-vendas` · **Componente:** `RelatoriosVendasView` ([src/views/RelatoriosVendasView.tsx](../../src/views/RelatoriosVendasView.tsx))
- **Lê:** [clientes](tabelas.md#t-clientes), [orcamentos](tabelas.md#t-orcamentos), [pedidos_venda](tabelas.md#t-pedidos_venda), [vendas](tabelas.md#t-vendas)
- **Grava direto:** —
- **Chama (RPC):** —

## Outras telas (barra lateral, hubs, atalhos)

<a id="s-sessoes-gerais"></a>
### Sessões Gerais

- **Rota:** `sessoes-gerais` · **Componente:** `HubView` ([src/views/SessoesGeraisView.tsx](../../src/views/SessoesGeraisView.tsx))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** —
- **Chama (RPC):** —

## TI & Suporte

<a id="s-ti-relógiodasmáquinas"></a>
### TI & Suporte › Relógiodasmáquinas *(rota ti-relógiodasmáquinas)*

- **Rota:** `ti-relógiodasmáquinas` · **Componente:** `RelogioMaquinasView` ([src/views/RelogioMaquinasView.tsx](../../src/views/RelogioMaquinasView.tsx))
- **Lê:** [ti_relogio_maquinas](tabelas.md#t-ti_relogio_maquinas), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [comandos_turma](tabelas.md#t-comandos_turma), [ti_relogio_maquinas](tabelas.md#t-ti_relogio_maquinas)
- **Chama (RPC):** —
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [comandos_turma](tabelas.md#t-comandos_turma): [Modo Aula](telas.md#s-aula-modo)
- **Arquivos que acessam dados:** `src/components/BotaoRecarregarTurma.tsx`, `src/hooks/useUserProfile.ts`, `src/views/RelogioMaquinasView.tsx`

## Outras telas (barra lateral, hubs, atalhos)

<a id="s-usuarios"></a>
### Usuários

- **Rota:** `usuarios` · **Componente:** `UsuariosView` ([src/views/UsuariosView.tsx](../../src/views/UsuariosView.tsx))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [senhas_visiveis](tabelas.md#t-senhas_visiveis), [user_profiles](tabelas.md#t-user_profiles)
- **Grava direto:** [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)
- **Chama (RPC):** [atualizar_foto_usuario](funcoes.md#f-atualizar_foto_usuario), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais_admin](funcoes.md#f-resetar_dados_operacionais_admin), [resetar_geral_admin](funcoes.md#f-resetar_geral_admin)
- **Grava via RPC:** [avaliacoes](tabelas.md#t-avaliacoes), [caixa_bancos](tabelas.md#t-caixa_bancos), [configuracoes](tabelas.md#t-configuracoes), [desenvolvimentos_ia](tabelas.md#t-desenvolvimentos_ia), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [itens_venda](tabelas.md#t-itens_venda), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **API do servidor:** `/api/users`
- **Gatilhos levam a mudança até:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [maxbank_contas](tabelas.md#t-maxbank_contas), [produto_unidades](tabelas.md#t-produto_unidades)
- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**
  - por [avaliacoes](tabelas.md#t-avaliacoes): [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
  - por [caixa_bancos](tabelas.md#t-caixa_bancos): [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos), [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
  - por [desenvolvimentos_ia](tabelas.md#t-desenvolvimentos_ia): [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
  - por [emprestimos_filial](tabelas.md#t-emprestimos_filial): [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
  - por [funcionarios](tabelas.md#t-funcionarios): [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
  - por [itens_venda](tabelas.md#t-itens_venda): [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
  - por [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo): [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
  - por [user_profiles](tabelas.md#t-user_profiles): [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos)
- **Arquivos que acessam dados:** `src/hooks/useUserProfile.ts`, `src/views/UsuariosView.tsx`
