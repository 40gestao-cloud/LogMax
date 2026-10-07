# Mapa por tabela

> **Gerado por `npm run mapa` — não edite à mão.** Rode de novo depois de mexer em tela, RPC, gatilho ou policy; o `git diff` desta pasta mostra a ligação nova.
> Banco lido: `jvqsaccupxkvezriiede` (as 4 turmas são idênticas — `npm run drift`). Detecção estática: SQL dinâmico e endpoint passado por variável não aparecem.

Para cada tabela: quem grava (tela, RPC, gatilho, servidor), quem lê, os gatilhos que disparam nela e a cadeia que eles provocam, e o que acontece quando uma linha é apagada.

<a id="t-afastamentos"></a>
## afastamentos

- **Telas que gravam:** [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos)
- **RPCs que gravam:** [aplicar_afastamento_no_ponto](funcoes.md#f-aplicar_afastamento_no_ponto), [reverter_afastamento_no_ponto](funcoes.md#f-reverter_afastamento_no_ponto)
- **Telas que leem:** [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos)
- **RPCs que leem:** [aplicar_afastamento_no_ponto](funcoes.md#f-aplicar_afastamento_no_ponto), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `afastamentos_updated_at` — BEFORE UPDATE → [trg_afastamentos_updated_at](funcoes.md#f-trg_afastamentos_updated_at)
  - `trg_afastamento_decisao_guard` — BEFORE UPDATE → [afastamento_decisao_guard](funcoes.md#f-afastamento_decisao_guard)
  - `trg_afastamento_nasce_pendente` — BEFORE INSERT → [afastamento_nasce_pendente](funcoes.md#f-afastamento_nasce_pendente)
  - `trg_afastamento_reverte_ao_excluir` — BEFORE DELETE → [afastamento_reverte_ao_excluir](funcoes.md#f-afastamento_reverte_ao_excluir) · grava em [ponto_eletronico](tabelas.md#t-ponto_eletronico)
  - `trg_afastamento_reverte_ao_inativar` — AFTER UPDATE → [afastamento_reverte_ao_inativar](funcoes.md#f-afastamento_reverte_ao_inativar) · grava em [ponto_eletronico](tabelas.md#t-ponto_eletronico)
  - `trg_afastamento_valida_periodo` — BEFORE INSERT/UPDATE → [afastamento_valida_periodo](funcoes.md#f-afastamento_valida_periodo)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [afastamentos](tabelas.md#t-afastamentos) → [afastamento_reverte_ao_excluir](funcoes.md#f-afastamento_reverte_ao_excluir) → [ponto_eletronico](tabelas.md#t-ponto_eletronico)
  - 1. [afastamentos](tabelas.md#t-afastamentos) → [afastamento_reverte_ao_inativar](funcoes.md#f-afastamento_reverte_ao_inativar) → [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Ao apagar uma linha daqui:** [ponto_eletronico](tabelas.md#t-ponto_eletronico).afastamento_id zera o vínculo (SET NULL)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios)
- **RLS:** ALL `afast_rh_all` (setores: rh · gerente da filial · Matriz/professor); SELECT `afast_self_read` (o próprio usuário)

<a id="t-ajustes_custo_compra"></a>
## ajustes_custo_compra

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **RPCs que gravam:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota)
- **Telas que leem:** —
- **RPCs que leem:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [_dre_calculo](funcoes.md#f-_dre_calculo)
- **Aponta para:** pedido_id → [pedidos](tabelas.md#t-pedidos); produto_id → [produtos](tabelas.md#t-produtos)
- **RLS:** SELECT `ajustes_custo_select` (setores: estoque, financeiro, logistica · gerente da filial · Matriz/professor)

<a id="t-alarmes_turma"></a>
## alarmes_turma

- **Telas que gravam:** [Central tempo *(rota central-tempo)*](telas.md#s-central-tempo)
- **RPCs que gravam:** —
- **Telas que leem:** [Central tempo *(rota central-tempo)*](telas.md#s-central-tempo)
- **Gatilhos nesta tabela:**
  - `alarmes_turma_sem_sobreposicao` — BEFORE INSERT/UPDATE → [alarmes_turma_sem_sobreposicao](funcoes.md#f-alarmes_turma_sem_sobreposicao)
- **RLS:** DELETE `alarmes_turma_delete` (Matriz/professor); INSERT `alarmes_turma_insert` (Matriz/professor); SELECT `alarmes_turma_select` (todos); UPDATE `alarmes_turma_update` (Matriz/professor)

<a id="t-alcadas_compra"></a>
## alcadas_compra

- **Telas que gravam:** [Financeiro › Alçadas](telas.md#s-financeiro-alçadas)
- **RPCs que gravam:** —
- **Telas que leem:** [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Alçadas](telas.md#s-financeiro-alçadas), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **RPCs que leem:** [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao)
- **RLS:** INSERT `alcadas_compra_insert` (Matriz/professor); SELECT `alcadas_compra_select` (qualquer um da própria filial · Matriz/professor); UPDATE `alcadas_compra_update` (Matriz/professor)

<a id="t-aplicacoes_financeiras"></a>
## aplicacoes_financeiras

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **RPCs que gravam:** [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao)
- **Telas que leem:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **RPCs que leem:** [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao)
- **Aponta para:** banco_investimento_id → [bancos_investimento](tabelas.md#t-bancos_investimento); conta_id → [caixa_bancos](tabelas.md#t-caixa_bancos)
- **RLS:** SELECT `aplicacoes_financeiras_select` (setores: admin, ceo, conselheiro · gerente da filial)

<a id="t-aprovacoes_compras"></a>
## aprovacoes_compras

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **RPCs que gravam:** [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [criar_requisicao_compra](funcoes.md#f-criar_requisicao_compra), [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao)
- **Gatilhos (de outras tabelas) que gravam aqui:** [aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao) (em [requisicoes](tabelas.md#t-requisicoes))
- **Telas que leem:** [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **RPCs que leem:** [contar_pendencias](funcoes.md#f-contar_pendencias), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [devolver_requisicao_para_correcao](funcoes.md#f-devolver_requisicao_para_correcao), [minha_mesa](funcoes.md#f-minha_mesa), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao)
- **Gatilhos nesta tabela:**
  - `trg_aprovacao_carimba_decisao` — BEFORE INSERT/UPDATE → [fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** requisicao_id → [requisicoes](tabelas.md#t-requisicoes)
- **RLS:** DELETE `compras_delete` (setores: compras · gerente da filial · Matriz/professor); SELECT `compras_select` (setores: compras · gerente da filial · Matriz/professor); UPDATE `compras_update` (setores: compras · gerente da filial · Matriz/professor)

<a id="t-aprovacoes_estoque"></a>
## aprovacoes_estoque

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **RPCs que gravam:** [criar_requisicao_estoque](funcoes.md#f-criar_requisicao_estoque), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque)
- **Gatilhos (de outras tabelas) que gravam aqui:** [aprovacao_estoque_segue_a_requisicao](funcoes.md#f-aprovacao_estoque_segue_a_requisicao) (em [requisicoes_estoque](tabelas.md#t-requisicoes_estoque))
- **Telas que leem:** [Estoque › Gerenciamento](telas.md#s-estoque-gerenciamento), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **RPCs que leem:** [contar_pendencias](funcoes.md#f-contar_pendencias), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [minha_mesa](funcoes.md#f-minha_mesa), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque)
- **Gatilhos nesta tabela:**
  - `trg_aprovacao_carimba_decisao` — BEFORE INSERT/UPDATE → [fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** requisicao_estoque_id → [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **RLS:** DELETE `logist_delete` (setores: logistica · gerente da filial · Matriz/professor); SELECT `logist_select` (setores: logistica · gerente da filial · Matriz/professor); UPDATE `logist_update` (setores: logistica · gerente da filial · Matriz/professor)

<a id="t-apuracao_bonus_itens"></a>
## apuracao_bonus_itens

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Aponta para:** apuracao_id → [apuracoes_bonus](tabelas.md#t-apuracoes_bonus); funcionario_id → [funcionarios](tabelas.md#t-funcionarios); colaborador_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `apuracao_item_read` (Matriz/professor)

<a id="t-apuracoes_bonus"></a>
## apuracoes_bonus

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Ao apagar uma linha daqui:** [apuracao_bonus_itens](tabelas.md#t-apuracao_bonus_itens).apuracao_id APAGA JUNTO (CASCADE)
- **Aponta para:** competicao_id → [competicoes_matriz](tabelas.md#t-competicoes_matriz); politica_id → [politicas_remuneracao](tabelas.md#t-politicas_remuneracao)
- **RLS:** SELECT `apuracao_read` (todos)

<a id="t-auditoria_revisoes"></a>
## auditoria_revisoes

- **Telas que gravam:** —
- **RPCs que gravam:** [abrir_revisao_auditoria](funcoes.md#f-abrir_revisao_auditoria), [encerrar_revisao_auditoria](funcoes.md#f-encerrar_revisao_auditoria), [responder_revisao_auditoria](funcoes.md#f-responder_revisao_auditoria)
- **Telas que leem:** —
- **RPCs que leem:** [abrir_revisao_auditoria](funcoes.md#f-abrir_revisao_auditoria), [encerrar_revisao_auditoria](funcoes.md#f-encerrar_revisao_auditoria), [responder_revisao_auditoria](funcoes.md#f-responder_revisao_auditoria)
- **Aponta para:** operacao_id → [historico_operacoes](tabelas.md#t-historico_operacoes)
- **RLS:** SELECT `revisao_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-aula_atividades"></a>
## aula_atividades

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que gravam:** [publicar_atividade_aula](funcoes.md#f-publicar_atividade_aula), [remover_atividade_aula](funcoes.md#f-remover_atividade_aula)
- **Telas que leem:** [Atividade da aula](telas.md#s-aula-atividade), [Modo Aula](telas.md#s-aula-modo)
- **RPCs que leem:** [marcar_tarefa_aula](funcoes.md#f-marcar_tarefa_aula)
- **Ao apagar uma linha daqui:** [aula_atividades_ciencia](tabelas.md#t-aula_atividades_ciencia).atividade_id APAGA JUNTO (CASCADE); [aula_tarefas_realizadas](tabelas.md#t-aula_tarefas_realizadas).atividade_id APAGA JUNTO (CASCADE)
- **RLS:** DELETE `aula_atividades_delete` (setores: admin, ceo); INSERT `aula_atividades_insert` (setores: admin, ceo); SELECT `aula_atividades_read` (setores: admin, ceo); UPDATE `aula_atividades_update` (setores: admin, ceo)

<a id="t-aula_atividades_ciencia"></a>
## aula_atividades_ciencia

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Atividade da aula](telas.md#s-aula-atividade), [Modo Aula](telas.md#s-aula-modo)
- **RPCs que gravam:** [dar_ciencia_atividade](funcoes.md#f-dar_ciencia_atividade)
- **Telas que leem:** [Atividade da aula](telas.md#s-aula-atividade), [Modo Aula](telas.md#s-aula-modo)
- **Aponta para:** atividade_id → [aula_atividades](tabelas.md#t-aula_atividades)
- **RLS:** DELETE `aula_ativ_ciencia_delete` (setores: admin, ceo); INSERT `aula_ativ_ciencia_insert` (o próprio usuário); SELECT `aula_ativ_ciencia_read` (setores: admin, ceo)

<a id="t-aula_config"></a>
## aula_config

- **Telas que gravam:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que gravam:** [encerrar_aulas_ociosas](funcoes.md#f-encerrar_aulas_ociosas)
- **Telas que leem:** [Atividade da aula](telas.md#s-aula-atividade), [Modo Aula](telas.md#s-aula-modo)
- **RPCs que leem:** [auth_aula_setores](funcoes.md#f-auth_aula_setores)
- **Telas escutando em tempo real:** [Atividade da aula](telas.md#s-aula-atividade), [Modo Aula](telas.md#s-aula-modo)
- **Gatilhos nesta tabela:**
  - `trg_aula_config_sessao` — AFTER UPDATE → [aula_config_registrar_sessao](funcoes.md#f-aula_config_registrar_sessao) · grava em [aula_sessoes](tabelas.md#t-aula_sessoes)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [aula_config](tabelas.md#t-aula_config) → [aula_config_registrar_sessao](funcoes.md#f-aula_config_registrar_sessao) → [aula_sessoes](tabelas.md#t-aula_sessoes)
- **RLS:** SELECT `aula_config_select` (todos); UPDATE `aula_config_update` (setores: admin, ceo)

<a id="t-aula_grupo_apoio"></a>
## aula_grupo_apoio

- **Telas que gravam:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que gravam:** —
- **Telas que leem:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que leem:** [auth_aula_setores](funcoes.md#f-auth_aula_setores)
- **Aponta para:** user_id → [user_profiles](tabelas.md#t-user_profiles); incluido_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `aula_grupo_apoio_remove_admin` (regra própria); INSERT `aula_grupo_apoio_inclui_admin` (regra própria); SELECT `aula_grupo_apoio_leitura` (o próprio usuário); UPDATE `aula_grupo_apoio_altera_admin` (regra própria)

<a id="t-aula_grupo_apoio_config"></a>
## aula_grupo_apoio_config

- **Telas que gravam:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que gravam:** [encerrar_aulas_ociosas](funcoes.md#f-encerrar_aulas_ociosas)
- **Telas que leem:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que leem:** [auth_aula_setores](funcoes.md#f-auth_aula_setores)
- **Aponta para:** atualizado_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** INSERT `aula_grupo_apoio_config_recria_admin` (regra própria); SELECT `aula_grupo_apoio_config_leitura` (o próprio usuário); UPDATE `aula_grupo_apoio_config_altera_admin` (regra própria)

<a id="t-aula_sessoes"></a>
## aula_sessoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que gravam:** [encerrar_aulas_ociosas](funcoes.md#f-encerrar_aulas_ociosas), [nomear_sessao_aula](funcoes.md#f-nomear_sessao_aula), [vincular_sessao_aula](funcoes.md#f-vincular_sessao_aula)
- **Gatilhos (de outras tabelas) que gravam aqui:** [aula_config_registrar_sessao](funcoes.md#f-aula_config_registrar_sessao) (em [aula_config](tabelas.md#t-aula_config))
- **Telas que leem:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que leem:** [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo), [encerrar_aulas_ociosas](funcoes.md#f-encerrar_aulas_ociosas), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [vincular_sessao_aula](funcoes.md#f-vincular_sessao_aula)
- **Ao apagar uma linha daqui:** [aula_sessoes](tabelas.md#t-aula_sessoes).continua_de zera o vínculo (SET NULL)
- **Aponta para:** continua_de → [aula_sessoes](tabelas.md#t-aula_sessoes); iniciada_por → [user_profiles](tabelas.md#t-user_profiles); encerrada_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `aula_sessoes_read` (setores: admin, ceo)

<a id="t-aula_tarefas_realizadas"></a>
## aula_tarefas_realizadas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que gravam:** [marcar_tarefa_aula](funcoes.md#f-marcar_tarefa_aula)
- **Telas que leem:** [Atividade da aula](telas.md#s-aula-atividade), [Modo Aula](telas.md#s-aula-modo)
- **Aponta para:** atividade_id → [aula_atividades](tabelas.md#t-aula_atividades); marcado_por → [user_profiles](tabelas.md#t-user_profiles); user_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `aula_tarefas_realizadas_delete` (setores: admin, ceo); INSERT `aula_tarefas_realizadas_insert` (setores: admin, ceo); SELECT `aula_tarefas_realizadas_read` (setores: admin, ceo)

<a id="t-avaliacoes"></a>
## avaliacoes

- **Telas que gravam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Telas que gravam via RPC:** [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia), [Usuários](telas.md#s-usuarios)
- **RPCs que gravam:** [atualizar_avaliacao](funcoes.md#f-atualizar_avaliacao), [criar_avaliacao](funcoes.md#f-criar_avaliacao), [criar_avaliacao_filial](funcoes.md#f-criar_avaliacao_filial), [criar_avaliacao_ti_dev_ia](funcoes.md#f-criar_avaliacao_ti_dev_ia), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
- **RPCs que leem:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [atualizar_avaliacao](funcoes.md#f-atualizar_avaliacao), [calcular_placar_padrao](funcoes.md#f-calcular_placar_padrao), [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios), [media_avaliacao_funcionario](funcoes.md#f-media_avaliacao_funcionario), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_avaliacoes_filial` — BEFORE INSERT → [fn_avaliacoes_filial_from_ciclo](funcoes.md#f-fn_avaliacoes_filial_from_ciclo)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [criterios_avaliacao](tabelas.md#t-criterios_avaliacao).avaliacao_id APAGA JUNTO (CASCADE); [feedbacks_avaliacao](tabelas.md#t-feedbacks_avaliacao).avaliacao_id APAGA JUNTO (CASCADE); [pdi_itens](tabelas.md#t-pdi_itens).avaliacao_id APAGA JUNTO (CASCADE)
- **Aponta para:** ciclo_id → [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao); desenvolvimento_ia_id → [desenvolvimentos_ia](tabelas.md#t-desenvolvimentos_ia); avaliador_id → [user_profiles](tabelas.md#t-user_profiles); avaliado_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `avaliacoes_delete` (Matriz/professor); INSERT `avaliacoes_insert` (setores: ti · Matriz/professor); SELECT `avaliacoes_read` (gerente da filial · Matriz/professor); UPDATE `avaliacoes_modify` (Matriz/professor)

<a id="t-avaliacoes_matriz"></a>
## avaliacoes_matriz

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas), [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas), [avaliar_item_matriz](funcoes.md#f-avaliar_item_matriz), [excluir_competicao_matriz](funcoes.md#f-excluir_competicao_matriz), [remover_avaliacao_matriz](funcoes.md#f-remover_avaliacao_matriz), [remover_matriz_participante](funcoes.md#f-remover_matriz_participante), [remover_matriz_tarefa](funcoes.md#f-remover_matriz_tarefa)
- **Telas que leem:** [Início](telas.md#s-inicio), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que leem:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas), [lembrar_avaliacoes_pendentes](funcoes.md#f-lembrar_avaliacoes_pendentes), [media_participantes_competicao](funcoes.md#f-media_participantes_competicao), [minha_mesa](funcoes.md#f-minha_mesa), [participantes_sem_nota_competicao](funcoes.md#f-participantes_sem_nota_competicao), [progresso_avaliacao_matriz](funcoes.md#f-progresso_avaliacao_matriz), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Views que dependem desta:** [avaliacoes_matriz_agregado](tabelas.md#t-avaliacoes_matriz_agregado), [avaliacoes_matriz_placar_filial](tabelas.md#t-avaliacoes_matriz_placar_filial)
- **Gatilhos nesta tabela:**
  - `trg_aval_matriz_updated_at` — BEFORE UPDATE → [trg_aval_matriz_updated_at](funcoes.md#f-trg_aval_matriz_updated_at)
  - `trg_avaliacoes_matriz_congela_avaliador` — BEFORE INSERT/UPDATE → [fn_avaliacao_matriz_congela_avaliador](funcoes.md#f-fn_avaliacao_matriz_congela_avaliador)
- **Aponta para:** competicao_id → [competicoes_matriz](tabelas.md#t-competicoes_matriz); avaliador_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `aval_matriz_delete` (ninguém (só via RPC)); INSERT `aval_matriz_insert` (ninguém (só via RPC)); SELECT `aval_matriz_select` (setores: ceo, conselheiro · gerente da filial · Matriz/professor); UPDATE `aval_matriz_update` (ninguém (só via RPC))

<a id="t-avaliacoes_matriz_agregado"></a>
## avaliacoes_matriz_agregado (view)

- **Telas que leem:** —

<a id="t-avaliacoes_matriz_placar_filial"></a>
## avaliacoes_matriz_placar_filial (view)

- **Telas que leem:** —

<a id="t-avisos_matriz"></a>
## avisos_matriz

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes)
- **RPCs que gravam:** [criar_aviso_matriz](funcoes.md#f-criar_aviso_matriz), [remover_aviso_matriz](funcoes.md#f-remover_aviso_matriz)
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes)
- **Ao apagar uma linha daqui:** [avisos_matriz_ciencia](tabelas.md#t-avisos_matriz_ciencia).aviso_id APAGA JUNTO (CASCADE)
- **RLS:** DELETE `avisos_matriz_delete` (Matriz/professor); INSERT `avisos_matriz_insert` (Matriz/professor); SELECT `avisos_matriz_read` (Matriz/professor); UPDATE `avisos_matriz_update` (Matriz/professor)

<a id="t-avisos_matriz_ciencia"></a>
## avisos_matriz_ciencia

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes)
- **RPCs que gravam:** [dar_ciencia_aviso](funcoes.md#f-dar_ciencia_aviso)
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes)
- **Aponta para:** aviso_id → [avisos_matriz](tabelas.md#t-avisos_matriz)
- **RLS:** DELETE `avisos_ciencia_delete` (Matriz/professor); INSERT `avisos_ciencia_insert` (o próprio usuário); SELECT `avisos_ciencia_read` (Matriz/professor)

<a id="t-bancos_investimento"></a>
## bancos_investimento

- **Telas que gravam:** [Capital](telas.md#s-matriz-capital)
- **RPCs que gravam:** —
- **Telas que leem:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **RPCs que leem:** [aplicar_em_banco](funcoes.md#f-aplicar_em_banco)
- **Ao apagar uma linha daqui:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras).banco_investimento_id bloqueia (NO ACTION)
- **RLS:** DELETE `bancos_investimento_delete` (setores: admin, ceo); INSERT `bancos_investimento_insert` (setores: admin, ceo); SELECT `bancos_investimento_select` (o próprio usuário); UPDATE `bancos_investimento_update` (setores: admin, ceo)

<a id="t-beneficios"></a>
## beneficios

- **Telas que gravam:** [Recursos Humanos › Benefícios](telas.md#s-rh-benefícios)
- **RPCs que gravam:** —
- **Telas que leem:** [Recursos Humanos › Benefícios](telas.md#s-rh-benefícios), [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários)
- **RPCs que leem:** [beneficios_do_funcionario](funcoes.md#f-beneficios_do_funcionario)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [funcionario_beneficios](tabelas.md#t-funcionario_beneficios).beneficio_id APAGA JUNTO (CASCADE)
- **RLS:** ALL `benef_rh_write` (setores: rh · gerente da filial · Matriz/professor); SELECT `benef_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-beneficios_pendentes"></a>
## beneficios_pendentes

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Gatilhos nesta tabela:**
  - `trg_beneficios_pendentes_codigo` — BEFORE INSERT → [beneficios_pendentes_gerar_codigo](funcoes.md#f-beneficios_pendentes_gerar_codigo)
  - `trg_beneficios_pendentes_paid_at` — BEFORE UPDATE → [beneficios_pendentes_set_paid_at](funcoes.md#f-beneficios_pendentes_set_paid_at)
- **RLS:** DELETE `beneficios_pendentes_auth_delete` (Matriz/professor); INSERT `beneficios_pendentes_auth_insert` (o próprio usuário); SELECT `beneficios_pendentes_anon_select` (regra própria); SELECT `beneficios_pendentes_auth_select` (Matriz/professor); UPDATE `beneficios_pendentes_anon_update` (regra própria); UPDATE `beneficios_pendentes_auth_update` (Matriz/professor); UPDATE `beneficios_pendentes_pagador_update` (regra própria)

<a id="t-blackout_config"></a>
## blackout_config

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que gravam:** [alternar_simulacao_perda](funcoes.md#f-alternar_simulacao_perda)
- **Telas que leem:** [Modo Aula](telas.md#s-aula-modo)
- **RPCs que leem:** [auth_blackout](funcoes.md#f-auth_blackout)
- **Telas escutando em tempo real:** [Modo Aula](telas.md#s-aula-modo)
- **RLS:** SELECT `blackout_select` (todos); UPDATE `blackout_update` (setores: ceo, conselheiro · Matriz/professor)

<a id="t-briefings_diarios"></a>
## briefings_diarios

- **Telas que gravam:** [Matriz › Briefing Diário](telas.md#s-briefing-diario)
- **RPCs que gravam:** [descartar_tarefa_briefing](funcoes.md#f-descartar_tarefa_briefing), [editar_tarefa_briefing](funcoes.md#f-editar_tarefa_briefing), [excluir_briefing_cascade](funcoes.md#f-excluir_briefing_cascade)
- **Servidor (api/) grava:** `api/ai-briefing.ts`
- **Telas que leem:** [Matriz › Briefing Diário](telas.md#s-briefing-diario)
- **RPCs que leem:** [descartar_tarefa_briefing](funcoes.md#f-descartar_tarefa_briefing), [editar_tarefa_briefing](funcoes.md#f-editar_tarefa_briefing), [excluir_briefing_cascade](funcoes.md#f-excluir_briefing_cascade)
- **Servidor (api/) lê:** `api/ai-briefing.ts`
- **Gatilhos nesta tabela:**
  - `briefings_diarios_updated_at` — BEFORE UPDATE → [trg_briefings_diarios_updated_at](funcoes.md#f-trg_briefings_diarios_updated_at)
- **Ao apagar uma linha daqui:** [marketing_tarefas](tabelas.md#t-marketing_tarefas).briefing_id zera o vínculo (SET NULL); [tarefas](tabelas.md#t-tarefas).briefing_id zera o vínculo (SET NULL)
- **RLS:** DELETE `briefings_delete` (Matriz/professor); INSERT `briefings_insert` (Matriz/professor); SELECT `briefings_read` (Matriz/professor); UPDATE `briefings_update` (Matriz/professor)

<a id="t-caixa_bancos"></a>
## caixa_bancos

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos), [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital), [Usuários](telas.md#s-usuarios)
- **RPCs que gravam:** [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [estornar_aporte_capital](funcoes.md#f-estornar_aporte_capital), [registrar_aporte_capital](funcoes.md#f-registrar_aporte_capital), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais), [resetar_geral_admin](funcoes.md#f-resetar_geral_admin), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [transferir_entre_contas](funcoes.md#f-transferir_entre_contas)
- **Gatilhos (de outras tabelas) que gravam aqui:** [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar) (em [contas_pagar](tabelas.md#t-contas_pagar)), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber) (em [contas_receber](tabelas.md#t-contas_receber))
- **Telas que leem:** [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Gerenciamento](telas.md#s-financeiro-gerenciamento), [Financeiro › Relatórios](telas.md#s-financeiro-relatórios), [Capital](telas.md#s-matriz-capital)
- **RPCs que leem:** [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [conceder_mutuo_capital](funcoes.md#f-conceder_mutuo_capital), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [estornar_aporte_capital](funcoes.md#f-estornar_aporte_capital), [registrar_aporte_capital](funcoes.md#f-registrar_aporte_capital), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [transferir_entre_contas](funcoes.md#f-transferir_entre_contas)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras).conta_id zera o vínculo (SET NULL); [capital_filial](tabelas.md#t-capital_filial).banco_origem_id zera o vínculo (SET NULL); [capital_filial](tabelas.md#t-capital_filial).banco_destino_id zera o vínculo (SET NULL); [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha).banco_id bloqueia (NO ACTION); [contas_pagar](tabelas.md#t-contas_pagar).banco_id zera o vínculo (SET NULL); [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas).banco_id zera o vínculo (SET NULL); [contas_receber](tabelas.md#t-contas_receber).banco_id zera o vínculo (SET NULL); [contas_receber_baixas](tabelas.md#t-contas_receber_baixas).banco_id zera o vínculo (SET NULL); [destinacoes_resultado](tabelas.md#t-destinacoes_resultado).banco_origem_id zera o vínculo (SET NULL); [destinacoes_resultado](tabelas.md#t-destinacoes_resultado).banco_destino_id zera o vínculo (SET NULL); [distribuicoes_lucro](tabelas.md#t-distribuicoes_lucro).banco_origem_id zera o vínculo (SET NULL); [distribuicoes_lucro](tabelas.md#t-distribuicoes_lucro).banco_destino_id zera o vínculo (SET NULL); [emprestimos_filial](tabelas.md#t-emprestimos_filial).banco_id zera o vínculo (SET NULL); [emprestimos_filial](tabelas.md#t-emprestimos_filial).banco_origem_id zera o vínculo (SET NULL)
- **RLS:** DELETE `caixa_bancos_delete` (setores: admin, ceo); INSERT `caixa_bancos_insert` (setores: admin, ceo); SELECT `caixa_bancos_select` (qualquer um da própria filial · Matriz/professor); UPDATE `caixa_bancos_update` (setores: admin, ceo)

<a id="t-candidatura_etapas"></a>
## candidatura_etapas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que gravam:** [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [mover_candidatura](funcoes.md#f-mover_candidatura), [registrar_candidatura](funcoes.md#f-registrar_candidatura), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga)
- **Telas que leem:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Aponta para:** candidatura_id → [candidaturas](tabelas.md#t-candidaturas)
- **RLS:** SELECT `candidatura_etapas_select` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-candidaturas"></a>
## candidaturas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que gravam:** [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [mover_candidatura](funcoes.md#f-mover_candidatura), [registrar_candidatura](funcoes.md#f-registrar_candidatura), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga)
- **Telas que leem:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que leem:** [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [minha_mesa](funcoes.md#f-minha_mesa), [mover_candidatura](funcoes.md#f-mover_candidatura)
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [candidatura_etapas](tabelas.md#t-candidatura_etapas).candidatura_id APAGA JUNTO (CASCADE); [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira).candidatura_id zera o vínculo (SET NULL); [vaga_convites](tabelas.md#t-vaga_convites).candidatura_id zera o vínculo (SET NULL)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios); funcionario_origem_id → [funcionarios](tabelas.md#t-funcionarios); vaga_id → [vagas](tabelas.md#t-vagas)
- **RLS:** SELECT `candidaturas_select` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-capital_config"></a>
## capital_config

- **Telas que gravam:** [Capital](telas.md#s-matriz-capital)
- **RPCs que gravam:** —
- **Telas que leem:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **RPCs que leem:** [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial)
- **Aponta para:** criado_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `capital_config_delete` (setores: admin, ceo); INSERT `capital_config_insert` (setores: admin, ceo); SELECT `capital_config_select` (setores: admin, ceo, conselheiro, gerente · gerente da filial); UPDATE `capital_config_update` (setores: admin, ceo)

<a id="t-capital_filial"></a>
## capital_filial

- **Telas que gravam:** [Capital](telas.md#s-matriz-capital)
- **RPCs que gravam:** [estornar_aporte_capital](funcoes.md#f-estornar_aporte_capital), [registrar_aporte_capital](funcoes.md#f-registrar_aporte_capital)
- **Telas que leem:** [Empresa › Filiais](telas.md#s-empresa-filiais), [Capital](telas.md#s-matriz-capital)
- **RPCs que leem:** [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [estornar_aporte_capital](funcoes.md#f-estornar_aporte_capital), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Gatilhos nesta tabela:**
  - `trg_bloqueia_delete_aporte_com_caixa` — BEFORE DELETE → [bloqueia_delete_aporte_com_caixa](funcoes.md#f-bloqueia_delete_aporte_com_caixa)
- **Aponta para:** banco_origem_id → [caixa_bancos](tabelas.md#t-caixa_bancos); banco_destino_id → [caixa_bancos](tabelas.md#t-caixa_bancos); registrado_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `capital_filial_delete` (setores: admin, ceo); SELECT `capital_filial_select` (setores: admin, ceo, conselheiro, gerente · gerente da filial)

<a id="t-cargos"></a>
## cargos

- **Telas que gravam:** [Recursos Humanos › Cargos](telas.md#s-rh-cargos)
- **RPCs que gravam:** —
- **Telas que leem:** [Recursos Humanos › Cargos](telas.md#s-rh-cargos), [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que leem:** [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **RLS:** ALL `rh_all` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-cartao_pendentes"></a>
## cartao_pendentes

- **Telas que gravam:** [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que gravam:** [autorizar_cartao_maxbank](funcoes.md#f-autorizar_cartao_maxbank), [confirmar_cartao_pendente](funcoes.md#f-confirmar_cartao_pendente), [liberar_cobranca](funcoes.md#f-liberar_cobranca), [reservar_cobranca](funcoes.md#f-reservar_cobranca)
- **Telas que leem:** —
- **RPCs que leem:** [autorizar_cartao_maxbank](funcoes.md#f-autorizar_cartao_maxbank), [consultar_status_cobranca](funcoes.md#f-consultar_status_cobranca), [reservar_cobranca](funcoes.md#f-reservar_cobranca)
- **Gatilhos nesta tabela:**
  - `cartao_pendentes_visitor_gate` — BEFORE UPDATE → [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate)
  - `trg_cartao_pendentes_filial` — BEFORE INSERT → [pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial)
  - `trg_cartao_pendentes_paid_at` — BEFORE UPDATE → [cartao_pendentes_set_paid_at](funcoes.md#f-cartao_pendentes_set_paid_at)
- **RLS:** DELETE `cartao_pendentes_auth_delete` (Matriz/professor); INSERT `cartao_pendentes_auth_insert` (o próprio usuário); SELECT `cartao_pendentes_anon_select` (regra própria); SELECT `cartao_pendentes_auth_select` (Matriz/professor); UPDATE `cartao_pendentes_anon_update` (regra própria); UPDATE `cartao_pendentes_auth_update` (Matriz/professor)

<a id="t-categorias_produto"></a>
## categorias_produto

- **Telas que gravam:** [Cadastros › Categorias](telas.md#s-cadastros-categorias), [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- **RPCs que gravam:** [aplicar_taxonomia_padrao](funcoes.md#f-aplicar_taxonomia_padrao)
- **Telas que leem:** [Cadastros › Categorias](telas.md#s-cadastros-categorias), [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Marketing › Campanhas](telas.md#s-marketing-campanhas), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Vendas › Clientes](telas.md#s-vendas-clientes)
- **RPCs que leem:** [_lixeira_expr_filial](funcoes.md#f-_lixeira_expr_filial), [aplicar_taxonomia_padrao](funcoes.md#f-aplicar_taxonomia_padrao), [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Servidor (api/) lê:** `api/ai-aula-atividade.ts`
- **Gatilhos nesta tabela:**
  - `trg_carimba_exclusao` — BEFORE UPDATE → [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao)
  - `trg_taxonomia_padrao_protege` — BEFORE INSERT/UPDATE/DELETE → [fn_taxonomia_padrao_protege](funcoes.md#f-fn_taxonomia_padrao_protege)
- **Ao apagar uma linha daqui:** [orcamento_mensal_categoria](tabelas.md#t-orcamento_mensal_categoria).categoria_id APAGA JUNTO (CASCADE); [produtos](tabelas.md#t-produtos).categoria_id zera o vínculo (SET NULL); [subcategorias_produto](tabelas.md#t-subcategorias_produto).categoria_id APAGA JUNTO (CASCADE)
- **RLS:** ALL `categorias_produto_write` (setores: compras, logistica · gerente da filial · Matriz/professor); SELECT `categorias_produto_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-centros_custo"></a>
## centros_custo

- **Telas que gravam:** [Financeiro › Centros de Custo](telas.md#s-financeiro-centrosdecusto)
- **RPCs que gravam:** —
- **Telas que leem:** [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Centros de Custo](telas.md#s-financeiro-centrosdecusto), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Vendas › Clientes](telas.md#s-vendas-clientes)
- **RPCs que leem:** [_dre_calculo](funcoes.md#f-_dre_calculo), [criar_requisicao_estoque](funcoes.md#f-criar_requisicao_estoque), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_centro_custo_normaliza_grupo` — BEFORE INSERT/UPDATE → [fn_centro_custo_normaliza_grupo](funcoes.md#f-fn_centro_custo_normaliza_grupo)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [consumos_material](tabelas.md#t-consumos_material).centro_custo_id bloqueia (NO ACTION); [contas_pagar](tabelas.md#t-contas_pagar).centro_custo_id zera o vínculo (SET NULL); [despesas_recorrentes](tabelas.md#t-despesas_recorrentes).centro_custo_id zera o vínculo (SET NULL); [filial_investimentos](tabelas.md#t-filial_investimentos).centro_custo_id zera o vínculo (SET NULL); [orcamento_itens](tabelas.md#t-orcamento_itens).centro_custo_id bloqueia (RESTRICT); [requisicoes_estoque](tabelas.md#t-requisicoes_estoque).centro_custo_id bloqueia (NO ACTION)
- **RLS:** ALL `write_admin` (Matriz/professor); SELECT `read_authenticated` (todos)

<a id="t-ciclo_tarefa_avaliacoes"></a>
## ciclo_tarefa_avaliacoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas), [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas), [avaliar_ciclo_tarefa](funcoes.md#f-avaliar_ciclo_tarefa), [remover_avaliacao_ciclo_tarefa](funcoes.md#f-remover_avaliacao_ciclo_tarefa)
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que leem:** [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas), [media_participantes_ciclo](funcoes.md#f-media_participantes_ciclo), [minha_mesa](funcoes.md#f-minha_mesa)
- **Gatilhos nesta tabela:**
  - `trg_ciclo_tarefa_aval_upd` — BEFORE UPDATE → [trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at)
- **Aponta para:** participante_id → [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes)
- **RLS:** SELECT `ct_aval_select` (setores: ceo, conselheiro · gerente da filial · Matriz/professor)

<a id="t-ciclo_tarefa_avaliadores"></a>
## ciclo_tarefa_avaliadores

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [definir_avaliadores_ciclo_tarefa](funcoes.md#f-definir_avaliadores_ciclo_tarefa)
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que leem:** [_assert_pode_avaliar_ciclo_tarefa](funcoes.md#f-_assert_pode_avaliar_ciclo_tarefa), [liberar_ciclo_tarefa](funcoes.md#f-liberar_ciclo_tarefa)
- **Aponta para:** tarefa_id → [ciclo_tarefas](tabelas.md#t-ciclo_tarefas); user_profile_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `ct_avaliadores_select` (o próprio usuário)

<a id="t-ciclo_tarefa_participantes"></a>
## ciclo_tarefa_participantes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas), [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas), [atualizar_ciclo_tarefa](funcoes.md#f-atualizar_ciclo_tarefa), [criar_ciclo_tarefa](funcoes.md#f-criar_ciclo_tarefa), [excluir_ciclo_tarefa](funcoes.md#f-excluir_ciclo_tarefa)
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Metas *(rota metas)*](telas.md#s-metas)
- **RPCs que leem:** [_assert_pode_avaliar_ciclo_tarefa](funcoes.md#f-_assert_pode_avaliar_ciclo_tarefa), [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas), [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas), [avaliar_ciclo_tarefa](funcoes.md#f-avaliar_ciclo_tarefa), [liberar_ciclo_tarefa](funcoes.md#f-liberar_ciclo_tarefa), [media_participantes_ciclo](funcoes.md#f-media_participantes_ciclo), [minha_mesa](funcoes.md#f-minha_mesa), [remover_avaliacao_ciclo_tarefa](funcoes.md#f-remover_avaliacao_ciclo_tarefa)
- **Ao apagar uma linha daqui:** [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes).participante_id APAGA JUNTO (CASCADE)
- **Aponta para:** tarefa_id → [ciclo_tarefas](tabelas.md#t-ciclo_tarefas); funcionario_id → [funcionarios](tabelas.md#t-funcionarios); user_profile_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `ct_part_select` (o próprio usuário)

<a id="t-ciclo_tarefas"></a>
## ciclo_tarefas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [atualizar_ciclo_tarefa](funcoes.md#f-atualizar_ciclo_tarefa), [criar_ciclo_tarefa](funcoes.md#f-criar_ciclo_tarefa), [encerrar_ciclo_tarefa](funcoes.md#f-encerrar_ciclo_tarefa), [excluir_ciclo_tarefa](funcoes.md#f-excluir_ciclo_tarefa), [liberar_ciclo_tarefa](funcoes.md#f-liberar_ciclo_tarefa), [reabrir_ciclo_tarefa](funcoes.md#f-reabrir_ciclo_tarefa)
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Metas *(rota metas)*](telas.md#s-metas)
- **RPCs que leem:** [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas), [atualizar_ciclo_tarefa](funcoes.md#f-atualizar_ciclo_tarefa), [avaliar_ciclo_tarefa](funcoes.md#f-avaliar_ciclo_tarefa), [definir_avaliadores_ciclo_tarefa](funcoes.md#f-definir_avaliadores_ciclo_tarefa), [encerrar_ciclo_tarefa](funcoes.md#f-encerrar_ciclo_tarefa), [excluir_ciclo_tarefa](funcoes.md#f-excluir_ciclo_tarefa), [liberar_ciclo_tarefa](funcoes.md#f-liberar_ciclo_tarefa), [media_participantes_ciclo](funcoes.md#f-media_participantes_ciclo), [minha_mesa](funcoes.md#f-minha_mesa), [reabrir_ciclo_tarefa](funcoes.md#f-reabrir_ciclo_tarefa), [remover_avaliacao_ciclo_tarefa](funcoes.md#f-remover_avaliacao_ciclo_tarefa)
- **Gatilhos nesta tabela:**
  - `trg_ciclo_tarefas_upd` — BEFORE UPDATE → [trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at)
- **Ao apagar uma linha daqui:** [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores).tarefa_id APAGA JUNTO (CASCADE); [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes).tarefa_id APAGA JUNTO (CASCADE)
- **Aponta para:** ciclo_id → [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)
- **RLS:** SELECT `ct_tarefas_select` (o próprio usuário)

<a id="t-ciclos_avaliacao"></a>
## ciclos_avaliacao

- **Telas que gravam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [excluir_competicao_matriz](funcoes.md#f-excluir_competicao_matriz)
- **Gatilhos (de outras tabelas) que gravam aqui:** [competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz) (em [competicoes_matriz](tabelas.md#t-competicoes_matriz)), [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz) (em [competicoes_matriz](tabelas.md#t-competicoes_matriz)), [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz) (em [competicoes_matriz](tabelas.md#t-competicoes_matriz))
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que leem:** [atualizar_avaliacao](funcoes.md#f-atualizar_avaliacao), [calcular_placar_padrao](funcoes.md#f-calcular_placar_padrao), [criar_avaliacao](funcoes.md#f-criar_avaliacao), [criar_avaliacao_filial](funcoes.md#f-criar_avaliacao_filial), [criar_ciclo_tarefa](funcoes.md#f-criar_ciclo_tarefa), [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios)
- **Ao apagar uma linha daqui:** [avaliacoes](tabelas.md#t-avaliacoes).ciclo_id APAGA JUNTO (CASCADE); [ciclo_tarefas](tabelas.md#t-ciclo_tarefas).ciclo_id APAGA JUNTO (CASCADE); [competicoes_matriz](tabelas.md#t-competicoes_matriz).ciclo_id zera o vínculo (SET NULL); [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao).ciclo_id APAGA JUNTO (CASCADE)
- **RLS:** ALL `ciclos_write` (Matriz/professor); SELECT `ciclos_read` (todos)

<a id="t-classificacoes_auxiliares"></a>
## classificacoes_auxiliares

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
- **RLS:** ALL `write_admin` (Matriz/professor); SELECT `read_authenticated` (todos)

<a id="t-clientes"></a>
## clientes

- **Telas que gravam:** [Vendas › Clientes](telas.md#s-vendas-clientes)
- **RPCs que gravam:** —
- **Telas que leem:** [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Gerenciamento](telas.md#s-financeiro-gerenciamento), [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Recibos de Vendas](telas.md#s-financeiro-recibosdevendas), [Financeiro › Relatórios](telas.md#s-financeiro-relatórios), [Matriz › Vendas](telas.md#s-relatorio-vendas), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Clientes](telas.md#s-vendas-clientes), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que leem:** [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_carimba_exclusao` — BEFORE UPDATE → [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [contas_receber](tabelas.md#t-contas_receber).cliente_id zera o vínculo (SET NULL); [notas_emitidas](tabelas.md#t-notas_emitidas).cliente_id zera o vínculo (SET NULL); [orcamentos](tabelas.md#t-orcamentos).cliente_id zera o vínculo (SET NULL); [pedidos_venda](tabelas.md#t-pedidos_venda).cliente_id zera o vínculo (SET NULL); [pix_pendentes](tabelas.md#t-pix_pendentes).cliente_id zera o vínculo (SET NULL); [projetos](tabelas.md#t-projetos).cliente_id zera o vínculo (SET NULL); [vendas](tabelas.md#t-vendas).cliente_id zera o vínculo (SET NULL)
- **RLS:** ALL `write_clientes` (setores: financeiro, vendas · gerente da filial · Matriz/professor); SELECT `read_clientes` (qualquer um da própria filial · Matriz/professor)

<a id="t-comandos_turma"></a>
## comandos_turma

- **Telas que gravam:** [Modo Aula](telas.md#s-aula-modo), [TI & Suporte › Relógiodasmáquinas *(rota ti-relógiodasmáquinas)*](telas.md#s-ti-relógiodasmáquinas)
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Aponta para:** emitido_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** INSERT `comandos_turma_escrita_admin` (o próprio usuário); SELECT `comandos_turma_leitura` (todos)

<a id="t-competicao_votos"></a>
## competicao_votos

- **Telas que gravam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [excluir_competicao_matriz](funcoes.md#f-excluir_competicao_matriz)
- **Telas que leem:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que leem:** [_competicao_votos_validos](funcoes.md#f-_competicao_votos_validos)
- **Gatilhos nesta tabela:**
  - `trg_competicao_voto_touch` — BEFORE UPDATE → [_competicao_voto_touch](funcoes.md#f-_competicao_voto_touch)
- **Aponta para:** competicao_id → [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **RLS:** INSERT `voto_write` (setores: admin, ceo, conselheiro · gerente da filial); SELECT `voto_read` (setores: ceo, conselheiro · gerente da filial · Matriz/professor); UPDATE `voto_update` (setores: admin, ceo, conselheiro · gerente da filial)

<a id="t-competicoes_matriz"></a>
## competicoes_matriz

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [atualizar_competicao](funcoes.md#f-atualizar_competicao), [criar_competicao](funcoes.md#f-criar_competicao), [declarar_vencedora](funcoes.md#f-declarar_vencedora), [encerrar_competicao_agora](funcoes.md#f-encerrar_competicao_agora), [excluir_competicao_matriz](funcoes.md#f-excluir_competicao_matriz), [expirar_competicoes](funcoes.md#f-expirar_competicoes), [reabrir_competicao](funcoes.md#f-reabrir_competicao)
- **Servidor (api/) grava:** `api/ai-competicao.ts`
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Início](telas.md#s-inicio), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos)
- **RPCs que leem:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [_competicao_votos_validos](funcoes.md#f-_competicao_votos_validos), [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [_pontualidade_competicao](funcoes.md#f-_pontualidade_competicao), [atualizar_competicao](funcoes.md#f-atualizar_competicao), [avaliar_item_matriz](funcoes.md#f-avaliar_item_matriz), [calcular_placar_competicao](funcoes.md#f-calcular_placar_competicao), [criar_ciclo_tarefa](funcoes.md#f-criar_ciclo_tarefa), [criar_matriz_tarefa](funcoes.md#f-criar_matriz_tarefa), [declarar_vencedora](funcoes.md#f-declarar_vencedora), [encerrar_competicao_agora](funcoes.md#f-encerrar_competicao_agora), [excluir_competicao_matriz](funcoes.md#f-excluir_competicao_matriz), [lembrar_avaliacoes_pendentes](funcoes.md#f-lembrar_avaliacoes_pendentes), [liberar_matriz_tarefa](funcoes.md#f-liberar_matriz_tarefa), [minha_mesa](funcoes.md#f-minha_mesa), [reabrir_competicao](funcoes.md#f-reabrir_competicao), [remover_avaliacao_matriz](funcoes.md#f-remover_avaliacao_matriz), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Servidor (api/) lê:** `api/ai-competicao.ts`
- **Gatilhos nesta tabela:**
  - `trg_comp_apaga_ciclo` — AFTER DELETE → [competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz) · grava em [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)
  - `trg_comp_criar_ciclo` — BEFORE INSERT → [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz) · grava em [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)
  - `trg_comp_sync_ciclo` — BEFORE UPDATE → [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz) · grava em [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [competicoes_matriz](tabelas.md#t-competicoes_matriz) → [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz) → [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)
  - 1. [competicoes_matriz](tabelas.md#t-competicoes_matriz) → [competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz) → [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)
  - 1. [competicoes_matriz](tabelas.md#t-competicoes_matriz) → [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz) → [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)
- **Ao apagar uma linha daqui:** [apuracoes_bonus](tabelas.md#t-apuracoes_bonus).competicao_id APAGA JUNTO (CASCADE); [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz).competicao_id APAGA JUNTO (CASCADE); [competicao_votos](tabelas.md#t-competicao_votos).competicao_id APAGA JUNTO (CASCADE); [matriz_tarefas](tabelas.md#t-matriz_tarefas).competicao_id APAGA JUNTO (CASCADE)
- **Aponta para:** ciclo_id → [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)
- **RLS:** INSERT `comp_write` (Matriz/professor); SELECT `comp_read` (todos); UPDATE `comp_update` (Matriz/professor)

<a id="t-conciliacao_maquininha_itens"></a>
## conciliacao_maquininha_itens

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha)
- **RPCs que gravam:** [conciliar_maquininha](funcoes.md#f-conciliar_maquininha)
- **Telas que leem:** [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha)
- **RPCs que leem:** [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha)
- **Aponta para:** conciliacao_id → [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha); conta_receber_id → [contas_receber](tabelas.md#t-contas_receber)
- **RLS:** SELECT `fin_select` (setores: financeiro · gerente da filial · Matriz/professor)

<a id="t-conciliacoes_maquininha"></a>
## conciliacoes_maquininha

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha)
- **RPCs que gravam:** [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha)
- **Telas que leem:** [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha)
- **RPCs que leem:** [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [conciliacao_maquininha_itens](tabelas.md#t-conciliacao_maquininha_itens).conciliacao_id APAGA JUNTO (CASCADE)
- **Aponta para:** banco_id → [caixa_bancos](tabelas.md#t-caixa_bancos); conta_pagar_id → [contas_pagar](tabelas.md#t-contas_pagar); forma_pagamento_id → [formas_pagamento](tabelas.md#t-formas_pagamento)
- **RLS:** SELECT `fin_select` (setores: financeiro · gerente da filial · Matriz/professor); UPDATE `fin_update` (setores: financeiro · gerente da filial · Matriz/professor)

<a id="t-condicoes_pagamento"></a>
## condicoes_pagamento

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **RLS:** ALL `condicoes_pagamento_write` (setores: financeiro · gerente da filial · Matriz/professor); SELECT `condicoes_pagamento_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-configuracoes"></a>
## configuracoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Usuários](telas.md#s-usuarios)
- **RPCs que gravam:** [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais), [resetar_dados_operacionais_admin](funcoes.md#f-resetar_dados_operacionais_admin), [resetar_geral_admin](funcoes.md#f-resetar_geral_admin)
- **Telas que leem:** [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que leem:** [ponto_corte_turma](funcoes.md#f-ponto_corte_turma), [resetar_dados_operacionais_admin](funcoes.md#f-resetar_dados_operacionais_admin)
- **RLS:** ALL `admin_write` (Matriz/professor); SELECT `auth_read` (todos)

<a id="t-consumos_material"></a>
## consumos_material

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque) (em [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao) (em [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque))
- **Telas que leem:** —
- **RPCs que leem:** [_dre_calculo](funcoes.md#f-_dre_calculo)
- **Aponta para:** centro_custo_id → [centros_custo](tabelas.md#t-centros_custo); movimentacao_id → [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque); produto_id → [produtos](tabelas.md#t-produtos); requisicao_estoque_id → [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **RLS:** SELECT `consumo_material_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-contas_pagar"></a>
## contas_pagar

- **Telas que gravam:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **Telas que gravam via RPC:** [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que gravam:** [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aplicar_rateio_administrativo](funcoes.md#f-aplicar_rateio_administrativo), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [apurar_das](funcoes.md#f-apurar_das), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha), [cancelar_frete_compra](funcoes.md#f-cancelar_frete_compra), [cancelar_pedido_compra](funcoes.md#f-cancelar_pedido_compra), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [conferir_nota_fiscal](funcoes.md#f-conferir_nota_fiscal), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [gerar_contas_recorrentes](funcoes.md#f-gerar_contas_recorrentes), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [processar_folha](funcoes.md#f-processar_folha), [processar_rescisao](funcoes.md#f-processar_rescisao), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [reverter_folha_maxbank](funcoes.md#f-reverter_folha_maxbank), [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo)
- **Telas que leem:** [Compras › Gerenciamento](telas.md#s-compras-gerenciamento), [Compras › Notas recebidas](telas.md#s-compras-notasrecebidas), [Dashboard](telas.md#s-dashboard), [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Gerenciamento](telas.md#s-financeiro-gerenciamento), [Financeiro › Relatórios](telas.md#s-financeiro-relatórios), [Início](telas.md#s-inicio)
- **RPCs que leem:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [_dre_calculo](funcoes.md#f-_dre_calculo), [_pontualidade_competicao](funcoes.md#f-_pontualidade_competicao), [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [apurar_das](funcoes.md#f-apurar_das), [apurar_rateio_administrativo](funcoes.md#f-apurar_rateio_administrativo), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado), [cancelar_frete_compra](funcoes.md#f-cancelar_frete_compra), [cancelar_pedido_compra](funcoes.md#f-cancelar_pedido_compra), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [conferir_nota_fiscal](funcoes.md#f-conferir_nota_fiscal), [das_competencias](funcoes.md#f-das_competencias), [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [gerar_contas_recorrentes](funcoes.md#f-gerar_contas_recorrentes), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [listar_pendencias](funcoes.md#f-listar_pendencias), [parametros_precificacao](funcoes.md#f-parametros_precificacao), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete), [processar_folha](funcoes.md#f-processar_folha), [processar_rescisao](funcoes.md#f-processar_rescisao), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo), [total_pendente_contas_pagar](funcoes.md#f-total_pendente_contas_pagar)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_conta_de_das_congela` — BEFORE INSERT/UPDATE → [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela)
  - `trg_conta_de_das_inativa` — AFTER UPDATE → [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa) · grava em [das_apuracoes](tabelas.md#t-das_apuracoes)
  - `trg_conta_de_frete_congela` — BEFORE INSERT/UPDATE → [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela)
  - `trg_conta_de_frete_inativa` — AFTER UPDATE → [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa) · grava em [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [fretes_compra](tabelas.md#t-fretes_compra), [produtos_custo](tabelas.md#t-produtos_custo)
  - `trg_conta_de_pedido_congela` — BEFORE UPDATE → [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela)
  - `trg_conta_de_pedido_nao_exclui` — BEFORE UPDATE → [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui)
  - `trg_conta_pagar_exige_recebimento` — BEFORE UPDATE → [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento)
  - `trg_conta_pagar_fatura_antes_de_pagar` — BEFORE UPDATE → [fn_conta_pagar_fatura_antes_de_pagar](funcoes.md#f-fn_conta_pagar_fatura_antes_de_pagar)
  - `trg_conta_pagar_nao_exclui` — BEFORE UPDATE → [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui)
  - `trg_conta_pagar_natureza` — BEFORE INSERT/UPDATE → [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza)
  - `trg_contas_pagar_avancar_folha` — AFTER UPDATE → [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar) · grava em [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [notificacoes](tabelas.md#t-notificacoes)
  - `trg_contas_pagar_avancar_rescisao` — AFTER UPDATE → [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao) · grava em [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [notificacoes](tabelas.md#t-notificacoes), [rescisoes](tabelas.md#t-rescisoes)
  - `trg_contas_pagar_bloqueio_insert` — BEFORE INSERT → [bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado)
  - `trg_contas_pagar_bloqueio_pagar` — BEFORE UPDATE → [bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado)
  - `trg_contas_pagar_sync_parcela` — AFTER UPDATE → [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo) · grava em [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_sync_saldo_contas_pagar` — AFTER INSERT/UPDATE/DELETE → [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar) · grava em [caixa_bancos](tabelas.md#t-caixa_bancos)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar) → [caixa_bancos](tabelas.md#t-caixa_bancos)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo) → [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa) → [fretes_compra](tabelas.md#t-fretes_compra)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa) → [produtos_custo](tabelas.md#t-produtos_custo)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa) → [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa) → [das_apuracoes](tabelas.md#t-das_apuracoes)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar) → [folha_credito_falhas](tabelas.md#t-folha_credito_falhas)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar) → [folha_pagamento](tabelas.md#t-folha_pagamento)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar) → [maxbank_contas](tabelas.md#t-maxbank_contas)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar) → [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao) → [rescisoes](tabelas.md#t-rescisoes)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao) → [maxbank_contas](tabelas.md#t-maxbank_contas)
  - 1. [contas_pagar](tabelas.md#t-contas_pagar) → [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao) → [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Ao apagar uma linha daqui:** [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha).conta_pagar_id zera o vínculo (SET NULL); [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas).conta_id APAGA JUNTO (CASCADE); [das_apuracoes](tabelas.md#t-das_apuracoes).conta_pagar_id APAGA JUNTO (CASCADE); [filial_investimentos](tabelas.md#t-filial_investimentos).conta_pagar_id zera o vínculo (SET NULL); [folha_credito_falhas](tabelas.md#t-folha_credito_falhas).conta_pagar_id zera o vínculo (SET NULL); [fretes_compra](tabelas.md#t-fretes_compra).conta_pagar_id APAGA JUNTO (CASCADE); [notas_recebidas](tabelas.md#t-notas_recebidas).conta_pagar_id zera o vínculo (SET NULL); [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo).contas_pagar_id zera o vínculo (SET NULL); [rateio_administrativo_itens](tabelas.md#t-rateio_administrativo_itens).conta_pagar_id zera o vínculo (SET NULL)
- **Aponta para:** banco_id → [caixa_bancos](tabelas.md#t-caixa_bancos); centro_custo_id → [centros_custo](tabelas.md#t-centros_custo); recorrencia_id → [despesas_recorrentes](tabelas.md#t-despesas_recorrentes); filial_investimento_id → [filial_investimentos](tabelas.md#t-filial_investimentos); folha_pagamento_id → [folha_pagamento](tabelas.md#t-folha_pagamento); fornecedor_id → [fornecedores](tabelas.md#t-fornecedores); pedido_id → [pedidos](tabelas.md#t-pedidos); rescisao_id → [rescisoes](tabelas.md#t-rescisoes)
- **RLS:** DELETE `fin_delete` (setores: financeiro · gerente da filial · Matriz/professor); INSERT `fin_insert` (setores: financeiro · gerente da filial · Matriz/professor); SELECT `fin_select` (setores: financeiro · gerente da filial · Matriz/professor); UPDATE `fin_update` (setores: financeiro · gerente da filial · Matriz/professor)

<a id="t-contas_pagar_baixas"></a>
## contas_pagar_baixas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **RPCs que gravam:** [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar)
- **Telas que leem:** —
- **RPCs que leem:** [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [total_pendente_contas_pagar](funcoes.md#f-total_pendente_contas_pagar)
- **Aponta para:** banco_id → [caixa_bancos](tabelas.md#t-caixa_bancos); conta_id → [contas_pagar](tabelas.md#t-contas_pagar)
- **RLS:** SELECT `cpb_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-contas_receber"></a>
## contas_receber

- **Telas que gravam:** [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber)
- **Telas que gravam via RPC:** [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Capital](telas.md#s-matriz-capital), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que gravam:** [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aplicar_rateio_administrativo](funcoes.md#f-aplicar_rateio_administrativo), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [pdv_registrar_credito_misto](funcoes.md#f-pdv_registrar_credito_misto), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz) (em [vendas](tabelas.md#t-vendas))
- **Telas que leem:** [Dashboard](telas.md#s-dashboard), [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Gerenciamento](telas.md#s-financeiro-gerenciamento), [Financeiro › Relatórios](telas.md#s-financeiro-relatórios), [Início](telas.md#s-inicio)
- **RPCs que leem:** [_taxa_pelo_mix](funcoes.md#f-_taxa_pelo_mix), [apurar_rateio_administrativo](funcoes.md#f-apurar_rateio_administrativo), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [cliente_saldo_devedor](funcoes.md#f-cliente_saldo_devedor), [cliente_titulos_vencidos](funcoes.md#f-cliente_titulos_vencidos), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [listar_pendencias](funcoes.md#f-listar_pendencias), [pdv_registrar_credito_misto](funcoes.md#f-pdv_registrar_credito_misto), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_conta_receber_fecha_pedido_venda` — AFTER UPDATE → [_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda) · grava em [pedidos_venda](tabelas.md#t-pedidos_venda)
  - `trg_conta_receber_nao_exclui` — BEFORE UPDATE → [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui)
  - `trg_exige_conciliacao` — BEFORE INSERT/UPDATE → [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_sync_saldo_contas_receber` — AFTER INSERT/UPDATE/DELETE → [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber) · grava em [caixa_bancos](tabelas.md#t-caixa_bancos)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [contas_receber](tabelas.md#t-contas_receber) → [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber) → [caixa_bancos](tabelas.md#t-caixa_bancos)
  - 1. [contas_receber](tabelas.md#t-contas_receber) → [_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda) → [pedidos_venda](tabelas.md#t-pedidos_venda)
- **Ao apagar uma linha daqui:** [conciliacao_maquininha_itens](tabelas.md#t-conciliacao_maquininha_itens).conta_receber_id APAGA JUNTO (CASCADE); [contas_receber_baixas](tabelas.md#t-contas_receber_baixas).conta_id APAGA JUNTO (CASCADE); [notas_emitidas](tabelas.md#t-notas_emitidas).conta_receber_id zera o vínculo (SET NULL); [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo).contas_receber_id zera o vínculo (SET NULL); [pedidos_venda](tabelas.md#t-pedidos_venda).conta_receber_id zera o vínculo (SET NULL); [rateio_administrativo_itens](tabelas.md#t-rateio_administrativo_itens).conta_receber_id zera o vínculo (SET NULL)
- **Aponta para:** banco_id → [caixa_bancos](tabelas.md#t-caixa_bancos); cliente_id → [clientes](tabelas.md#t-clientes); forma_pagamento_id → [formas_pagamento](tabelas.md#t-formas_pagamento); pedido_venda_id → [pedidos_venda](tabelas.md#t-pedidos_venda); produto_patrimonio_id → [produtos](tabelas.md#t-produtos); venda_id → [vendas](tabelas.md#t-vendas)
- **RLS:** DELETE `fin_delete` (setores: financeiro · gerente da filial · Matriz/professor); INSERT `fin_insert` (setores: financeiro · gerente da filial · Matriz/professor); SELECT `fin_select` (setores: financeiro · gerente da filial · Matriz/professor); UPDATE `fin_update` (setores: financeiro · gerente da filial · Matriz/professor)

<a id="t-contas_receber_baixas"></a>
## contas_receber_baixas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber)
- **RPCs que gravam:** [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha)
- **Telas que leem:** —
- **RPCs que leem:** [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado), [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha), [cliente_saldo_devedor](funcoes.md#f-cliente_saldo_devedor), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta)
- **Aponta para:** banco_id → [caixa_bancos](tabelas.md#t-caixa_bancos); conta_id → [contas_receber](tabelas.md#t-contas_receber)
- **RLS:** SELECT `crb_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-contratos"></a>
## contratos

- **Telas que gravam:** [Contratos](telas.md#s-contratos)
- **RPCs que gravam:** [assinar_contrato](funcoes.md#f-assinar_contrato), [encerrar_contrato](funcoes.md#f-encerrar_contrato), [recusar_contrato](funcoes.md#f-recusar_contrato)
- **Telas que leem:** [Contratos](telas.md#s-contratos)
- **RPCs que leem:** [assinar_contrato](funcoes.md#f-assinar_contrato), [encerrar_contrato](funcoes.md#f-encerrar_contrato), [minha_mesa](funcoes.md#f-minha_mesa), [recusar_contrato](funcoes.md#f-recusar_contrato)
- **Gatilhos nesta tabela:**
  - `contratos_carimbo_trg` — BEFORE INSERT/UPDATE → [contratos_carimbo](funcoes.md#f-contratos_carimbo)
- **Ao apagar uma linha daqui:** [contratos](tabelas.md#t-contratos).contrato_pai_id zera o vínculo (SET NULL); [contratos_assinaturas](tabelas.md#t-contratos_assinaturas).contrato_id APAGA JUNTO (CASCADE)
- **Aponta para:** contrato_pai_id → [contratos](tabelas.md#t-contratos); criado_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `contratos_delete` (gerente da filial); INSERT `contratos_insert` (gerente da filial); SELECT `contratos_select` (setores: ceo, conselheiro · gerente da filial); UPDATE `contratos_update` (gerente da filial)

<a id="t-contratos_assinaturas"></a>
## contratos_assinaturas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Contratos](telas.md#s-contratos)
- **RPCs que gravam:** [assinar_contrato](funcoes.md#f-assinar_contrato)
- **Telas que leem:** [Contratos](telas.md#s-contratos)
- **RPCs que leem:** [assinar_contrato](funcoes.md#f-assinar_contrato)
- **Aponta para:** contrato_id → [contratos](tabelas.md#t-contratos); user_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `contratos_assinaturas_select` (regra própria)

<a id="t-controle_caixa"></a>
## controle_caixa

- **Telas que gravam:** [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que gravam:** [confirmar_fechamento_caixa](funcoes.md#f-confirmar_fechamento_caixa), [fechar_caixa_conferido](funcoes.md#f-fechar_caixa_conferido), [reabrir_caixa](funcoes.md#f-reabrir_caixa), [solicitar_fechamento_caixa](funcoes.md#f-solicitar_fechamento_caixa), [suspender_caixa](funcoes.md#f-suspender_caixa)
- **Telas que leem:** [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que leem:** [confirmar_fechamento_caixa](funcoes.md#f-confirmar_fechamento_caixa), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [dinheiro_do_caixa](funcoes.md#f-dinheiro_do_caixa), [fechar_caixa_conferido](funcoes.md#f-fechar_caixa_conferido), [listar_pendencias](funcoes.md#f-listar_pendencias), [previa_fechamento_caixa](funcoes.md#f-previa_fechamento_caixa), [reabrir_caixa](funcoes.md#f-reabrir_caixa), [registrar_movimentacao_caixa](funcoes.md#f-registrar_movimentacao_caixa), [solicitar_fechamento_caixa](funcoes.md#f-solicitar_fechamento_caixa), [suspender_caixa](funcoes.md#f-suspender_caixa)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_avisa_financeiro_do_caixa` — AFTER INSERT/UPDATE → [avisa_financeiro_do_caixa](funcoes.md#f-avisa_financeiro_do_caixa) · grava em [notificacoes](tabelas.md#t-notificacoes)
  - `trg_bloqueia_fechamento_venda_em_curso` — BEFORE UPDATE → [bloqueia_fechamento_com_venda_em_curso](funcoes.md#f-bloqueia_fechamento_com_venda_em_curso)
  - `trg_controle_caixa_guard` — BEFORE INSERT/UPDATE → [controle_caixa_guard](funcoes.md#f-controle_caixa_guard)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [controle_caixa_reaberturas](tabelas.md#t-controle_caixa_reaberturas).controle_caixa_id APAGA JUNTO (CASCADE); [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa).controle_caixa_id APAGA JUNTO (CASCADE)
- **RLS:** ALL `caixa_filial_write` (setores: financeiro, vendas · gerente da filial · Matriz/professor); SELECT `caixa_filial_select` (setores: financeiro, vendas · gerente da filial · Matriz/professor)

<a id="t-controle_caixa_reaberturas"></a>
## controle_caixa_reaberturas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa)
- **RPCs que gravam:** [reabrir_caixa](funcoes.md#f-reabrir_caixa)
- **Telas que leem:** —
- **Aponta para:** controle_caixa_id → [controle_caixa](tabelas.md#t-controle_caixa)
- **RLS:** SELECT `caixa_reab_select` (setores: financeiro · Matriz/professor)

<a id="t-cotacoes"></a>
## cotacoes

- **Telas que gravam:** [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **Telas que gravam via RPC:** [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **RPCs que gravam:** [decidir_cotacao](funcoes.md#f-decidir_cotacao), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao), [reabrir_cotacao](funcoes.md#f-reabrir_cotacao), [reenviar_cotacao_corrigida](funcoes.md#f-reenviar_cotacao_corrigida)
- **Telas que leem:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Gerenciamento](telas.md#s-compras-gerenciamento), [Compras › Pedidos](telas.md#s-compras-pedidos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **RPCs que leem:** [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo), [contar_pendencias](funcoes.md#f-contar_pendencias), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [decidir_cotacao](funcoes.md#f-decidir_cotacao), [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [listar_pendencias](funcoes.md#f-listar_pendencias), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [reabrir_cotacao](funcoes.md#f-reabrir_cotacao), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao), [reenviar_cotacao_corrigida](funcoes.md#f-reenviar_cotacao_corrigida), [vincular_produto_requisicao](funcoes.md#f-vincular_produto_requisicao)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_cotacao_aprovada_congela` — BEFORE UPDATE → [fn_cotacao_aprovada_congela](funcoes.md#f-fn_cotacao_aprovada_congela)
  - `trg_cotacao_com_pedido_nao_volta` — BEFORE UPDATE → [fn_cotacao_com_pedido_nao_volta](funcoes.md#f-fn_cotacao_com_pedido_nao_volta)
  - `trg_cotacao_decisao_guard` — BEFORE UPDATE → [cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard)
  - `trg_cotacao_marca_so_na_eventual` — BEFORE INSERT/UPDATE → [fn_cotacao_marca_so_na_eventual](funcoes.md#f-fn_cotacao_marca_so_na_eventual)
  - `trg_cotacao_proposta_unica_fornecedor` — BEFORE INSERT/UPDATE → [cotacao_proposta_unica_por_fornecedor](funcoes.md#f-cotacao_proposta_unica_por_fornecedor)
  - `trg_cotacoes_unica_aprovada` — BEFORE INSERT/UPDATE → [cotacoes_unica_aprovada](funcoes.md#f-cotacoes_unica_aprovada)
  - `trg_fornecedor_nao_e_concessionaria` — BEFORE INSERT/UPDATE → [fn_fornecedor_nao_e_concessionaria](funcoes.md#f-fn_fornecedor_nao_e_concessionaria)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_numero_documento` — BEFORE INSERT → [set_numero_documento](funcoes.md#f-set_numero_documento) · grava em [documento_sequencias](tabelas.md#t-documento_sequencias)
  - `trg_sem_exclusao` — BEFORE UPDATE → [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao)
- **Ao apagar uma linha daqui:** [pedidos](tabelas.md#t-pedidos).cotacao_id zera o vínculo (SET NULL)
- **Aponta para:** fornecedor_id → [fornecedores](tabelas.md#t-fornecedores); requisicao_id → [requisicoes](tabelas.md#t-requisicoes)
- **RLS:** DELETE `cot_delete` (Matriz/professor); INSERT `cot_insert` (setores: compras, logistica · gerente da filial · Matriz/professor); SELECT `cot_select` (setores: compras, financeiro, logistica · gerente da filial · Matriz/professor); UPDATE `cot_update` (setores: compras, financeiro, logistica · gerente da filial · Matriz/professor)

<a id="t-criterios_avaliacao"></a>
## criterios_avaliacao

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
- **RPCs que gravam:** [atualizar_avaliacao](funcoes.md#f-atualizar_avaliacao), [criar_avaliacao](funcoes.md#f-criar_avaliacao), [criar_avaliacao_filial](funcoes.md#f-criar_avaliacao_filial), [criar_avaliacao_ti_dev_ia](funcoes.md#f-criar_avaliacao_ti_dev_ia)
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que leem:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [calcular_placar_padrao](funcoes.md#f-calcular_placar_padrao), [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios), [media_avaliacao_funcionario](funcoes.md#f-media_avaliacao_funcionario)
- **Aponta para:** avaliacao_id → [avaliacoes](tabelas.md#t-avaliacoes)
- **RLS:** INSERT `criterios_insert` (o próprio usuário); SELECT `criterios_read` (regra própria)

<a id="t-das_apuracoes"></a>
## das_apuracoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- **RPCs que gravam:** [apurar_das](funcoes.md#f-apurar_das)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa) (em [contas_pagar](tabelas.md#t-contas_pagar))
- **Telas que leem:** —
- **RPCs que leem:** [apurar_das](funcoes.md#f-apurar_das), [das_competencias](funcoes.md#f-das_competencias)
- **Aponta para:** conta_pagar_id → [contas_pagar](tabelas.md#t-contas_pagar)
- **RLS:** SELECT `das_apuracoes_select` (setores: financeiro · gerente da filial · Matriz/professor)

<a id="t-demissoes"></a>
## demissoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **RPCs que gravam:** [decidir_desligamento](funcoes.md#f-decidir_desligamento), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento)
- **Telas que leem:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **RPCs que leem:** [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [decidir_desligamento](funcoes.md#f-decidir_desligamento), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [minha_mesa](funcoes.md#f-minha_mesa), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento)
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [rescisoes](tabelas.md#t-rescisoes).demissao_id APAGA JUNTO (CASCADE)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios)
- **RLS:** SELECT `demissoes_select` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-departamentos"></a>
## departamentos

- **Telas que gravam:** [Recursos Humanos › Departamentos](telas.md#s-rh-departamentos)
- **RPCs que gravam:** —
- **Telas que leem:** [Recursos Humanos › Departamentos](telas.md#s-rh-departamentos), [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que leem:** [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **RLS:** ALL `rh_all` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-desenvolvimentos_ia"></a>
## desenvolvimentos_ia

- **Telas que gravam:** [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
- **Telas que gravam via RPC:** [Usuários](telas.md#s-usuarios)
- **RPCs que gravam:** [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Telas que leem:** [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
- **RPCs que leem:** [contar_pendencias](funcoes.md#f-contar_pendencias)
- **Ao apagar uma linha daqui:** [avaliacoes](tabelas.md#t-avaliacoes).desenvolvimento_ia_id APAGA JUNTO (CASCADE)
- **RLS:** DELETE `dev_ia_delete` (Matriz/professor); INSERT `dev_ia_insert` (setores: ti · Matriz/professor); SELECT `dev_ia_read` (todos); UPDATE `dev_ia_update` (setores: ti · Matriz/professor)

<a id="t-despesas_recorrentes"></a>
## despesas_recorrentes

- **Telas que gravam:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **RPCs que gravam:** [gerar_contas_recorrentes](funcoes.md#f-gerar_contas_recorrentes)
- **Telas que leem:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **RPCs que leem:** [gerar_contas_recorrentes](funcoes.md#f-gerar_contas_recorrentes)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [contas_pagar](tabelas.md#t-contas_pagar).recorrencia_id zera o vínculo (SET NULL)
- **Aponta para:** centro_custo_id → [centros_custo](tabelas.md#t-centros_custo); fornecedor_id → [fornecedores](tabelas.md#t-fornecedores)
- **RLS:** DELETE `desp_rec_delete` (setores: financeiro · gerente da filial · Matriz/professor); INSERT `desp_rec_insert` (setores: financeiro · gerente da filial · Matriz/professor); SELECT `desp_rec_select` (setores: financeiro · gerente da filial · Matriz/professor); UPDATE `desp_rec_update` (setores: financeiro · gerente da filial · Matriz/professor)

<a id="t-destinacoes_resultado"></a>
## destinacoes_resultado

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Aponta para:** banco_origem_id → [caixa_bancos](tabelas.md#t-caixa_bancos); banco_destino_id → [caixa_bancos](tabelas.md#t-caixa_bancos)
- **RLS:** SELECT `destinacao_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-devolucoes"></a>
## devolucoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que gravam:** [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda)
- **Telas que leem:** [Vendas › Devoluções](telas.md#s-vendas-devoluções)
- **RPCs que leem:** [_dre_calculo](funcoes.md#f-_dre_calculo), [_receita_servico](funcoes.md#f-_receita_servico), [_receita_simples](funcoes.md#f-_receita_simples), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Views que dependem desta:** [v_venda_saldo_devolucao](tabelas.md#t-v_venda_saldo_devolucao)
- **Gatilhos nesta tabela:**
  - `trg_devolucao_valida_filial` — BEFORE INSERT/UPDATE → [devolucao_valida_filial_da_venda](funcoes.md#f-devolucao_valida_filial_da_venda)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [itens_devolucao](tabelas.md#t-itens_devolucao).devolucao_id APAGA JUNTO (CASCADE)
- **Aponta para:** venda_id → [vendas](tabelas.md#t-vendas)
- **RLS:** INSERT `devolucoes_insert` (gerente da filial · Matriz/professor); SELECT `devolucoes_select` (qualquer um da própria filial · Matriz/professor); UPDATE `devolucoes_update` (gerente da filial · Matriz/professor)

<a id="t-devolucoes_fornecedor"></a>
## devolucoes_fornecedor

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- **RPCs que gravam:** [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor)
- **Telas que leem:** [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- **RPCs que leem:** [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor)
- **Views que dependem desta:** [v_fornecedor_desempenho](tabelas.md#t-v_fornecedor_desempenho), [v_pedido_saldo](tabelas.md#t-v_pedido_saldo)
- **Aponta para:** pedido_id → [pedidos](tabelas.md#t-pedidos); produto_id → [produtos](tabelas.md#t-produtos); recebimento_id → [recebimentos](tabelas.md#t-recebimentos)
- **RLS:** SELECT `devfor_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-distribuicoes_lucro"></a>
## distribuicoes_lucro

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Capital](telas.md#s-matriz-capital)
- **RPCs que gravam:** [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial)
- **Telas que leem:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **RPCs que leem:** [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial)
- **Aponta para:** banco_origem_id → [caixa_bancos](tabelas.md#t-caixa_bancos); banco_destino_id → [caixa_bancos](tabelas.md#t-caixa_bancos); decidido_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `distribuicoes_lucro_select` (setores: admin, ceo, conselheiro · gerente da filial)

<a id="t-documento_sequencias"></a>
## documento_sequencias

- **Telas que gravam:** —
- **RPCs que gravam:** [proximo_numero_documento](funcoes.md#f-proximo_numero_documento)
- **Telas que leem:** —

<a id="t-documentos"></a>
## documentos

- **Telas que gravam:** [Documentos](telas.md#s-documentos)
- **RPCs que gravam:** [publicar_documento](funcoes.md#f-publicar_documento)
- **Telas que leem:** [Documentos](telas.md#s-documentos)
- **RPCs que leem:** [marcar_documento_lido](funcoes.md#f-marcar_documento_lido), [publicar_documento](funcoes.md#f-publicar_documento), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `documento_arquivo_e_de_quem_grava_trg` — BEFORE INSERT/UPDATE → [documento_arquivo_e_de_quem_grava](funcoes.md#f-documento_arquivo_e_de_quem_grava)
  - `documento_publicacao_e_so_de_ida_trg` — BEFORE UPDATE → [documento_publicacao_e_so_de_ida](funcoes.md#f-documento_publicacao_e_so_de_ida)
- **Ao apagar uma linha daqui:** [documentos_leitura](tabelas.md#t-documentos_leitura).documento_id APAGA JUNTO (CASCADE)
- **Aponta para:** publicado_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `documentos_delete` (Matriz/professor); INSERT `documentos_insert` (Matriz/professor); SELECT `documentos_select` (Matriz/professor); UPDATE `documentos_update` (Matriz/professor)

<a id="t-documentos_leitura"></a>
## documentos_leitura

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Documentos](telas.md#s-documentos)
- **RPCs que gravam:** [marcar_documento_lido](funcoes.md#f-marcar_documento_lido)
- **Telas que leem:** [Documentos](telas.md#s-documentos)
- **Aponta para:** documento_id → [documentos](tabelas.md#t-documentos); user_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** INSERT `documentos_leitura_insert` (o próprio usuário); SELECT `documentos_leitura_select` (setores: admin, ceo, conselheiro)

<a id="t-duplicatas"></a>
## duplicatas

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
- **RLS:** ALL `fin_all` (setores: financeiro · Matriz/professor)

<a id="t-emprestimos_filial"></a>
## emprestimos_filial

- **Telas que gravam:** [Financeiro › Capital](telas.md#s-financeiro-capital)
- **Telas que gravam via RPC:** [Capital](telas.md#s-matriz-capital), [Usuários](telas.md#s-usuarios)
- **RPCs que gravam:** [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [conceder_mutuo_capital](funcoes.md#f-conceder_mutuo_capital), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [negar_emprestimo](funcoes.md#f-negar_emprestimo), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Telas que leem:** [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **RPCs que leem:** [_pontualidade_competicao](funcoes.md#f-_pontualidade_competicao), [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [negar_emprestimo](funcoes.md#f-negar_emprestimo), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_emprestimo_arquivado_historico` — BEFORE UPDATE → [emprestimo_arquivado_e_historico](funcoes.md#f-emprestimo_arquivado_e_historico)
  - `trg_emprestimo_valida_condicoes` — BEFORE INSERT/UPDATE → [emprestimo_valida_condicoes](funcoes.md#f-emprestimo_valida_condicoes)
- **Ao apagar uma linha daqui:** [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo).emprestimo_id APAGA JUNTO (CASCADE)
- **Aponta para:** banco_id → [caixa_bancos](tabelas.md#t-caixa_bancos); banco_origem_id → [caixa_bancos](tabelas.md#t-caixa_bancos); solicitado_por → [user_profiles](tabelas.md#t-user_profiles); aprovado_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** INSERT `emprestimos_insert` (setores: admin, ceo, gerente · gerente da filial); SELECT `emprestimos_select` (setores: admin, ceo, conselheiro · gerente da filial); UPDATE `emprestimos_update` (setores: admin, ceo)

<a id="t-evidencias_avaliacao"></a>
## evidencias_avaliacao

- **Telas que gravam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** —
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Aponta para:** ciclo_id → [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao); colaborador_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `evidencias_delete` (Matriz/professor); INSERT `evidencias_insert` (o próprio usuário); SELECT `evidencias_read` (gerente da filial · Matriz/professor)

<a id="t-expedicao"></a>
## expedicao

- **Telas que gravam:** [Estoque › Expedição](telas.md#s-estoque-expedição)
- **RPCs que gravam:** [expedir](funcoes.md#f-expedir)
- **Telas que leem:** [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Gerenciamento](telas.md#s-estoque-gerenciamento)
- **RPCs que leem:** [contar_pendencias](funcoes.md#f-contar_pendencias), [expedir](funcoes.md#f-expedir)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** produto_id → [produtos](tabelas.md#t-produtos); requisicao_id → [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **RLS:** ALL `logist_all` (setores: logistica · Matriz/professor)

<a id="t-feedbacks_avaliacao"></a>
## feedbacks_avaliacao

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Aponta para:** avaliacao_id → [avaliacoes](tabelas.md#t-avaliacoes)
- **RLS:** INSERT `feedbacks_insert` (o próprio usuário); SELECT `feedbacks_read` (regra própria)

<a id="t-feedbacks_organizacao"></a>
## feedbacks_organizacao

- **Telas que gravam:** [Feedback & Requerimentos](telas.md#s-feedback-org)
- **RPCs que gravam:** [enviar_feedback_anonimo](funcoes.md#f-enviar_feedback_anonimo)
- **Telas que leem:** [Feedback & Requerimentos](telas.md#s-feedback-org)
- **RLS:** DELETE `feedback_org_delete` (ninguém (só via RPC)); INSERT `feedback_org_insert` (todos); SELECT `feedback_org_select` (setores: admin, ceo); UPDATE `feedback_org_modify` (setores: admin, ceo)

<a id="t-ferias"></a>
## ferias

- **Telas que gravam:** [Recursos Humanos › Férias](telas.md#s-rh-férias)
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **RPCs que gravam:** [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado)
- **Telas que leem:** [Recursos Humanos › Férias](telas.md#s-rh-férias), [Recursos Humanos › Gerenciamento](telas.md#s-rh-gerenciamento), [Recursos Humanos › Relatórios](telas.md#s-rh-relatórios)
- **RPCs que leem:** [calcular_rescisao](funcoes.md#f-calcular_rescisao), [contar_pendencias](funcoes.md#f-contar_pendencias), [minha_mesa](funcoes.md#f-minha_mesa)
- **Gatilhos nesta tabela:**
  - `trg_ferias_decisao_guard` — BEFORE UPDATE → [ferias_decisao_guard](funcoes.md#f-ferias_decisao_guard)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas).ferias_id zera o vínculo (SET NULL)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios)
- **RLS:** ALL `ferias_rh_all` (setores: rh · gerente da filial · Matriz/professor); INSERT `ferias_self_ins` (o próprio usuário); SELECT `ferias_self_read` (o próprio usuário)

<a id="t-filiais"></a>
## filiais

- **Telas que gravam:** [Empresa › Filiais](telas.md#s-empresa-filiais)
- **RPCs que gravam:** —
- **Telas que leem:** [Empresa › Filiais](telas.md#s-empresa-filiais)
- **RPCs que leem:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [filial_investimentos](tabelas.md#t-filial_investimentos).filial_id zera o vínculo (SET NULL)
- **RLS:** DELETE `filiais_delete` (Matriz/professor); INSERT `filiais_insert` (Matriz/professor); SELECT `read_filiais` (regra própria); UPDATE `filiais_update` (Matriz/professor)

<a id="t-filial_caixa_config"></a>
## filial_caixa_config

- **Telas que gravam:** [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos)
- **RPCs que gravam:** —
- **Telas que leem:** [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos)
- **RPCs que leem:** [transferir_entre_contas](funcoes.md#f-transferir_entre_contas)
- **RLS:** SELECT `fcc_select` (qualquer um da própria filial · Matriz/professor); UPDATE `fcc_update` (setores: admin, ceo)

<a id="t-filial_investimentos"></a>
## filial_investimentos

- **Telas que gravam:** [Empresa › Filiais](telas.md#s-empresa-filiais)
- **Telas que gravam via RPC:** [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
- **RPCs que gravam:** [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial)
- **Telas que leem:** [Empresa › Filiais](telas.md#s-empresa-filiais)
- **RPCs que leem:** [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_filial_investimento_aluguel_qtd_um` — BEFORE INSERT/UPDATE → [fn_filial_investimento_aluguel_qtd_um](funcoes.md#f-fn_filial_investimento_aluguel_qtd_um)
  - `trg_filial_investimento_carimba_filial` — BEFORE INSERT/UPDATE → [fn_filial_investimento_carimba_filial](funcoes.md#f-fn_filial_investimento_carimba_filial)
  - `trg_filial_investimento_trava_gerado` — BEFORE UPDATE → [fn_filial_investimento_trava_gerado](funcoes.md#f-fn_filial_investimento_trava_gerado)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [contas_pagar](tabelas.md#t-contas_pagar).filial_investimento_id zera o vínculo (SET NULL)
- **Aponta para:** centro_custo_id → [centros_custo](tabelas.md#t-centros_custo); conta_pagar_id → [contas_pagar](tabelas.md#t-contas_pagar); filial_id → [filiais](tabelas.md#t-filiais); produto_patrimonio_id → [produtos](tabelas.md#t-produtos)
- **RLS:** DELETE `filial_investimentos_delete` (gerente da filial · Matriz/professor); INSERT `filial_investimentos_insert` (gerente da filial · Matriz/professor); SELECT `read_filial_investimentos` (qualquer um da própria filial · Matriz/professor); UPDATE `filial_investimentos_update` (gerente da filial · Matriz/professor)

<a id="t-filial_precificacao"></a>
## filial_precificacao

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- **RPCs que gravam:** [salvar_lucro_servico](funcoes.md#f-salvar_lucro_servico), [salvar_parametros_precificacao](funcoes.md#f-salvar_parametros_precificacao)
- **Telas que leem:** —
- **RPCs que leem:** [_simples_rbt12](funcoes.md#f-_simples_rbt12), [parametros_precificacao](funcoes.md#f-parametros_precificacao)

<a id="t-financeiro_config"></a>
## financeiro_config

- **Telas que gravam:** [Financeiro › Juros & Multa](telas.md#s-financeiro-juros&multa)
- **RPCs que gravam:** —
- **Telas que leem:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Juros & Multa](telas.md#s-financeiro-juros&multa)
- **RPCs que leem:** [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado), [total_pendente_contas_pagar](funcoes.md#f-total_pendente_contas_pagar)
- **RLS:** SELECT `fin_config_read` (todos); UPDATE `fin_config_update` (setores: financeiro)

<a id="t-folha_credito_falhas"></a>
## folha_credito_falhas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **RPCs que gravam:** [_folha_creditar_e_avancar](funcoes.md#f-_folha_creditar_e_avancar)
- **Telas que leem:** —
- **Aponta para:** conta_pagar_id → [contas_pagar](tabelas.md#t-contas_pagar); folha_id → [folha_pagamento](tabelas.md#t-folha_pagamento)
- **RLS:** SELECT `folha_falhas_read` (setores: rh · Matriz/professor)

<a id="t-folha_pagamento"></a>
## folha_pagamento

- **Telas que gravam:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **RPCs que gravam:** [_folha_creditar_e_avancar](funcoes.md#f-_folha_creditar_e_avancar), [processar_folha](funcoes.md#f-processar_folha), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto)
- **Telas que leem:** [Empresa › Filiais](telas.md#s-empresa-filiais), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Recursos Humanos › Gerenciamento](telas.md#s-rh-gerenciamento), [Recursos Humanos › Relatórios](telas.md#s-rh-relatórios)
- **RPCs que leem:** [_folha_creditar_e_avancar](funcoes.md#f-_folha_creditar_e_avancar), [creditar_folha_maxbank](funcoes.md#f-creditar_folha_maxbank), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [pagar_folha](funcoes.md#f-pagar_folha), [processar_folha](funcoes.md#f-processar_folha), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais), [rh_fgts_acumulado](funcoes.md#f-rh_fgts_acumulado), [rh_media_variaveis](funcoes.md#f-rh_media_variaveis)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_folha_historico_fechado` — BEFORE UPDATE → [folha_historico_fechado](funcoes.md#f-folha_historico_fechado)
  - `trg_folha_pagamento_set_salario_base` — BEFORE INSERT → [folha_pagamento_set_salario_base](funcoes.md#f-folha_pagamento_set_salario_base)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [contas_pagar](tabelas.md#t-contas_pagar).folha_pagamento_id zera o vínculo (SET NULL); [folha_credito_falhas](tabelas.md#t-folha_credito_falhas).folha_id APAGA JUNTO (CASCADE); [folha_rubricas](tabelas.md#t-folha_rubricas).folha_id APAGA JUNTO (CASCADE)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios)
- **RLS:** ALL `folha_rh_all` (setores: rh · gerente da filial · Matriz/professor); SELECT `folha_self_read` (o próprio usuário)

<a id="t-folha_rubricas"></a>
## folha_rubricas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **RPCs que gravam:** [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto)
- **Telas que leem:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **RPCs que leem:** [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais), [rh_media_variaveis](funcoes.md#f-rh_media_variaveis)
- **Aponta para:** folha_id → [folha_pagamento](tabelas.md#t-folha_pagamento)
- **RLS:** SELECT `folha_rubricas_select` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-formas_pagamento"></a>
## formas_pagamento

- **Telas que gravam:** [Empresa › Formas de pagamento](telas.md#s-empresa-formasdepagamento)
- **RPCs que gravam:** —
- **Telas que leem:** [Empresa › Formas de pagamento](telas.md#s-empresa-formasdepagamento), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **RPCs que leem:** [_taxa_pelo_mix](funcoes.md#f-_taxa_pelo_mix), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [parametros_precificacao](funcoes.md#f-parametros_precificacao)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_formas_pagamento_normaliza` — BEFORE INSERT/UPDATE → [fn_formas_pagamento_normaliza](funcoes.md#f-fn_formas_pagamento_normaliza)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha).forma_pagamento_id zera o vínculo (SET NULL); [contas_receber](tabelas.md#t-contas_receber).forma_pagamento_id zera o vínculo (SET NULL); [orcamentos](tabelas.md#t-orcamentos).forma_pagamento_id zera o vínculo (SET NULL)
- **RLS:** ALL `formas_pagamento_write` (setores: financeiro · gerente da filial · Matriz/professor); SELECT `formas_pagamento_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-fornecedores"></a>
## fornecedores

- **Telas que gravam:** [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores)
- **RPCs que gravam:** —
- **Telas que leem:** [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Gerenciamento](telas.md#s-compras-gerenciamento), [Compras › Notas recebidas](telas.md#s-compras-notasrecebidas), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Relatórios](telas.md#s-compras-relatórios), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Gerenciamento](telas.md#s-financeiro-gerenciamento), [Financeiro › Relatórios](telas.md#s-financeiro-relatórios), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Vendas › Clientes](telas.md#s-vendas-clientes)
- **RPCs que leem:** [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_carimba_exclusao` — BEFORE UPDATE → [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [contas_pagar](tabelas.md#t-contas_pagar).fornecedor_id zera o vínculo (SET NULL); [cotacoes](tabelas.md#t-cotacoes).fornecedor_id zera o vínculo (SET NULL); [despesas_recorrentes](tabelas.md#t-despesas_recorrentes).fornecedor_id zera o vínculo (SET NULL); [fretes_compra](tabelas.md#t-fretes_compra).transportadora_id zera o vínculo (SET NULL); [notas_recebidas](tabelas.md#t-notas_recebidas).fornecedor_id zera o vínculo (SET NULL); [pedidos](tabelas.md#t-pedidos).fornecedor_id zera o vínculo (SET NULL); [produtos](tabelas.md#t-produtos).fornecedor_id zera o vínculo (SET NULL)
- **RLS:** ALL `write_fornecedores` (setores: compras, financeiro, logistica · gerente da filial · Matriz/professor); SELECT `read_fornecedores` (qualquer um da própria filial · Matriz/professor)

<a id="t-frequencia_trabalho"></a>
## frequencia_trabalho

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RPCs que leem:** [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Views que dependem desta:** [frequencia_trabalho_com_filial](tabelas.md#t-frequencia_trabalho_com_filial)
- **Gatilhos nesta tabela:**
  - `trg_frequencia_updated_at` — BEFORE UPDATE → [frequencia_set_updated_at](funcoes.md#f-frequencia_set_updated_at)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios)
- **RLS:** ALL `frequencia_write` (Matriz/professor); SELECT `frequencia_select` (Matriz/professor)

<a id="t-frequencia_trabalho_com_filial"></a>
## frequencia_trabalho_com_filial (view)

- **Telas que leem:** —

<a id="t-fretes_compra"></a>
## fretes_compra

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **RPCs que gravam:** [_cancelar_frete_compra](funcoes.md#f-_cancelar_frete_compra), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra)
- **Telas que leem:** —
- **RPCs que leem:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [cancelar_frete_compra](funcoes.md#f-cancelar_frete_compra), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete)
- **Gatilhos nesta tabela:**
  - `trg_fornecedor_nao_e_concessionaria` — BEFORE INSERT/UPDATE → [fn_fornecedor_nao_e_concessionaria](funcoes.md#f-fn_fornecedor_nao_e_concessionaria)
- **Ao apagar uma linha daqui:** [fretes_compra_rateio](tabelas.md#t-fretes_compra_rateio).frete_id APAGA JUNTO (CASCADE)
- **Aponta para:** conta_pagar_id → [contas_pagar](tabelas.md#t-contas_pagar); transportadora_id → [fornecedores](tabelas.md#t-fornecedores)
- **RLS:** SELECT `fretes_compra_select` (setores: estoque, financeiro, logistica · gerente da filial · Matriz/professor)

<a id="t-fretes_compra_rateio"></a>
## fretes_compra_rateio

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **RPCs que gravam:** [lancar_frete_compra](funcoes.md#f-lancar_frete_compra)
- **Telas que leem:** —
- **RPCs que leem:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [_cancelar_frete_compra](funcoes.md#f-_cancelar_frete_compra), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete)
- **Aponta para:** frete_id → [fretes_compra](tabelas.md#t-fretes_compra); pedido_id → [pedidos](tabelas.md#t-pedidos)
- **RLS:** SELECT `fretes_rateio_select` (setores: estoque, financeiro, logistica · gerente da filial · Matriz/professor)

<a id="t-funcionario_beneficios"></a>
## funcionario_beneficios

- **Telas que gravam:** [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários)
- **RPCs que gravam:** —
- **Telas que leem:** [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários)
- **RPCs que leem:** [beneficios_do_funcionario](funcoes.md#f-beneficios_do_funcionario)
- **Gatilhos nesta tabela:**
  - `trg_func_benef_set_filial` — BEFORE INSERT/UPDATE → [func_benef_set_filial](funcoes.md#f-func_benef_set_filial)
- **Aponta para:** beneficio_id → [beneficios](tabelas.md#t-beneficios); funcionario_id → [funcionarios](tabelas.md#t-funcionarios)
- **RLS:** ALL `func_benef_rh_write` (setores: rh · gerente da filial · Matriz/professor); SELECT `func_benef_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-funcionario_tarefas_suspensas"></a>
## funcionario_tarefas_suspensas

- **Telas que gravam:** —
- **RPCs que gravam:** [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas), [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas)
- **Telas que leem:** —
- **RPCs que leem:** [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas)

<a id="t-funcionarios"></a>
## funcionarios

- **Telas que gravam:** [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários), [Usuários](telas.md#s-usuarios)
- **Telas que gravam via RPC:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que gravam:** [decidir_desligamento](funcoes.md#f-decidir_desligamento), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario), [resetar_geral_admin](funcoes.md#f-resetar_geral_admin), [vincular_acesso_funcionario](funcoes.md#f-vincular_acesso_funcionario)
- **Gatilhos (de outras tabelas) que gravam aqui:** [user_profiles_propagar_filial](funcoes.md#f-user_profiles_propagar_filial) (em [user_profiles](tabelas.md#t-user_profiles))
- **Servidor (api/) grava:** `api/users.ts`
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Crachá Virtual](telas.md#s-cracha-virtual), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Meu Crachá](telas.md#s-meu-cracha), [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Férias](telas.md#s-rh-férias), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários), [Recursos Humanos › Gerenciamento](telas.md#s-rh-gerenciamento), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto), [Recursos Humanos › Relatórios](telas.md#s-rh-relatórios), [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos), [Usuários](telas.md#s-usuarios)
- **RPCs que leem:** [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [_funcionario_da_conta](funcoes.md#f-_funcionario_da_conta), [_funcionario_desligado](funcoes.md#f-_funcionario_desligado), [_sincronizar_funcionario_tarefas](funcoes.md#f-_sincronizar_funcionario_tarefas), [apurar_rateio_administrativo](funcoes.md#f-apurar_rateio_administrativo), [beneficios_do_funcionario](funcoes.md#f-beneficios_do_funcionario), [calcular_rescisao](funcoes.md#f-calcular_rescisao), [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [creditar_folha_maxbank](funcoes.md#f-creditar_folha_maxbank), [creditar_rescisao_maxbank](funcoes.md#f-creditar_rescisao_maxbank), [decidir_desligamento](funcoes.md#f-decidir_desligamento), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios), [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [funcionario_filial](funcoes.md#f-funcionario_filial), [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [media_avaliacao_funcionario](funcoes.md#f-media_avaliacao_funcionario), [minha_frequencia](funcoes.md#f-minha_frequencia), [minha_mesa](funcoes.md#f-minha_mesa), [nomear_mandato](funcoes.md#f-nomear_mandato), [processar_folha](funcoes.md#f-processar_folha), [processar_rescisao](funcoes.md#f-processar_rescisao), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [remover_ponto](funcoes.md#f-remover_ponto), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento), [vincular_acesso_funcionario](funcoes.md#f-vincular_acesso_funcionario)
- **Servidor (api/) lê:** `api/users.ts`
- **Views que dependem desta:** [frequencia_trabalho_com_filial](tabelas.md#t-frequencia_trabalho_com_filial)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_funcionario_sincroniza_tarefas` — AFTER UPDATE → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) · grava em [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [funcionario_tarefas_suspensas](tabelas.md#t-funcionario_tarefas_suspensas), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
  - `trg_funcionarios_autovincular` — BEFORE INSERT/UPDATE → [funcionarios_autovincular_user_profile](funcoes.md#f-funcionarios_autovincular_user_profile)
  - `trg_funcionarios_vinculo_admin` — BEFORE INSERT/UPDATE → [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz)
  - 1. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
  - 1. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [funcionario_tarefas_suspensas](tabelas.md#t-funcionario_tarefas_suspensas)
  - 1. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes)
  - 1. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes)
- **Ao apagar uma linha daqui:** [afastamentos](tabelas.md#t-afastamentos).funcionario_id APAGA JUNTO (CASCADE); [apuracao_bonus_itens](tabelas.md#t-apuracao_bonus_itens).funcionario_id zera o vínculo (SET NULL); [candidaturas](tabelas.md#t-candidaturas).funcionario_id zera o vínculo (SET NULL); [candidaturas](tabelas.md#t-candidaturas).funcionario_origem_id zera o vínculo (SET NULL); [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes).funcionario_id zera o vínculo (SET NULL); [demissoes](tabelas.md#t-demissoes).funcionario_id APAGA JUNTO (CASCADE); [ferias](tabelas.md#t-ferias).funcionario_id zera o vínculo (SET NULL); [folha_pagamento](tabelas.md#t-folha_pagamento).funcionario_id zera o vínculo (SET NULL); [frequencia_trabalho](tabelas.md#t-frequencia_trabalho).funcionario_id APAGA JUNTO (CASCADE); [funcionario_beneficios](tabelas.md#t-funcionario_beneficios).funcionario_id APAGA JUNTO (CASCADE); [mandatos](tabelas.md#t-mandatos).funcionario_id zera o vínculo (SET NULL); [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes).funcionario_id zera o vínculo (SET NULL); [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira).funcionario_id APAGA JUNTO (CASCADE); [ponto_eletronico](tabelas.md#t-ponto_eletronico).funcionario_id zera o vínculo (SET NULL); [rescisoes](tabelas.md#t-rescisoes).funcionario_id APAGA JUNTO (CASCADE); [treinamento_inscricoes](tabelas.md#t-treinamento_inscricoes).funcionario_id APAGA JUNTO (CASCADE); [user_profiles](tabelas.md#t-user_profiles).funcionario_id zera o vínculo (SET NULL); [vaga_convites](tabelas.md#t-vaga_convites).funcionario_id APAGA JUNTO (CASCADE)
- **Aponta para:** user_profile_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** ALL `rh_filial_all` (setores: rh · gerente da filial · Matriz/professor); SELECT `func_self` (o próprio usuário)

<a id="t-historico_operacoes"></a>
## historico_operacoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **RPCs que gravam:** [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [estornar_aporte_capital](funcoes.md#f-estornar_aporte_capital), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao)
- **Gatilhos (de outras tabelas) que gravam aqui:** [registrar_historico](funcoes.md#f-registrar_historico) (em [afastamentos](tabelas.md#t-afastamentos), [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [avaliacoes](tabelas.md#t-avaliacoes), [beneficios](tabelas.md#t-beneficios), [caixa_bancos](tabelas.md#t-caixa_bancos), [candidaturas](tabelas.md#t-candidaturas), [cargos](tabelas.md#t-cargos), [centros_custo](tabelas.md#t-centros_custo), [clientes](tabelas.md#t-clientes), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha), [condicoes_pagamento](tabelas.md#t-condicoes_pagamento), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [controle_caixa](tabelas.md#t-controle_caixa), [cotacoes](tabelas.md#t-cotacoes), [demissoes](tabelas.md#t-demissoes), [departamentos](tabelas.md#t-departamentos), [despesas_recorrentes](tabelas.md#t-despesas_recorrentes), [devolucoes](tabelas.md#t-devolucoes), [expedicao](tabelas.md#t-expedicao), [ferias](tabelas.md#t-ferias), [filiais](tabelas.md#t-filiais), [filial_investimentos](tabelas.md#t-filial_investimentos), [folha_pagamento](tabelas.md#t-folha_pagamento), [formas_pagamento](tabelas.md#t-formas_pagamento), [fornecedores](tabelas.md#t-fornecedores), [funcionarios](tabelas.md#t-funcionarios), [inventarios](tabelas.md#t-inventarios), [mandatos](tabelas.md#t-mandatos), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [notas_emitidas](tabelas.md#t-notas_emitidas), [notas_recebidas](tabelas.md#t-notas_recebidas), [orcamentos](tabelas.md#t-orcamentos), [pdi_itens](tabelas.md#t-pdi_itens), [pedidos](tabelas.md#t-pedidos), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos](tabelas.md#t-produtos), [projetos](tabelas.md#t-projetos), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [rescisoes](tabelas.md#t-rescisoes), [riscos](tabelas.md#t-riscos), [treinamentos](tabelas.md#t-treinamentos), [vagas](tabelas.md#t-vagas), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque), [vendas](tabelas.md#t-vendas))
- **Telas que leem:** [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Notas recebidas](telas.md#s-compras-notasrecebidas), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Empresa › Filiais](telas.md#s-empresa-filiais), [Empresa › Formas de pagamento](telas.md#s-empresa-formasdepagamento), [Empresa › Projetos](telas.md#s-empresa-projetos), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos), [Financeiro › Centros de Custo](telas.md#s-financeiro-centrosdecusto), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber), [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Recursos Humanos › Benefícios](telas.md#s-rh-benefícios), [Recursos Humanos › Cargos](telas.md#s-rh-cargos), [Recursos Humanos › Departamentos](telas.md#s-rh-departamentos), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários), [Vendas › Clientes](telas.md#s-vendas-clientes), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
- **RPCs que leem:** [abrir_revisao_auditoria](funcoes.md#f-abrir_revisao_auditoria), [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [encerrar_revisao_auditoria](funcoes.md#f-encerrar_revisao_auditoria)
- **Ao apagar uma linha daqui:** [auditoria_revisoes](tabelas.md#t-auditoria_revisoes).operacao_id APAGA JUNTO (CASCADE)
- **RLS:** SELECT `historico_select` (setores: ceo, conselheiro · Matriz/professor)

<a id="t-ia_uso_por_hora"></a>
## ia_uso_por_hora

- **Telas que gravam:** —
- **RPCs que gravam:** [contar_uso_ia](funcoes.md#f-contar_uso_ia)
- **Telas que leem:** —

<a id="t-integracoes_bancarias"></a>
## integracoes_bancarias

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RLS:** ALL `fin_all` (setores: financeiro · Matriz/professor)

<a id="t-inventarios"></a>
## inventarios

- **Telas que gravam:** [Estoque › Inventários](telas.md#s-estoque-inventários)
- **RPCs que gravam:** [fechar_inventario](funcoes.md#f-fechar_inventario)
- **Telas que leem:** [Estoque › Gerenciamento](telas.md#s-estoque-gerenciamento), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Relatórios](telas.md#s-estoque-relatórios)
- **RPCs que leem:** [fechar_inventario](funcoes.md#f-fechar_inventario)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** produto_id → [produtos](tabelas.md#t-produtos)
- **RLS:** ALL `logist_all` (setores: logistica · Matriz/professor)

<a id="t-itens_campanha"></a>
## itens_campanha

- **Telas que gravam:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções), [Marketing › Campanhas](telas.md#s-marketing-campanhas)
- **RPCs que gravam:** —
- **Telas que leem:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções), [Marketing › Campanhas](telas.md#s-marketing-campanhas)
- **Aponta para:** campanha_id → [marketing_campanhas](tabelas.md#t-marketing_campanhas); produto_id → [produtos](tabelas.md#t-produtos)
- **RLS:** DELETE `itens_campanha_delete` (setores: marketing · gerente da filial · Matriz/professor); INSERT `itens_campanha_insert` (setores: marketing · gerente da filial · Matriz/professor); SELECT `itens_campanha_select` (setores: financeiro, marketing · gerente da filial · Matriz/professor); UPDATE `itens_campanha_update` (setores: marketing · gerente da filial · Matriz/professor)

<a id="t-itens_devolucao"></a>
## itens_devolucao

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que gravam:** [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda)
- **Telas que leem:** —
- **RPCs que leem:** [_dre_calculo](funcoes.md#f-_dre_calculo), [_receita_servico](funcoes.md#f-_receita_servico), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda)
- **Views que dependem desta:** [v_venda_saldo_devolucao](tabelas.md#t-v_venda_saldo_devolucao)
- **Gatilhos nesta tabela:**
  - `trg_item_devolucao_devolve_unidade` — AFTER INSERT → [fn_item_devolucao_devolve_unidade](funcoes.md#f-fn_item_devolucao_devolve_unidade) · grava em [produto_unidades](tabelas.md#t-produto_unidades)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [itens_devolucao](tabelas.md#t-itens_devolucao) → [fn_item_devolucao_devolve_unidade](funcoes.md#f-fn_item_devolucao_devolve_unidade) → [produto_unidades](tabelas.md#t-produto_unidades)
- **Aponta para:** devolucao_id → [devolucoes](tabelas.md#t-devolucoes); produto_id → [produtos](tabelas.md#t-produtos); servico_id → [servicos](tabelas.md#t-servicos)
- **RLS:** ALL `itens_devolucao_write` (gerente da filial · Matriz/professor); SELECT `itens_devolucao_select` (Matriz/professor)

<a id="t-itens_venda"></a>
## itens_venda

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Usuários](telas.md#s-usuarios), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que gravam:** [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Telas que leem:** [Financeiro › Recibos de Vendas](telas.md#s-financeiro-recibosdevendas), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que leem:** [_dre_calculo](funcoes.md#f-_dre_calculo), [_receita_servico](funcoes.md#f-_receita_servico), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi)
- **Views que dependem desta:** [v_venda_saldo_devolucao](tabelas.md#t-v_venda_saldo_devolucao)
- **Gatilhos nesta tabela:**
  - `trg_item_venda_aloca_unidade` — AFTER INSERT → [fn_item_venda_aloca_unidade](funcoes.md#f-fn_item_venda_aloca_unidade) · grava em [produto_unidades](tabelas.md#t-produto_unidades)
  - `trg_item_venda_so_mercadoria` — BEFORE INSERT/UPDATE → [fn_item_venda_so_mercadoria](funcoes.md#f-fn_item_venda_so_mercadoria)
  - `trg_itens_venda_carimba_custo` — BEFORE INSERT → [fn_itens_venda_carimba_custo](funcoes.md#f-fn_itens_venda_carimba_custo)
  - `trg_valida_filial_item_venda` — BEFORE INSERT/UPDATE → [fn_valida_filial_item_venda](funcoes.md#f-fn_valida_filial_item_venda)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [itens_venda](tabelas.md#t-itens_venda) → [fn_item_venda_aloca_unidade](funcoes.md#f-fn_item_venda_aloca_unidade) → [produto_unidades](tabelas.md#t-produto_unidades)
- **Ao apagar uma linha daqui:** [produto_unidades](tabelas.md#t-produto_unidades).item_venda_id zera o vínculo (SET NULL)
- **Aponta para:** produto_id → [produtos](tabelas.md#t-produtos); servico_id → [servicos](tabelas.md#t-servicos); venda_id → [vendas](tabelas.md#t-vendas)
- **RLS:** ALL `itens_write` (setores: vendas · gerente da filial · Matriz/professor); SELECT `itens_select` (setores: financeiro, vendas · gerente da filial · Matriz/professor)

<a id="t-justificativas_falta"></a>
## justificativas_falta

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Meu Crachá](telas.md#s-meu-cracha), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que gravam:** [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [parecer_justificativa_falta](funcoes.md#f-parecer_justificativa_falta)
- **Telas que leem:** [Meu Crachá](telas.md#s-meu-cracha), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que leem:** [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [minha_frequencia](funcoes.md#f-minha_frequencia), [minha_mesa](funcoes.md#f-minha_mesa), [parecer_justificativa_falta](funcoes.md#f-parecer_justificativa_falta), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Aponta para:** ponto_id → [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **RLS:** DELETE `justfalta_delete` (regra própria); SELECT `justfalta_select` (Matriz/professor)

<a id="t-loja_config"></a>
## loja_config

- **Telas que gravam:** [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que gravam:** —
- **Telas que leem:** [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Servidor (api/) lê:** `api/loja.ts`
- **RLS:** SELECT `loja_config_read` (qualquer um da própria filial · Matriz/professor); UPDATE `loja_config_write` (gerente da filial · Matriz/professor)

<a id="t-loja_palavras_bloqueadas"></a>
## loja_palavras_bloqueadas

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RLS:** ALL `palavras_bloqueadas_write` (setores: admin, ceo); SELECT `palavras_bloqueadas_select` (setores: marketing, vendas)

<a id="t-mandatos"></a>
## mandatos

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos)
- **RPCs que gravam:** [encerrar_mandato](funcoes.md#f-encerrar_mandato), [nomear_mandato](funcoes.md#f-nomear_mandato)
- **Telas que leem:** [Início](telas.md#s-inicio), [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos)
- **RPCs que leem:** [encerrar_mandato](funcoes.md#f-encerrar_mandato), [nomear_mandato](funcoes.md#f-nomear_mandato)
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [mandatos](tabelas.md#t-mandatos).origem_mandato_id zera o vínculo (SET NULL)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios); origem_mandato_id → [mandatos](tabelas.md#t-mandatos); user_profile_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `mandato_read` (todos)

<a id="t-mapeamentos_rateio"></a>
## mapeamentos_rateio

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
- **RLS:** SELECT `mapeamentos_rateio_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-marketing_arte_feedback"></a>
## marketing_arte_feedback

- **Telas que gravam:** —
- **RPCs que gravam:** [dar_feedback_arte](funcoes.md#f-dar_feedback_arte)
- **Telas que leem:** —
- **Gatilhos nesta tabela:**
  - `marketing_arte_feedback_updated_at` — BEFORE UPDATE → [trg_marketing_arte_feedback_updated_at](funcoes.md#f-trg_marketing_arte_feedback_updated_at)
- **Aponta para:** arte_id → [marketing_artes](tabelas.md#t-marketing_artes)
- **RLS:** DELETE `feedback_delete` (Matriz/professor); INSERT `feedback_insert` (setores: admin, ceo, gerente · gerente da filial); SELECT `feedback_read` (setores: financeiro, marketing · gerente da filial · Matriz/professor); UPDATE `feedback_update` (Matriz/professor)

<a id="t-marketing_artes"></a>
## marketing_artes

- **Telas que gravam:** [Marketing › Promoções](telas.md#s-marketing-promoções)
- **Telas que gravam via RPC:** [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
- **RPCs que gravam:** [marcar_vitrine](funcoes.md#f-marcar_vitrine)
- **Gatilhos (de outras tabelas) que gravam aqui:** [trg_marketing_promocoes_soft_delete_arte](funcoes.md#f-trg_marketing_promocoes_soft_delete_arte) (em [marketing_promocoes](tabelas.md#t-marketing_promocoes))
- **Telas que leem:** [Artes promocionais *(rota artes-promocionais)*](telas.md#s-artes-promocionais), [Marketing › Configurações *(rota marketing-configurações)*](telas.md#s-marketing-configurações), [Marketing › Promoções](telas.md#s-marketing-promoções)
- **RPCs que leem:** [get_vitrine_publica](funcoes.md#f-get_vitrine_publica), [listar_vitrine_candidatos](funcoes.md#f-listar_vitrine_candidatos), [marcar_vitrine](funcoes.md#f-marcar_vitrine), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Gatilhos nesta tabela:**
  - `marketing_artes_updated_at` — BEFORE UPDATE → [trg_marketing_artes_updated_at](funcoes.md#f-trg_marketing_artes_updated_at)
  - `trg_arte_produto_e_cota` — BEFORE INSERT/UPDATE → [fn_arte_produto_e_cota](funcoes.md#f-fn_arte_produto_e_cota)
- **Ao apagar uma linha daqui:** [marketing_arte_feedback](tabelas.md#t-marketing_arte_feedback).arte_id APAGA JUNTO (CASCADE)
- **Aponta para:** promocao_id → [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **RLS:** DELETE `artes_delete` (setores: marketing · gerente da filial · Matriz/professor); INSERT `artes_insert` (setores: marketing · gerente da filial · Matriz/professor); SELECT `artes_read` (setores: financeiro, marketing · gerente da filial · Matriz/professor); UPDATE `artes_update` (setores: marketing · gerente da filial · Matriz/professor)

<a id="t-marketing_calendario"></a>
## marketing_calendario

- **Telas que gravam:** [Marketing › Calendário](telas.md#s-marketing-calendário)
- **RPCs que gravam:** —
- **Telas que leem:** [Marketing › Calendário](telas.md#s-marketing-calendário)
- **Gatilhos nesta tabela:**
  - `marketing_calendario_updated_at` — BEFORE UPDATE → [trg_marketing_calendario_updated_at](funcoes.md#f-trg_marketing_calendario_updated_at)
- **Aponta para:** promocao_id → [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **RLS:** DELETE `calendario_delete` (setores: marketing · gerente da filial · Matriz/professor); INSERT `calendario_insert` (setores: marketing · gerente da filial · Matriz/professor); SELECT `calendario_read` (setores: financeiro, marketing · gerente da filial · Matriz/professor); UPDATE `calendario_update` (setores: marketing · gerente da filial · Matriz/professor)

<a id="t-marketing_campanhas"></a>
## marketing_campanhas

- **Telas que gravam:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções), [Marketing › Campanhas](telas.md#s-marketing-campanhas)
- **RPCs que gravam:** —
- **Telas que leem:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções), [Marketing › Campanhas](telas.md#s-marketing-campanhas), [Marketing › Cupons](telas.md#s-marketing-cupons), [Marketing › Promoções](telas.md#s-marketing-promoções)
- **RPCs que leem:** [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Views que dependem desta:** [v_campanha_roi](tabelas.md#t-v_campanha_roi)
- **Gatilhos nesta tabela:**
  - `marketing_campanhas_updated_at` — BEFORE UPDATE → [trg_marketing_campanhas_updated_at](funcoes.md#f-trg_marketing_campanhas_updated_at)
- **Ao apagar uma linha daqui:** [itens_campanha](tabelas.md#t-itens_campanha).campanha_id APAGA JUNTO (CASCADE); [marketing_cupons](tabelas.md#t-marketing_cupons).campanha_id zera o vínculo (SET NULL); [marketing_promocoes](tabelas.md#t-marketing_promocoes).campanha_id zera o vínculo (SET NULL)
- **RLS:** DELETE `campanhas_delete` (setores: marketing · gerente da filial · Matriz/professor); INSERT `campanhas_insert` (setores: marketing · gerente da filial · Matriz/professor); SELECT `campanhas_read` (setores: financeiro, marketing · gerente da filial · Matriz/professor); UPDATE `campanhas_update` (setores: financeiro, marketing · gerente da filial · Matriz/professor)

<a id="t-marketing_config"></a>
## marketing_config

- **Telas que gravam:** [Marketing › Configurações *(rota marketing-configurações)*](telas.md#s-marketing-configurações)
- **RPCs que gravam:** —
- **Telas que leem:** [Marketing › Configurações *(rota marketing-configurações)*](telas.md#s-marketing-configurações), [Marketing › Promoções](telas.md#s-marketing-promoções), [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
- **RPCs que leem:** [get_vitrine_publica](funcoes.md#f-get_vitrine_publica), [marcar_vitrine](funcoes.md#f-marcar_vitrine)
- **RLS:** SELECT `marketing_config_read` (todos); UPDATE `marketing_config_write` (Matriz/professor)

<a id="t-marketing_cupons"></a>
## marketing_cupons

- **Telas que gravam:** [Marketing › Cupons](telas.md#s-marketing-cupons)
- **Telas que gravam via RPC:** [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que gravam:** [criar_venda_pdv](funcoes.md#f-criar_venda_pdv)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz) (em [vendas](tabelas.md#t-vendas))
- **Telas que leem:** [Marketing › Cupons](telas.md#s-marketing-cupons)
- **RPCs que leem:** [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [validar_cupom](funcoes.md#f-validar_cupom)
- **Servidor (api/) lê:** `api/loja.ts`
- **Views que dependem desta:** [v_campanha_roi](tabelas.md#t-v_campanha_roi)
- **Gatilhos nesta tabela:**
  - `marketing_cupons_updated_at` — BEFORE UPDATE → [trg_marketing_cupons_updated_at](funcoes.md#f-trg_marketing_cupons_updated_at)
- **Ao apagar uma linha daqui:** [vendas](tabelas.md#t-vendas).cupom_id zera o vínculo (SET NULL)
- **Aponta para:** campanha_id → [marketing_campanhas](tabelas.md#t-marketing_campanhas)
- **RLS:** DELETE `cupons_delete` (setores: marketing · gerente da filial · Matriz/professor); INSERT `cupons_insert` (setores: marketing · gerente da filial · Matriz/professor); SELECT `cupons_read` (setores: financeiro, marketing · gerente da filial · Matriz/professor); UPDATE `cupons_update` (setores: marketing · gerente da filial · Matriz/professor)

<a id="t-marketing_promocoes"></a>
## marketing_promocoes

- **Telas que gravam:** [Marketing › Promoções](telas.md#s-marketing-promoções)
- **Telas que gravam via RPC:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções)
- **RPCs que gravam:** [analisar_promocao_financeiro](funcoes.md#f-analisar_promocao_financeiro), [aprovar_promocao](funcoes.md#f-aprovar_promocao), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [reprovar_promocao](funcoes.md#f-reprovar_promocao), [reverter_promocoes_expiradas](funcoes.md#f-reverter_promocoes_expiradas)
- **Telas que leem:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções), [Marketing › Calendário](telas.md#s-marketing-calendário), [Marketing › Promoções](telas.md#s-marketing-promoções)
- **RPCs que leem:** [analisar_promocao_financeiro](funcoes.md#f-analisar_promocao_financeiro), [aprovar_promocao](funcoes.md#f-aprovar_promocao), [contar_pendencias](funcoes.md#f-contar_pendencias), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [get_vitrine_publica](funcoes.md#f-get_vitrine_publica), [listar_pendencias](funcoes.md#f-listar_pendencias), [listar_vitrine_candidatos](funcoes.md#f-listar_vitrine_candidatos), [marcar_vitrine](funcoes.md#f-marcar_vitrine), [minha_mesa](funcoes.md#f-minha_mesa), [promocao_vigente_do_produto](funcoes.md#f-promocao_vigente_do_produto), [reprovar_promocao](funcoes.md#f-reprovar_promocao)
- **Views que dependem desta:** [v_promocao_vigente](tabelas.md#t-v_promocao_vigente)
- **Gatilhos nesta tabela:**
  - `marketing_promocoes_soft_delete_arte` — AFTER UPDATE → [trg_marketing_promocoes_soft_delete_arte](funcoes.md#f-trg_marketing_promocoes_soft_delete_arte) · grava em [marketing_artes](tabelas.md#t-marketing_artes)
  - `trg_promocao_decisao_guard` — BEFORE UPDATE → [promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [marketing_promocoes](tabelas.md#t-marketing_promocoes) → [trg_marketing_promocoes_soft_delete_arte](funcoes.md#f-trg_marketing_promocoes_soft_delete_arte) → [marketing_artes](tabelas.md#t-marketing_artes)
- **Ao apagar uma linha daqui:** [marketing_artes](tabelas.md#t-marketing_artes).promocao_id APAGA JUNTO (CASCADE); [marketing_calendario](tabelas.md#t-marketing_calendario).promocao_id zera o vínculo (SET NULL)
- **Aponta para:** campanha_id → [marketing_campanhas](tabelas.md#t-marketing_campanhas); produto_id → [produtos](tabelas.md#t-produtos)
- **RLS:** DELETE `mkt_delete` (setores: marketing · gerente da filial · Matriz/professor); INSERT `mkt_insert` (setores: marketing · gerente da filial · Matriz/professor); SELECT `mkt_select` (setores: financeiro, marketing · gerente da filial · Matriz/professor); UPDATE `mkt_update` (setores: financeiro, marketing · gerente da filial · Matriz/professor)

<a id="t-marketing_tarefas"></a>
## marketing_tarefas

- **Telas que gravam:** [Matriz › Briefing Diário](telas.md#s-briefing-diario), [Financeiro › Aprovações de Conteúdo](telas.md#s-financeiro-aprovaçõesdeconteúdo)
- **RPCs que gravam:** [descartar_tarefa_briefing](funcoes.md#f-descartar_tarefa_briefing), [editar_tarefa_briefing](funcoes.md#f-editar_tarefa_briefing), [excluir_briefing_cascade](funcoes.md#f-excluir_briefing_cascade)
- **Telas que leem:** [Financeiro › Aprovações de Conteúdo](telas.md#s-financeiro-aprovaçõesdeconteúdo)
- **RPCs que leem:** [contar_pendencias](funcoes.md#f-contar_pendencias), [listar_pendencias](funcoes.md#f-listar_pendencias)
- **Aponta para:** briefing_id → [briefings_diarios](tabelas.md#t-briefings_diarios)
- **RLS:** DELETE `mkt_delete` (setores: marketing · gerente da filial · Matriz/professor); INSERT `mkt_insert` (setores: marketing · gerente da filial · Matriz/professor); SELECT `mkt_select` (setores: financeiro, marketing · gerente da filial · Matriz/professor); UPDATE `mkt_update` (setores: financeiro, marketing · gerente da filial · Matriz/professor)

<a id="t-matriz_tarefa_participantes"></a>
## matriz_tarefa_participantes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas), [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas), [adicionar_matriz_participante](funcoes.md#f-adicionar_matriz_participante), [criar_matriz_tarefa](funcoes.md#f-criar_matriz_tarefa), [remover_matriz_participante](funcoes.md#f-remover_matriz_participante), [remover_matriz_tarefa](funcoes.md#f-remover_matriz_tarefa)
- **Telas que leem:** [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Início](telas.md#s-inicio), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Metas *(rota metas)*](telas.md#s-metas)
- **RPCs que leem:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [_devolver_funcionario_as_tarefas](funcoes.md#f-_devolver_funcionario_as_tarefas), [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas), [avaliar_item_matriz](funcoes.md#f-avaliar_item_matriz), [encerrar_matriz_tarefa](funcoes.md#f-encerrar_matriz_tarefa), [lembrar_avaliacoes_pendentes](funcoes.md#f-lembrar_avaliacoes_pendentes), [liberar_matriz_tarefa](funcoes.md#f-liberar_matriz_tarefa), [media_participantes_competicao](funcoes.md#f-media_participantes_competicao), [minha_mesa](funcoes.md#f-minha_mesa), [participantes_sem_nota_competicao](funcoes.md#f-participantes_sem_nota_competicao), [progresso_avaliacao_matriz](funcoes.md#f-progresso_avaliacao_matriz), [remover_avaliacao_matriz](funcoes.md#f-remover_avaliacao_matriz), [remover_matriz_participante](funcoes.md#f-remover_matriz_participante), [remover_matriz_tarefa](funcoes.md#f-remover_matriz_tarefa)
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios); tarefa_id → [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **RLS:** DELETE `mt_part_del` (ninguém (só via RPC)); INSERT `mt_part_ins` (ninguém (só via RPC)); SELECT `mt_part_select` (todos); UPDATE `mt_part_upd` (ninguém (só via RPC))

<a id="t-matriz_tarefas"></a>
## matriz_tarefas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** [atualizar_matriz_tarefa](funcoes.md#f-atualizar_matriz_tarefa), [criar_matriz_tarefa](funcoes.md#f-criar_matriz_tarefa), [encerrar_matriz_tarefa](funcoes.md#f-encerrar_matriz_tarefa), [excluir_competicao_matriz](funcoes.md#f-excluir_competicao_matriz), [liberar_matriz_tarefa](funcoes.md#f-liberar_matriz_tarefa), [reabrir_matriz_tarefa](funcoes.md#f-reabrir_matriz_tarefa), [remover_matriz_tarefa](funcoes.md#f-remover_matriz_tarefa)
- **Telas que leem:** [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Início](telas.md#s-inicio), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Metas *(rota metas)*](telas.md#s-metas)
- **RPCs que leem:** [_assert_matriz_tarefa_gestor](funcoes.md#f-_assert_matriz_tarefa_gestor), [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas), [adicionar_matriz_participante](funcoes.md#f-adicionar_matriz_participante), [atualizar_matriz_tarefa](funcoes.md#f-atualizar_matriz_tarefa), [avaliar_item_matriz](funcoes.md#f-avaliar_item_matriz), [encerrar_matriz_tarefa](funcoes.md#f-encerrar_matriz_tarefa), [lembrar_avaliacoes_pendentes](funcoes.md#f-lembrar_avaliacoes_pendentes), [liberar_matriz_tarefa](funcoes.md#f-liberar_matriz_tarefa), [media_participantes_competicao](funcoes.md#f-media_participantes_competicao), [minha_mesa](funcoes.md#f-minha_mesa), [participantes_sem_nota_competicao](funcoes.md#f-participantes_sem_nota_competicao), [reabrir_matriz_tarefa](funcoes.md#f-reabrir_matriz_tarefa), [remover_avaliacao_matriz](funcoes.md#f-remover_avaliacao_matriz), [remover_matriz_participante](funcoes.md#f-remover_matriz_participante), [remover_matriz_tarefa](funcoes.md#f-remover_matriz_tarefa), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Servidor (api/) lê:** `api/ai-briefing-tarefa.ts`
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_matriz_tarefas_upd` — BEFORE UPDATE → [trg_matriz_tarefas_updated_at](funcoes.md#f-trg_matriz_tarefas_updated_at)
- **Ao apagar uma linha daqui:** [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes).tarefa_id APAGA JUNTO (CASCADE)
- **Aponta para:** competicao_id → [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **RLS:** DELETE `mt_tarefas_del` (ninguém (só via RPC)); INSERT `mt_tarefas_ins` (ninguém (só via RPC)); SELECT `mt_tarefas_select` (todos); UPDATE `mt_tarefas_upd` (ninguém (só via RPC))

<a id="t-max_docs"></a>
## max_docs

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Gatilhos nesta tabela:**
  - `max_docs_touch` — BEFORE UPDATE → [max_work_touch_updated_at](funcoes.md#f-max_work_touch_updated_at)
- **RLS:** DELETE `max_docs_delete` (o próprio usuário); INSERT `max_docs_insert` (o próprio usuário); SELECT `max_docs_select` (o próprio usuário); UPDATE `max_docs_update` (o próprio usuário)

<a id="t-max_planilhas"></a>
## max_planilhas

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Gatilhos nesta tabela:**
  - `max_planilhas_touch` — BEFORE UPDATE → [max_work_touch_updated_at](funcoes.md#f-max_work_touch_updated_at)
- **RLS:** DELETE `max_planilhas_delete` (o próprio usuário); INSERT `max_planilhas_insert` (o próprio usuário); SELECT `max_planilhas_select` (o próprio usuário); UPDATE `max_planilhas_update` (o próprio usuário)

<a id="t-max_shows"></a>
## max_shows

- **Telas que gravam:** [Atividade da aula](telas.md#s-aula-atividade), [Modo Aula](telas.md#s-aula-modo), [Central de Avaliação](telas.md#s-avaliacoes), [Contratos](telas.md#s-contratos), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Conteúdo](telas.md#s-matriz-conteudo), [Max Show](telas.md#s-max-show), [Max work show *(rota max-work-show)*](telas.md#s-max-work-show), [Mesa gestor *(rota mesa-gestor)*](telas.md#s-mesa-gestor), [Metas *(rota metas)*](telas.md#s-metas), [Matriz › Painel de BI](telas.md#s-painel-bi), [Pendências](telas.md#s-pendencias), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que gravam:** —
- **Telas que leem:** [Max Show](telas.md#s-max-show), [Max work show *(rota max-work-show)*](telas.md#s-max-work-show)
- **Gatilhos nesta tabela:**
  - `max_shows_touch` — BEFORE UPDATE → [max_work_touch_updated_at](funcoes.md#f-max_work_touch_updated_at)
- **RLS:** DELETE `max_shows_delete` (o próprio usuário); INSERT `max_shows_insert` (o próprio usuário); SELECT `max_shows_select` (gerente da filial); UPDATE `max_shows_update` (o próprio usuário)

<a id="t-maxbank_config"></a>
## maxbank_config

- **Telas que gravam:** —
- **RPCs que gravam:** [set_maxbank_threshold](funcoes.md#f-set_maxbank_threshold)
- **Telas que leem:** —
- **RPCs que leem:** [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado)
- **Aponta para:** updated_by → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `maxbank_config_read` (todos)

<a id="t-maxbank_contas"></a>
## maxbank_contas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **RPCs que gravam:** [aprovar_meta_maxbank](funcoes.md#f-aprovar_meta_maxbank), [aprovar_tarefa_tatica](funcoes.md#f-aprovar_tarefa_tatica), [autorizar_cartao_maxbank](funcoes.md#f-autorizar_cartao_maxbank), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [creditar_folha_maxbank](funcoes.md#f-creditar_folha_maxbank), [creditar_rescisao_maxbank](funcoes.md#f-creditar_rescisao_maxbank), [debitar_maxbank_beneficios](funcoes.md#f-debitar_maxbank_beneficios), [debitar_maxbank_salario](funcoes.md#f-debitar_maxbank_salario), [excluir_transacao_maxbank](funcoes.md#f-excluir_transacao_maxbank), [recompute_saldos_maxbank](funcoes.md#f-recompute_saldos_maxbank), [transferir_pix_maxbank](funcoes.md#f-transferir_pix_maxbank)
- **Gatilhos (de outras tabelas) que gravam aqui:** [criar_maxbank_conta_para_colaborador](funcoes.md#f-criar_maxbank_conta_para_colaborador) (em [user_profiles](tabelas.md#t-user_profiles))
- **Telas que leem:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **RPCs que leem:** [aprovar_meta_maxbank](funcoes.md#f-aprovar_meta_maxbank), [aprovar_tarefa_tatica](funcoes.md#f-aprovar_tarefa_tatica), [autorizar_cartao_maxbank](funcoes.md#f-autorizar_cartao_maxbank), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [creditar_folha_maxbank](funcoes.md#f-creditar_folha_maxbank), [creditar_rescisao_maxbank](funcoes.md#f-creditar_rescisao_maxbank), [debitar_maxbank_beneficios](funcoes.md#f-debitar_maxbank_beneficios), [debitar_maxbank_salario](funcoes.md#f-debitar_maxbank_salario), [excluir_transacao_maxbank](funcoes.md#f-excluir_transacao_maxbank), [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado), [recompute_saldos_maxbank](funcoes.md#f-recompute_saldos_maxbank), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais), [transferir_pix_maxbank](funcoes.md#f-transferir_pix_maxbank)
- **Gatilhos nesta tabela:**
  - `trg_maxbank_contas_updated_at` — BEFORE UPDATE → [maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)
- **Ao apagar uma linha daqui:** [maxbank_transacoes](tabelas.md#t-maxbank_transacoes).conta_id APAGA JUNTO (CASCADE)
- **Aponta para:** colaborador_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `maxbank_contas_read` (setores: financeiro, rh · Matriz/professor)

<a id="t-maxbank_folgas_conquistadas"></a>
## maxbank_folgas_conquistadas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **RPCs que gravam:** [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado)
- **Telas que leem:** —
- **RPCs que leem:** [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado)
- **Aponta para:** ferias_id → [ferias](tabelas.md#t-ferias); meta_gatilho_id → [maxbank_metas](tabelas.md#t-maxbank_metas); colaborador_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `maxbank_folgas_read` (setores: rh · Matriz/professor)

<a id="t-maxbank_metas"></a>
## maxbank_metas

- **Telas que gravam:** —
- **RPCs que gravam:** [aprovar_meta_maxbank](funcoes.md#f-aprovar_meta_maxbank), [concluir_meta_maxbank](funcoes.md#f-concluir_meta_maxbank), [criar_meta_maxbank](funcoes.md#f-criar_meta_maxbank), [rejeitar_meta_maxbank](funcoes.md#f-rejeitar_meta_maxbank)
- **Telas que leem:** —
- **RPCs que leem:** [aprovar_meta_maxbank](funcoes.md#f-aprovar_meta_maxbank), [concluir_meta_maxbank](funcoes.md#f-concluir_meta_maxbank), [rejeitar_meta_maxbank](funcoes.md#f-rejeitar_meta_maxbank)
- **Gatilhos nesta tabela:**
  - `trg_maxbank_metas_updated_at` — BEFORE UPDATE → [maxbank_metas_set_updated_at](funcoes.md#f-maxbank_metas_set_updated_at)
- **Ao apagar uma linha daqui:** [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas).meta_gatilho_id zera o vínculo (SET NULL)
- **Aponta para:** colaborador_id → [user_profiles](tabelas.md#t-user_profiles); criada_por → [user_profiles](tabelas.md#t-user_profiles); aprovada_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `maxbank_metas_read` (setores: admin, ceo, gerente, rh · gerente da filial · Matriz/professor)

<a id="t-maxbank_transacoes"></a>
## maxbank_transacoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **RPCs que gravam:** [aprovar_meta_maxbank](funcoes.md#f-aprovar_meta_maxbank), [aprovar_tarefa_tatica](funcoes.md#f-aprovar_tarefa_tatica), [autorizar_cartao_maxbank](funcoes.md#f-autorizar_cartao_maxbank), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [creditar_folha_maxbank](funcoes.md#f-creditar_folha_maxbank), [creditar_rescisao_maxbank](funcoes.md#f-creditar_rescisao_maxbank), [debitar_maxbank_beneficios](funcoes.md#f-debitar_maxbank_beneficios), [debitar_maxbank_salario](funcoes.md#f-debitar_maxbank_salario), [excluir_transacao_maxbank](funcoes.md#f-excluir_transacao_maxbank), [transferir_pix_maxbank](funcoes.md#f-transferir_pix_maxbank)
- **Telas que leem:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **RPCs que leem:** [debitar_maxbank_salario](funcoes.md#f-debitar_maxbank_salario), [excluir_transacao_maxbank](funcoes.md#f-excluir_transacao_maxbank), [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado), [recompute_saldos_maxbank](funcoes.md#f-recompute_saldos_maxbank), [reverter_folha_maxbank](funcoes.md#f-reverter_folha_maxbank)
- **Gatilhos nesta tabela:**
  - `trg_maxbank_tx_protege_abertura` — BEFORE DELETE → [maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura)
- **Aponta para:** conta_id → [maxbank_contas](tabelas.md#t-maxbank_contas)
- **RLS:** SELECT `maxbank_transacoes_read` (setores: financeiro, rh · Matriz/professor)

<a id="t-maxbank_transferencias"></a>
## maxbank_transferencias

- **Telas que gravam:** —
- **RPCs que gravam:** [transferir_pix_maxbank](funcoes.md#f-transferir_pix_maxbank)
- **Telas que leem:** —
- **RPCs que leem:** [transferir_pix_maxbank](funcoes.md#f-transferir_pix_maxbank)
- **Aponta para:** de_colaborador_id → [user_profiles](tabelas.md#t-user_profiles); para_colaborador_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `maxbank_transferencias_read` (setores: financeiro, rh · Matriz/professor)

<a id="t-mesa_anotacoes"></a>
## mesa_anotacoes

- **Telas que gravam:** [Mesa gestor *(rota mesa-gestor)*](telas.md#s-mesa-gestor)
- **RPCs que gravam:** —
- **Telas que leem:** [Mesa gestor *(rota mesa-gestor)*](telas.md#s-mesa-gestor)
- **Gatilhos nesta tabela:**
  - `trg_mesa_anotacoes_carimbo` — BEFORE INSERT/UPDATE → [fn_mesa_anotacoes_carimbo](funcoes.md#f-fn_mesa_anotacoes_carimbo)
- **RLS:** ALL `mesa_anotacoes_dono` (setores: admin, ceo, conselheiro, gerente · gerente da filial)

<a id="t-metas_estrategicas"></a>
## metas_estrategicas

- **Telas que gravam:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **RPCs que gravam:** [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [criar_meta_estrategica](funcoes.md#f-criar_meta_estrategica), [editar_meta_estrategica](funcoes.md#f-editar_meta_estrategica), [encerrar_meta_estrategica](funcoes.md#f-encerrar_meta_estrategica), [pausar_meta_estrategica](funcoes.md#f-pausar_meta_estrategica), [publicar_meta_estrategica](funcoes.md#f-publicar_meta_estrategica), [reabrir_meta_estrategica](funcoes.md#f-reabrir_meta_estrategica)
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **RPCs que leem:** [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [contar_pendencias](funcoes.md#f-contar_pendencias), [criar_tarefa_tatica](funcoes.md#f-criar_tarefa_tatica), [editar_meta_estrategica](funcoes.md#f-editar_meta_estrategica), [encerrar_meta_estrategica](funcoes.md#f-encerrar_meta_estrategica), [pausar_meta_estrategica](funcoes.md#f-pausar_meta_estrategica), [publicar_meta_estrategica](funcoes.md#f-publicar_meta_estrategica), [reabrir_meta_estrategica](funcoes.md#f-reabrir_meta_estrategica), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Gatilhos nesta tabela:**
  - `trg_metas_estrategicas_updated_at` — BEFORE UPDATE → [metas_estrategicas_set_updated_at](funcoes.md#f-metas_estrategicas_set_updated_at)
- **Ao apagar uma linha daqui:** [tarefas_taticas](tabelas.md#t-tarefas_taticas).meta_estrategica_id APAGA JUNTO (CASCADE)
- **Aponta para:** criada_por → [user_profiles](tabelas.md#t-user_profiles); concluida_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `metas_estrategicas_read` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-metricas_redes_sociais"></a>
## metricas_redes_sociais

- **Telas que gravam:** [Marketing › Redes Sociais](telas.md#s-marketing-redessociais)
- **RPCs que gravam:** —
- **Telas que leem:** [Marketing › Redes Sociais](telas.md#s-marketing-redessociais)
- **RLS:** DELETE `metricas_rs_delete` (setores: admin, ceo); INSERT `metricas_rs_insert` (setores: admin, ceo); SELECT `metricas_rs_select` (regra própria); UPDATE `metricas_rs_update` (setores: admin, ceo)

<a id="t-modo_visitante_config"></a>
## modo_visitante_config

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RLS:** SELECT `modo_visitante_anon_select` (todos); SELECT `modo_visitante_auth_select` (todos); UPDATE `modo_visitante_auth_admin_write` (setores: admin, ceo)

<a id="t-movimentacoes_caixa"></a>
## movimentacoes_caixa

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que gravam:** [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [registrar_movimentacao_caixa](funcoes.md#f-registrar_movimentacao_caixa)
- **Telas que leem:** [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa)
- **RPCs que leem:** [confirmar_fechamento_caixa](funcoes.md#f-confirmar_fechamento_caixa), [fechar_caixa_conferido](funcoes.md#f-fechar_caixa_conferido), [previa_fechamento_caixa](funcoes.md#f-previa_fechamento_caixa), [registrar_movimentacao_caixa](funcoes.md#f-registrar_movimentacao_caixa), [solicitar_fechamento_caixa](funcoes.md#f-solicitar_fechamento_caixa)
- **Gatilhos nesta tabela:**
  - `trg_movimentacao_caixa_guard` — BEFORE INSERT/UPDATE → [movimentacao_caixa_guard](funcoes.md#f-movimentacao_caixa_guard)
- **Aponta para:** controle_caixa_id → [controle_caixa](tabelas.md#t-controle_caixa)
- **RLS:** ALL `mov_caixa_all` (setores: financeiro, vendas · gerente da filial · Matriz/professor)

<a id="t-movimentacoes_carreira"></a>
## movimentacoes_carreira

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que gravam:** [efetivar_promocao](funcoes.md#f-efetivar_promocao), [encerrar_mandato](funcoes.md#f-encerrar_mandato), [marcar_acesso_ajustado](funcoes.md#f-marcar_acesso_ajustado), [nomear_mandato](funcoes.md#f-nomear_mandato)
- **Telas que leem:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que leem:** [marcar_acesso_ajustado](funcoes.md#f-marcar_acesso_ajustado), [minha_mesa](funcoes.md#f-minha_mesa)
- **Servidor (api/) lê:** `api/users.ts`
- **Gatilhos nesta tabela:**
  - `trg_filial_movimentacao_carreira` — BEFORE INSERT/UPDATE → [set_filial_movimentacao_carreira](funcoes.md#f-set_filial_movimentacao_carreira)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** candidatura_id → [candidaturas](tabelas.md#t-candidaturas); funcionario_id → [funcionarios](tabelas.md#t-funcionarios); vaga_id → [vagas](tabelas.md#t-vagas)
- **RLS:** SELECT `movimentacoes_carreira_select` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-movimentacoes_estoque"></a>
## movimentacoes_estoque

- **Telas que gravam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Movimentações](telas.md#s-estoque-movimentações)
- **Telas que gravam via RPC:** [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que gravam:** [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [devolver_movimentacao_para_correcao](funcoes.md#f-devolver_movimentacao_para_correcao), [expedir](funcoes.md#f-expedir), [fechar_inventario](funcoes.md#f-fechar_inventario), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [movimentar_estoque](funcoes.md#f-movimentar_estoque), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_recebimento_da_entrada](funcoes.md#f-fn_recebimento_da_entrada) (em [recebimentos](tabelas.md#t-recebimentos)), [fn_recebimento_inativo_estorna_entrada](funcoes.md#f-fn_recebimento_inativo_estorna_entrada) (em [recebimentos](tabelas.md#t-recebimentos)), [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz) (em [vendas](tabelas.md#t-vendas))
- **Telas que leem:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Gerenciamento](telas.md#s-estoque-gerenciamento), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Relatórios](telas.md#s-estoque-relatórios)
- **RPCs que leem:** [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [devolver_movimentacao_para_correcao](funcoes.md#f-devolver_movimentacao_para_correcao), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor)
- **Gatilhos nesta tabela:**
  - `trg_atualiza_estoque` — AFTER INSERT/UPDATE/DELETE → [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto) · grava em [produtos](tabelas.md#t-produtos)
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_consumo_material_do_estoque` — AFTER INSERT → [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque) · grava em [consumos_material](tabelas.md#t-consumos_material)
  - `trg_consumo_material_mov_apagada` — BEFORE DELETE → [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao) · grava em [consumos_material](tabelas.md#t-consumos_material)
  - `trg_consumo_material_segue_mov` — AFTER UPDATE → [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao) · grava em [consumos_material](tabelas.md#t-consumos_material)
  - `trg_custo_medio_da_entrada` — BEFORE INSERT → [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada) · grava em [produtos_custo](tabelas.md#t-produtos_custo)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_mov_estoque_casa_com_pedido` — BEFORE INSERT → [_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido)
  - `trg_mov_saldo_abertura_so_na_implantacao` — BEFORE INSERT → [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao)
  - `trg_mov_servico_nao_tem_saldo` — BEFORE INSERT → [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto) → [produtos](tabelas.md#t-produtos)
  - 1. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque) → [consumos_material](tabelas.md#t-consumos_material)
  - 1. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao) → [consumos_material](tabelas.md#t-consumos_material)
  - 1. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao) → [consumos_material](tabelas.md#t-consumos_material)
  - 1. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada) → [produtos_custo](tabelas.md#t-produtos_custo)
- **Ao apagar uma linha daqui:** [consumos_material](tabelas.md#t-consumos_material).movimentacao_id zera o vínculo (SET NULL)
- **Aponta para:** pedido_venda_id → [pedidos_venda](tabelas.md#t-pedidos_venda); produto_id → [produtos](tabelas.md#t-produtos); recebimento_id → [recebimentos](tabelas.md#t-recebimentos); requisicao_estoque_id → [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **RLS:** DELETE `mov_delete` (setores: logistica · gerente da filial · Matriz/professor); INSERT `mov_insert` (setores: estoque, logistica · gerente da filial · Matriz/professor); SELECT `mov_select` (setores: compras, logistica · gerente da filial · Matriz/professor); UPDATE `mov_update` (setores: logistica · gerente da filial · Matriz/professor)

<a id="t-notas_emitidas"></a>
## notas_emitidas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que gravam:** [emitir_nota](funcoes.md#f-emitir_nota)
- **Telas que leem:** [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas), [Capital](telas.md#s-matriz-capital)
- **RPCs que leem:** [emitir_nota](funcoes.md#f-emitir_nota)
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_nota_emitida_guard` — BEFORE INSERT/UPDATE → [nota_emitida_guard](funcoes.md#f-nota_emitida_guard)
- **Aponta para:** cliente_id → [clientes](tabelas.md#t-clientes); conta_receber_id → [contas_receber](tabelas.md#t-contas_receber); criado_por → [user_profiles](tabelas.md#t-user_profiles); atualizado_por → [user_profiles](tabelas.md#t-user_profiles); venda_id → [vendas](tabelas.md#t-vendas)
- **RLS:** DELETE `notas_emitidas_delete` (Matriz/professor); INSERT `notas_emitidas_insert` (setores: financeiro, vendas · gerente da filial · Matriz/professor); SELECT `notas_emitidas_select` (setores: financeiro, vendas · gerente da filial · Matriz/professor); UPDATE `notas_emitidas_update` (setores: financeiro, vendas · gerente da filial · Matriz/professor)

<a id="t-notas_recebidas"></a>
## notas_recebidas

- **Telas que gravam:** [Compras › Notas recebidas](telas.md#s-compras-notasrecebidas)
- **RPCs que gravam:** —
- **Telas que leem:** [Compras › Notas recebidas](telas.md#s-compras-notasrecebidas), [Compras › Relatórios](telas.md#s-compras-relatórios), [Capital](telas.md#s-matriz-capital)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_fornecedor_nao_e_concessionaria` — BEFORE INSERT/UPDATE → [fn_fornecedor_nao_e_concessionaria](funcoes.md#f-fn_fornecedor_nao_e_concessionaria)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** conta_pagar_id → [contas_pagar](tabelas.md#t-contas_pagar); fornecedor_id → [fornecedores](tabelas.md#t-fornecedores)
- **RLS:** ALL `compras_all` (setores: compras, financeiro · gerente da filial · Matriz/professor)

<a id="t-notificacoes"></a>
## notificacoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Matriz › Briefing Diário](telas.md#s-briefing-diario), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Marketing › Promoções](telas.md#s-marketing-promoções), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Capital](telas.md#s-matriz-capital), [Competição](telas.md#s-matriz-competicao), [Meu Crachá](telas.md#s-meu-cracha), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto), [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **RPCs que gravam:** [encerrar_matriz_tarefa](funcoes.md#f-encerrar_matriz_tarefa), [lembrar_avaliacoes_pendentes](funcoes.md#f-lembrar_avaliacoes_pendentes), [liberar_ciclo_tarefa](funcoes.md#f-liberar_ciclo_tarefa), [liberar_matriz_tarefa](funcoes.md#f-liberar_matriz_tarefa), [notificar_setor](funcoes.md#f-notificar_setor), [reabrir_competicao](funcoes.md#f-reabrir_competicao)
- **Telas que leem:** [Matriz › Briefing Diário](telas.md#s-briefing-diario), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Marketing › Promoções](telas.md#s-marketing-promoções), [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **RPCs que leem:** [lembrar_avaliacoes_pendentes](funcoes.md#f-lembrar_avaliacoes_pendentes), [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [marcar_todas_lidas](funcoes.md#f-marcar_todas_lidas)
- **Ao apagar uma linha daqui:** [notificacoes_lidas](tabelas.md#t-notificacoes_lidas).notificacao_id APAGA JUNTO (CASCADE)
- **RLS:** DELETE `notif_delete` (Matriz/professor); INSERT `notif_insert` (Matriz/professor); SELECT `notif_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-notificacoes_lidas"></a>
## notificacoes_lidas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Matriz › Briefing Diário](telas.md#s-briefing-diario), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Marketing › Promoções](telas.md#s-marketing-promoções), [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **RPCs que gravam:** [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [marcar_todas_lidas](funcoes.md#f-marcar_todas_lidas)
- **Telas que leem:** —
- **Aponta para:** notificacao_id → [notificacoes](tabelas.md#t-notificacoes)
- **RLS:** INSERT `notif_lidas_insert` (o próprio usuário); SELECT `notif_lidas_select` (o próprio usuário)

<a id="t-orcamento_itens"></a>
## orcamento_itens

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Aponta para:** centro_custo_id → [centros_custo](tabelas.md#t-centros_custo); orcamento_id → [orcamentos_periodo](tabelas.md#t-orcamentos_periodo)
- **RLS:** SELECT `orcamento_item_read` (Matriz/professor)

<a id="t-orcamento_mensal_categoria"></a>
## orcamento_mensal_categoria

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Aponta para:** categoria_id → [categorias_produto](tabelas.md#t-categorias_produto)
- **RLS:** DELETE `orcamento_mensal_delete` (setores: financeiro · gerente da filial · Matriz/professor); INSERT `orcamento_mensal_insert` (setores: financeiro · gerente da filial · Matriz/professor); SELECT `orcamento_mensal_select` (setores: financeiro · gerente da filial · Matriz/professor); UPDATE `orcamento_mensal_update` (setores: financeiro · gerente da filial · Matriz/professor)

<a id="t-orcamentos"></a>
## orcamentos

- **Telas que gravam:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **Telas que gravam via RPC:** [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
- **RPCs que gravam:** [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido)
- **Telas que leem:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Matriz › Vendas](telas.md#s-relatorio-vendas), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **RPCs que leem:** [contar_pendencias](funcoes.md#f-contar_pendencias), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [listar_pendencias](funcoes.md#f-listar_pendencias), [minha_mesa](funcoes.md#f-minha_mesa)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_condicao_pagamento` — BEFORE INSERT/UPDATE → [fn_orcamento_condicao_pagamento](funcoes.md#f-fn_orcamento_condicao_pagamento)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_numero_documento` — BEFORE INSERT → [set_numero_documento](funcoes.md#f-set_numero_documento) · grava em [documento_sequencias](tabelas.md#t-documento_sequencias)
  - `trg_sem_exclusao` — BEFORE UPDATE → [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao)
- **Ao apagar uma linha daqui:** [pedidos_venda](tabelas.md#t-pedidos_venda).orcamento_id zera o vínculo (SET NULL)
- **Aponta para:** cliente_id → [clientes](tabelas.md#t-clientes); forma_pagamento_id → [formas_pagamento](tabelas.md#t-formas_pagamento)
- **RLS:** DELETE `orc_delete` (setores: vendas · gerente da filial · Matriz/professor); INSERT `orc_insert` (setores: vendas · gerente da filial · Matriz/professor); SELECT `orc_select` (setores: financeiro, vendas · gerente da filial · Matriz/professor); UPDATE `orc_update` (setores: financeiro, vendas · gerente da filial · Matriz/professor)

<a id="t-orcamentos_periodo"></a>
## orcamentos_periodo

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RPCs que leem:** [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Ao apagar uma linha daqui:** [orcamento_itens](tabelas.md#t-orcamento_itens).orcamento_id APAGA JUNTO (CASCADE)
- **RLS:** SELECT `orcamento_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-parcelas_emprestimo"></a>
## parcelas_emprestimo

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital), [Usuários](telas.md#s-usuarios)
- **RPCs que gravam:** [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo) (em [contas_pagar](tabelas.md#t-contas_pagar))
- **Telas que leem:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **RPCs que leem:** [_dre_calculo](funcoes.md#f-_dre_calculo), [_pontualidade_competicao](funcoes.md#f-_pontualidade_competicao), [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_parcela_emprestimo_arquivada_historico` — BEFORE UPDATE → [parcela_emprestimo_arquivada_e_historico](funcoes.md#f-parcela_emprestimo_arquivada_e_historico)
- **Aponta para:** contas_pagar_id → [contas_pagar](tabelas.md#t-contas_pagar); contas_receber_id → [contas_receber](tabelas.md#t-contas_receber); emprestimo_id → [emprestimos_filial](tabelas.md#t-emprestimos_filial)
- **RLS:** INSERT `parcelas_insert` (setores: financeiro · Matriz/professor); SELECT `parcelas_select` (setores: admin, ceo, conselheiro · gerente da filial); UPDATE `parcelas_update` (setores: financeiro · Matriz/professor)

<a id="t-pdi_itens"></a>
## pdi_itens

- **Telas que gravam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que gravam:** —
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **RPCs que leem:** [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios)
- **Gatilhos nesta tabela:**
  - `pdi_itens_updated_at` — BEFORE UPDATE → [trg_pdi_itens_updated_at](funcoes.md#f-trg_pdi_itens_updated_at)
  - `trg_filial_pdi_item` — BEFORE INSERT/UPDATE → [set_filial_pdi_item](funcoes.md#f-set_filial_pdi_item)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** avaliacao_id → [avaliacoes](tabelas.md#t-avaliacoes); treinamento_id → [treinamentos](tabelas.md#t-treinamentos)
- **RLS:** DELETE `pdi_delete` (Matriz/professor); INSERT `pdi_insert` (Matriz/professor); SELECT `pdi_read` (gerente da filial · Matriz/professor); UPDATE `pdi_update` (Matriz/professor)

<a id="t-pedidos"></a>
## pedidos

- **Telas que gravam:** [Compras › Pedidos](telas.md#s-compras-pedidos)
- **Telas que gravam via RPC:** [Compras › Cotações](telas.md#s-compras-cotações), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **RPCs que gravam:** [cancelar_pedido_compra](funcoes.md#f-cancelar_pedido_compra), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_recebimento_fecha_pedido](funcoes.md#f-fn_recebimento_fecha_pedido) (em [recebimentos](tabelas.md#t-recebimentos))
- **Telas que leem:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Gerenciamento](telas.md#s-compras-gerenciamento), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Relatórios](telas.md#s-compras-relatórios), [Dashboard](telas.md#s-dashboard), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **RPCs que leem:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [cancelar_pedido_compra](funcoes.md#f-cancelar_pedido_compra), [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [conferir_nota_fiscal](funcoes.md#f-conferir_nota_fiscal), [contar_pendencias](funcoes.md#f-contar_pendencias), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [listar_pendencias](funcoes.md#f-listar_pendencias), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor)
- **Views que dependem desta:** [v_fornecedor_desempenho](tabelas.md#t-v_fornecedor_desempenho), [v_pedido_saldo](tabelas.md#t-v_pedido_saldo), [v_pedidos_a_receber](tabelas.md#t-v_pedidos_a_receber)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_fornecedor_nao_e_concessionaria` — BEFORE INSERT/UPDATE → [fn_fornecedor_nao_e_concessionaria](funcoes.md#f-fn_fornecedor_nao_e_concessionaria)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_numero_documento` — BEFORE INSERT → [set_numero_documento](funcoes.md#f-set_numero_documento) · grava em [documento_sequencias](tabelas.md#t-documento_sequencias)
  - `trg_pedido_avisa_estoque` — AFTER UPDATE → [fn_pedido_avisa_estoque](funcoes.md#f-fn_pedido_avisa_estoque) · grava em [notificacoes](tabelas.md#t-notificacoes)
  - `trg_pedido_congela_compra` — BEFORE UPDATE → [fn_pedido_congela_compra](funcoes.md#f-fn_pedido_congela_compra)
  - `trg_pedido_marca_recebimento` — BEFORE UPDATE → [fn_pedido_marca_recebimento](funcoes.md#f-fn_pedido_marca_recebimento)
  - `trg_pedido_transicao_valida` — BEFORE UPDATE → [fn_pedido_transicao_valida](funcoes.md#f-fn_pedido_transicao_valida)
  - `trg_sem_exclusao` — BEFORE UPDATE → [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao)
- **Ao apagar uma linha daqui:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra).pedido_id APAGA JUNTO (CASCADE); [contas_pagar](tabelas.md#t-contas_pagar).pedido_id zera o vínculo (SET NULL); [devolucoes_fornecedor](tabelas.md#t-devolucoes_fornecedor).pedido_id APAGA JUNTO (CASCADE); [fretes_compra_rateio](tabelas.md#t-fretes_compra_rateio).pedido_id APAGA JUNTO (CASCADE); [recebimentos](tabelas.md#t-recebimentos).pedido_id zera o vínculo (SET NULL)
- **Aponta para:** cotacao_id → [cotacoes](tabelas.md#t-cotacoes); fornecedor_id → [fornecedores](tabelas.md#t-fornecedores); produto_id → [produtos](tabelas.md#t-produtos); requisicao_id → [requisicoes](tabelas.md#t-requisicoes); servico_id → [servicos](tabelas.md#t-servicos)
- **RLS:** SELECT `compras_select` (setores: compras, financeiro, logistica · gerente da filial · Matriz/professor); UPDATE `compras_update` (setores: compras, logistica · gerente da filial · Matriz/professor)

<a id="t-pedidos_online"></a>
## pedidos_online

- **Telas que gravam:** [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que gravam:** [cancelar_pedido_online](funcoes.md#f-cancelar_pedido_online), [confirmar_pedido_online](funcoes.md#f-confirmar_pedido_online), [limpar_ip_hash_pedidos_online](funcoes.md#f-limpar_ip_hash_pedidos_online)
- **Servidor (api/) grava:** `api/loja.ts`
- **Telas que leem:** [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que leem:** [cancelar_pedido_online](funcoes.md#f-cancelar_pedido_online), [confirmar_pedido_online](funcoes.md#f-confirmar_pedido_online), [gerar_codigo_pedido_online](funcoes.md#f-gerar_codigo_pedido_online), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Servidor (api/) lê:** `api/loja.ts`
- **Gatilhos nesta tabela:**
  - `trg_loja_apelido_limpo` — BEFORE INSERT/UPDATE → [loja_apelido_limpo](funcoes.md#f-loja_apelido_limpo)
- **Ao apagar uma linha daqui:** [pedidos_online_itens](tabelas.md#t-pedidos_online_itens).pedido_id APAGA JUNTO (CASCADE)
- **Aponta para:** venda_id → [vendas](tabelas.md#t-vendas)
- **RLS:** ALL `pedidos_online_all` (regra própria)

<a id="t-pedidos_online_itens"></a>
## pedidos_online_itens

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Servidor (api/) grava:** `api/loja.ts`
- **Telas que leem:** [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que leem:** [confirmar_pedido_online](funcoes.md#f-confirmar_pedido_online)
- **Servidor (api/) lê:** `api/loja.ts`
- **Aponta para:** pedido_id → [pedidos_online](tabelas.md#t-pedidos_online); produto_id → [produtos](tabelas.md#t-produtos)
- **RLS:** ALL `pedidos_online_itens_all` (regra própria)

<a id="t-pedidos_venda"></a>
## pedidos_venda

- **Telas que gravam:** [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
- **Telas que gravam via RPC:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **RPCs que gravam:** [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda)
- **Gatilhos (de outras tabelas) que gravam aqui:** [_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda) (em [contas_receber](tabelas.md#t-contas_receber))
- **Telas que leem:** [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Matriz › Vendas](telas.md#s-relatorio-vendas), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
- **RPCs que leem:** [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [contar_pendencias](funcoes.md#f-contar_pendencias), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [minha_mesa](funcoes.md#f-minha_mesa), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_numero_documento` — BEFORE INSERT → [set_numero_documento](funcoes.md#f-set_numero_documento) · grava em [documento_sequencias](tabelas.md#t-documento_sequencias)
  - `trg_pedido_venda_status_marcos` — BEFORE INSERT/UPDATE → [fn_pedido_venda_status_pelos_marcos](funcoes.md#f-fn_pedido_venda_status_pelos_marcos)
  - `trg_sem_exclusao` — BEFORE UPDATE → [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao)
- **Ao apagar uma linha daqui:** [contas_receber](tabelas.md#t-contas_receber).pedido_venda_id zera o vínculo (SET NULL); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque).pedido_venda_id bloqueia (NO ACTION); [vendas](tabelas.md#t-vendas).pedido_venda_id zera o vínculo (SET NULL)
- **Aponta para:** cliente_id → [clientes](tabelas.md#t-clientes); conta_receber_id → [contas_receber](tabelas.md#t-contas_receber); orcamento_id → [orcamentos](tabelas.md#t-orcamentos)
- **RLS:** DELETE `pv_delete` (setores: vendas · gerente da filial · Matriz/professor); INSERT `pv_insert` (setores: vendas · gerente da filial · Matriz/professor); SELECT `pv_select` (setores: financeiro, logistica, vendas · gerente da filial · Matriz/professor); UPDATE `pv_update` (setores: financeiro, logistica, vendas · gerente da filial · Matriz/professor)

<a id="t-pesquisa_perguntas"></a>
## pesquisa_perguntas

- **Telas que gravam:** [Recursos Humanos › Pesquisas](telas.md#s-rh-pesquisas)
- **RPCs que gravam:** —
- **Telas que leem:** [Minhas pesquisas *(rota minhas-pesquisas)*](telas.md#s-minhas-pesquisas), [Recursos Humanos › Pesquisas](telas.md#s-rh-pesquisas)
- **Ao apagar uma linha daqui:** [pesquisa_resposta_itens](tabelas.md#t-pesquisa_resposta_itens).pergunta_id APAGA JUNTO (CASCADE)
- **Aponta para:** pesquisa_id → [pesquisas](tabelas.md#t-pesquisas)
- **RLS:** ALL `pesquisa_perguntas_write` (setores: rh · gerente da filial · Matriz/professor); SELECT `pesquisa_perguntas_select` (Matriz/professor)

<a id="t-pesquisa_resposta_itens"></a>
## pesquisa_resposta_itens

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Minhas pesquisas *(rota minhas-pesquisas)*](telas.md#s-minhas-pesquisas)
- **RPCs que gravam:** [responder_pesquisa](funcoes.md#f-responder_pesquisa)
- **Telas que leem:** [Recursos Humanos › Pesquisas](telas.md#s-rh-pesquisas)
- **Aponta para:** pergunta_id → [pesquisa_perguntas](tabelas.md#t-pesquisa_perguntas); resposta_id → [pesquisa_respostas](tabelas.md#t-pesquisa_respostas)
- **RLS:** SELECT `pesquisa_resposta_itens_select` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-pesquisa_respostas"></a>
## pesquisa_respostas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Minhas pesquisas *(rota minhas-pesquisas)*](telas.md#s-minhas-pesquisas)
- **RPCs que gravam:** [responder_pesquisa](funcoes.md#f-responder_pesquisa)
- **Telas que leem:** [Início](telas.md#s-inicio), [Minhas pesquisas *(rota minhas-pesquisas)*](telas.md#s-minhas-pesquisas), [Recursos Humanos › Pesquisas](telas.md#s-rh-pesquisas)
- **RPCs que leem:** [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [responder_pesquisa](funcoes.md#f-responder_pesquisa)
- **Ao apagar uma linha daqui:** [pesquisa_resposta_itens](tabelas.md#t-pesquisa_resposta_itens).resposta_id APAGA JUNTO (CASCADE)
- **Aponta para:** pesquisa_id → [pesquisas](tabelas.md#t-pesquisas)
- **RLS:** SELECT `pesquisa_respostas_select` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-pesquisas"></a>
## pesquisas

- **Telas que gravam:** [Recursos Humanos › Pesquisas](telas.md#s-rh-pesquisas)
- **RPCs que gravam:** —
- **Telas que leem:** [Início](telas.md#s-inicio), [Minhas pesquisas *(rota minhas-pesquisas)*](telas.md#s-minhas-pesquisas), [Recursos Humanos › Pesquisas](telas.md#s-rh-pesquisas)
- **RPCs que leem:** [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [responder_pesquisa](funcoes.md#f-responder_pesquisa)
- **Ao apagar uma linha daqui:** [pesquisa_perguntas](tabelas.md#t-pesquisa_perguntas).pesquisa_id APAGA JUNTO (CASCADE); [pesquisa_respostas](tabelas.md#t-pesquisa_respostas).pesquisa_id APAGA JUNTO (CASCADE)
- **RLS:** ALL `pesquisas_write` (setores: rh · gerente da filial · Matriz/professor); SELECT `pesquisas_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-pix_pendentes"></a>
## pix_pendentes

- **Telas que gravam:** [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que gravam:** [confirmar_pix_pendente](funcoes.md#f-confirmar_pix_pendente), [liberar_cobranca](funcoes.md#f-liberar_cobranca), [renotificar_pix_pago](funcoes.md#f-renotificar_pix_pago), [reservar_cobranca](funcoes.md#f-reservar_cobranca)
- **Telas que leem:** —
- **RPCs que leem:** [consultar_status_cobranca](funcoes.md#f-consultar_status_cobranca), [reservar_cobranca](funcoes.md#f-reservar_cobranca)
- **Gatilhos nesta tabela:**
  - `pix_pendentes_visitor_gate` — BEFORE UPDATE → [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate)
  - `trg_pix_pendentes_filial` — BEFORE INSERT → [pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial)
  - `trg_pix_pendentes_paid_at` — BEFORE UPDATE → [pix_pendentes_set_paid_at](funcoes.md#f-pix_pendentes_set_paid_at)
- **Aponta para:** cliente_id → [clientes](tabelas.md#t-clientes)
- **RLS:** DELETE `pix_pendentes_auth_delete` (Matriz/professor); INSERT `pix_pendentes_auth_insert` (o próprio usuário); SELECT `pix_pendentes_anon_select` (regra própria); SELECT `pix_pendentes_auth_select` (Matriz/professor); UPDATE `pix_pendentes_anon_update` (regra própria); UPDATE `pix_pendentes_auth_update` (Matriz/professor)

<a id="t-planilhas_trabalho"></a>
## planilhas_trabalho

- **Telas que gravam:** [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Vendas › Clientes](telas.md#s-vendas-clientes)
- **RPCs que gravam:** —
- **Telas que leem:** [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Vendas › Clientes](telas.md#s-vendas-clientes)
- **Aponta para:** user_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** INSERT `planilhas_trabalho_insert` (o próprio usuário); SELECT `planilhas_trabalho_read` (o próprio usuário); UPDATE `planilhas_trabalho_update` (o próprio usuário)

<a id="t-politicas_remuneracao"></a>
## politicas_remuneracao

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Ao apagar uma linha daqui:** [apuracoes_bonus](tabelas.md#t-apuracoes_bonus).politica_id bloqueia (RESTRICT)
- **RLS:** ALL `politica_write` (regra própria); SELECT `politica_read` (todos)

<a id="t-ponto_calendario_excecoes"></a>
## ponto_calendario_excecoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que gravam:** [definir_excecao_calendario](funcoes.md#f-definir_excecao_calendario), [remover_excecao_calendario](funcoes.md#f-remover_excecao_calendario)
- **Telas que leem:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que leem:** [_dia_de_folga](funcoes.md#f-_dia_de_folga), [dias_letivos_periodo](funcoes.md#f-dias_letivos_periodo)
- **RLS:** SELECT `excecao_read` (todos)

<a id="t-ponto_codigo_tentativas"></a>
## ponto_codigo_tentativas

- **Telas que gravam:** —
- **RPCs que gravam:** [contar_tentativa_codigo_ponto](funcoes.md#f-contar_tentativa_codigo_ponto)
- **Telas que leem:** —

<a id="t-ponto_eletronico"></a>
## ponto_eletronico

- **Telas que gravam:** [Crachá Virtual](telas.md#s-cracha-virtual)
- **Telas que gravam via RPC:** [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que gravam:** [_reverter_ponto_do_afastamento](funcoes.md#f-_reverter_ponto_do_afastamento), [aplicar_afastamento_no_ponto](funcoes.md#f-aplicar_afastamento_no_ponto), [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [remover_ponto](funcoes.md#f-remover_ponto)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_recompute_ponto_eletronico_after_delete](funcoes.md#f-fn_recompute_ponto_eletronico_after_delete) (em [ponto_qr_registros](tabelas.md#t-ponto_qr_registros)), [fn_sync_ponto_eletronico](funcoes.md#f-fn_sync_ponto_eletronico) (em [ponto_qr_registros](tabelas.md#t-ponto_qr_registros))
- **Telas que leem:** [Crachá Virtual](telas.md#s-cracha-virtual), [Recursos Humanos › Gerenciamento](telas.md#s-rh-gerenciamento), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que leem:** [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [_reverter_ponto_do_afastamento](funcoes.md#f-_reverter_ponto_do_afastamento), [aplicar_afastamento_no_ponto](funcoes.md#f-aplicar_afastamento_no_ponto), [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [definir_excecao_calendario](funcoes.md#f-definir_excecao_calendario), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [minha_frequencia](funcoes.md#f-minha_frequencia), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [remover_ponto](funcoes.md#f-remover_ponto), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_ponto_dia_de_folga` — BEFORE INSERT/UPDATE → [fn_ponto_recusa_dia_de_folga](funcoes.md#f-fn_ponto_recusa_dia_de_folga)
  - `trg_ponto_filial` — BEFORE INSERT/UPDATE → [fn_ponto_filial_from_funcionario](funcoes.md#f-fn_ponto_filial_from_funcionario)
- **Ao apagar uma linha daqui:** [justificativas_falta](tabelas.md#t-justificativas_falta).ponto_id zera o vínculo (SET NULL)
- **Aponta para:** afastamento_id → [afastamentos](tabelas.md#t-afastamentos); funcionario_id → [funcionarios](tabelas.md#t-funcionarios)
- **RLS:** DELETE `ponto_admin_delete` (regra própria); INSERT `ponto_rh_insert` (setores: rh · gerente da filial · Matriz/professor); SELECT `ponto_rh_select` (setores: rh · gerente da filial · Matriz/professor); UPDATE `ponto_rh_update` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-ponto_jornada"></a>
## ponto_jornada

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que gravam:** [definir_ponto_jornada](funcoes.md#f-definir_ponto_jornada)
- **Telas que leem:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **RPCs que leem:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [definir_ponto_jornada](funcoes.md#f-definir_ponto_jornada), [dias_letivos_periodo](funcoes.md#f-dias_letivos_periodo), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [frequencia_filiais_competicao](funcoes.md#f-frequencia_filiais_competicao), [minha_frequencia](funcoes.md#f-minha_frequencia)
- **RLS:** SELECT `ponto_jornada_select` (todos)

<a id="t-ponto_qr_registros"></a>
## ponto_qr_registros

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Servidor (api/) grava:** `api/register-ponto.ts`
- **Telas que leem:** —
- **Servidor (api/) lê:** `api/register-ponto.ts`
- **Gatilhos nesta tabela:**
  - `trg_ponto_qr_carimba_hora` — BEFORE INSERT/UPDATE → [ponto_qr_carimba_hora](funcoes.md#f-ponto_qr_carimba_hora)
  - `trg_recompute_ponto` — AFTER DELETE → [fn_recompute_ponto_eletronico_after_delete](funcoes.md#f-fn_recompute_ponto_eletronico_after_delete) · grava em [ponto_eletronico](tabelas.md#t-ponto_eletronico)
  - `trg_sync_ponto` — AFTER INSERT → [fn_sync_ponto_eletronico](funcoes.md#f-fn_sync_ponto_eletronico) · grava em [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [ponto_qr_registros](tabelas.md#t-ponto_qr_registros) → [fn_recompute_ponto_eletronico_after_delete](funcoes.md#f-fn_recompute_ponto_eletronico_after_delete) → [ponto_eletronico](tabelas.md#t-ponto_eletronico)
  - 1. [ponto_qr_registros](tabelas.md#t-ponto_qr_registros) → [fn_sync_ponto_eletronico](funcoes.md#f-fn_sync_ponto_eletronico) → [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **RLS:** DELETE `pontoqr_delete` (setores: admin, ceo, rh); INSERT `pontoqr_insert` (setores: rh); SELECT `pontoqr_select` (setores: rh); UPDATE `pontoqr_modify` (setores: rh)

<a id="t-prestacao_pareceres"></a>
## prestacao_pareceres

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Aponta para:** prestacao_id → [prestacoes_contas](tabelas.md#t-prestacoes_contas); conselheiro_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `parecer_read` (setores: aprovada, aprovada_com_ressalva, reprovada)

<a id="t-prestacoes_contas"></a>
## prestacoes_contas

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RPCs que leem:** [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Ao apagar uma linha daqui:** [prestacao_pareceres](tabelas.md#t-prestacao_pareceres).prestacao_id APAGA JUNTO (CASCADE)
- **RLS:** SELECT `prestacao_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-previsoes"></a>
## previsoes

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
- **RLS:** ALL `fin_all` (setores: financeiro · Matriz/professor)

<a id="t-produto_unidades"></a>
## produto_unidades

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- **RPCs que gravam:** [registrar_unidades_recebidas](funcoes.md#f-registrar_unidades_recebidas)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_item_devolucao_devolve_unidade](funcoes.md#f-fn_item_devolucao_devolve_unidade) (em [itens_devolucao](tabelas.md#t-itens_devolucao)), [fn_item_venda_aloca_unidade](funcoes.md#f-fn_item_venda_aloca_unidade) (em [itens_venda](tabelas.md#t-itens_venda)), [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz) (em [vendas](tabelas.md#t-vendas))
- **Telas que leem:** [Financeiro › Recibos de Vendas](telas.md#s-financeiro-recibosdevendas)
- **RPCs que leem:** [registrar_unidades_recebidas](funcoes.md#f-registrar_unidades_recebidas)
- **Aponta para:** item_venda_id → [itens_venda](tabelas.md#t-itens_venda); produto_id → [produtos](tabelas.md#t-produtos); recebimento_id → [recebimentos](tabelas.md#t-recebimentos); venda_id → [vendas](tabelas.md#t-vendas)
- **RLS:** SELECT `produto_unidade_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-produtos"></a>
## produtos

- **Telas que gravam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Telas que gravam via RPC:** [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
- **RPCs que gravam:** [concluir_correcao_produto](funcoes.md#f-concluir_correcao_produto), [dar_baixa_patrimonio](funcoes.md#f-dar_baixa_patrimonio), [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [devolver_movimentacao_para_correcao](funcoes.md#f-devolver_movimentacao_para_correcao), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [marcar_vitrine](funcoes.md#f-marcar_vitrine), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto) (em [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque))
- **Telas que leem:** [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Dashboard](telas.md#s-dashboard), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Gerenciamento](telas.md#s-estoque-gerenciamento), [Estoque › Inventários](telas.md#s-estoque-inventários), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Relatórios](telas.md#s-estoque-relatórios), [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Estoque › Saldos](telas.md#s-estoque-saldos), [Estoque › Validades](telas.md#s-estoque-validades), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Recibos de Vendas](telas.md#s-financeiro-recibosdevendas), [Marketing › Campanhas](telas.md#s-marketing-campanhas), [Marketing › Configurações *(rota marketing-configurações)*](telas.md#s-marketing-configurações), [Conteúdo](telas.md#s-matriz-conteudo), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Vendas › Clientes](telas.md#s-vendas-clientes), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que leem:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [_dre_calculo](funcoes.md#f-_dre_calculo), [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [concluir_correcao_produto](funcoes.md#f-concluir_correcao_produto), [confirmar_pedido_online](funcoes.md#f-confirmar_pedido_online), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [criar_requisicao_estoque](funcoes.md#f-criar_requisicao_estoque), [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [dar_baixa_patrimonio](funcoes.md#f-dar_baixa_patrimonio), [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [devolver_movimentacao_para_correcao](funcoes.md#f-devolver_movimentacao_para_correcao), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [ean13_interno](funcoes.md#f-ean13_interno), [expedir](funcoes.md#f-expedir), [fechar_inventario](funcoes.md#f-fechar_inventario), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [get_vitrine_publica](funcoes.md#f-get_vitrine_publica), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [listar_vitrine_candidatos](funcoes.md#f-listar_vitrine_candidatos), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [marcar_vitrine](funcoes.md#f-marcar_vitrine), [minha_mesa](funcoes.md#f-minha_mesa), [movimentar_estoque](funcoes.md#f-movimentar_estoque), [preco_efetivo](funcoes.md#f-preco_efetivo), [promocao_vigente_do_produto](funcoes.md#f-promocao_vigente_do_produto), [reenviar_requisicao_corrigida](funcoes.md#f-reenviar_requisicao_corrigida), [reenviar_requisicao_estoque_corrigida](funcoes.md#f-reenviar_requisicao_estoque_corrigida), [reservar_codigo_produto](funcoes.md#f-reservar_codigo_produto), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [vender_patrimonio](funcoes.md#f-vender_patrimonio), [vincular_produto_requisicao](funcoes.md#f-vincular_produto_requisicao)
- **Servidor (api/) lê:** `api/loja.ts`
- **Views que dependem desta:** [produtos_com_custo](tabelas.md#t-produtos_com_custo), [v_promocao_vigente](tabelas.md#t-v_promocao_vigente)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_block_correcao_manual` — BEFORE UPDATE → [fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual)
  - `trg_block_estoque_manual` — BEFORE UPDATE → [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual)
  - `trg_carimba_exclusao` — BEFORE UPDATE → [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao)
  - `trg_fornecedor_nao_e_concessionaria` — BEFORE INSERT/UPDATE → [fn_fornecedor_nao_e_concessionaria](funcoes.md#f-fn_fornecedor_nao_e_concessionaria)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_produto_com_documento_aberto_nao_sai` — BEFORE UPDATE → [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai)
  - `trg_produto_ean_valido` — BEFORE INSERT/UPDATE → [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido)
  - `trg_produto_loja_online_guard` — BEFORE INSERT/UPDATE → [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard)
  - `trg_produto_marca_imutavel_com_uso` — BEFORE UPDATE → [fn_produto_marca_imutavel_com_uso](funcoes.md#f-fn_produto_marca_imutavel_com_uso)
  - `trg_produto_preco_abaixo_do_custo` — BEFORE INSERT/UPDATE → [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo)
  - `trg_produto_publicavel` — BEFORE INSERT/UPDATE → [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel)
  - `trg_produto_status_segue_ativo` — BEFORE INSERT/UPDATE → [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo)
  - `trg_produto_variante_ja_existe` — BEFORE INSERT/UPDATE → [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe)
  - `trg_unidade_imutavel_com_saldo` — BEFORE UPDATE → [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo)
- **Ao apagar uma linha daqui:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra).produto_id zera o vínculo (SET NULL); [consumos_material](tabelas.md#t-consumos_material).produto_id bloqueia (NO ACTION); [contas_receber](tabelas.md#t-contas_receber).produto_patrimonio_id bloqueia (NO ACTION); [devolucoes_fornecedor](tabelas.md#t-devolucoes_fornecedor).produto_id zera o vínculo (SET NULL); [expedicao](tabelas.md#t-expedicao).produto_id zera o vínculo (SET NULL); [filial_investimentos](tabelas.md#t-filial_investimentos).produto_patrimonio_id zera o vínculo (SET NULL); [inventarios](tabelas.md#t-inventarios).produto_id zera o vínculo (SET NULL); [itens_campanha](tabelas.md#t-itens_campanha).produto_id APAGA JUNTO (CASCADE); [itens_devolucao](tabelas.md#t-itens_devolucao).produto_id bloqueia (NO ACTION); [itens_venda](tabelas.md#t-itens_venda).produto_id zera o vínculo (SET NULL); [marketing_promocoes](tabelas.md#t-marketing_promocoes).produto_id zera o vínculo (SET NULL); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque).produto_id zera o vínculo (SET NULL); [pedidos](tabelas.md#t-pedidos).produto_id bloqueia (NO ACTION); [pedidos_online_itens](tabelas.md#t-pedidos_online_itens).produto_id bloqueia (RESTRICT); [produto_unidades](tabelas.md#t-produto_unidades).produto_id APAGA JUNTO (CASCADE); [produtos](tabelas.md#t-produtos).patrimonio_origem_id zera o vínculo (SET NULL); [produtos_custo](tabelas.md#t-produtos_custo).produto_id APAGA JUNTO (CASCADE); [requisicoes](tabelas.md#t-requisicoes).produto_id bloqueia (NO ACTION); [requisicoes_estoque](tabelas.md#t-requisicoes_estoque).produto_id zera o vínculo (SET NULL); [vencimentos_estoque](tabelas.md#t-vencimentos_estoque).produto_id zera o vínculo (SET NULL)
- **Aponta para:** categoria_id → [categorias_produto](tabelas.md#t-categorias_produto); fornecedor_id → [fornecedores](tabelas.md#t-fornecedores); patrimonio_origem_id → [produtos](tabelas.md#t-produtos); subcategoria_id → [subcategorias_produto](tabelas.md#t-subcategorias_produto); correcao_responsavel_id → [user_profiles](tabelas.md#t-user_profiles); correcao_solicitada_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `delete_produtos` (setores: compras, logistica · gerente da filial · Matriz/professor); INSERT `write_produtos` (setores: compras, logistica · gerente da filial · Matriz/professor); SELECT `produtos_select_filial` (qualquer um da própria filial · Matriz/professor); UPDATE `update_produtos` (setores: compras, logistica, vendas · gerente da filial · Matriz/professor)

<a id="t-produtos_codigo_reserva"></a>
## produtos_codigo_reserva

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Cadastros › Produtos](telas.md#s-cadastros-produtos)
- **RPCs que gravam:** [liberar_codigo_produto](funcoes.md#f-liberar_codigo_produto), [reservar_codigo_produto](funcoes.md#f-reservar_codigo_produto)
- **Telas que leem:** —
- **RPCs que leem:** [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [reservar_codigo_produto](funcoes.md#f-reservar_codigo_produto)

<a id="t-produtos_com_custo"></a>
## produtos_com_custo (view)

- **Telas que leem:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Catálogo](telas.md#s-catalogo-produtos), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Precificação](telas.md#s-financeiro-precificação), [Marketing › Promoções](telas.md#s-marketing-promoções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)

<a id="t-produtos_custo"></a>
## produtos_custo

- **Telas que gravam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos)
- **Telas que gravam via RPC:** [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
- **RPCs que gravam:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada) (em [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque))
- **Telas que leem:** [Empresa › Filiais](telas.md#s-empresa-filiais)
- **RPCs que leem:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [_dre_calculo](funcoes.md#f-_dre_calculo), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Views que dependem desta:** [produtos_com_custo](tabelas.md#t-produtos_com_custo)
- **Gatilhos nesta tabela:**
  - `trg_custo_manual_acima_do_preco` — BEFORE INSERT/UPDATE → [custo_manual_nao_passa_do_preco_de_venda](funcoes.md#f-custo_manual_nao_passa_do_preco_de_venda)
- **Aponta para:** produto_id → [produtos](tabelas.md#t-produtos)
- **RLS:** INSERT `produtos_custo_insert` (setores: financeiro, logistica, marketing · Matriz/professor); SELECT `produtos_custo_select` (setores: financeiro, logistica, marketing); UPDATE `produtos_custo_update` (setores: financeiro, logistica, marketing · Matriz/professor)

<a id="t-projetos"></a>
## projetos

- **Telas que gravam:** [Empresa › Projetos](telas.md#s-empresa-projetos)
- **RPCs que gravam:** —
- **Telas que leem:** [Empresa › Projetos](telas.md#s-empresa-projetos)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** cliente_id → [clientes](tabelas.md#t-clientes)
- **RLS:** ALL `projetos_write` (setores: financeiro · gerente da filial · Matriz/professor); SELECT `projetos_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-rateio_administrativo"></a>
## rateio_administrativo

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo)
- **RPCs que gravam:** [aplicar_rateio_administrativo](funcoes.md#f-aplicar_rateio_administrativo), [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo)
- **Telas que leem:** [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo)
- **RPCs que leem:** [apurar_rateio_administrativo](funcoes.md#f-apurar_rateio_administrativo), [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo)
- **Ao apagar uma linha daqui:** [rateio_administrativo_itens](tabelas.md#t-rateio_administrativo_itens).rateio_id APAGA JUNTO (CASCADE)
- **Aponta para:** criado_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `rateio_select` (setores: financeiro · gerente da filial)

<a id="t-rateio_administrativo_itens"></a>
## rateio_administrativo_itens

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo)
- **RPCs que gravam:** [aplicar_rateio_administrativo](funcoes.md#f-aplicar_rateio_administrativo)
- **Telas que leem:** [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo)
- **RPCs que leem:** [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo)
- **Aponta para:** conta_pagar_id → [contas_pagar](tabelas.md#t-contas_pagar); conta_receber_id → [contas_receber](tabelas.md#t-contas_receber); rateio_id → [rateio_administrativo](tabelas.md#t-rateio_administrativo)
- **RLS:** SELECT `rateio_itens_select` (setores: financeiro · gerente da filial · Matriz/professor)

<a id="t-recebimentos"></a>
## recebimentos

- **Telas que gravam:** [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- **RPCs que gravam:** —
- **Telas que leem:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Gerenciamento](telas.md#s-compras-gerenciamento), [Compras › Relatórios](telas.md#s-compras-relatórios), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **RPCs que leem:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [cancelar_pedido_compra](funcoes.md#f-cancelar_pedido_compra), [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [conferir_nota_fiscal](funcoes.md#f-conferir_nota_fiscal), [contar_pendencias](funcoes.md#f-contar_pendencias), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [listar_pendencias](funcoes.md#f-listar_pendencias), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [resumo_recebimentos](funcoes.md#f-resumo_recebimentos)
- **Views que dependem desta:** [v_pedido_saldo](tabelas.md#t-v_pedido_saldo)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_recebimento_conferido_congela` — BEFORE UPDATE → [fn_recebimento_conferido_congela](funcoes.md#f-fn_recebimento_conferido_congela)
  - `trg_recebimento_confirmado_nao_some` — BEFORE UPDATE → [fn_recebimento_confirmado_nao_some](funcoes.md#f-fn_recebimento_confirmado_nao_some)
  - `trg_recebimento_da_entrada` — AFTER INSERT/UPDATE → [fn_recebimento_da_entrada](funcoes.md#f-fn_recebimento_da_entrada) · grava em [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produtos_custo](tabelas.md#t-produtos_custo)
  - `trg_recebimento_data_plausivel` — BEFORE INSERT/UPDATE → [fn_recebimento_data_plausivel](funcoes.md#f-fn_recebimento_data_plausivel)
  - `trg_recebimento_estorna_entrada` — AFTER UPDATE → [fn_recebimento_inativo_estorna_entrada](funcoes.md#f-fn_recebimento_inativo_estorna_entrada) · grava em [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
  - `trg_recebimento_fecha_pedido` — AFTER INSERT/UPDATE/DELETE → [fn_recebimento_fecha_pedido](funcoes.md#f-fn_recebimento_fecha_pedido) · grava em [pedidos](tabelas.md#t-pedidos)
  - `trg_recebimento_nao_estoura_pedido` — BEFORE INSERT/UPDATE → [fn_recebimento_nao_estoura_pedido](funcoes.md#f-fn_recebimento_nao_estoura_pedido)
  - `trg_recebimento_nota_fiscal` — BEFORE INSERT/UPDATE → [fn_recebimento_exige_nota](funcoes.md#f-fn_recebimento_exige_nota)
  - `trg_recebimento_saldo_status` — BEFORE INSERT/UPDATE → [fn_recebimento_status_pelo_saldo](funcoes.md#f-fn_recebimento_status_pelo_saldo)
  - `trg_recebimento_segregacao_guard` — BEFORE INSERT/UPDATE → [recebimento_segregacao_guard](funcoes.md#f-recebimento_segregacao_guard)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [recebimentos](tabelas.md#t-recebimentos) → [fn_recebimento_da_entrada](funcoes.md#f-fn_recebimento_da_entrada) → [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
  - 1. [recebimentos](tabelas.md#t-recebimentos) → [fn_recebimento_da_entrada](funcoes.md#f-fn_recebimento_da_entrada) → [produtos_custo](tabelas.md#t-produtos_custo)
  - 1. [recebimentos](tabelas.md#t-recebimentos) → [fn_recebimento_da_entrada](funcoes.md#f-fn_recebimento_da_entrada) → [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra)
  - 1. [recebimentos](tabelas.md#t-recebimentos) → [fn_recebimento_fecha_pedido](funcoes.md#f-fn_recebimento_fecha_pedido) → [pedidos](tabelas.md#t-pedidos)
  - 1. [recebimentos](tabelas.md#t-recebimentos) → [fn_recebimento_inativo_estorna_entrada](funcoes.md#f-fn_recebimento_inativo_estorna_entrada) → [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
  - 1. [recebimentos](tabelas.md#t-recebimentos) → [fn_recebimento_inativo_estorna_entrada](funcoes.md#f-fn_recebimento_inativo_estorna_entrada) → [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto) → [produtos](tabelas.md#t-produtos)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque) → [consumos_material](tabelas.md#t-consumos_material)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao) → [consumos_material](tabelas.md#t-consumos_material)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao) → [consumos_material](tabelas.md#t-consumos_material)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada) → [produtos_custo](tabelas.md#t-produtos_custo)
- **Ao apagar uma linha daqui:** [devolucoes_fornecedor](tabelas.md#t-devolucoes_fornecedor).recebimento_id APAGA JUNTO (CASCADE); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque).recebimento_id zera o vínculo (SET NULL); [produto_unidades](tabelas.md#t-produto_unidades).recebimento_id zera o vínculo (SET NULL); [vencimentos_estoque](tabelas.md#t-vencimentos_estoque).recebimento_id zera o vínculo (SET NULL)
- **Aponta para:** pedido_id → [pedidos](tabelas.md#t-pedidos)
- **RLS:** ALL `estoque_all` (setores: estoque, logistica · gerente da filial · Matriz/professor)

<a id="t-redes_sociais_links"></a>
## redes_sociais_links

- **Telas que gravam:** [Marketing › Redes Sociais](telas.md#s-marketing-redessociais)
- **RPCs que gravam:** —
- **Telas que leem:** [Marketing › Redes Sociais](telas.md#s-marketing-redessociais)
- **RLS:** INSERT `redes_links_insert` (setores: admin, ceo); SELECT `redes_links_select` (regra própria); UPDATE `redes_links_update` (setores: admin, ceo)

<a id="t-relatorios_bi"></a>
## relatorios_bi

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Servidor (api/) grava:** `api/ai-bi.ts`
- **Telas que leem:** [Matriz › Painel de BI](telas.md#s-painel-bi)
- **Servidor (api/) lê:** `api/ai-bi.ts`
- **RLS:** DELETE `relatorios_bi_delete` (Matriz/professor); INSERT `relatorios_bi_insert` (gerente da filial · Matriz/professor); SELECT `relatorios_bi_read` (Matriz/professor)

<a id="t-requerimentos"></a>
## requerimentos

- **Telas que gravam:** [Feedback & Requerimentos](telas.md#s-feedback-org)
- **RPCs que gravam:** —
- **Telas que leem:** [Feedback & Requerimentos](telas.md#s-feedback-org)
- **RPCs que leem:** [minha_mesa](funcoes.md#f-minha_mesa)
- **Aponta para:** criado_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `requerimentos_delete` (setores: admin, ceo); INSERT `requerimentos_insert` (o próprio usuário); SELECT `requerimentos_select` (setores: admin, ceo, conselheiro · gerente da filial); UPDATE `requerimentos_update` (setores: admin, ceo, conselheiro · gerente da filial)

<a id="t-requisicao_ciencia"></a>
## requisicao_ciencia

- **Telas que gravam:** —
- **RPCs que gravam:** [dar_ciencia_requisicao](funcoes.md#f-dar_ciencia_requisicao)
- **Telas que leem:** —
- **Aponta para:** requisicao_id → [requisicoes](tabelas.md#t-requisicoes); user_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `ciencia_req_select` (o próprio usuário)

<a id="t-requisicao_estoque_ciencia"></a>
## requisicao_estoque_ciencia

- **Telas que gravam:** —
- **RPCs que gravam:** [dar_ciencia_requisicao_estoque](funcoes.md#f-dar_ciencia_requisicao_estoque)
- **Telas que leem:** —
- **Aponta para:** requisicao_estoque_id → [requisicoes_estoque](tabelas.md#t-requisicoes_estoque); user_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `ciencia_req_estoque_select` (o próprio usuário)

<a id="t-requisicoes"></a>
## requisicoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **RPCs que gravam:** [cancelar_pedido_compra](funcoes.md#f-cancelar_pedido_compra), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [criar_requisicao_compra](funcoes.md#f-criar_requisicao_compra), [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [devolver_requisicao_para_correcao](funcoes.md#f-devolver_requisicao_para_correcao), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao), [reenviar_requisicao_corrigida](funcoes.md#f-reenviar_requisicao_corrigida), [vincular_produto_requisicao](funcoes.md#f-vincular_produto_requisicao)
- **Telas que leem:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Gerenciamento](telas.md#s-compras-gerenciamento), [Compras › Pedidos](telas.md#s-compras-pedidos), [Compras › Relatórios](telas.md#s-compras-relatórios), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **RPCs que leem:** [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo), [contar_pendencias](funcoes.md#f-contar_pendencias), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [dar_ciencia_requisicao](funcoes.md#f-dar_ciencia_requisicao), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [devolver_requisicao_para_correcao](funcoes.md#f-devolver_requisicao_para_correcao), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [listar_pendencias](funcoes.md#f-listar_pendencias), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [minha_mesa](funcoes.md#f-minha_mesa), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao), [reenviar_requisicao_corrigida](funcoes.md#f-reenviar_requisicao_corrigida), [vincular_produto_requisicao](funcoes.md#f-vincular_produto_requisicao)
- **Gatilhos nesta tabela:**
  - `trg_aprovacao_segue_requisicao` — AFTER UPDATE → [aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao) · grava em [aprovacoes_compras](tabelas.md#t-aprovacoes_compras)
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_embalagem_coerente` — BEFORE UPDATE → [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_numero_requisicao` — BEFORE INSERT → [set_numero_requisicao](funcoes.md#f-set_numero_requisicao) · grava em [documento_sequencias](tabelas.md#t-documento_sequencias)
  - `trg_requisicao_decisao_guard` — BEFORE UPDATE → [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard)
  - `trg_requisicao_marca_reenvio` — BEFORE UPDATE → [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio)
  - `trg_sem_exclusao` — BEFORE UPDATE → [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [requisicoes](tabelas.md#t-requisicoes) → [aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao) → [aprovacoes_compras](tabelas.md#t-aprovacoes_compras)
- **Ao apagar uma linha daqui:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras).requisicao_id APAGA JUNTO (CASCADE); [cotacoes](tabelas.md#t-cotacoes).requisicao_id zera o vínculo (SET NULL); [pedidos](tabelas.md#t-pedidos).requisicao_id zera o vínculo (SET NULL); [requisicao_ciencia](tabelas.md#t-requisicao_ciencia).requisicao_id APAGA JUNTO (CASCADE)
- **Aponta para:** produto_id → [produtos](tabelas.md#t-produtos); servico_id → [servicos](tabelas.md#t-servicos); correcao_solicitada_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `compras_delete` (Matriz/professor); SELECT `compras_select` (setores: compras, financeiro, logistica · gerente da filial · Matriz/professor); UPDATE `compras_update` (setores: compras · gerente da filial · Matriz/professor)

<a id="t-requisicoes_estoque"></a>
## requisicoes_estoque

- **Telas que gravam:** [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial)
- **Telas que gravam via RPC:** [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **RPCs que gravam:** [criar_requisicao_estoque](funcoes.md#f-criar_requisicao_estoque), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque), [reenviar_requisicao_estoque_corrigida](funcoes.md#f-reenviar_requisicao_estoque_corrigida)
- **Telas que leem:** [Estoque › Expedição](telas.md#s-estoque-expedição), [Estoque › Gerenciamento](telas.md#s-estoque-gerenciamento), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **RPCs que leem:** [contar_pendencias](funcoes.md#f-contar_pendencias), [dar_ciencia_requisicao_estoque](funcoes.md#f-dar_ciencia_requisicao_estoque), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [expedir](funcoes.md#f-expedir), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [minha_mesa](funcoes.md#f-minha_mesa), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque), [reenviar_requisicao_estoque_corrigida](funcoes.md#f-reenviar_requisicao_estoque_corrigida)
- **Gatilhos nesta tabela:**
  - `trg_aprovacao_estoque_segue_requisicao` — AFTER UPDATE → [aprovacao_estoque_segue_a_requisicao](funcoes.md#f-aprovacao_estoque_segue_a_requisicao) · grava em [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque)
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_requisicao_estoque_decisao_guard` — BEFORE UPDATE → [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard)
  - `trg_requisicao_estoque_marca_reenvio` — BEFORE UPDATE → [requisicao_estoque_marca_reenvio](funcoes.md#f-requisicao_estoque_marca_reenvio)
  - `trg_sem_exclusao` — BEFORE UPDATE → [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [requisicoes_estoque](tabelas.md#t-requisicoes_estoque) → [aprovacao_estoque_segue_a_requisicao](funcoes.md#f-aprovacao_estoque_segue_a_requisicao) → [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque)
- **Ao apagar uma linha daqui:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque).requisicao_estoque_id APAGA JUNTO (CASCADE); [consumos_material](tabelas.md#t-consumos_material).requisicao_estoque_id APAGA JUNTO (CASCADE); [expedicao](tabelas.md#t-expedicao).requisicao_id zera o vínculo (SET NULL); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque).requisicao_estoque_id zera o vínculo (SET NULL); [requisicao_estoque_ciencia](tabelas.md#t-requisicao_estoque_ciencia).requisicao_estoque_id APAGA JUNTO (CASCADE)
- **Aponta para:** centro_custo_id → [centros_custo](tabelas.md#t-centros_custo); produto_id → [produtos](tabelas.md#t-produtos); correcao_solicitada_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `logist_delete` (setores: logistica · gerente da filial · Matriz/professor); SELECT `logist_select` (setores: logistica · gerente da filial · Matriz/professor); UPDATE `logist_update` (setores: logistica · gerente da filial · Matriz/professor)

<a id="t-rescisoes"></a>
## rescisoes

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **RPCs que gravam:** [pagar_rescisao](funcoes.md#f-pagar_rescisao), [processar_rescisao](funcoes.md#f-processar_rescisao), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario), [rescisao_gravar](funcoes.md#f-rescisao_gravar)
- **Gatilhos (de outras tabelas) que gravam aqui:** [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao) (em [contas_pagar](tabelas.md#t-contas_pagar))
- **Telas que leem:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **RPCs que leem:** [creditar_rescisao_maxbank](funcoes.md#f-creditar_rescisao_maxbank), [pagar_rescisao](funcoes.md#f-pagar_rescisao), [processar_rescisao](funcoes.md#f-processar_rescisao), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario)
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [contas_pagar](tabelas.md#t-contas_pagar).rescisao_id zera o vínculo (SET NULL)
- **Aponta para:** demissao_id → [demissoes](tabelas.md#t-demissoes); funcionario_id → [funcionarios](tabelas.md#t-funcionarios)
- **RLS:** SELECT `rescisoes_select` (setores: financeiro, rh · gerente da filial · Matriz/professor)

<a id="t-rh_faixas"></a>
## rh_faixas

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RPCs que leem:** [rh_calc_inss](funcoes.md#f-rh_calc_inss), [rh_calc_irrf](funcoes.md#f-rh_calc_irrf)
- **RLS:** ALL `rh_faixas_write` (setores: admin, ceo); SELECT `rh_faixas_select` (todos)

<a id="t-rh_parametros"></a>
## rh_parametros

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RPCs que leem:** [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [rh_calc_irrf](funcoes.md#f-rh_calc_irrf), [rh_vigencia_em](funcoes.md#f-rh_vigencia_em)
- **RLS:** ALL `rh_parametros_write` (setores: admin, ceo); SELECT `rh_parametros_select` (todos)

<a id="t-risco_revisoes"></a>
## risco_revisoes

- **Telas que gravam:** —
- **RPCs que gravam:** [revisar_risco](funcoes.md#f-revisar_risco)
- **Telas que leem:** —
- **Aponta para:** risco_id → [riscos](tabelas.md#t-riscos)
- **RLS:** SELECT `risco_revisoes_read` (regra própria)

<a id="t-riscos"></a>
## riscos

- **Telas que gravam:** —
- **RPCs que gravam:** [revisar_risco](funcoes.md#f-revisar_risco)
- **Telas que leem:** —
- **RPCs que leem:** [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [revisar_risco](funcoes.md#f-revisar_risco)
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [risco_revisoes](tabelas.md#t-risco_revisoes).risco_id APAGA JUNTO (CASCADE)
- **Aponta para:** dono_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** ALL `riscos_write` (Matriz/professor); SELECT `riscos_read` (Matriz/professor)

<a id="t-senhas_visiveis"></a>
## senhas_visiveis

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Servidor (api/) grava:** `api/users.ts`
- **Telas que leem:** [Usuários](telas.md#s-usuarios)
- **RLS:** SELECT `senhas_visiveis_select_admin` (regra própria)

<a id="t-servicos"></a>
## servicos

- **Telas que gravam:** [Cadastros › Serviços](telas.md#s-cadastros-serviços)
- **RPCs que gravam:** —
- **Telas que leem:** [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Compras › Cotações](telas.md#s-compras-cotações), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Marketing › Promoções](telas.md#s-marketing-promoções), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que leem:** [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [parametros_precificacao](funcoes.md#f-parametros_precificacao)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_carimba_exclusao` — BEFORE UPDATE → [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao)
- **Ao apagar uma linha daqui:** [itens_devolucao](tabelas.md#t-itens_devolucao).servico_id zera o vínculo (SET NULL); [itens_venda](tabelas.md#t-itens_venda).servico_id zera o vínculo (SET NULL); [pedidos](tabelas.md#t-pedidos).servico_id bloqueia (NO ACTION); [requisicoes](tabelas.md#t-requisicoes).servico_id bloqueia (NO ACTION)
- **RLS:** ALL `write_servicos` (setores: logistica · gerente da filial · Matriz/professor); SELECT `read_servicos` (qualquer um da própria filial · Matriz/professor)

<a id="t-subcategorias_produto"></a>
## subcategorias_produto

- **Telas que gravam:** [Cadastros › Categorias](telas.md#s-cadastros-categorias)
- **RPCs que gravam:** [aplicar_taxonomia_padrao](funcoes.md#f-aplicar_taxonomia_padrao)
- **Telas que leem:** [Cadastros › Categorias](telas.md#s-cadastros-categorias), [Cadastros › Fornecedores](telas.md#s-cadastros-fornecedores), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Marketing › Campanhas](telas.md#s-marketing-campanhas), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Vendas › Clientes](telas.md#s-vendas-clientes)
- **RPCs que leem:** [aplicar_taxonomia_padrao](funcoes.md#f-aplicar_taxonomia_padrao)
- **Gatilhos nesta tabela:**
  - `trg_carimba_exclusao` — BEFORE UPDATE → [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao)
  - `trg_taxonomia_padrao_protege` — BEFORE INSERT/UPDATE/DELETE → [fn_taxonomia_padrao_protege](funcoes.md#f-fn_taxonomia_padrao_protege)
- **Ao apagar uma linha daqui:** [produtos](tabelas.md#t-produtos).subcategoria_id zera o vínculo (SET NULL)
- **Aponta para:** categoria_id → [categorias_produto](tabelas.md#t-categorias_produto)
- **RLS:** ALL `subcategorias_write` (setores: compras, logistica · gerente da filial · Matriz/professor); SELECT `subcategorias_select` (Matriz/professor)

<a id="t-tarefas"></a>
## tarefas

- **Telas que gravam:** [Matriz › Briefing Diário](telas.md#s-briefing-diario)
- **RPCs que gravam:** [descartar_tarefa_briefing](funcoes.md#f-descartar_tarefa_briefing), [editar_tarefa_briefing](funcoes.md#f-editar_tarefa_briefing), [encerrar_revisao_auditoria](funcoes.md#f-encerrar_revisao_auditoria), [excluir_briefing_cascade](funcoes.md#f-excluir_briefing_cascade)
- **Telas que leem:** —
- **Aponta para:** briefing_id → [briefings_diarios](tabelas.md#t-briefings_diarios)
- **RLS:** ALL `tarefas_write` (Matriz/professor); SELECT `tarefas_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-tarefas_taticas"></a>
## tarefas_taticas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **RPCs que gravam:** [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [aprovar_tarefa_tatica](funcoes.md#f-aprovar_tarefa_tatica), [concluir_tarefa_tatica](funcoes.md#f-concluir_tarefa_tatica), [criar_tarefa_tatica](funcoes.md#f-criar_tarefa_tatica), [encerrar_tarefa_tatica](funcoes.md#f-encerrar_tarefa_tatica), [pausar_tarefa_tatica](funcoes.md#f-pausar_tarefa_tatica), [publicar_tarefa_tatica](funcoes.md#f-publicar_tarefa_tatica), [reabrir_tarefa_tatica](funcoes.md#f-reabrir_tarefa_tatica), [rejeitar_tarefa_tatica](funcoes.md#f-rejeitar_tarefa_tatica)
- **Telas que leem:** —
- **RPCs que leem:** [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [aprovar_tarefa_tatica](funcoes.md#f-aprovar_tarefa_tatica), [concluir_tarefa_tatica](funcoes.md#f-concluir_tarefa_tatica), [editar_meta_estrategica](funcoes.md#f-editar_meta_estrategica), [encerrar_tarefa_tatica](funcoes.md#f-encerrar_tarefa_tatica), [pausar_tarefa_tatica](funcoes.md#f-pausar_tarefa_tatica), [publicar_tarefa_tatica](funcoes.md#f-publicar_tarefa_tatica), [reabrir_tarefa_tatica](funcoes.md#f-reabrir_tarefa_tatica), [rejeitar_tarefa_tatica](funcoes.md#f-rejeitar_tarefa_tatica)
- **Gatilhos nesta tabela:**
  - `trg_tarefas_taticas_updated_at` — BEFORE UPDATE → [tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at)
- **Aponta para:** meta_estrategica_id → [metas_estrategicas](tabelas.md#t-metas_estrategicas); colaborador_id → [user_profiles](tabelas.md#t-user_profiles); criada_por → [user_profiles](tabelas.md#t-user_profiles); aprovada_por → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** SELECT `tarefas_taticas_read` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-taxonomia_padrao"></a>
## taxonomia_padrao

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RPCs que leem:** [aplicar_taxonomia_padrao](funcoes.md#f-aplicar_taxonomia_padrao)
- **RLS:** SELECT `taxonomia_padrao_select` (todos)

<a id="t-ti_chamados"></a>
## ti_chamados

- **Telas que gravam:** —
- **RPCs que gravam:** —
- **Telas que leem:** —
- **RLS:** DELETE `ti_chamados_delete` (Matriz/professor); INSERT `ti_chamados_write` (o próprio usuário); SELECT `ti_chamados_read` (setores: ti · Matriz/professor); UPDATE `ti_chamados_modify` (setores: ti · Matriz/professor)

<a id="t-ti_relogio_maquinas"></a>
## ti_relogio_maquinas

- **Telas que gravam:** [TI & Suporte › Relógiodasmáquinas *(rota ti-relógiodasmáquinas)*](telas.md#s-ti-relógiodasmáquinas)
- **RPCs que gravam:** [registrar_relogio_maquina](funcoes.md#f-registrar_relogio_maquina)
- **Telas que leem:** [TI & Suporte › Relógiodasmáquinas *(rota ti-relógiodasmáquinas)*](telas.md#s-ti-relógiodasmáquinas)
- **Aponta para:** ultimo_usuario_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `ti_relogio_apaga_admin` (regra própria); SELECT `ti_relogio_leitura_matriz` (Matriz/professor)

<a id="t-trabalho_reservas"></a>
## trabalho_reservas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Modo Aula](telas.md#s-aula-modo), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **RPCs que gravam:** [liberar_trabalho](funcoes.md#f-liberar_trabalho), [liberar_trabalho_forcado](funcoes.md#f-liberar_trabalho_forcado), [renovar_trabalho](funcoes.md#f-renovar_trabalho), [reservar_trabalho](funcoes.md#f-reservar_trabalho)
- **Telas que leem:** [Modo Aula](telas.md#s-aula-modo), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **RPCs que leem:** [reservar_trabalho](funcoes.md#f-reservar_trabalho)
- **Telas escutando em tempo real:** [Modo Aula](telas.md#s-aula-modo), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **RLS:** SELECT `trabalho_reservas_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-treinamento_inscricoes"></a>
## treinamento_inscricoes

- **Telas que gravam:** [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos)
- **RPCs que gravam:** —
- **Telas que leem:** [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos)
- **Gatilhos nesta tabela:**
  - `treinamento_inscricoes_updated_at` — BEFORE UPDATE → [trg_treinamento_inscricoes_updated_at](funcoes.md#f-trg_treinamento_inscricoes_updated_at)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios); treinamento_id → [treinamentos](tabelas.md#t-treinamentos)
- **RLS:** DELETE `inscricoes_delete` (setores: rh · gerente da filial · Matriz/professor); INSERT `inscricoes_insert` (setores: rh · gerente da filial · Matriz/professor); SELECT `inscricoes_read` (setores: rh · gerente da filial · Matriz/professor); UPDATE `inscricoes_update` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-treinamentos"></a>
## treinamentos

- **Telas que gravam:** [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos)
- **RPCs que gravam:** —
- **Telas que leem:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Gerenciamento](telas.md#s-rh-gerenciamento), [Recursos Humanos › Relatórios](telas.md#s-rh-relatórios), [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos)
- **RPCs que leem:** [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [pdi_itens](tabelas.md#t-pdi_itens).treinamento_id zera o vínculo (SET NULL); [treinamento_inscricoes](tabelas.md#t-treinamento_inscricoes).treinamento_id APAGA JUNTO (CASCADE)
- **RLS:** ALL `trein_rh_write` (setores: rh · gerente da filial · Matriz/professor); SELECT `trein_read` (qualquer um da própria filial · Matriz/professor)

<a id="t-user_profiles"></a>
## user_profiles

- **Telas que gravam:** [Usuários](telas.md#s-usuarios)
- **Telas que gravam via RPC:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos)
- **RPCs que gravam:** [_aplicar_desligado_em](funcoes.md#f-_aplicar_desligado_em), [atualizar_foto_usuario](funcoes.md#f-atualizar_foto_usuario), [encerrar_mandato](funcoes.md#f-encerrar_mandato), [nomear_mandato](funcoes.md#f-nomear_mandato), [resetar_geral_admin](funcoes.md#f-resetar_geral_admin)
- **Servidor (api/) grava:** `api/users.ts`
- **Telas que leem:** [Análise com IA](telas.md#s-analise-ia), [Atividade da aula](telas.md#s-aula-atividade), [Modo Aula](telas.md#s-aula-modo), [Central de Avaliação](telas.md#s-avaliacoes), [Matriz › Briefing Diário](telas.md#s-briefing-diario), [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Catálogo](telas.md#s-catalogo-produtos), [Central tempo *(rota central-tempo)*](telas.md#s-central-tempo), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Contratos](telas.md#s-contratos), [Crachá Virtual](telas.md#s-cracha-virtual), [Dashboard](telas.md#s-dashboard), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Documentos](telas.md#s-documentos), [Empresa › Filiais](telas.md#s-empresa-filiais), [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Movimentações](telas.md#s-estoque-movimentações), [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Feedback & Requerimentos](telas.md#s-feedback-org), [Financeiro › Alçadas](telas.md#s-financeiro-alçadas), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha), [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Financeiro › Gerenciamento](telas.md#s-financeiro-gerenciamento), [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo), [Financeiro › Recibos de Vendas](telas.md#s-financeiro-recibosdevendas), [Início](telas.md#s-inicio), [Marketing › Calendário](telas.md#s-marketing-calendário), [Marketing › Campanhas](telas.md#s-marketing-campanhas), [Marketing › Cupons](telas.md#s-marketing-cupons), [Marketing › Promoções](telas.md#s-marketing-promoções), [Marketing › Redes Sociais](telas.md#s-marketing-redessociais), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Capital](telas.md#s-matriz-capital), [Competição](telas.md#s-matriz-competicao), [Conteúdo](telas.md#s-matriz-conteudo), [Max Show](telas.md#s-max-show), [Max work show *(rota max-work-show)*](telas.md#s-max-work-show), [Mesa gestor *(rota mesa-gestor)*](telas.md#s-mesa-gestor), [Metas *(rota metas)*](telas.md#s-metas), [Meu Crachá](telas.md#s-meu-cracha), [Minhas pesquisas *(rota minhas-pesquisas)*](telas.md#s-minhas-pesquisas), [Matriz › Painel de BI](telas.md#s-painel-bi), [Pendências](telas.md#s-pendencias), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor), [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos), [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento), [Recursos Humanos › Férias](telas.md#s-rh-férias), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Recursos Humanos › Funcionários](telas.md#s-rh-funcionários), [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos), [Recursos Humanos › Pesquisas](telas.md#s-rh-pesquisas), [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto), [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos), [Sessões Gerais](telas.md#s-sessoes-gerais), [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia), [TI & Suporte › Relógiodasmáquinas *(rota ti-relógiodasmáquinas)*](telas.md#s-ti-relógiodasmáquinas), [Usuários](telas.md#s-usuarios), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
- **RPCs que leem:** [_aplicar_desligado_em](funcoes.md#f-_aplicar_desligado_em), [_assert_ciclo_tarefa_avaliador](funcoes.md#f-_assert_ciclo_tarefa_avaliador), [_assert_ciclo_tarefa_gestor](funcoes.md#f-_assert_ciclo_tarefa_gestor), [_assert_matriz_admin](funcoes.md#f-_assert_matriz_admin), [_assert_matriz_tarefa_gestor](funcoes.md#f-_assert_matriz_tarefa_gestor), [_assert_pode_avaliar_ciclo_tarefa](funcoes.md#f-_assert_pode_avaliar_ciclo_tarefa), [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [_competicao_votos_validos](funcoes.md#f-_competicao_votos_validos), [_funcionario_da_conta](funcoes.md#f-_funcionario_da_conta), [_funcionario_desligado](funcoes.md#f-_funcionario_desligado), [_maxbank_pode_reverter](funcoes.md#f-_maxbank_pode_reverter), [_pendencia_responsaveis](funcoes.md#f-_pendencia_responsaveis), [abrir_vaga](funcoes.md#f-abrir_vaga), [abrir_vaga_interna](funcoes.md#f-abrir_vaga_interna), [alternar_simulacao_perda](funcoes.md#f-alternar_simulacao_perda), [analisar_promocao_financeiro](funcoes.md#f-analisar_promocao_financeiro), [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [apagar_meta_estrategica](funcoes.md#f-apagar_meta_estrategica), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [aplicar_rateio_administrativo](funcoes.md#f-aplicar_rateio_administrativo), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [aprovar_meta_maxbank](funcoes.md#f-aprovar_meta_maxbank), [aprovar_tarefa_tatica](funcoes.md#f-aprovar_tarefa_tatica), [assinar_contrato](funcoes.md#f-assinar_contrato), [atualizar_avaliacao](funcoes.md#f-atualizar_avaliacao), [atualizar_foto_usuario](funcoes.md#f-atualizar_foto_usuario), [auditar_fluxo_compras](funcoes.md#f-auditar_fluxo_compras), [auth_aula_setores](funcoes.md#f-auth_aula_setores), [auth_desligado](funcoes.md#f-auth_desligado), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_conselho](funcoes.md#f-auth_is_conselho), [auth_registra_frequencia](funcoes.md#f-auth_registra_frequencia), [auth_user_filial](funcoes.md#f-auth_user_filial), [auth_user_role](funcoes.md#f-auth_user_role), [auth_user_setor](funcoes.md#f-auth_user_setor), [auth_user_setores](funcoes.md#f-auth_user_setores), [avaliar_item_matriz](funcoes.md#f-avaliar_item_matriz), [buscar_destinatario_pix](funcoes.md#f-buscar_destinatario_pix), [calcular_placar_competicao](funcoes.md#f-calcular_placar_competicao), [calcular_placar_padrao](funcoes.md#f-calcular_placar_padrao), [cancelar_pedido_online](funcoes.md#f-cancelar_pedido_online), [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo), [conceder_mutuo_capital](funcoes.md#f-conceder_mutuo_capital), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica), [confirmar_fechamento_caixa](funcoes.md#f-confirmar_fechamento_caixa), [confirmar_pedido_online](funcoes.md#f-confirmar_pedido_online), [contar_votantes_matriz](funcoes.md#f-contar_votantes_matriz), [contrato_representa](funcoes.md#f-contrato_representa), [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [criar_aviso_matriz](funcoes.md#f-criar_aviso_matriz), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [criar_matriz_tarefa](funcoes.md#f-criar_matriz_tarefa), [criar_meta_estrategica](funcoes.md#f-criar_meta_estrategica), [criar_meta_maxbank](funcoes.md#f-criar_meta_maxbank), [criar_requisicao_compra](funcoes.md#f-criar_requisicao_compra), [criar_requisicao_estoque](funcoes.md#f-criar_requisicao_estoque), [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote), [criar_tarefa_tatica](funcoes.md#f-criar_tarefa_tatica), [dar_ciencia_atividade](funcoes.md#f-dar_ciencia_atividade), [dar_ciencia_aviso](funcoes.md#f-dar_ciencia_aviso), [dar_feedback_arte](funcoes.md#f-dar_feedback_arte), [decidir_desligamento](funcoes.md#f-decidir_desligamento), [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [decidir_vaga](funcoes.md#f-decidir_vaga), [definir_avaliadores_ciclo_tarefa](funcoes.md#f-definir_avaliadores_ciclo_tarefa), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [descartar_tarefa_briefing](funcoes.md#f-descartar_tarefa_briefing), [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial), [documento_alcanca](funcoes.md#f-documento_alcanca), [documento_pode_emitir](funcoes.md#f-documento_pode_emitir), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [editar_meta_estrategica](funcoes.md#f-editar_meta_estrategica), [editar_tarefa_briefing](funcoes.md#f-editar_tarefa_briefing), [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin), [encerrar_contrato](funcoes.md#f-encerrar_contrato), [encerrar_mandato](funcoes.md#f-encerrar_mandato), [encerrar_meta_estrategica](funcoes.md#f-encerrar_meta_estrategica), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [encerrar_tarefa_tatica](funcoes.md#f-encerrar_tarefa_tatica), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [estornar_aporte_capital](funcoes.md#f-estornar_aporte_capital), [excluir_briefing_cascade](funcoes.md#f-excluir_briefing_cascade), [fechar_caixa_conferido](funcoes.md#f-fechar_caixa_conferido), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [frequencia_filiais_competicao](funcoes.md#f-frequencia_filiais_competicao), [liberar_ciclo_tarefa](funcoes.md#f-liberar_ciclo_tarefa), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [liberar_trabalho_forcado](funcoes.md#f-liberar_trabalho_forcado), [listar_pendencias](funcoes.md#f-listar_pendencias), [listar_pessoas_treinamento_ia](funcoes.md#f-listar_pessoas_treinamento_ia), [listar_vitrine_candidatos](funcoes.md#f-listar_vitrine_candidatos), [lixeira_listar](funcoes.md#f-lixeira_listar), [mapa_fluxo_compras](funcoes.md#f-mapa_fluxo_compras), [marcar_acesso_ajustado](funcoes.md#f-marcar_acesso_ajustado), [marcar_documento_lido](funcoes.md#f-marcar_documento_lido), [marcar_tarefa_aula](funcoes.md#f-marcar_tarefa_aula), [marcar_vitrine](funcoes.md#f-marcar_vitrine), [max_work_is_docente](funcoes.md#f-max_work_is_docente), [media_participantes_ciclo](funcoes.md#f-media_participantes_ciclo), [media_participantes_competicao](funcoes.md#f-media_participantes_competicao), [minha_frequencia](funcoes.md#f-minha_frequencia), [minha_mesa](funcoes.md#f-minha_mesa), [mover_candidatura](funcoes.md#f-mover_candidatura), [negar_emprestimo](funcoes.md#f-negar_emprestimo), [nomear_mandato](funcoes.md#f-nomear_mandato), [parecer_justificativa_falta](funcoes.md#f-parecer_justificativa_falta), [participantes_sem_nota_competicao](funcoes.md#f-participantes_sem_nota_competicao), [pausar_meta_estrategica](funcoes.md#f-pausar_meta_estrategica), [pausar_tarefa_tatica](funcoes.md#f-pausar_tarefa_tatica), [perfil_filial](funcoes.md#f-perfil_filial), [progresso_avaliacao_matriz](funcoes.md#f-progresso_avaliacao_matriz), [progresso_votacao_competicao](funcoes.md#f-progresso_votacao_competicao), [publicar_atividade_aula](funcoes.md#f-publicar_atividade_aula), [publicar_documento](funcoes.md#f-publicar_documento), [publicar_meta_estrategica](funcoes.md#f-publicar_meta_estrategica), [publicar_tarefa_tatica](funcoes.md#f-publicar_tarefa_tatica), [reabrir_caixa](funcoes.md#f-reabrir_caixa), [reabrir_meta_estrategica](funcoes.md#f-reabrir_meta_estrategica), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque), [reabrir_tarefa_tatica](funcoes.md#f-reabrir_tarefa_tatica), [recusar_contrato](funcoes.md#f-recusar_contrato), [registrar_aporte_capital](funcoes.md#f-registrar_aporte_capital), [registrar_candidatura](funcoes.md#f-registrar_candidatura), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [registrar_movimentacao_caixa](funcoes.md#f-registrar_movimentacao_caixa), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [registrar_relogio_maquina](funcoes.md#f-registrar_relogio_maquina), [registrar_voto](funcoes.md#f-registrar_voto), [rejeitar_meta_maxbank](funcoes.md#f-rejeitar_meta_maxbank), [rejeitar_tarefa_tatica](funcoes.md#f-rejeitar_tarefa_tatica), [remover_avaliacao_matriz](funcoes.md#f-remover_avaliacao_matriz), [reservar_trabalho](funcoes.md#f-reservar_trabalho), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais), [resetar_geral_admin](funcoes.md#f-resetar_geral_admin), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [responder_pesquisa](funcoes.md#f-responder_pesquisa), [revisar_risco](funcoes.md#f-revisar_risco), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda), [set_maxbank_threshold](funcoes.md#f-set_maxbank_threshold), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento), [solicitar_fechamento_caixa](funcoes.md#f-solicitar_fechamento_caixa), [suspender_caixa](funcoes.md#f-suspender_caixa), [transferir_pix_maxbank](funcoes.md#f-transferir_pix_maxbank), [usuarios_visiveis_para_auditoria](funcoes.md#f-usuarios_visiveis_para_auditoria), [vincular_acesso_funcionario](funcoes.md#f-vincular_acesso_funcionario)
- **Servidor (api/) lê:** `api/ai-aula-atividade.ts`, `api/users.ts`
- **Gatilhos nesta tabela:**
  - `trg_perfil_desligado_sincroniza_tarefas` — AFTER UPDATE → [fn_perfil_desligado_sincroniza_tarefas](funcoes.md#f-fn_perfil_desligado_sincroniza_tarefas) · grava em [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [funcionario_tarefas_suspensas](tabelas.md#t-funcionario_tarefas_suspensas), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
  - `trg_user_profiles_bloquear_privesc` — BEFORE UPDATE → [user_profiles_bloquear_privesc](funcoes.md#f-user_profiles_bloquear_privesc)
  - `trg_user_profiles_conselho_e_da_matriz` — BEFORE INSERT/UPDATE → [fn_conselho_e_da_matriz](funcoes.md#f-fn_conselho_e_da_matriz)
  - `trg_user_profiles_maxbank_conta` — AFTER INSERT → [criar_maxbank_conta_para_colaborador](funcoes.md#f-criar_maxbank_conta_para_colaborador) · grava em [maxbank_contas](tabelas.md#t-maxbank_contas)
  - `trg_user_profiles_propagar_filial` — AFTER INSERT/UPDATE → [user_profiles_propagar_filial](funcoes.md#f-user_profiles_propagar_filial) · grava em [funcionarios](tabelas.md#t-funcionarios)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [user_profiles](tabelas.md#t-user_profiles) → [criar_maxbank_conta_para_colaborador](funcoes.md#f-criar_maxbank_conta_para_colaborador) → [maxbank_contas](tabelas.md#t-maxbank_contas)
  - 1. [user_profiles](tabelas.md#t-user_profiles) → [user_profiles_propagar_filial](funcoes.md#f-user_profiles_propagar_filial) → [funcionarios](tabelas.md#t-funcionarios)
  - 1. [user_profiles](tabelas.md#t-user_profiles) → [fn_perfil_desligado_sincroniza_tarefas](funcoes.md#f-fn_perfil_desligado_sincroniza_tarefas) → [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz)
  - 1. [user_profiles](tabelas.md#t-user_profiles) → [fn_perfil_desligado_sincroniza_tarefas](funcoes.md#f-fn_perfil_desligado_sincroniza_tarefas) → [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
  - 1. [user_profiles](tabelas.md#t-user_profiles) → [fn_perfil_desligado_sincroniza_tarefas](funcoes.md#f-fn_perfil_desligado_sincroniza_tarefas) → [funcionario_tarefas_suspensas](tabelas.md#t-funcionario_tarefas_suspensas)
  - 1. [user_profiles](tabelas.md#t-user_profiles) → [fn_perfil_desligado_sincroniza_tarefas](funcoes.md#f-fn_perfil_desligado_sincroniza_tarefas) → [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes)
  - 1. [user_profiles](tabelas.md#t-user_profiles) → [fn_perfil_desligado_sincroniza_tarefas](funcoes.md#f-fn_perfil_desligado_sincroniza_tarefas) → [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes)
  -   2. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz)
  -   2. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
  -   2. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [funcionario_tarefas_suspensas](tabelas.md#t-funcionario_tarefas_suspensas)
  -   2. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes)
  -   2. [funcionarios](tabelas.md#t-funcionarios) → [fn_funcionario_sincroniza_tarefas](funcoes.md#f-fn_funcionario_sincroniza_tarefas) → [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes)
- **Ao apagar uma linha daqui:** [apuracao_bonus_itens](tabelas.md#t-apuracao_bonus_itens).colaborador_id APAGA JUNTO (CASCADE); [aula_grupo_apoio](tabelas.md#t-aula_grupo_apoio).user_id APAGA JUNTO (CASCADE); [aula_grupo_apoio](tabelas.md#t-aula_grupo_apoio).incluido_por zera o vínculo (SET NULL); [aula_grupo_apoio_config](tabelas.md#t-aula_grupo_apoio_config).atualizado_por zera o vínculo (SET NULL); [aula_sessoes](tabelas.md#t-aula_sessoes).iniciada_por zera o vínculo (SET NULL); [aula_sessoes](tabelas.md#t-aula_sessoes).encerrada_por zera o vínculo (SET NULL); [aula_tarefas_realizadas](tabelas.md#t-aula_tarefas_realizadas).marcado_por zera o vínculo (SET NULL); [aula_tarefas_realizadas](tabelas.md#t-aula_tarefas_realizadas).user_id APAGA JUNTO (CASCADE); [avaliacoes](tabelas.md#t-avaliacoes).avaliador_id APAGA JUNTO (CASCADE); [avaliacoes](tabelas.md#t-avaliacoes).avaliado_id APAGA JUNTO (CASCADE); [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz).avaliador_id APAGA JUNTO (CASCADE); [capital_config](tabelas.md#t-capital_config).criado_por zera o vínculo (SET NULL); [capital_filial](tabelas.md#t-capital_filial).registrado_por zera o vínculo (SET NULL); [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores).user_profile_id APAGA JUNTO (CASCADE); [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes).user_profile_id zera o vínculo (SET NULL); [comandos_turma](tabelas.md#t-comandos_turma).emitido_por zera o vínculo (SET NULL); [contratos](tabelas.md#t-contratos).criado_por zera o vínculo (SET NULL); [contratos_assinaturas](tabelas.md#t-contratos_assinaturas).user_id zera o vínculo (SET NULL); [distribuicoes_lucro](tabelas.md#t-distribuicoes_lucro).decidido_por zera o vínculo (SET NULL); [documentos](tabelas.md#t-documentos).publicado_por zera o vínculo (SET NULL); [documentos_leitura](tabelas.md#t-documentos_leitura).user_id APAGA JUNTO (CASCADE); [emprestimos_filial](tabelas.md#t-emprestimos_filial).solicitado_por zera o vínculo (SET NULL); [emprestimos_filial](tabelas.md#t-emprestimos_filial).aprovado_por zera o vínculo (SET NULL); [evidencias_avaliacao](tabelas.md#t-evidencias_avaliacao).colaborador_id APAGA JUNTO (CASCADE); [funcionarios](tabelas.md#t-funcionarios).user_profile_id zera o vínculo (SET NULL); [mandatos](tabelas.md#t-mandatos).user_profile_id APAGA JUNTO (CASCADE); [maxbank_config](tabelas.md#t-maxbank_config).updated_by zera o vínculo (SET NULL); [maxbank_contas](tabelas.md#t-maxbank_contas).colaborador_id APAGA JUNTO (CASCADE); [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas).colaborador_id APAGA JUNTO (CASCADE); [maxbank_metas](tabelas.md#t-maxbank_metas).colaborador_id APAGA JUNTO (CASCADE); [maxbank_metas](tabelas.md#t-maxbank_metas).criada_por zera o vínculo (SET NULL); [maxbank_metas](tabelas.md#t-maxbank_metas).aprovada_por zera o vínculo (SET NULL); [maxbank_transferencias](tabelas.md#t-maxbank_transferencias).de_colaborador_id APAGA JUNTO (CASCADE); [maxbank_transferencias](tabelas.md#t-maxbank_transferencias).para_colaborador_id APAGA JUNTO (CASCADE); [metas_estrategicas](tabelas.md#t-metas_estrategicas).criada_por zera o vínculo (SET NULL); [metas_estrategicas](tabelas.md#t-metas_estrategicas).concluida_por zera o vínculo (SET NULL); [notas_emitidas](tabelas.md#t-notas_emitidas).criado_por zera o vínculo (SET NULL); [notas_emitidas](tabelas.md#t-notas_emitidas).atualizado_por zera o vínculo (SET NULL); [planilhas_trabalho](tabelas.md#t-planilhas_trabalho).user_id APAGA JUNTO (CASCADE); [prestacao_pareceres](tabelas.md#t-prestacao_pareceres).conselheiro_id APAGA JUNTO (CASCADE); [produtos](tabelas.md#t-produtos).correcao_responsavel_id bloqueia (NO ACTION); [produtos](tabelas.md#t-produtos).correcao_solicitada_por bloqueia (NO ACTION); [rateio_administrativo](tabelas.md#t-rateio_administrativo).criado_por zera o vínculo (SET NULL); [requerimentos](tabelas.md#t-requerimentos).criado_por zera o vínculo (SET NULL); [requisicao_ciencia](tabelas.md#t-requisicao_ciencia).user_id APAGA JUNTO (CASCADE); [requisicao_estoque_ciencia](tabelas.md#t-requisicao_estoque_ciencia).user_id APAGA JUNTO (CASCADE); [requisicoes](tabelas.md#t-requisicoes).correcao_solicitada_por zera o vínculo (SET NULL); [requisicoes_estoque](tabelas.md#t-requisicoes_estoque).correcao_solicitada_por zera o vínculo (SET NULL); [riscos](tabelas.md#t-riscos).dono_id bloqueia (RESTRICT); [tarefas_taticas](tabelas.md#t-tarefas_taticas).colaborador_id APAGA JUNTO (CASCADE); [tarefas_taticas](tabelas.md#t-tarefas_taticas).criada_por zera o vínculo (SET NULL); [tarefas_taticas](tabelas.md#t-tarefas_taticas).aprovada_por zera o vínculo (SET NULL); [ti_relogio_maquinas](tabelas.md#t-ti_relogio_maquinas).ultimo_usuario_id zera o vínculo (SET NULL); [votacoes](tabelas.md#t-votacoes).criador_id zera o vínculo (SET NULL); [votacoes_votos](tabelas.md#t-votacoes_votos).user_id APAGA JUNTO (CASCADE)
- **Aponta para:** funcionario_id → [funcionarios](tabelas.md#t-funcionarios)
- **RLS:** SELECT `up_select_own_or_scope` (qualquer um da própria filial · Matriz/professor); UPDATE `up_update_own_or_admin` (o próprio usuário)

<a id="t-v_campanha_roi"></a>
## v_campanha_roi (view)

- **Telas que leem:** [Marketing › Campanhas](telas.md#s-marketing-campanhas)

<a id="t-v_fornecedor_desempenho"></a>
## v_fornecedor_desempenho (view)

- **Telas que leem:** [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)

<a id="t-v_pedido_saldo"></a>
## v_pedido_saldo (view)

- **Telas que leem:** [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- **RPCs que leem:** [pedido_saldo](funcoes.md#f-pedido_saldo), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor)
- **Views que dependem desta:** [v_pedidos_a_receber](tabelas.md#t-v_pedidos_a_receber)

<a id="t-v_pedidos_a_receber"></a>
## v_pedidos_a_receber (view)

- **Telas que leem:** —
- **RPCs que leem:** [contar_pendencias](funcoes.md#f-contar_pendencias)

<a id="t-v_promocao_vigente"></a>
## v_promocao_vigente (view)

- **Telas que leem:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv)
- **Servidor (api/) lê:** `api/loja.ts`

<a id="t-v_venda_saldo_devolucao"></a>
## v_venda_saldo_devolucao (view)

- **Telas que leem:** [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que leem:** [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda)

<a id="t-vaga_convites"></a>
## vaga_convites

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que gravam:** [cancelar_convite_vaga](funcoes.md#f-cancelar_convite_vaga), [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga)
- **Telas que leem:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que leem:** [cancelar_convite_vaga](funcoes.md#f-cancelar_convite_vaga), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga)
- **Aponta para:** candidatura_id → [candidaturas](tabelas.md#t-candidaturas); funcionario_id → [funcionarios](tabelas.md#t-funcionarios); vaga_id → [vagas](tabelas.md#t-vagas)
- **RLS:** SELECT `vaga_convites_select` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-vagas"></a>
## vagas

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que gravam:** [abrir_vaga](funcoes.md#f-abrir_vaga), [abrir_vaga_interna](funcoes.md#f-abrir_vaga_interna), [cancelar_vaga](funcoes.md#f-cancelar_vaga), [decidir_vaga](funcoes.md#f-decidir_vaga), [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao)
- **Telas que leem:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **RPCs que leem:** [cancelar_vaga](funcoes.md#f-cancelar_vaga), [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [decidir_vaga](funcoes.md#f-decidir_vaga), [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [minha_mesa](funcoes.md#f-minha_mesa), [registrar_candidatura](funcoes.md#f-registrar_candidatura), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga)
- **Gatilhos nesta tabela:**
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao apagar uma linha daqui:** [candidaturas](tabelas.md#t-candidaturas).vaga_id APAGA JUNTO (CASCADE); [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira).vaga_id zera o vínculo (SET NULL); [vaga_convites](tabelas.md#t-vaga_convites).vaga_id APAGA JUNTO (CASCADE)
- **RLS:** SELECT `vagas_select` (setores: rh · gerente da filial · Matriz/professor)

<a id="t-vencimentos_estoque"></a>
## vencimentos_estoque

- **Telas que gravam:** [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Validades](telas.md#s-estoque-validades)
- **RPCs que gravam:** [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [encerrar_lote_consumido](funcoes.md#f-encerrar_lote_consumido), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor)
- **Gatilhos (de outras tabelas) que gravam aqui:** [fn_recebimento_inativo_estorna_entrada](funcoes.md#f-fn_recebimento_inativo_estorna_entrada) (em [recebimentos](tabelas.md#t-recebimentos))
- **Telas que leem:** [Estoque › Gerenciamento](telas.md#s-estoque-gerenciamento), [Estoque › Recebimentos](telas.md#s-estoque-recebimentos), [Estoque › Relatórios](telas.md#s-estoque-relatórios), [Estoque › Validades](telas.md#s-estoque-validades)
- **RPCs que leem:** [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [encerrar_lote_consumido](funcoes.md#f-encerrar_lote_consumido), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Aponta para:** produto_id → [produtos](tabelas.md#t-produtos); recebimento_id → [recebimentos](tabelas.md#t-recebimentos)
- **RLS:** ALL `venc_write` (setores: logistica · gerente da filial · Matriz/professor); SELECT `venc_select` (qualquer um da própria filial · Matriz/professor)

<a id="t-vendas"></a>
## vendas

- **Telas que gravam:** [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › PDV](telas.md#s-vendas-pdv)
- **Telas que gravam via RPC:** [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que gravam:** [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv)
- **Telas que leem:** [Cadastros › Lixeira](telas.md#s-cadastros-lixeira), [Dashboard](telas.md#s-dashboard), [Estoque › Saldos](telas.md#s-estoque-saldos), [Financeiro › Recibos de Vendas](telas.md#s-financeiro-recibosdevendas), [Matriz › Vendas](telas.md#s-relatorio-vendas), [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › Histórico de Vendas](telas.md#s-vendas-históricodevendas), [Vendas › PDV](telas.md#s-vendas-pdv)
- **RPCs que leem:** [_dre_calculo](funcoes.md#f-_dre_calculo), [_receita_servico](funcoes.md#f-_receita_servico), [_receita_simples](funcoes.md#f-_receita_simples), [_simples_rbt12](funcoes.md#f-_simples_rbt12), [_taxa_pelo_mix](funcoes.md#f-_taxa_pelo_mix), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [dinheiro_do_caixa](funcoes.md#f-dinheiro_do_caixa), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [pdv_registrar_credito_misto](funcoes.md#f-pdv_registrar_credito_misto), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Views que dependem desta:** [v_campanha_roi](tabelas.md#t-v_campanha_roi)
- **Gatilhos nesta tabela:**
  - `trg_auditoria` — BEFORE INSERT/UPDATE → [set_auditoria_campos](funcoes.md#f-set_auditoria_campos)
  - `trg_historico` — AFTER INSERT/UPDATE → [registrar_historico](funcoes.md#f-registrar_historico) · grava em [historico_operacoes](tabelas.md#t-historico_operacoes)
  - `trg_venda_cancelada_desfaz` — AFTER UPDATE → [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz) · grava em [contas_receber](tabelas.md#t-contas_receber), [marketing_cupons](tabelas.md#t-marketing_cupons), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produto_unidades](tabelas.md#t-produto_unidades)
  - `trg_venda_de_pedido_so_pelo_pedido` — BEFORE UPDATE → [fn_venda_de_pedido_so_pelo_pedido](funcoes.md#f-fn_venda_de_pedido_so_pelo_pedido)
  - `trg_venda_dinheiro_exige_caixa` — BEFORE INSERT → [fn_venda_dinheiro_exige_caixa](funcoes.md#f-fn_venda_dinheiro_exige_caixa)
  - `trg_venda_fiado_respeita_credito` — BEFORE INSERT → [venda_fiado_respeita_credito](funcoes.md#f-venda_fiado_respeita_credito)
- **Cadeia de gatilhos ao gravar aqui:**
  - 1. [vendas](tabelas.md#t-vendas) → [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz) → [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
  - 1. [vendas](tabelas.md#t-vendas) → [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz) → [produto_unidades](tabelas.md#t-produto_unidades)
  - 1. [vendas](tabelas.md#t-vendas) → [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz) → [contas_receber](tabelas.md#t-contas_receber)
  - 1. [vendas](tabelas.md#t-vendas) → [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz) → [marketing_cupons](tabelas.md#t-marketing_cupons)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto) → [produtos](tabelas.md#t-produtos)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque) → [consumos_material](tabelas.md#t-consumos_material)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao) → [consumos_material](tabelas.md#t-consumos_material)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao) → [consumos_material](tabelas.md#t-consumos_material)
  -   2. [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) → [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada) → [produtos_custo](tabelas.md#t-produtos_custo)
  -   2. [contas_receber](tabelas.md#t-contas_receber) → [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber) → [caixa_bancos](tabelas.md#t-caixa_bancos)
  -   2. [contas_receber](tabelas.md#t-contas_receber) → [_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda) → [pedidos_venda](tabelas.md#t-pedidos_venda)
- **Ao apagar uma linha daqui:** [contas_receber](tabelas.md#t-contas_receber).venda_id zera o vínculo (SET NULL); [devolucoes](tabelas.md#t-devolucoes).venda_id bloqueia (NO ACTION); [itens_venda](tabelas.md#t-itens_venda).venda_id APAGA JUNTO (CASCADE); [notas_emitidas](tabelas.md#t-notas_emitidas).venda_id zera o vínculo (SET NULL); [pedidos_online](tabelas.md#t-pedidos_online).venda_id zera o vínculo (SET NULL); [produto_unidades](tabelas.md#t-produto_unidades).venda_id zera o vínculo (SET NULL); [vendas_pagamentos](tabelas.md#t-vendas_pagamentos).venda_id APAGA JUNTO (CASCADE)
- **Aponta para:** cliente_id → [clientes](tabelas.md#t-clientes); cupom_id → [marketing_cupons](tabelas.md#t-marketing_cupons); pedido_venda_id → [pedidos_venda](tabelas.md#t-pedidos_venda)
- **RLS:** ALL `vendas_write` (setores: vendas · gerente da filial · Matriz/professor); SELECT `vendas_select` (setores: financeiro, vendas · gerente da filial · Matriz/professor)

<a id="t-vendas_pagamentos"></a>
## vendas_pagamentos

- **Telas que gravam:** —
- **Telas que gravam via RPC:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv), [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **RPCs que gravam:** [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv)
- **Telas que leem:** —
- **RPCs que leem:** [_taxa_pelo_mix](funcoes.md#f-_taxa_pelo_mix)
- **Aponta para:** venda_id → [vendas](tabelas.md#t-vendas)
- **RLS:** SELECT `vendas_pagamentos_select` (setores: financeiro, vendas · gerente da filial · Matriz/professor)

<a id="t-vitrine_institucional"></a>
## vitrine_institucional

- **Telas que gravam:** [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
- **RPCs que gravam:** [marcar_vitrine](funcoes.md#f-marcar_vitrine)
- **Telas que leem:** [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
- **RPCs que leem:** [get_vitrine_publica](funcoes.md#f-get_vitrine_publica), [listar_vitrine_candidatos](funcoes.md#f-listar_vitrine_candidatos), [marcar_vitrine](funcoes.md#f-marcar_vitrine)
- **RLS:** DELETE `vitrine_inst_delete` (Matriz/professor); INSERT `vitrine_inst_insert` (Matriz/professor); SELECT `vitrine_inst_read` (Matriz/professor); UPDATE `vitrine_inst_update` (Matriz/professor)

<a id="t-votacoes"></a>
## votacoes

- **Telas que gravam:** —
- **RPCs que gravam:** [registrar_voto](funcoes.md#f-registrar_voto)
- **Telas que leem:** —
- **RPCs que leem:** [registrar_voto](funcoes.md#f-registrar_voto), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial)
- **Ao apagar uma linha daqui:** [votacoes_votos](tabelas.md#t-votacoes_votos).votacao_id APAGA JUNTO (CASCADE)
- **Aponta para:** criador_id → [user_profiles](tabelas.md#t-user_profiles)
- **RLS:** DELETE `votacoes_delete` (setores: admin, ceo); INSERT `votacoes_insert` (setores: admin, ceo, conselheiro · gerente da filial); SELECT `votacoes_select` (todos); UPDATE `votacoes_update` (setores: admin, ceo, conselheiro · gerente da filial)

<a id="t-votacoes_votos"></a>
## votacoes_votos

- **Telas que gravam:** —
- **RPCs que gravam:** [registrar_voto](funcoes.md#f-registrar_voto)
- **Telas que leem:** —
- **RPCs que leem:** [registrar_voto](funcoes.md#f-registrar_voto)
- **Aponta para:** user_id → [user_profiles](tabelas.md#t-user_profiles); votacao_id → [votacoes](tabelas.md#t-votacoes)
- **RLS:** INSERT `votacoes_votos_insert` (o próprio usuário); SELECT `votacoes_votos_select` (todos)
