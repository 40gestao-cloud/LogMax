# Mapa de dependências do LogMax

> **Gerado por `npm run mapa` — não edite à mão.** Rode de novo depois de mexer em tela, RPC, gatilho ou policy; o `git diff` desta pasta mostra a ligação nova.
> Banco lido: `jvqsaccupxkvezriiede` (as 4 turmas são idênticas — `npm run drift`). Detecção estática: SQL dinâmico e endpoint passado por variável não aparecem.

## Como usar

1. **Antes de mexer** numa tela, abra ela em [telas.md](telas.md) e leia o **⚠ Confira também**: são as outras telas que gravam nas mesmas tabelas.
2. **Antes de mexer numa tabela, RPC ou gatilho**, abra em [tabelas.md](tabelas.md) ou [funcoes.md](funcoes.md): quem grava, quem lê, a cadeia de gatilhos e o que cai junto quando algo é apagado.
3. **Depois de mexer**, rode `npm run mapa` e olhe o `git diff docs/mapa`: ligação nova que você não esperava é o aviso.

**Tabelas transversais** (aparecem nas listas, mas não entram no "Confira também", porque quase toda tela as toca por uma ferramenta comum): `documento_sequencias`, `historico_operacoes`, `max_shows`, `notificacoes`, `notificacoes_lidas`, `planilhas_trabalho`, `trabalho_reservas`.

**Tamanho:** 116 telas · 202 tabelas · 10 views · 435 RPCs · 174 funções de gatilho · 289 gatilhos

## Menus

### Empresa

- [Empresa › Filiais](telas.md#s-empresa-filiais)
- [Empresa › Formas de pagamento](telas.md#s-empresa-formasdepagamento)
- [Empresa › Projetos](telas.md#s-empresa-projetos)

### Requisições

- [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)

### Cadastros

- [Cadastros › Categorias](telas.md#s-cadastros-categorias)
- [Cadastros › Produtos](telas.md#s-cadastros-produtos)
- [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores)
- [Cadastros › Serviços](telas.md#s-cadastros-serviços)
- [Cadastros › Lixeira](telas.md#s-cadastros-lixeira)

### Compras

- [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra)
- [Compras › Cotações](telas.md#s-compras-cotações)
- [Compras › Pedidos](telas.md#s-compras-pedidos)
- [Compras › Notas recebidas](telas.md#s-compras-notasrecebidas)
- [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras)
- [Compras › Gerenciamento](telas.md#s-compras-gerenciamento)
- [Compras › Relatórios](telas.md#s-compras-relatórios)

### Estoque

- [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial)
- [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições)
- [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- [Estoque › Expedição](telas.md#s-estoque-expedição)
- [Estoque › Movimentações](telas.md#s-estoque-movimentações)
- [Estoque › Saldos](telas.md#s-estoque-saldos)
- [Estoque › Validades](telas.md#s-estoque-validades)
- [Estoque › Inventários](telas.md#s-estoque-inventários)
- [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda)
- [Estoque › Gerenciamento](telas.md#s-estoque-gerenciamento)
- [Estoque › Relatórios](telas.md#s-estoque-relatórios)

### Financeiro

- [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa)
- [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber)
- [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos)
- [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha)
- [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
- [Financeiro › Centros de Custo](telas.md#s-financeiro-centrosdecusto)
- [Financeiro › DRE](telas.md#s-financeiro-dre)
- [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- [Financeiro › Juros & Multa](telas.md#s-financeiro-juros&multa)
- [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento)
- [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções)
- [Financeiro › Alçadas](telas.md#s-financeiro-alçadas)
- [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda)
- [Financeiro › Recibos de Vendas](telas.md#s-financeiro-recibosdevendas)
- [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas)
- [Financeiro › Capital](telas.md#s-financeiro-capital)
- [Financeiro › Gerenciamento](telas.md#s-financeiro-gerenciamento)
- [Financeiro › Relatórios](telas.md#s-financeiro-relatórios)

### Recursos Humanos

- [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários)
- [Recursos Humanos › Departamentos](telas.md#s-rh-departamentos)
- [Recursos Humanos › Cargos](telas.md#s-rh-cargos)
- [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- [Recursos Humanos › Férias](telas.md#s-rh-férias)
- [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos)
- [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos)
- [Recursos Humanos › Benefícios](telas.md#s-rh-benefícios)
- [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos)
- [Recursos Humanos › Pesquisas](telas.md#s-rh-pesquisas)
- [Recursos Humanos › Gerenciamento](telas.md#s-rh-gerenciamento)
- [Recursos Humanos › Relatórios](telas.md#s-rh-relatórios)

### Vendas

- [Vendas › PDV](telas.md#s-vendas-pdv)
- [Vendas › Clientes](telas.md#s-vendas-clientes)
- [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
- [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas)
- [Vendas › Devoluções](telas.md#s-vendas-devoluções)
- [Vendas › Treinamento](telas.md#s-vendas-treinamento)

### Marketing

- [Marketing › Redes Sociais](telas.md#s-marketing-redessociais)
- [Marketing › Campanhas](telas.md#s-marketing-campanhas)
- [Marketing › Promoções](telas.md#s-marketing-promoções)
- [Marketing › Cupons](telas.md#s-marketing-cupons)
- [Marketing › Calendário](telas.md#s-marketing-calendário)
- [Marketing › Aprovações de Conteúdo](telas.md#s-marketing-aprovaçõesdeconteúdo)

### TI & Suporte

- [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)

### Matriz (hubs de Sessões Gerais)

- [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial)
- [Estoque › Gerenciamento](telas.md#s-estoque-gerenciamento)
- [Estoque › Relatórios](telas.md#s-estoque-relatórios)
- [Matriz › Vendas](telas.md#s-relatorio-vendas)
- [Matriz › Painel de BI](telas.md#s-painel-bi)
- [Matriz › Briefing Diário](telas.md#s-briefing-diario)

### Outras telas

- [Análise com IA](telas.md#s-analise-ia)
- [Artes promocionais *(rota artes-promocionais)*](telas.md#s-artes-promocionais)
- [Atividade da aula](telas.md#s-aula-atividade)
- [Modo Aula](telas.md#s-aula-modo)
- [Central de Avaliação](telas.md#s-avaliacoes)
- [Catálogo](telas.md#s-catalogo-produtos)
- [Central tempo *(rota central-tempo)*](telas.md#s-central-tempo)
- [Contratos](telas.md#s-contratos)
- [Crachá Virtual](telas.md#s-cracha-virtual)
- [Dashboard](telas.md#s-dashboard)
- [Demandas](telas.md#s-demandas)
- [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho)
- [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas)
- [Documentos](telas.md#s-documentos)
- [Feedback & Requerimentos](telas.md#s-feedback-org)
- [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo)
- [Início](telas.md#s-inicio)
- [Marketing › Configurações *(rota marketing-configurações)*](telas.md#s-marketing-configurações)
- [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin)
- [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
- [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes)
- [Capital](telas.md#s-matriz-capital)
- [Competição](telas.md#s-matriz-competicao)
- [Conteúdo](telas.md#s-matriz-conteudo)
- [Max Show](telas.md#s-max-show)
- [Max work show *(rota max-work-show)*](telas.md#s-max-work-show)
- [Mesa gestor *(rota mesa-gestor)*](telas.md#s-mesa-gestor)
- [Metas *(rota metas)*](telas.md#s-metas)
- [Meu Crachá](telas.md#s-meu-cracha)
- [Minhas pesquisas *(rota minhas-pesquisas)*](telas.md#s-minhas-pesquisas)
- [Pendências](telas.md#s-pendencias)
- [Sessões Gerais](telas.md#s-sessoes-gerais)
- [TI & Suporte › Relógiodasmáquinas *(rota ti-relógiodasmáquinas)*](telas.md#s-ti-relógiodasmáquinas)
- [Usuários](telas.md#s-usuarios)
