# Mapa por função do banco (RPC e gatilho)

> **Gerado por `npm run mapa` — não edite à mão.** Rode de novo depois de mexer em tela, RPC, gatilho ou policy; o `git diff` desta pasta mostra a ligação nova.
> Banco lido: `jvqsaccupxkvezriiede` (as 4 turmas são idênticas — `npm run drift`). Detecção estática: SQL dinâmico e endpoint passado por variável não aparecem.

Para cada função: quem a chama (tela, servidor, outra função, gatilho), o que ela grava e lê, e as funções que ela chama.

<a id="f-_ajustar_custo_pela_nota"></a>
## _ajustar_custo_pela_nota (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_cancelar_frete_compra](funcoes.md#f-_cancelar_frete_compra), [conferir_nota_fiscal](funcoes.md#f-conferir_nota_fiscal), [fn_recebimento_da_entrada](funcoes.md#f-fn_recebimento_da_entrada), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra)
- **Grava:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [produtos_custo](tabelas.md#t-produtos_custo)
- **Ao gravar, acorda os gatilhos de:** [produtos_custo](tabelas.md#t-produtos_custo) ([custo_manual_nao_passa_do_preco_de_venda](funcoes.md#f-custo_manual_nao_passa_do_preco_de_venda))
- **Lê:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [contas_pagar](tabelas.md#t-contas_pagar), [fretes_compra](tabelas.md#t-fretes_compra), [fretes_compra_rateio](tabelas.md#t-fretes_compra_rateio), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo), [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-_aplicar_desligado_em"></a>
## _aplicar_desligado_em (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [decidir_desligamento](funcoes.md#f-decidir_desligamento), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario)
- **Grava:** [user_profiles](tabelas.md#t-user_profiles)
- **Ao gravar, acorda os gatilhos de:** [user_profiles](tabelas.md#t-user_profiles) ([criar_maxbank_conta_para_colaborador](funcoes.md#f-criar_maxbank_conta_para_colaborador), [fn_conselho_e_da_matriz](funcoes.md#f-fn_conselho_e_da_matriz), [user_profiles_bloquear_privesc](funcoes.md#f-user_profiles_bloquear_privesc), [user_profiles_propagar_filial](funcoes.md#f-user_profiles_propagar_filial))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role)
- **Liga flags de sessão:** `app.desligamento_rh`

<a id="f-_assert_blackout"></a>
## _assert_blackout (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [total_pendente_contas_pagar](funcoes.md#f-total_pendente_contas_pagar)
- **Grava:** —
- **Chama:** [auth_blackout](funcoes.md#f-auth_blackout), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-_assert_caixa"></a>
## _assert_caixa (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [confirmar_fechamento_caixa](funcoes.md#f-confirmar_fechamento_caixa), [fechar_caixa_conferido](funcoes.md#f-fechar_caixa_conferido), [previa_fechamento_caixa](funcoes.md#f-previa_fechamento_caixa), [registrar_movimentacao_caixa](funcoes.md#f-registrar_movimentacao_caixa), [solicitar_fechamento_caixa](funcoes.md#f-solicitar_fechamento_caixa), [suspender_caixa](funcoes.md#f-suspender_caixa)
- **Grava:** —
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-_assert_capital_holding"></a>
## _assert_capital_holding (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [conceder_mutuo_capital](funcoes.md#f-conceder_mutuo_capital), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial), [estornar_aporte_capital](funcoes.md#f-estornar_aporte_capital), [negar_emprestimo](funcoes.md#f-negar_emprestimo)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-_assert_ciclo_tarefa_avaliador"></a>
## _assert_ciclo_tarefa_avaliador (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_assert_ciclo_tarefa_gestor"></a>
## _assert_ciclo_tarefa_gestor (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [atualizar_ciclo_tarefa](funcoes.md#f-atualizar_ciclo_tarefa), [criar_ciclo_tarefa](funcoes.md#f-criar_ciclo_tarefa), [definir_avaliadores_ciclo_tarefa](funcoes.md#f-definir_avaliadores_ciclo_tarefa), [encerrar_ciclo_tarefa](funcoes.md#f-encerrar_ciclo_tarefa), [excluir_ciclo_tarefa](funcoes.md#f-excluir_ciclo_tarefa), [liberar_ciclo_tarefa](funcoes.md#f-liberar_ciclo_tarefa), [reabrir_ciclo_tarefa](funcoes.md#f-reabrir_ciclo_tarefa)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_assert_interfilial"></a>
## _assert_interfilial (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_assert_vaga_matriz](funcoes.md#f-_assert_vaga_matriz), [abrir_vaga_interna](funcoes.md#f-abrir_vaga_interna), [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-_assert_lixeira"></a>
## _assert_lixeira (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [lixeira_expurgar](funcoes.md#f-lixeira_expurgar), [lixeira_listar](funcoes.md#f-lixeira_listar), [lixeira_restaurar](funcoes.md#f-lixeira_restaurar), [lixeira_vinculos](funcoes.md#f-lixeira_vinculos)
- **Grava:** —
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_lixeira_tabelas](funcoes.md#f-_lixeira_tabelas), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-_assert_lixeira_filial"></a>
## _assert_lixeira_filial (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [lixeira_expurgar](funcoes.md#f-lixeira_expurgar), [lixeira_listar](funcoes.md#f-lixeira_listar), [lixeira_restaurar](funcoes.md#f-lixeira_restaurar)
- **Grava:** —
- **Chama:** [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-_assert_matriz_admin"></a>
## _assert_matriz_admin (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [definir_excecao_calendario](funcoes.md#f-definir_excecao_calendario), [definir_ponto_jornada](funcoes.md#f-definir_ponto_jornada), [encerrar_matriz_tarefa](funcoes.md#f-encerrar_matriz_tarefa), [reabrir_matriz_tarefa](funcoes.md#f-reabrir_matriz_tarefa), [remover_excecao_calendario](funcoes.md#f-remover_excecao_calendario)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_assert_matriz_tarefa_gestor"></a>
## _assert_matriz_tarefa_gestor (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [adicionar_matriz_participante](funcoes.md#f-adicionar_matriz_participante), [atualizar_matriz_tarefa](funcoes.md#f-atualizar_matriz_tarefa), [liberar_matriz_tarefa](funcoes.md#f-liberar_matriz_tarefa), [remover_matriz_participante](funcoes.md#f-remover_matriz_participante), [remover_matriz_tarefa](funcoes.md#f-remover_matriz_tarefa)
- **Grava:** —
- **Lê:** [matriz_tarefas](tabelas.md#t-matriz_tarefas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_assert_nao_e_o_solicitante"></a>
## _assert_nao_e_o_solicitante (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [negar_emprestimo](funcoes.md#f-negar_emprestimo)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-_assert_pode_avaliar_ciclo_tarefa"></a>
## _assert_pode_avaliar_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [avaliar_ciclo_tarefa](funcoes.md#f-avaliar_ciclo_tarefa), [remover_avaliacao_ciclo_tarefa](funcoes.md#f-remover_avaliacao_ciclo_tarefa)
- **Grava:** —
- **Lê:** [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_assert_recrutamento"></a>
## _assert_recrutamento (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [abrir_vaga](funcoes.md#f-abrir_vaga), [abrir_vaga_interna](funcoes.md#f-abrir_vaga_interna), [cancelar_convite_vaga](funcoes.md#f-cancelar_convite_vaga), [cancelar_vaga](funcoes.md#f-cancelar_vaga), [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [marcar_acesso_ajustado](funcoes.md#f-marcar_acesso_ajustado), [mover_candidatura](funcoes.md#f-mover_candidatura), [registrar_candidatura](funcoes.md#f-registrar_candidatura), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [vincular_acesso_funcionario](funcoes.md#f-vincular_acesso_funcionario)
- **Grava:** —
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-_assert_rpc"></a>
## _assert_rpc (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_assert_caixa](funcoes.md#f-_assert_caixa), [_assert_lixeira](funcoes.md#f-_assert_lixeira), [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [alternar_simulacao_perda](funcoes.md#f-alternar_simulacao_perda), [analisar_promocao_financeiro](funcoes.md#f-analisar_promocao_financeiro), [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aplicar_afastamento_no_ponto](funcoes.md#f-aplicar_afastamento_no_ponto), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [aplicar_rateio_administrativo](funcoes.md#f-aplicar_rateio_administrativo), [aprovar_promocao](funcoes.md#f-aprovar_promocao), [apurar_das](funcoes.md#f-apurar_das), [apurar_rateio_administrativo](funcoes.md#f-apurar_rateio_administrativo), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [calcular_rescisao](funcoes.md#f-calcular_rescisao), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado), [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha), [cancelar_convite_vaga](funcoes.md#f-cancelar_convite_vaga), [cancelar_frete_compra](funcoes.md#f-cancelar_frete_compra), [cancelar_pedido_compra](funcoes.md#f-cancelar_pedido_compra), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [cancelar_vaga](funcoes.md#f-cancelar_vaga), [cliente_saldo_devedor](funcoes.md#f-cliente_saldo_devedor), [cliente_titulos_vencidos](funcoes.md#f-cliente_titulos_vencidos), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [concluir_correcao_produto](funcoes.md#f-concluir_correcao_produto), [conferir_nota_fiscal](funcoes.md#f-conferir_nota_fiscal), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [criar_requisicao_compra](funcoes.md#f-criar_requisicao_compra), [criar_requisicao_estoque](funcoes.md#f-criar_requisicao_estoque), [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [dar_baixa_patrimonio](funcoes.md#f-dar_baixa_patrimonio), [dar_ciencia_requisicao](funcoes.md#f-dar_ciencia_requisicao), [dar_ciencia_requisicao_estoque](funcoes.md#f-dar_ciencia_requisicao_estoque), [das_competencias](funcoes.md#f-das_competencias), [decidir_cotacao](funcoes.md#f-decidir_cotacao), [decidir_desligamento](funcoes.md#f-decidir_desligamento), [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [decidir_vaga](funcoes.md#f-decidir_vaga), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios), [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [devolver_requisicao_para_correcao](funcoes.md#f-devolver_requisicao_para_correcao), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [efetivar_contratacao](funcoes.md#f-efetivar_contratacao), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [emitir_nota](funcoes.md#f-emitir_nota), [encerrar_lote_consumido](funcoes.md#f-encerrar_lote_consumido), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [enviar_feedback_anonimo](funcoes.md#f-enviar_feedback_anonimo), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [expedir](funcoes.md#f-expedir), [fechar_inventario](funcoes.md#f-fechar_inventario), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [gerar_dre](funcoes.md#f-gerar_dre), [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [liberar_codigo_produto](funcoes.md#f-liberar_codigo_produto), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [liberar_trabalho](funcoes.md#f-liberar_trabalho), [limpar_ip_hash_pedidos_online](funcoes.md#f-limpar_ip_hash_pedidos_online), [listar_vitrine_candidatos](funcoes.md#f-listar_vitrine_candidatos), [marcar_acesso_ajustado](funcoes.md#f-marcar_acesso_ajustado), [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas), [marcar_todas_lidas](funcoes.md#f-marcar_todas_lidas), [marcar_vitrine](funcoes.md#f-marcar_vitrine), [minha_frequencia](funcoes.md#f-minha_frequencia), [mover_candidatura](funcoes.md#f-mover_candidatura), [movimentar_estoque](funcoes.md#f-movimentar_estoque), [notificar_setor](funcoes.md#f-notificar_setor), [pagar_folha](funcoes.md#f-pagar_folha), [pagar_rescisao](funcoes.md#f-pagar_rescisao), [parametros_precificacao](funcoes.md#f-parametros_precificacao), [parecer_justificativa_falta](funcoes.md#f-parecer_justificativa_falta), [pdv_registrar_credito_misto](funcoes.md#f-pdv_registrar_credito_misto), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete), [processar_folha](funcoes.md#f-processar_folha), [processar_rescisao](funcoes.md#f-processar_rescisao), [reabrir_caixa](funcoes.md#f-reabrir_caixa), [reabrir_cotacao](funcoes.md#f-reabrir_cotacao), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [recompute_saldos_maxbank](funcoes.md#f-recompute_saldos_maxbank), [reenviar_cotacao_corrigida](funcoes.md#f-reenviar_cotacao_corrigida), [reenviar_requisicao_corrigida](funcoes.md#f-reenviar_requisicao_corrigida), [reenviar_requisicao_estoque_corrigida](funcoes.md#f-reenviar_requisicao_estoque_corrigida), [registrar_aporte_capital](funcoes.md#f-registrar_aporte_capital), [registrar_candidatura](funcoes.md#f-registrar_candidatura), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [registrar_unidades_recebidas](funcoes.md#f-registrar_unidades_recebidas), [remover_ponto](funcoes.md#f-remover_ponto), [renovar_trabalho](funcoes.md#f-renovar_trabalho), [reprovar_promocao](funcoes.md#f-reprovar_promocao), [reservar_codigo_produto](funcoes.md#f-reservar_codigo_produto), [reservar_trabalho](funcoes.md#f-reservar_trabalho), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga), [responder_pesquisa](funcoes.md#f-responder_pesquisa), [reverter_promocoes_expiradas](funcoes.md#f-reverter_promocoes_expiradas), [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo), [salvar_lucro_servico](funcoes.md#f-salvar_lucro_servico), [salvar_parametros_precificacao](funcoes.md#f-salvar_parametros_precificacao), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento), [transferir_entre_contas](funcoes.md#f-transferir_entre_contas), [validar_cupom](funcoes.md#f-validar_cupom), [vender_patrimonio](funcoes.md#f-vender_patrimonio), [vincular_acesso_funcionario](funcoes.md#f-vincular_acesso_funcionario), [vincular_produto_requisicao](funcoes.md#f-vincular_produto_requisicao)
- **Grava:** —
- **Chama:** [auth_blackout](funcoes.md#f-auth_blackout), [auth_desligado](funcoes.md#f-auth_desligado), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-_assert_vaga_matriz"></a>
## _assert_vaga_matriz (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [abrir_vaga](funcoes.md#f-abrir_vaga), [abrir_vaga_interna](funcoes.md#f-abrir_vaga_interna)
- **Grava:** —
- **Chama:** [_assert_interfilial](funcoes.md#f-_assert_interfilial), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-_calcular_placar_competicao_raw"></a>
## _calcular_placar_competicao_raw (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [calcular_placar_competicao](funcoes.md#f-calcular_placar_competicao)
- **Grava:** —
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [filiais](tabelas.md#t-filiais), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [ponto_jornada](tabelas.md#t-ponto_jornada), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [_funcionario_desligado](funcoes.md#f-_funcionario_desligado), [_peso_nota_matriz](funcoes.md#f-_peso_nota_matriz), [_pontualidade_competicao](funcoes.md#f-_pontualidade_competicao)

<a id="f-_cancelar_frete_compra"></a>
## _cancelar_frete_compra (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [cancelar_frete_compra](funcoes.md#f-cancelar_frete_compra), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa)
- **Grava:** [fretes_compra](tabelas.md#t-fretes_compra)
- **Lê:** [fretes_compra_rateio](tabelas.md#t-fretes_compra_rateio)
- **Chama:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota)

<a id="f-_competicao_empatada"></a>
## _competicao_empatada (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Chama:** [_competicao_votos_validos](funcoes.md#f-_competicao_votos_validos), [contar_votantes_matriz](funcoes.md#f-contar_votantes_matriz)

<a id="f-_competicao_voto_touch"></a>
## _competicao_voto_touch (gatilho)

- **Dispara em:** [competicao_votos](tabelas.md#t-competicao_votos)
- **Grava:** —

<a id="f-_competicao_votos_validos"></a>
## _competicao_votos_validos (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_competicao_empatada](funcoes.md#f-_competicao_empatada), [_sugestao_rejeicao_competicao](funcoes.md#f-_sugestao_rejeicao_competicao), [declarar_vencedora](funcoes.md#f-declarar_vencedora), [progresso_votacao_competicao](funcoes.md#f-progresso_votacao_competicao)
- **Grava:** —
- **Lê:** [competicao_votos](tabelas.md#t-competicao_votos), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_conta_receber_fecha_pedido_venda"></a>
## _conta_receber_fecha_pedido_venda (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_receber](tabelas.md#t-contas_receber)
- **Grava:** [pedidos_venda](tabelas.md#t-pedidos_venda)
- **Ao gravar, acorda os gatilhos de:** [pedidos_venda](tabelas.md#t-pedidos_venda) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_pedido_venda_status_pelos_marcos](funcoes.md#f-fn_pedido_venda_status_pelos_marcos), [set_numero_documento](funcoes.md#f-set_numero_documento))
- **Lê:** [contas_receber](tabelas.md#t-contas_receber), [pedidos_venda](tabelas.md#t-pedidos_venda), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_dia_de_folga"></a>
## _dia_de_folga (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [dias_letivos_periodo](funcoes.md#f-dias_letivos_periodo), [minha_frequencia](funcoes.md#f-minha_frequencia)
- **Grava:** —
- **Lê:** [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes)

<a id="f-_dre_calculo"></a>
## _dre_calculo (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [gerar_dre](funcoes.md#f-gerar_dre), [parametros_precificacao](funcoes.md#f-parametros_precificacao)
- **Grava:** —
- **Lê:** [ajustes_custo_compra](tabelas.md#t-ajustes_custo_compra), [centros_custo](tabelas.md#t-centros_custo), [consumos_material](tabelas.md#t-consumos_material), [contas_pagar](tabelas.md#t-contas_pagar), [devolucoes](tabelas.md#t-devolucoes), [itens_devolucao](tabelas.md#t-itens_devolucao), [itens_venda](tabelas.md#t-itens_venda), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo), [vendas](tabelas.md#t-vendas)
- **Chama:** [_simples_periodo](funcoes.md#f-_simples_periodo)

<a id="f-_folha_creditar_e_avancar"></a>
## _folha_creditar_e_avancar (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [pagar_folha](funcoes.md#f-pagar_folha)
- **Grava:** [folha_credito_falhas](tabelas.md#t-folha_credito_falhas), [folha_pagamento](tabelas.md#t-folha_pagamento)
- **Ao gravar, acorda os gatilhos de:** [folha_pagamento](tabelas.md#t-folha_pagamento) ([folha_historico_fechado](funcoes.md#f-folha_historico_fechado), [folha_pagamento_set_salario_base](funcoes.md#f-folha_pagamento_set_salario_base))
- **Lê:** [folha_pagamento](tabelas.md#t-folha_pagamento)
- **Chama:** [creditar_folha_maxbank](funcoes.md#f-creditar_folha_maxbank), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-_freq_credito_dia"></a>
## _freq_credito_dia (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [minha_frequencia](funcoes.md#f-minha_frequencia)
- **Grava:** —

<a id="f-_frequencia_competicao"></a>
## _frequencia_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [frequencia_filiais_competicao](funcoes.md#f-frequencia_filiais_competicao)
- **Grava:** —
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz), [funcionarios](tabelas.md#t-funcionarios), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [ponto_jornada](tabelas.md#t-ponto_jornada)
- **Chama:** [_dia_de_folga](funcoes.md#f-_dia_de_folga), [_freq_credito_dia](funcoes.md#f-_freq_credito_dia), [_funcionario_desligado](funcoes.md#f-_funcionario_desligado), [acre_today](funcoes.md#f-acre_today), [dias_letivos_periodo](funcoes.md#f-dias_letivos_periodo)

<a id="f-_funcionario_da_conta"></a>
## _funcionario_da_conta (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta)
- **Grava:** —
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_funcionario_desligado"></a>
## _funcionario_desligado (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [avaliar_item_matriz](funcoes.md#f-avaliar_item_matriz), [fn_ponto_filial_from_funcionario](funcoes.md#f-fn_ponto_filial_from_funcionario), [minha_mesa](funcoes.md#f-minha_mesa), [participantes_sem_nota_competicao](funcoes.md#f-participantes_sem_nota_competicao), [progresso_avaliacao_matriz](funcoes.md#f-progresso_avaliacao_matriz), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual)
- **Grava:** —
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_inss_simplificado"></a>
## _inss_simplificado (RPC)

- **Telas que chamam:** —
- **Grava:** —
- **Chama:** [rh_calc_inss](funcoes.md#f-rh_calc_inss)

<a id="f-_irrf_simplificado"></a>
## _irrf_simplificado (RPC)

- **Telas que chamam:** —
- **Grava:** —
- **Chama:** [rh_calc_irrf](funcoes.md#f-rh_calc_irrf)

<a id="f-_lixeira_expr_filial"></a>
## _lixeira_expr_filial (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [lixeira_expurgar](funcoes.md#f-lixeira_expurgar), [lixeira_listar](funcoes.md#f-lixeira_listar), [lixeira_restaurar](funcoes.md#f-lixeira_restaurar)
- **Grava:** —
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto)

<a id="f-_lixeira_tabelas"></a>
## _lixeira_tabelas (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_assert_lixeira](funcoes.md#f-_assert_lixeira), [lixeira_listar](funcoes.md#f-lixeira_listar)
- **Grava:** —

<a id="f-_maxbank_pode_reverter"></a>
## _maxbank_pode_reverter (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [excluir_transacao_maxbank](funcoes.md#f-excluir_transacao_maxbank), [recompute_saldos_maxbank](funcoes.md#f-recompute_saldos_maxbank), [reverter_folha_maxbank](funcoes.md#f-reverter_folha_maxbank)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_mov_estoque_casa_com_pedido"></a>
## _mov_estoque_casa_com_pedido (gatilho, SECURITY DEFINER)

- **Dispara em:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Grava:** —
- **Lê:** [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin)

<a id="f-_normalizar_texto_loja"></a>
## _normalizar_texto_loja (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [loja_apelido_limpo](funcoes.md#f-loja_apelido_limpo)
- **Grava:** —

<a id="f-_pendencia_responsaveis"></a>
## _pendencia_responsaveis (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [listar_pendencias](funcoes.md#f-listar_pendencias), [minha_mesa](funcoes.md#f-minha_mesa)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-_peso_nota_matriz"></a>
## _peso_nota_matriz (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw), [media_participantes_competicao](funcoes.md#f-media_participantes_competicao)
- **Grava:** —

<a id="f-_pontualidade_competicao"></a>
## _pontualidade_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw)
- **Grava:** —
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz), [contas_pagar](tabelas.md#t-contas_pagar), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-_receita_servico"></a>
## _receita_servico (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_simples_periodo](funcoes.md#f-_simples_periodo)
- **Grava:** —
- **Lê:** [devolucoes](tabelas.md#t-devolucoes), [itens_devolucao](tabelas.md#t-itens_devolucao), [itens_venda](tabelas.md#t-itens_venda), [vendas](tabelas.md#t-vendas)

<a id="f-_receita_simples"></a>
## _receita_simples (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_simples_periodo](funcoes.md#f-_simples_periodo), [_simples_rbt12](funcoes.md#f-_simples_rbt12), [parametros_precificacao](funcoes.md#f-parametros_precificacao)
- **Grava:** —
- **Lê:** [devolucoes](tabelas.md#t-devolucoes), [vendas](tabelas.md#t-vendas)

<a id="f-_reverter_ponto_do_afastamento"></a>
## _reverter_ponto_do_afastamento (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [afastamento_reverte_ao_excluir](funcoes.md#f-afastamento_reverte_ao_excluir), [reverter_afastamento_no_ponto](funcoes.md#f-reverter_afastamento_no_ponto)
- **Grava:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Ao gravar, acorda os gatilhos de:** [ponto_eletronico](tabelas.md#t-ponto_eletronico) ([fn_ponto_filial_from_funcionario](funcoes.md#f-fn_ponto_filial_from_funcionario), [fn_ponto_recusa_dia_de_folga](funcoes.md#f-fn_ponto_recusa_dia_de_folga))
- **Lê:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Chama:** [ponto_corte_turma](funcoes.md#f-ponto_corte_turma)

<a id="f-_simples_do_mes"></a>
## _simples_do_mes (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [apurar_das](funcoes.md#f-apurar_das), [das_competencias](funcoes.md#f-das_competencias)
- **Grava:** —
- **Chama:** [_simples_periodo](funcoes.md#f-_simples_periodo)

<a id="f-_simples_periodo"></a>
## _simples_periodo (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_dre_calculo](funcoes.md#f-_dre_calculo), [_simples_do_mes](funcoes.md#f-_simples_do_mes)
- **Grava:** —
- **Chama:** [_receita_servico](funcoes.md#f-_receita_servico), [_receita_simples](funcoes.md#f-_receita_simples), [_simples_rbt12](funcoes.md#f-_simples_rbt12), [simples_anexo_i](funcoes.md#f-simples_anexo_i), [simples_anexo_iii](funcoes.md#f-simples_anexo_iii)

<a id="f-_simples_rbt12"></a>
## _simples_rbt12 (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_simples_periodo](funcoes.md#f-_simples_periodo), [parametros_precificacao](funcoes.md#f-parametros_precificacao)
- **Grava:** —
- **Lê:** [filial_precificacao](tabelas.md#t-filial_precificacao), [vendas](tabelas.md#t-vendas)
- **Chama:** [_receita_simples](funcoes.md#f-_receita_simples)

<a id="f-_sugestao_rejeicao_competicao"></a>
## _sugestao_rejeicao_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [declarar_vencedora](funcoes.md#f-declarar_vencedora)
- **Grava:** —
- **Chama:** [_competicao_votos_validos](funcoes.md#f-_competicao_votos_validos)

<a id="f-_taxa_pelo_mix"></a>
## _taxa_pelo_mix (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [parametros_precificacao](funcoes.md#f-parametros_precificacao)
- **Grava:** —
- **Lê:** [contas_receber](tabelas.md#t-contas_receber), [formas_pagamento](tabelas.md#t-formas_pagamento), [vendas](tabelas.md#t-vendas), [vendas_pagamentos](tabelas.md#t-vendas_pagamentos)
- **Chama:** [_tipo_da_forma_pdv](funcoes.md#f-_tipo_da_forma_pdv)

<a id="f-_tipo_da_forma_pdv"></a>
## _tipo_da_forma_pdv (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_taxa_pelo_mix](funcoes.md#f-_taxa_pelo_mix), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv)
- **Grava:** —

<a id="f-_tirar_funcionario_das_tarefas"></a>
## _tirar_funcionario_das_tarefas (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [fn_funcionario_excluido_sai_das_tarefas](funcoes.md#f-fn_funcionario_excluido_sai_das_tarefas)
- **Grava:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz) ([fn_avaliacao_matriz_congela_avaliador](funcoes.md#f-fn_avaliacao_matriz_congela_avaliador), [trg_aval_matriz_updated_at](funcoes.md#f-trg_aval_matriz_updated_at)); [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes) ([trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at))
- **Lê:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas)

<a id="f-abrir_revisao_auditoria"></a>
## abrir_revisao_auditoria (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [auditoria_revisoes](tabelas.md#t-auditoria_revisoes)
- **Lê:** [auditoria_revisoes](tabelas.md#t-auditoria_revisoes), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Chama:** [auth_is_conselho](funcoes.md#f-auth_is_conselho), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-abrir_vaga"></a>
## abrir_vaga (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [vagas](tabelas.md#t-vagas)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_vaga_matriz](funcoes.md#f-_assert_vaga_matriz), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-abrir_vaga_interna"></a>
## abrir_vaga_interna (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [vagas](tabelas.md#t-vagas)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_interfilial](funcoes.md#f-_assert_interfilial), [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_vaga_matriz](funcoes.md#f-_assert_vaga_matriz), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-acre_today"></a>
## acre_today (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [_pontualidade_competicao](funcoes.md#f-_pontualidade_competicao), [analisar_promocao_financeiro](funcoes.md#f-analisar_promocao_financeiro), [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [aprovar_promocao](funcoes.md#f-aprovar_promocao), [apurar_das](funcoes.md#f-apurar_das), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [cliente_titulos_vencidos](funcoes.md#f-cliente_titulos_vencidos), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [criar_requisicao_compra](funcoes.md#f-criar_requisicao_compra), [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [dar_baixa_patrimonio](funcoes.md#f-dar_baixa_patrimonio), [das_competencias](funcoes.md#f-das_competencias), [decidir_cotacao](funcoes.md#f-decidir_cotacao), [definir_ponto_jornada](funcoes.md#f-definir_ponto_jornada), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [emitir_nota](funcoes.md#f-emitir_nota), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [expedir](funcoes.md#f-expedir), [fechar_inventario](funcoes.md#f-fechar_inventario), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_item_devolucao_devolve_unidade](funcoes.md#f-fn_item_devolucao_devolve_unidade), [fn_pedido_marca_recebimento](funcoes.md#f-fn_pedido_marca_recebimento), [fn_recebimento_da_entrada](funcoes.md#f-fn_recebimento_da_entrada), [fn_recebimento_data_plausivel](funcoes.md#f-fn_recebimento_data_plausivel), [fn_recebimento_exige_nota](funcoes.md#f-fn_recebimento_exige_nota), [fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [get_vitrine_publica](funcoes.md#f-get_vitrine_publica), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [listar_vitrine_candidatos](funcoes.md#f-listar_vitrine_candidatos), [marcar_vitrine](funcoes.md#f-marcar_vitrine), [minha_frequencia](funcoes.md#f-minha_frequencia), [movimentar_estoque](funcoes.md#f-movimentar_estoque), [parametros_precificacao](funcoes.md#f-parametros_precificacao), [pdv_registrar_credito_misto](funcoes.md#f-pdv_registrar_credito_misto), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete), [promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [promocao_vigente_do_produto](funcoes.md#f-promocao_vigente_do_produto), [reenviar_cotacao_corrigida](funcoes.md#f-reenviar_cotacao_corrigida), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [reverter_promocoes_expiradas](funcoes.md#f-reverter_promocoes_expiradas), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda), [set_numero_documento](funcoes.md#f-set_numero_documento), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao), [total_pendente_contas_pagar](funcoes.md#f-total_pendente_contas_pagar), [validar_cupom](funcoes.md#f-validar_cupom), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Grava:** —

<a id="f-adicionar_matriz_participante"></a>
## adicionar_matriz_participante (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
- **Lê:** [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Chama:** [_assert_matriz_tarefa_gestor](funcoes.md#f-_assert_matriz_tarefa_gestor)

<a id="f-afastamento_decisao_guard"></a>
## afastamento_decisao_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [afastamentos](tabelas.md#t-afastamentos)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-afastamento_nasce_pendente"></a>
## afastamento_nasce_pendente (gatilho, SECURITY DEFINER)

- **Dispara em:** [afastamentos](tabelas.md#t-afastamentos)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-afastamento_reverte_ao_excluir"></a>
## afastamento_reverte_ao_excluir (gatilho, SECURITY DEFINER)

- **Dispara em:** [afastamentos](tabelas.md#t-afastamentos)
- **Grava:** —
- **Chama:** [_reverter_ponto_do_afastamento](funcoes.md#f-_reverter_ponto_do_afastamento)

<a id="f-afastamento_reverte_ao_inativar"></a>
## afastamento_reverte_ao_inativar (gatilho, SECURITY DEFINER)

- **Dispara em:** [afastamentos](tabelas.md#t-afastamentos)
- **Grava:** —
- **Chama:** [reverter_afastamento_no_ponto](funcoes.md#f-reverter_afastamento_no_ponto)

<a id="f-afastamento_valida_periodo"></a>
## afastamento_valida_periodo (gatilho)

- **Dispara em:** [afastamentos](tabelas.md#t-afastamentos)
- **Grava:** —
- **Chama:** [ponto_corte_turma](funcoes.md#f-ponto_corte_turma)

<a id="f-alarmes_turma_sem_sobreposicao"></a>
## alarmes_turma_sem_sobreposicao (gatilho)

- **Dispara em:** [alarmes_turma](tabelas.md#t-alarmes_turma)
- **Grava:** —
- **Lê:** [alarmes_turma](tabelas.md#t-alarmes_turma)

<a id="f-alternar_simulacao_perda"></a>
## alternar_simulacao_perda (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo)
- **Grava:** [blackout_config](tabelas.md#t-blackout_config)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-analisar_promocao_financeiro"></a>
## analisar_promocao_financeiro (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções)
- **Grava:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Ao gravar, acorda os gatilhos de:** [marketing_promocoes](tabelas.md#t-marketing_promocoes) ([promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [trg_marketing_promocoes_soft_delete_arte](funcoes.md#f-trg_marketing_promocoes_soft_delete_arte))
- **Lê:** [marketing_promocoes](tabelas.md#t-marketing_promocoes), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-antecipar_parcela_emprestimo"></a>
## antecipar_parcela_emprestimo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Capital](telas.md#s-financeiro-capital)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [historico_operacoes](tabelas.md#t-historico_operacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo) ([parcela_emprestimo_arquivada_e_historico](funcoes.md#f-parcela_emprestimo_arquivada_e_historico))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [brl](funcoes.md#f-brl), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital)

<a id="f-apagar_emprestimo"></a>
## apagar_emprestimo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Capital](telas.md#s-matriz-capital)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [emprestimos_filial](tabelas.md#t-emprestimos_filial) ([emprestimo_arquivado_e_historico](funcoes.md#f-emprestimo_arquivado_e_historico), [emprestimo_valida_condicoes](funcoes.md#f-emprestimo_valida_condicoes))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role), [brl](funcoes.md#f-brl)

<a id="f-apagar_meta_estrategica"></a>
## apagar_meta_estrategica (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** [metas_estrategicas](tabelas.md#t-metas_estrategicas), [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Ao gravar, acorda os gatilhos de:** [metas_estrategicas](tabelas.md#t-metas_estrategicas) ([metas_estrategicas_set_updated_at](funcoes.md#f-metas_estrategicas_set_updated_at)); [tarefas_taticas](tabelas.md#t-tarefas_taticas) ([tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at))
- **Lê:** [metas_estrategicas](tabelas.md#t-metas_estrategicas), [tarefas_taticas](tabelas.md#t-tarefas_taticas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-aplicar_afastamento_no_ponto"></a>
## aplicar_afastamento_no_ponto (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos)
- **Grava:** [afastamentos](tabelas.md#t-afastamentos), [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Ao gravar, acorda os gatilhos de:** [afastamentos](tabelas.md#t-afastamentos) ([afastamento_decisao_guard](funcoes.md#f-afastamento_decisao_guard), [afastamento_nasce_pendente](funcoes.md#f-afastamento_nasce_pendente), [afastamento_reverte_ao_excluir](funcoes.md#f-afastamento_reverte_ao_excluir), [afastamento_reverte_ao_inativar](funcoes.md#f-afastamento_reverte_ao_inativar), [afastamento_valida_periodo](funcoes.md#f-afastamento_valida_periodo), [trg_afastamentos_updated_at](funcoes.md#f-trg_afastamentos_updated_at)); [ponto_eletronico](tabelas.md#t-ponto_eletronico) ([fn_ponto_filial_from_funcionario](funcoes.md#f-fn_ponto_filial_from_funcionario), [fn_ponto_recusa_dia_de_folga](funcoes.md#f-fn_ponto_recusa_dia_de_folga))
- **Lê:** [afastamentos](tabelas.md#t-afastamentos), [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [ponto_corte_turma](funcoes.md#f-ponto_corte_turma)

<a id="f-aplicar_em_banco"></a>
## aplicar_em_banco (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **Grava:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras), [caixa_bancos](tabelas.md#t-caixa_bancos), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Lê:** [bancos_investimento](tabelas.md#t-bancos_investimento), [caixa_bancos](tabelas.md#t-caixa_bancos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [auth_user_role](funcoes.md#f-auth_user_role), [brl](funcoes.md#f-brl), [pct_br](funcoes.md#f-pct_br)

<a id="f-aplicar_rateio_administrativo"></a>
## aplicar_rateio_administrativo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [rateio_administrativo](tabelas.md#t-rateio_administrativo), [rateio_administrativo_itens](tabelas.md#t-rateio_administrativo_itens)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [apurar_rateio_administrativo](funcoes.md#f-apurar_rateio_administrativo), [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-aplicar_taxonomia_padrao"></a>
## aplicar_taxonomia_padrao (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [categorias_produto](tabelas.md#t-categorias_produto), [subcategorias_produto](tabelas.md#t-subcategorias_produto)
- **Ao gravar, acorda os gatilhos de:** [categorias_produto](tabelas.md#t-categorias_produto) ([fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_taxonomia_padrao_protege](funcoes.md#f-fn_taxonomia_padrao_protege)); [subcategorias_produto](tabelas.md#t-subcategorias_produto) ([fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_taxonomia_padrao_protege](funcoes.md#f-fn_taxonomia_padrao_protege))
- **Lê:** [categorias_produto](tabelas.md#t-categorias_produto), [subcategorias_produto](tabelas.md#t-subcategorias_produto), [taxonomia_padrao](tabelas.md#t-taxonomia_padrao)
- **Chama:** [nome_item_normalizado](funcoes.md#f-nome_item_normalizado)
- **Liga flags de sessão:** `app.taxonomia_padrao`

<a id="f-aprovacao_estoque_segue_a_requisicao"></a>
## aprovacao_estoque_segue_a_requisicao (gatilho, SECURITY DEFINER)

- **Dispara em:** [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Grava:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao))

<a id="f-aprovacao_segue_a_requisicao"></a>
## aprovacao_segue_a_requisicao (gatilho, SECURITY DEFINER)

- **Dispara em:** [requisicoes](tabelas.md#t-requisicoes)
- **Grava:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao))

<a id="f-aprovar_emprestimo"></a>
## aprovar_emprestimo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Capital](telas.md#s-matriz-capital)
- **Chamada por outras funções:** [conceder_mutuo_capital](funcoes.md#f-conceder_mutuo_capital)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [emprestimos_filial](tabelas.md#t-emprestimos_filial) ([emprestimo_arquivado_e_historico](funcoes.md#f-emprestimo_arquivado_e_historico), [emprestimo_valida_condicoes](funcoes.md#f-emprestimo_valida_condicoes)); [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo) ([parcela_emprestimo_arquivada_e_historico](funcoes.md#f-parcela_emprestimo_arquivada_e_historico))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_capital_holding](funcoes.md#f-_assert_capital_holding), [_assert_nao_e_o_solicitante](funcoes.md#f-_assert_nao_e_o_solicitante), [acre_today](funcoes.md#f-acre_today), [brl](funcoes.md#f-brl)

<a id="f-aprovar_meta_maxbank"></a>
## aprovar_meta_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_metas](tabelas.md#t-maxbank_metas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_metas](tabelas.md#t-maxbank_metas) ([maxbank_metas_set_updated_at](funcoes.md#f-maxbank_metas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura))
- **Lê:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_metas](tabelas.md#t-maxbank_metas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado)

<a id="f-aprovar_promocao"></a>
## aprovar_promocao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções)
- **Grava:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Ao gravar, acorda os gatilhos de:** [marketing_promocoes](tabelas.md#t-marketing_promocoes) ([promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [trg_marketing_promocoes_soft_delete_arte](funcoes.md#f-trg_marketing_promocoes_soft_delete_arte))
- **Lê:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [promocao_vigente_do_produto](funcoes.md#f-promocao_vigente_do_produto)

<a id="f-aprovar_tarefa_tatica"></a>
## aprovar_tarefa_tatica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura)); [tarefas_taticas](tabelas.md#t-tarefas_taticas) ([tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at))
- **Lê:** [maxbank_contas](tabelas.md#t-maxbank_contas), [tarefas_taticas](tabelas.md#t-tarefas_taticas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado)

<a id="f-apurar_das"></a>
## apurar_das (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [das_apuracoes](tabelas.md#t-das_apuracoes)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [das_apuracoes](tabelas.md#t-das_apuracoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_simples_do_mes](funcoes.md#f-_simples_do_mes), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [vencimento_das](funcoes.md#f-vencimento_das)
- **Liga flags de sessão:** `app.das`

<a id="f-apurar_rateio_administrativo"></a>
## apurar_rateio_administrativo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo)
- **Chamada por outras funções:** [aplicar_rateio_administrativo](funcoes.md#f-aplicar_rateio_administrativo)
- **Grava:** —
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [funcionarios](tabelas.md#t-funcionarios), [rateio_administrativo](tabelas.md#t-rateio_administrativo)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-assinar_contrato"></a>
## assinar_contrato (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Contratos](telas.md#s-contratos)
- **Grava:** [contratos](tabelas.md#t-contratos), [contratos_assinaturas](tabelas.md#t-contratos_assinaturas)
- **Ao gravar, acorda os gatilhos de:** [contratos](tabelas.md#t-contratos) ([contratos_carimbo](funcoes.md#f-contratos_carimbo))
- **Lê:** [contratos](tabelas.md#t-contratos), [contratos_assinaturas](tabelas.md#t-contratos_assinaturas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [contrato_representa](funcoes.md#f-contrato_representa)

<a id="f-atividade_aula_alcanca"></a>
## atividade_aula_alcanca (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Chama:** [atividade_aula_alcanca_perfil](funcoes.md#f-atividade_aula_alcanca_perfil), [auth_user_filial](funcoes.md#f-auth_user_filial), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-atividade_aula_alcanca_perfil"></a>
## atividade_aula_alcanca_perfil (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [atividade_aula_alcanca](funcoes.md#f-atividade_aula_alcanca), [marcar_tarefa_aula](funcoes.md#f-marcar_tarefa_aula)
- **Grava:** —

<a id="f-atualizar_avaliacao"></a>
## atualizar_avaliacao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [avaliacoes](tabelas.md#t-avaliacoes), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes](tabelas.md#t-avaliacoes) ([fn_avaliacoes_filial_from_ciclo](funcoes.md#f-fn_avaliacoes_filial_from_ciclo))
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-atualizar_ciclo_tarefa"></a>
## atualizar_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Ao gravar, acorda os gatilhos de:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas) ([trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at))
- **Lê:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Chama:** [_assert_ciclo_tarefa_gestor](funcoes.md#f-_assert_ciclo_tarefa_gestor)

<a id="f-atualizar_competicao"></a>
## atualizar_competicao (RPC)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Ao gravar, acorda os gatilhos de:** [competicoes_matriz](tabelas.md#t-competicoes_matriz) ([competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz), [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz), [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-atualizar_foto_usuario"></a>
## atualizar_foto_usuario (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Usuários](telas.md#s-usuarios)
- **Grava:** [user_profiles](tabelas.md#t-user_profiles)
- **Ao gravar, acorda os gatilhos de:** [user_profiles](tabelas.md#t-user_profiles) ([criar_maxbank_conta_para_colaborador](funcoes.md#f-criar_maxbank_conta_para_colaborador), [fn_conselho_e_da_matriz](funcoes.md#f-fn_conselho_e_da_matriz), [user_profiles_bloquear_privesc](funcoes.md#f-user_profiles_bloquear_privesc), [user_profiles_propagar_filial](funcoes.md#f-user_profiles_propagar_filial))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-atualizar_matriz_tarefa"></a>
## atualizar_matriz_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Ao gravar, acorda os gatilhos de:** [matriz_tarefas](tabelas.md#t-matriz_tarefas) ([trg_matriz_tarefas_updated_at](funcoes.md#f-trg_matriz_tarefas_updated_at))
- **Lê:** [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Chama:** [_assert_matriz_tarefa_gestor](funcoes.md#f-_assert_matriz_tarefa_gestor)

<a id="f-auditar_fluxo_compras"></a>
## auditar_fluxo_compras (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo)
- **Grava:** —
- **Lê:** [aula_sessoes](tabelas.md#t-aula_sessoes), [cotacoes](tabelas.md#t-cotacoes), [historico_operacoes](tabelas.md#t-historico_operacoes), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-aula_config_registrar_sessao"></a>
## aula_config_registrar_sessao (gatilho, SECURITY DEFINER)

- **Dispara em:** [aula_config](tabelas.md#t-aula_config)
- **Grava:** [aula_sessoes](tabelas.md#t-aula_sessoes)
- **Lê:** [aula_sessoes](tabelas.md#t-aula_sessoes), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-aula_setores_do_modulo"></a>
## aula_setores_do_modulo (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [auth_aula_setores](funcoes.md#f-auth_aula_setores)
- **Grava:** —

<a id="f-auth_aula_setores"></a>
## auth_aula_setores (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [auth_user_setores](funcoes.md#f-auth_user_setores)
- **Grava:** —
- **Lê:** [aula_config](tabelas.md#t-aula_config), [aula_grupo_apoio](tabelas.md#t-aula_grupo_apoio), [aula_grupo_apoio_config](tabelas.md#t-aula_grupo_apoio_config), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [aula_setores_do_modulo](funcoes.md#f-aula_setores_do_modulo)

<a id="f-auth_blackout"></a>
## auth_blackout (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_assert_blackout](funcoes.md#f-_assert_blackout), [_assert_rpc](funcoes.md#f-_assert_rpc)
- **Grava:** —
- **Lê:** [blackout_config](tabelas.md#t-blackout_config)
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-auth_desligado"></a>
## auth_desligado (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_assert_rpc](funcoes.md#f-_assert_rpc), [revisar_risco](funcoes.md#f-revisar_risco)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-auth_gerente_da"></a>
## auth_gerente_da (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_assert_caixa](funcoes.md#f-_assert_caixa), [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [aprovar_promocao](funcoes.md#f-aprovar_promocao), [auth_opera_loja](funcoes.md#f-auth_opera_loja), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [concluir_correcao_produto](funcoes.md#f-concluir_correcao_produto), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [das_competencias](funcoes.md#f-das_competencias), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios), [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [devolucao_valida_filial_da_venda](funcoes.md#f-devolucao_valida_filial_da_venda), [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [devolver_requisicao_para_correcao](funcoes.md#f-devolver_requisicao_para_correcao), [encerrar_lote_consumido](funcoes.md#f-encerrar_lote_consumido), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [ferias_decisao_guard](funcoes.md#f-ferias_decisao_guard), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [gerar_dre](funcoes.md#f-gerar_dre), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [nota_emitida_guard](funcoes.md#f-nota_emitida_guard), [parametros_precificacao](funcoes.md#f-parametros_precificacao), [promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [reabrir_caixa](funcoes.md#f-reabrir_caixa), [reenviar_requisicao_corrigida](funcoes.md#f-reenviar_requisicao_corrigida), [reenviar_requisicao_estoque_corrigida](funcoes.md#f-reenviar_requisicao_estoque_corrigida), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [salvar_lucro_servico](funcoes.md#f-salvar_lucro_servico), [salvar_parametros_precificacao](funcoes.md#f-salvar_parametros_precificacao), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento), [transferir_entre_contas](funcoes.md#f-transferir_entre_contas), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Grava:** —
- **Chama:** [auth_user_filial](funcoes.md#f-auth_user_filial), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-auth_in_setor"></a>
## auth_in_setor (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_assert_caixa](funcoes.md#f-_assert_caixa), [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc), [analisar_promocao_financeiro](funcoes.md#f-analisar_promocao_financeiro), [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [auth_opera_loja](funcoes.md#f-auth_opera_loja), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [controle_caixa_guard](funcoes.md#f-controle_caixa_guard), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard), [das_competencias](funcoes.md#f-das_competencias), [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios), [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [encerrar_lote_consumido](funcoes.md#f-encerrar_lote_consumido), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [ferias_decisao_guard](funcoes.md#f-ferias_decisao_guard), [gerar_dre](funcoes.md#f-gerar_dre), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [listar_pessoas_treinamento_ia](funcoes.md#f-listar_pessoas_treinamento_ia), [movimentacao_caixa_guard](funcoes.md#f-movimentacao_caixa_guard), [nota_emitida_guard](funcoes.md#f-nota_emitida_guard), [parametros_precificacao](funcoes.md#f-parametros_precificacao), [promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [reabrir_caixa](funcoes.md#f-reabrir_caixa), [reenviar_cotacao_corrigida](funcoes.md#f-reenviar_cotacao_corrigida), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [salvar_lucro_servico](funcoes.md#f-salvar_lucro_servico), [salvar_parametros_precificacao](funcoes.md#f-salvar_parametros_precificacao), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento), [total_pendente_contas_pagar](funcoes.md#f-total_pendente_contas_pagar), [transferir_entre_contas](funcoes.md#f-transferir_entre_contas), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Grava:** —
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_user_setores](funcoes.md#f-auth_user_setores)

<a id="f-auth_is_admin"></a>
## auth_is_admin (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [alternar_simulacao_perda](funcoes.md#f-alternar_simulacao_perda), [analisar_promocao_financeiro](funcoes.md#f-analisar_promocao_financeiro), [aplicar_rateio_administrativo](funcoes.md#f-aplicar_rateio_administrativo), [aprovar_promocao](funcoes.md#f-aprovar_promocao), [atualizar_competicao](funcoes.md#f-atualizar_competicao), [auth_blackout](funcoes.md#f-auth_blackout), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [corrigir_requisicao_compra](funcoes.md#f-corrigir_requisicao_compra), [criar_aviso_matriz](funcoes.md#f-criar_aviso_matriz), [criar_competicao](funcoes.md#f-criar_competicao), [criar_devolucao_venda](funcoes.md#f-criar_devolucao_venda), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [devolucao_valida_filial_da_venda](funcoes.md#f-devolucao_valida_filial_da_venda), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [devolver_requisicao_para_correcao](funcoes.md#f-devolver_requisicao_para_correcao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [expirar_competicoes](funcoes.md#f-expirar_competicoes), [ferias_decisao_guard](funcoes.md#f-ferias_decisao_guard), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_recebimento_confirmado_nao_some](funcoes.md#f-fn_recebimento_confirmado_nao_some), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [reabrir_cotacao](funcoes.md#f-reabrir_cotacao), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque), [reenviar_requisicao_corrigida](funcoes.md#f-reenviar_requisicao_corrigida), [reenviar_requisicao_estoque_corrigida](funcoes.md#f-reenviar_requisicao_estoque_corrigida), [remover_aviso_matriz](funcoes.md#f-remover_aviso_matriz), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard), [reverter_rateio_administrativo](funcoes.md#f-reverter_rateio_administrativo), [revisar_risco](funcoes.md#f-revisar_risco), [total_pendente_contas_pagar](funcoes.md#f-total_pendente_contas_pagar), [transferir_entre_contas](funcoes.md#f-transferir_entre_contas), [vender_patrimonio](funcoes.md#f-vender_patrimonio)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-auth_is_conselho"></a>
## auth_is_conselho (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [abrir_revisao_auditoria](funcoes.md#f-abrir_revisao_auditoria), [encerrar_mandato](funcoes.md#f-encerrar_mandato), [encerrar_revisao_auditoria](funcoes.md#f-encerrar_revisao_auditoria), [nomear_mandato](funcoes.md#f-nomear_mandato)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-auth_is_service_role"></a>
## auth_is_service_role (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_aplicar_desligado_em](funcoes.md#f-_aplicar_desligado_em), [_assert_blackout](funcoes.md#f-_assert_blackout), [_assert_caixa](funcoes.md#f-_assert_caixa), [_assert_capital_holding](funcoes.md#f-_assert_capital_holding), [_assert_interfilial](funcoes.md#f-_assert_interfilial), [_assert_nao_e_o_solicitante](funcoes.md#f-_assert_nao_e_o_solicitante), [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc), [_assert_vaga_matriz](funcoes.md#f-_assert_vaga_matriz), [_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [afastamento_decisao_guard](funcoes.md#f-afastamento_decisao_guard), [afastamento_nasce_pendente](funcoes.md#f-afastamento_nasce_pendente), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [auth_blackout](funcoes.md#f-auth_blackout), [autorizar_cartao_maxbank](funcoes.md#f-autorizar_cartao_maxbank), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard), [decidir_desligamento](funcoes.md#f-decidir_desligamento), [decidir_vaga](funcoes.md#f-decidir_vaga), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [devolver_cotacao_para_correcao](funcoes.md#f-devolver_cotacao_para_correcao), [devolver_movimentacao_para_correcao](funcoes.md#f-devolver_movimentacao_para_correcao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [emitir_nota](funcoes.md#f-emitir_nota), [expirar_competicoes](funcoes.md#f-expirar_competicoes), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [ferias_decisao_guard](funcoes.md#f-ferias_decisao_guard), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_cotacao_aprovada_congela](funcoes.md#f-fn_cotacao_aprovada_congela), [fn_cotacao_com_pedido_nao_volta](funcoes.md#f-fn_cotacao_com_pedido_nao_volta), [fn_pedido_congela_compra](funcoes.md#f-fn_pedido_congela_compra), [fn_pedido_transicao_valida](funcoes.md#f-fn_pedido_transicao_valida), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_recebimento_conferido_congela](funcoes.md#f-fn_recebimento_conferido_congela), [fn_recebimento_confirmado_nao_some](funcoes.md#f-fn_recebimento_confirmado_nao_some), [fn_recebimento_nao_estoura_pedido](funcoes.md#f-fn_recebimento_nao_estoura_pedido), [fn_venda_dinheiro_exige_caixa](funcoes.md#f-fn_venda_dinheiro_exige_caixa), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard), [ponto_qr_carimba_hora](funcoes.md#f-ponto_qr_carimba_hora), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario), [recebimento_segregacao_guard](funcoes.md#f-recebimento_segregacao_guard), [reenviar_cotacao_corrigida](funcoes.md#f-reenviar_cotacao_corrigida), [registrar_aporte_capital](funcoes.md#f-registrar_aporte_capital), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento), [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate), [user_profiles_bloquear_privesc](funcoes.md#f-user_profiles_bloquear_privesc)
- **Grava:** —

<a id="f-auth_opera_loja"></a>
## auth_opera_loja (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [cancelar_pedido_online](funcoes.md#f-cancelar_pedido_online), [confirmar_pedido_online](funcoes.md#f-confirmar_pedido_online), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard)
- **Grava:** —
- **Chama:** [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-auth_pode_filial"></a>
## auth_pode_filial (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_assert_caixa](funcoes.md#f-_assert_caixa), [_assert_lixeira_filial](funcoes.md#f-_assert_lixeira_filial), [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [analisar_promocao_financeiro](funcoes.md#f-analisar_promocao_financeiro), [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [aprovar_promocao](funcoes.md#f-aprovar_promocao), [apurar_das](funcoes.md#f-apurar_das), [atualizar_foto_usuario](funcoes.md#f-atualizar_foto_usuario), [auth_opera_loja](funcoes.md#f-auth_opera_loja), [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [baixar_lote_vencido](funcoes.md#f-baixar_lote_vencido), [beneficios_do_funcionario](funcoes.md#f-beneficios_do_funcionario), [cancelar_conciliacao_maquininha](funcoes.md#f-cancelar_conciliacao_maquininha), [cancelar_frete_compra](funcoes.md#f-cancelar_frete_compra), [cancelar_pedido_compra](funcoes.md#f-cancelar_pedido_compra), [cancelar_pedido_venda](funcoes.md#f-cancelar_pedido_venda), [composicao_custo_produto](funcoes.md#f-composicao_custo_produto), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [concluir_correcao_produto](funcoes.md#f-concluir_correcao_produto), [conferir_nota_fiscal](funcoes.md#f-conferir_nota_fiscal), [controle_caixa_guard](funcoes.md#f-controle_caixa_guard), [criar_requisicao_compra](funcoes.md#f-criar_requisicao_compra), [criar_requisicao_estoque](funcoes.md#f-criar_requisicao_estoque), [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [dar_baixa_patrimonio](funcoes.md#f-dar_baixa_patrimonio), [das_competencias](funcoes.md#f-das_competencias), [desempenho_funcionarios](funcoes.md#f-desempenho_funcionarios), [desvincular_investimento_conta](funcoes.md#f-desvincular_investimento_conta), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [emitir_nota](funcoes.md#f-emitir_nota), [encerrar_lote_consumido](funcoes.md#f-encerrar_lote_consumido), [encerrar_promocao](funcoes.md#f-encerrar_promocao), [expedir](funcoes.md#f-expedir), [fechar_inventario](funcoes.md#f-fechar_inventario), [gerar_contas_da_montagem](funcoes.md#f-gerar_contas_da_montagem), [gerar_dre](funcoes.md#f-gerar_dre), [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao), [lancar_frete_compra](funcoes.md#f-lancar_frete_compra), [lancar_investimento_filial](funcoes.md#f-lancar_investimento_filial), [liberar_requisicao_estoque](funcoes.md#f-liberar_requisicao_estoque), [movimentacao_caixa_guard](funcoes.md#f-movimentacao_caixa_guard), [movimentar_estoque](funcoes.md#f-movimentar_estoque), [nota_emitida_guard](funcoes.md#f-nota_emitida_guard), [pagar_folha](funcoes.md#f-pagar_folha), [pagar_rescisao](funcoes.md#f-pagar_rescisao), [parametros_precificacao](funcoes.md#f-parametros_precificacao), [pdv_registrar_credito_misto](funcoes.md#f-pdv_registrar_credito_misto), [pedidos_para_frete](funcoes.md#f-pedidos_para_frete), [processar_folha](funcoes.md#f-processar_folha), [processar_rescisao](funcoes.md#f-processar_rescisao), [reabrir_caixa](funcoes.md#f-reabrir_caixa), [reenviar_cotacao_corrigida](funcoes.md#f-reenviar_cotacao_corrigida), [registrar_devolucao_fornecedor](funcoes.md#f-registrar_devolucao_fornecedor), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [registrar_unidades_recebidas](funcoes.md#f-registrar_unidades_recebidas), [reprovar_promocao](funcoes.md#f-reprovar_promocao), [reservar_codigo_produto](funcoes.md#f-reservar_codigo_produto), [reservar_trabalho](funcoes.md#f-reservar_trabalho), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [responder_pesquisa](funcoes.md#f-responder_pesquisa), [responder_revisao_auditoria](funcoes.md#f-responder_revisao_auditoria), [salvar_lucro_servico](funcoes.md#f-salvar_lucro_servico), [salvar_parametros_precificacao](funcoes.md#f-salvar_parametros_precificacao), [separar_pedido_venda](funcoes.md#f-separar_pedido_venda), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento), [transferir_entre_contas](funcoes.md#f-transferir_entre_contas), [vender_patrimonio](funcoes.md#f-vender_patrimonio), [vincular_produto_requisicao](funcoes.md#f-vincular_produto_requisicao)
- **Grava:** —
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_user_filial](funcoes.md#f-auth_user_filial)

<a id="f-auth_registra_frequencia"></a>
## auth_registra_frequencia (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-auth_user_filial"></a>
## auth_user_filial (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [atividade_aula_alcanca](funcoes.md#f-atividade_aula_alcanca), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [aviso_matriz_alcanca](funcoes.md#f-aviso_matriz_alcanca), [listar_pendencias](funcoes.md#f-listar_pendencias), [minha_mesa](funcoes.md#f-minha_mesa), [notificar_setor](funcoes.md#f-notificar_setor), [parecer_justificativa_falta](funcoes.md#f-parecer_justificativa_falta), [responder_revisao_auditoria](funcoes.md#f-responder_revisao_auditoria)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-auth_user_role"></a>
## auth_user_role (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_aplicar_desligado_em](funcoes.md#f-_aplicar_desligado_em), [_assert_capital_holding](funcoes.md#f-_assert_capital_holding), [_assert_interfilial](funcoes.md#f-_assert_interfilial), [_assert_lixeira](funcoes.md#f-_assert_lixeira), [alternar_simulacao_perda](funcoes.md#f-alternar_simulacao_perda), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [atividade_aula_alcanca](funcoes.md#f-atividade_aula_alcanca), [auth_blackout](funcoes.md#f-auth_blackout), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_conselho](funcoes.md#f-auth_is_conselho), [aviso_matriz_alcanca](funcoes.md#f-aviso_matriz_alcanca), [concluir_correcao_produto](funcoes.md#f-concluir_correcao_produto), [controle_caixa_guard](funcoes.md#f-controle_caixa_guard), [dar_feedback_arte](funcoes.md#f-dar_feedback_arte), [decidir_desligamento](funcoes.md#f-decidir_desligamento), [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [decidir_vaga](funcoes.md#f-decidir_vaga), [declarar_vencedora](funcoes.md#f-declarar_vencedora), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [devolver_movimentacao_para_correcao](funcoes.md#f-devolver_movimentacao_para_correcao), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [encerrar_competicao_agora](funcoes.md#f-encerrar_competicao_agora), [excluir_competicao_matriz](funcoes.md#f-excluir_competicao_matriz), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard), [gerar_painel_bi](funcoes.md#f-gerar_painel_bi), [marcar_tarefa_aula](funcoes.md#f-marcar_tarefa_aula), [minha_mesa](funcoes.md#f-minha_mesa), [movimentacao_caixa_guard](funcoes.md#f-movimentacao_caixa_guard), [nomear_mandato](funcoes.md#f-nomear_mandato), [nomear_sessao_aula](funcoes.md#f-nomear_sessao_aula), [parecer_justificativa_falta](funcoes.md#f-parecer_justificativa_falta), [publicar_atividade_aula](funcoes.md#f-publicar_atividade_aula), [reabrir_competicao](funcoes.md#f-reabrir_competicao), [reabrir_cotacao](funcoes.md#f-reabrir_cotacao), [reabrir_requisicao](funcoes.md#f-reabrir_requisicao), [reabrir_requisicao_estoque](funcoes.md#f-reabrir_requisicao_estoque), [readmitir_funcionario](funcoes.md#f-readmitir_funcionario), [registrar_aporte_capital](funcoes.md#f-registrar_aporte_capital), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [remover_atividade_aula](funcoes.md#f-remover_atividade_aula), [remover_ponto](funcoes.md#f-remover_ponto), [resetar_dados_da_filial](funcoes.md#f-resetar_dados_da_filial), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais), [resetar_dados_operacionais_admin](funcoes.md#f-resetar_dados_operacionais_admin), [resetar_geral_admin](funcoes.md#f-resetar_geral_admin), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao), [user_profiles_bloquear_privesc](funcoes.md#f-user_profiles_bloquear_privesc), [vincular_sessao_aula](funcoes.md#f-vincular_sessao_aula)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-auth_user_setor"></a>
## auth_user_setor (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [dar_feedback_arte](funcoes.md#f-dar_feedback_arte), [marcar_todas_lidas](funcoes.md#f-marcar_todas_lidas), [notificar_setor](funcoes.md#f-notificar_setor)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-auth_user_setores"></a>
## auth_user_setores (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [auth_in_setor](funcoes.md#f-auth_in_setor)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_aula_setores](funcoes.md#f-auth_aula_setores)

<a id="f-autorizar_cartao_maxbank"></a>
## autorizar_cartao_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [cartao_pendentes](tabelas.md#t-cartao_pendentes), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Ao gravar, acorda os gatilhos de:** [cartao_pendentes](tabelas.md#t-cartao_pendentes) ([cartao_pendentes_set_paid_at](funcoes.md#f-cartao_pendentes_set_paid_at), [pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial), [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate)); [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura))
- **Lê:** [cartao_pendentes](tabelas.md#t-cartao_pendentes), [maxbank_contas](tabelas.md#t-maxbank_contas)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-avaliar_ciclo_tarefa"></a>
## avaliar_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes)
- **Ao gravar, acorda os gatilhos de:** [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes) ([trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at))
- **Lê:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Chama:** [_assert_pode_avaliar_ciclo_tarefa](funcoes.md#f-_assert_pode_avaliar_ciclo_tarefa)

<a id="f-avaliar_item_matriz"></a>
## avaliar_item_matriz (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz) ([fn_avaliacao_matriz_congela_avaliador](funcoes.md#f-fn_avaliacao_matriz_congela_avaliador), [trg_aval_matriz_updated_at](funcoes.md#f-trg_aval_matriz_updated_at))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_funcionario_desligado](funcoes.md#f-_funcionario_desligado)

<a id="f-avisa_financeiro_do_caixa"></a>
## avisa_financeiro_do_caixa (gatilho, SECURITY DEFINER)

- **Dispara em:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Grava:** —
- **Chama:** [brl](funcoes.md#f-brl), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-aviso_matriz_alcanca"></a>
## aviso_matriz_alcanca (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Chama:** [auth_user_filial](funcoes.md#f-auth_user_filial), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-baixar_conta_pagar"></a>
## baixar_conta_pagar (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **Chamada por outras funções:** [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_pagar](tabelas.md#t-contas_pagar), [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado)

<a id="f-baixar_conta_receber"></a>
## baixar_conta_receber (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber)
- **Chamada por outras funções:** [conciliar_maquininha](funcoes.md#f-conciliar_maquininha)
- **Grava:** [contas_receber](tabelas.md#t-contas_receber), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas)
- **Ao gravar, acorda os gatilhos de:** [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_receber](tabelas.md#t-contas_receber), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado)

<a id="f-baixar_lote_vencido"></a>
## baixar_lote_vencido (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Validades](telas.md#s-estoque-validades)
- **Grava:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo))
- **Lê:** [produtos](tabelas.md#t-produtos), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-beneficios_do_funcionario"></a>
## beneficios_do_funcionario (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **Grava:** —
- **Lê:** [beneficios](tabelas.md#t-beneficios), [funcionario_beneficios](tabelas.md#t-funcionario_beneficios), [funcionarios](tabelas.md#t-funcionarios)
- **Chama:** [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-beneficios_pendentes_gerar_codigo"></a>
## beneficios_pendentes_gerar_codigo (gatilho)

- **Dispara em:** [beneficios_pendentes](tabelas.md#t-beneficios_pendentes)
- **Grava:** —
- **Lê:** [beneficios_pendentes](tabelas.md#t-beneficios_pendentes)

<a id="f-beneficios_pendentes_set_paid_at"></a>
## beneficios_pendentes_set_paid_at (gatilho)

- **Dispara em:** [beneficios_pendentes](tabelas.md#t-beneficios_pendentes)
- **Grava:** —

<a id="f-bloqueia_conta_pagar_estourado"></a>
## bloqueia_conta_pagar_estourado (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** —
- **Chama:** [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital)

<a id="f-bloqueia_delete_aporte_com_caixa"></a>
## bloqueia_delete_aporte_com_caixa (gatilho, SECURITY DEFINER)

- **Dispara em:** [capital_filial](tabelas.md#t-capital_filial)
- **Grava:** —

<a id="f-bloqueia_fechamento_com_venda_em_curso"></a>
## bloqueia_fechamento_com_venda_em_curso (gatilho, SECURITY DEFINER)

- **Dispara em:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Grava:** —
- **Lê:** [aula_config](tabelas.md#t-aula_config), [cartao_pendentes](tabelas.md#t-cartao_pendentes), [pix_pendentes](tabelas.md#t-pix_pendentes)

<a id="f-brl"></a>
## brl (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [apagar_emprestimo](funcoes.md#f-apagar_emprestimo), [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [avisa_financeiro_do_caixa](funcoes.md#f-avisa_financeiro_do_caixa), [conceder_mutuo_capital](funcoes.md#f-conceder_mutuo_capital), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial), [editar_emprestimo](funcoes.md#f-editar_emprestimo), [emprestimo_arquivado_e_historico](funcoes.md#f-emprestimo_arquivado_e_historico), [estornar_aporte_capital](funcoes.md#f-estornar_aporte_capital), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao)
- **Grava:** —

<a id="f-buscar_destinatario_pix"></a>
## buscar_destinatario_pix (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-calcular_placar_competicao"></a>
## calcular_placar_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Servidor (api/) chama:** `api/ai-competicao.ts`
- **Chamada por outras funções:** [declarar_vencedora](funcoes.md#f-declarar_vencedora), [ranking_competicao](funcoes.md#f-ranking_competicao)
- **Grava:** —
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_calcular_placar_competicao_raw](funcoes.md#f-_calcular_placar_competicao_raw)

<a id="f-calcular_placar_padrao"></a>
## calcular_placar_padrao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** —
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-calcular_rescisao"></a>
## calcular_rescisao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **Chamada por outras funções:** [decidir_desligamento](funcoes.md#f-decidir_desligamento), [demitir_funcionario](funcoes.md#f-demitir_funcionario), [solicitar_desligamento](funcoes.md#f-solicitar_desligamento)
- **Grava:** —
- **Lê:** [ferias](tabelas.md#t-ferias), [funcionarios](tabelas.md#t-funcionarios)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [rh_calc_inss](funcoes.md#f-rh_calc_inss), [rh_calc_irrf](funcoes.md#f-rh_calc_irrf), [rh_fgts_acumulado](funcoes.md#f-rh_fgts_acumulado), [rh_media_variaveis](funcoes.md#f-rh_media_variaveis), [rh_vigencia_em](funcoes.md#f-rh_vigencia_em)

<a id="f-calcular_saldo_capital"></a>
## calcular_saldo_capital (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos), [Financeiro › Capital](telas.md#s-financeiro-capital), [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Capital](telas.md#s-matriz-capital)
- **Chamada por outras funções:** [antecipar_parcela_emprestimo](funcoes.md#f-antecipar_parcela_emprestimo), [bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial)
- **Grava:** —
- **Lê:** [capital_config](tabelas.md#t-capital_config), [capital_filial](tabelas.md#t-capital_filial), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [distribuicoes_lucro](tabelas.md#t-distribuicoes_lucro), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today)

<a id="f-calcular_valor_atualizado"></a>
## calcular_valor_atualizado (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [baixar_conta_pagar](funcoes.md#f-baixar_conta_pagar), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [conciliar_maquininha](funcoes.md#f-conciliar_maquininha), [registrar_pagamento_conta](funcoes.md#f-registrar_pagamento_conta)
- **Grava:** —
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas), [contas_receber](tabelas.md#t-contas_receber), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas), [financeiro_config](tabelas.md#t-financeiro_config)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today)

<a id="f-cancelar_conciliacao_maquininha"></a>
## cancelar_conciliacao_maquininha (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha)
- **Grava:** [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber))
- **Lê:** [conciliacao_maquininha_itens](tabelas.md#t-conciliacao_maquininha_itens), [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-cancelar_convite_vaga"></a>
## cancelar_convite_vaga (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [vaga_convites](tabelas.md#t-vaga_convites)
- **Lê:** [vaga_convites](tabelas.md#t-vaga_convites)
- **Chama:** [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-cancelar_frete_compra"></a>
## cancelar_frete_compra (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [fretes_compra](tabelas.md#t-fretes_compra)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_cancelar_frete_compra](funcoes.md#f-_cancelar_frete_compra), [auth_pode_filial](funcoes.md#f-auth_pode_filial)
- **Liga flags de sessão:** `app.frete_compra`

<a id="f-cancelar_meta_estrategica"></a>
## cancelar_meta_estrategica (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** —
- **Chama:** [encerrar_meta_estrategica](funcoes.md#f-encerrar_meta_estrategica)

<a id="f-cancelar_pedido_compra"></a>
## cancelar_pedido_compra (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Compras › Pedidos](telas.md#s-compras-pedidos)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [pedidos](tabelas.md#t-pedidos), [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [pedidos](tabelas.md#t-pedidos) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_pedido_avisa_estoque](funcoes.md#f-fn_pedido_avisa_estoque), [fn_pedido_congela_compra](funcoes.md#f-fn_pedido_congela_compra), [fn_pedido_marca_recebimento](funcoes.md#f-fn_pedido_marca_recebimento), [fn_pedido_transicao_valida](funcoes.md#f-fn_pedido_transicao_valida), [set_numero_documento](funcoes.md#f-set_numero_documento)); [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)
- **Liga flags de sessão:** `app.conta_pedido_baixa`

<a id="f-cancelar_pedido_online"></a>
## cancelar_pedido_online (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Grava:** [pedidos_online](tabelas.md#t-pedidos_online)
- **Ao gravar, acorda os gatilhos de:** [pedidos_online](tabelas.md#t-pedidos_online) ([loja_apelido_limpo](funcoes.md#f-loja_apelido_limpo))
- **Lê:** [pedidos_online](tabelas.md#t-pedidos_online), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_opera_loja](funcoes.md#f-auth_opera_loja)

<a id="f-cancelar_pedido_venda"></a>
## cancelar_pedido_venda (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
- **Grava:** [contas_receber](tabelas.md#t-contas_receber), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [orcamentos](tabelas.md#t-orcamentos), [pedidos_venda](tabelas.md#t-pedidos_venda), [vendas](tabelas.md#t-vendas)
- **Ao gravar, acorda os gatilhos de:** [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo)); [orcamentos](tabelas.md#t-orcamentos) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_orcamento_condicao_pagamento](funcoes.md#f-fn_orcamento_condicao_pagamento), [set_numero_documento](funcoes.md#f-set_numero_documento)); [pedidos_venda](tabelas.md#t-pedidos_venda) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_pedido_venda_status_pelos_marcos](funcoes.md#f-fn_pedido_venda_status_pelos_marcos), [set_numero_documento](funcoes.md#f-set_numero_documento)); [vendas](tabelas.md#t-vendas) ([fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz), [fn_venda_de_pedido_so_pelo_pedido](funcoes.md#f-fn_venda_de_pedido_so_pelo_pedido), [fn_venda_dinheiro_exige_caixa](funcoes.md#f-fn_venda_dinheiro_exige_caixa), [venda_fiado_respeita_credito](funcoes.md#f-venda_fiado_respeita_credito))
- **Lê:** [contas_receber](tabelas.md#t-contas_receber), [devolucoes](tabelas.md#t-devolucoes), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos_venda](tabelas.md#t-pedidos_venda), [vendas](tabelas.md#t-vendas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial)
- **Liga flags de sessão:** `app.cancelando_pedido_venda`

<a id="f-cancelar_vaga"></a>
## cancelar_vaga (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [vagas](tabelas.md#t-vagas)
- **Lê:** [vagas](tabelas.md#t-vagas)
- **Chama:** [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-cartao_pendentes_set_paid_at"></a>
## cartao_pendentes_set_paid_at (gatilho)

- **Dispara em:** [cartao_pendentes](tabelas.md#t-cartao_pendentes)
- **Grava:** —

<a id="f-cliente_saldo_devedor"></a>
## cliente_saldo_devedor (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv)
- **Chamada por outras funções:** [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [venda_fiado_respeita_credito](funcoes.md#f-venda_fiado_respeita_credito)
- **Grava:** —
- **Lê:** [contas_receber](tabelas.md#t-contas_receber), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-cliente_titulos_vencidos"></a>
## cliente_titulos_vencidos (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos), [Vendas › PDV](telas.md#s-vendas-pdv)
- **Chamada por outras funções:** [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [venda_fiado_respeita_credito](funcoes.md#f-venda_fiado_respeita_credito)
- **Grava:** —
- **Lê:** [contas_receber](tabelas.md#t-contas_receber)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today)

<a id="f-coletar_textos_fluxo"></a>
## coletar_textos_fluxo (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Servidor (api/) chama:** `api/ai-aula-atividade.ts`
- **Grava:** —
- **Lê:** [aula_sessoes](tabelas.md#t-aula_sessoes), [categorias_produto](tabelas.md#t-categorias_produto), [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [similarity](funcoes.md#f-similarity)

<a id="f-competicao_apaga_ciclo_matriz"></a>
## competicao_apaga_ciclo_matriz (gatilho, SECURITY DEFINER)

- **Dispara em:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Grava:** [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)

<a id="f-competicao_criar_ciclo_matriz"></a>
## competicao_criar_ciclo_matriz (gatilho, SECURITY DEFINER)

- **Dispara em:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Grava:** [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)

<a id="f-competicao_sync_ciclo_matriz"></a>
## competicao_sync_ciclo_matriz (gatilho, SECURITY DEFINER)

- **Dispara em:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Grava:** [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)

<a id="f-composicao_custo_produto"></a>
## composicao_custo_produto (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos)
- **Grava:** —
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [fornecedores](tabelas.md#t-fornecedores), [fretes_compra](tabelas.md#t-fretes_compra), [fretes_compra_rateio](tabelas.md#t-fretes_compra_rateio), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo), [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-conceder_mutuo_capital"></a>
## conceder_mutuo_capital (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Capital](telas.md#s-matriz-capital)
- **Grava:** [emprestimos_filial](tabelas.md#t-emprestimos_filial)
- **Ao gravar, acorda os gatilhos de:** [emprestimos_filial](tabelas.md#t-emprestimos_filial) ([emprestimo_arquivado_e_historico](funcoes.md#f-emprestimo_arquivado_e_historico), [emprestimo_valida_condicoes](funcoes.md#f-emprestimo_valida_condicoes))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_capital_holding](funcoes.md#f-_assert_capital_holding), [aprovar_emprestimo](funcoes.md#f-aprovar_emprestimo), [brl](funcoes.md#f-brl), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-conciliar_maquininha"></a>
## conciliar_maquininha (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Conciliação da Maquininha](telas.md#s-financeiro-conciliaçãodamaquininha)
- **Grava:** [conciliacao_maquininha_itens](tabelas.md#t-conciliacao_maquininha_itens), [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha), [contas_pagar](tabelas.md#t-contas_pagar)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_receber](tabelas.md#t-contas_receber), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas), [formas_pagamento](tabelas.md#t-formas_pagamento)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [baixar_conta_receber](funcoes.md#f-baixar_conta_receber), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado)
- **Liga flags de sessão:** `app.conciliando_maquininha`

<a id="f-concluir_correcao_produto"></a>
## concluir_correcao_produto (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos)
- **Grava:** [produtos](tabelas.md#t-produtos)
- **Ao gravar, acorda os gatilhos de:** [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo))
- **Lê:** [produtos](tabelas.md#t-produtos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [auth_user_role](funcoes.md#f-auth_user_role)
- **Liga flags de sessão:** `app.allow_correcao_update`

<a id="f-concluir_meta_estrategica"></a>
## concluir_meta_estrategica (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura)); [metas_estrategicas](tabelas.md#t-metas_estrategicas) ([metas_estrategicas_set_updated_at](funcoes.md#f-metas_estrategicas_set_updated_at))
- **Lê:** [maxbank_contas](tabelas.md#t-maxbank_contas), [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [gerar_folgas_acumulado](funcoes.md#f-gerar_folgas_acumulado)

<a id="f-concluir_meta_maxbank"></a>
## concluir_meta_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [maxbank_metas](tabelas.md#t-maxbank_metas)
- **Ao gravar, acorda os gatilhos de:** [maxbank_metas](tabelas.md#t-maxbank_metas) ([maxbank_metas_set_updated_at](funcoes.md#f-maxbank_metas_set_updated_at))
- **Lê:** [maxbank_metas](tabelas.md#t-maxbank_metas)

<a id="f-concluir_tarefa_tatica"></a>
## concluir_tarefa_tatica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Ao gravar, acorda os gatilhos de:** [tarefas_taticas](tabelas.md#t-tarefas_taticas) ([tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at))
- **Lê:** [tarefas_taticas](tabelas.md#t-tarefas_taticas)

<a id="f-condicao_pagamento_dias"></a>
## condicao_pagamento_dias (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao)
- **Grava:** —

<a id="f-conferir_nota_fiscal"></a>
## conferir_nota_fiscal (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)
- **Liga flags de sessão:** `app.conta_pedido_nf`

<a id="f-confirmar_cartao_pendente"></a>
## confirmar_cartao_pendente (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [cartao_pendentes](tabelas.md#t-cartao_pendentes)
- **Ao gravar, acorda os gatilhos de:** [cartao_pendentes](tabelas.md#t-cartao_pendentes) ([cartao_pendentes_set_paid_at](funcoes.md#f-cartao_pendentes_set_paid_at), [pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial), [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate))

<a id="f-confirmar_fechamento_caixa"></a>
## confirmar_fechamento_caixa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa)
- **Grava:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Ao gravar, acorda os gatilhos de:** [controle_caixa](tabelas.md#t-controle_caixa) ([avisa_financeiro_do_caixa](funcoes.md#f-avisa_financeiro_do_caixa), [bloqueia_fechamento_com_venda_em_curso](funcoes.md#f-bloqueia_fechamento_com_venda_em_curso), [controle_caixa_guard](funcoes.md#f-controle_caixa_guard))
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_caixa](funcoes.md#f-_assert_caixa), [dinheiro_do_caixa](funcoes.md#f-dinheiro_do_caixa)

<a id="f-confirmar_pedido_online"></a>
## confirmar_pedido_online (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Vendas › Pedidos Online](telas.md#s-vendas-pedidosonline)
- **Grava:** [pedidos_online](tabelas.md#t-pedidos_online)
- **Ao gravar, acorda os gatilhos de:** [pedidos_online](tabelas.md#t-pedidos_online) ([loja_apelido_limpo](funcoes.md#f-loja_apelido_limpo))
- **Lê:** [pedidos_online](tabelas.md#t-pedidos_online), [pedidos_online_itens](tabelas.md#t-pedidos_online_itens), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_opera_loja](funcoes.md#f-auth_opera_loja), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv), [normalizar_nome](funcoes.md#f-normalizar_nome)

<a id="f-confirmar_pix_pendente"></a>
## confirmar_pix_pendente (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [pix_pendentes](tabelas.md#t-pix_pendentes)
- **Ao gravar, acorda os gatilhos de:** [pix_pendentes](tabelas.md#t-pix_pendentes) ([pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial), [pix_pendentes_set_paid_at](funcoes.md#f-pix_pendentes_set_paid_at), [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate))

<a id="f-consultar_status_cobranca"></a>
## consultar_status_cobranca (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [cartao_pendentes](tabelas.md#t-cartao_pendentes), [pix_pendentes](tabelas.md#t-pix_pendentes)

<a id="f-conta_com_dinheiro_nao_exclui"></a>
## conta_com_dinheiro_nao_exclui (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber)
- **Grava:** —
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-conta_pagar_avancar_folha_e_creditar"></a>
## conta_pagar_avancar_folha_e_creditar (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** —
- **Chama:** [_folha_creditar_e_avancar](funcoes.md#f-_folha_creditar_e_avancar)

<a id="f-conta_pagar_avancar_rescisao"></a>
## conta_pagar_avancar_rescisao (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** [rescisoes](tabelas.md#t-rescisoes)
- **Chama:** [creditar_rescisao_maxbank](funcoes.md#f-creditar_rescisao_maxbank), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-conta_pagar_exige_recebimento"></a>
## conta_pagar_exige_recebimento (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** —
- **Lê:** [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-contar_minha_mesa"></a>
## contar_minha_mesa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Mesa gestor *(rota mesa-gestor)*](telas.md#s-mesa-gestor)
- **Grava:** —
- **Chama:** [minha_mesa](funcoes.md#f-minha_mesa)

<a id="f-contar_pendencias"></a>
## contar_pendencias (RPC)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [cotacoes](tabelas.md#t-cotacoes), [desenvolvimentos_ia](tabelas.md#t-desenvolvimentos_ia), [expedicao](tabelas.md#t-expedicao), [ferias](tabelas.md#t-ferias), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [marketing_tarefas](tabelas.md#t-marketing_tarefas), [metas_estrategicas](tabelas.md#t-metas_estrategicas), [orcamentos](tabelas.md#t-orcamentos), [pedidos](tabelas.md#t-pedidos), [pedidos_venda](tabelas.md#t-pedidos_venda), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [v_pedidos_a_receber](tabelas.md#t-v_pedidos_a_receber)

<a id="f-contar_tentativa_codigo_ponto"></a>
## contar_tentativa_codigo_ponto (RPC)

- **Telas que chamam:** —
- **Servidor (api/) chama:** `api/register-ponto.ts`
- **Grava:** [ponto_codigo_tentativas](tabelas.md#t-ponto_codigo_tentativas)

<a id="f-contar_uso_ia"></a>
## contar_uso_ia (RPC)

- **Telas que chamam:** —
- **Grava:** [ia_uso_por_hora](tabelas.md#t-ia_uso_por_hora)

<a id="f-contar_votantes_matriz"></a>
## contar_votantes_matriz (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Chamada por outras funções:** [_competicao_empatada](funcoes.md#f-_competicao_empatada), [declarar_vencedora](funcoes.md#f-declarar_vencedora), [lembrar_avaliacoes_pendentes](funcoes.md#f-lembrar_avaliacoes_pendentes), [participantes_sem_nota_competicao](funcoes.md#f-participantes_sem_nota_competicao), [progresso_votacao_competicao](funcoes.md#f-progresso_votacao_competicao)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-contrato_representa"></a>
## contrato_representa (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [assinar_contrato](funcoes.md#f-assinar_contrato), [encerrar_contrato](funcoes.md#f-encerrar_contrato), [minha_mesa](funcoes.md#f-minha_mesa), [recusar_contrato](funcoes.md#f-recusar_contrato)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-contratos_carimbo"></a>
## contratos_carimbo (gatilho, SECURITY DEFINER)

- **Dispara em:** [contratos](tabelas.md#t-contratos)
- **Grava:** —
- **Lê:** [contratos](tabelas.md#t-contratos), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-controle_caixa_guard"></a>
## controle_caixa_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Grava:** —
- **Chama:** [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-converter_orcamento_em_pedido"></a>
## converter_orcamento_em_pedido (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **Grava:** [contas_receber](tabelas.md#t-contas_receber), [itens_venda](tabelas.md#t-itens_venda), [orcamentos](tabelas.md#t-orcamentos), [pedidos_venda](tabelas.md#t-pedidos_venda), [vendas](tabelas.md#t-vendas), [vendas_pagamentos](tabelas.md#t-vendas_pagamentos)
- **Ao gravar, acorda os gatilhos de:** [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [itens_venda](tabelas.md#t-itens_venda) ([fn_item_venda_aloca_unidade](funcoes.md#f-fn_item_venda_aloca_unidade), [fn_item_venda_so_mercadoria](funcoes.md#f-fn_item_venda_so_mercadoria), [fn_itens_venda_carimba_custo](funcoes.md#f-fn_itens_venda_carimba_custo), [fn_valida_filial_item_venda](funcoes.md#f-fn_valida_filial_item_venda)); [orcamentos](tabelas.md#t-orcamentos) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_orcamento_condicao_pagamento](funcoes.md#f-fn_orcamento_condicao_pagamento), [set_numero_documento](funcoes.md#f-set_numero_documento)); [pedidos_venda](tabelas.md#t-pedidos_venda) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_pedido_venda_status_pelos_marcos](funcoes.md#f-fn_pedido_venda_status_pelos_marcos), [set_numero_documento](funcoes.md#f-set_numero_documento)); [vendas](tabelas.md#t-vendas) ([fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz), [fn_venda_de_pedido_so_pelo_pedido](funcoes.md#f-fn_venda_de_pedido_so_pelo_pedido), [fn_venda_dinheiro_exige_caixa](funcoes.md#f-fn_venda_dinheiro_exige_caixa), [venda_fiado_respeita_credito](funcoes.md#f-venda_fiado_respeita_credito))
- **Lê:** [clientes](tabelas.md#t-clientes), [formas_pagamento](tabelas.md#t-formas_pagamento), [orcamentos](tabelas.md#t-orcamentos), [pedidos_venda](tabelas.md#t-pedidos_venda), [servicos](tabelas.md#t-servicos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [cliente_saldo_devedor](funcoes.md#f-cliente_saldo_devedor), [cliente_titulos_vencidos](funcoes.md#f-cliente_titulos_vencidos), [emitir_nota](funcoes.md#f-emitir_nota), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-convocar_para_vaga"></a>
## convocar_para_vaga (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [vaga_convites](tabelas.md#t-vaga_convites)
- **Lê:** [candidaturas](tabelas.md#t-candidaturas), [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles), [vagas](tabelas.md#t-vagas)
- **Chama:** [_assert_interfilial](funcoes.md#f-_assert_interfilial), [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc), [media_avaliacao_funcionario](funcoes.md#f-media_avaliacao_funcionario)

<a id="f-corrigir_requisicao_compra"></a>
## corrigir_requisicao_compra (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra)
- **Grava:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)); [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [cotacoes](tabelas.md#t-cotacoes), [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-cotacao_decisao_guard"></a>
## cotacao_decisao_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [cotacoes](tabelas.md#t-cotacoes)
- **Grava:** —
- **Lê:** [alcadas_compra](tabelas.md#t-alcadas_compra), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin)

<a id="f-cotacao_proposta_unica_por_fornecedor"></a>
## cotacao_proposta_unica_por_fornecedor (gatilho, SECURITY DEFINER)

- **Dispara em:** [cotacoes](tabelas.md#t-cotacoes)
- **Grava:** —
- **Lê:** [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-cotacoes_unica_aprovada"></a>
## cotacoes_unica_aprovada (gatilho, SECURITY DEFINER)

- **Dispara em:** [cotacoes](tabelas.md#t-cotacoes)
- **Grava:** —
- **Lê:** [cotacoes](tabelas.md#t-cotacoes)

<a id="f-creditar_folha_maxbank"></a>
## creditar_folha_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_folha_creditar_e_avancar](funcoes.md#f-_folha_creditar_e_avancar)
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura))
- **Lê:** [folha_pagamento](tabelas.md#t-folha_pagamento), [funcionarios](tabelas.md#t-funcionarios), [maxbank_contas](tabelas.md#t-maxbank_contas)

<a id="f-creditar_rescisao_maxbank"></a>
## creditar_rescisao_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [pagar_rescisao](funcoes.md#f-pagar_rescisao)
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [maxbank_contas](tabelas.md#t-maxbank_contas), [rescisoes](tabelas.md#t-rescisoes)

<a id="f-criar_avaliacao"></a>
## criar_avaliacao (RPC)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [avaliacoes](tabelas.md#t-avaliacoes), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes](tabelas.md#t-avaliacoes) ([fn_avaliacoes_filial_from_ciclo](funcoes.md#f-fn_avaliacoes_filial_from_ciclo))
- **Lê:** [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)

<a id="f-criar_avaliacao_filial"></a>
## criar_avaliacao_filial (RPC)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [avaliacoes](tabelas.md#t-avaliacoes), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes](tabelas.md#t-avaliacoes) ([fn_avaliacoes_filial_from_ciclo](funcoes.md#f-fn_avaliacoes_filial_from_ciclo))
- **Lê:** [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)

<a id="f-criar_avaliacao_ti_dev_ia"></a>
## criar_avaliacao_ti_dev_ia (RPC)

- **Telas que chamam:** [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
- **Grava:** [avaliacoes](tabelas.md#t-avaliacoes), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes](tabelas.md#t-avaliacoes) ([fn_avaliacoes_filial_from_ciclo](funcoes.md#f-fn_avaliacoes_filial_from_ciclo))

<a id="f-criar_aviso_matriz"></a>
## criar_aviso_matriz (RPC)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes)
- **Grava:** [avisos_matriz](tabelas.md#t-avisos_matriz)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-criar_ciclo_tarefa"></a>
## criar_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Ao gravar, acorda os gatilhos de:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas) ([trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at))
- **Lê:** [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Chama:** [_assert_ciclo_tarefa_gestor](funcoes.md#f-_assert_ciclo_tarefa_gestor)

<a id="f-criar_competicao"></a>
## criar_competicao (RPC)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Ao gravar, acorda os gatilhos de:** [competicoes_matriz](tabelas.md#t-competicoes_matriz) ([competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz), [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz), [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz))
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-criar_devolucao_venda"></a>
## criar_devolucao_venda (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Vendas › Devoluções](telas.md#s-vendas-devoluções), [Vendas › PDV](telas.md#s-vendas-pdv)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [devolucoes](tabelas.md#t-devolucoes), [itens_devolucao](tabelas.md#t-itens_devolucao), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [devolucoes](tabelas.md#t-devolucoes) ([devolucao_valida_filial_da_venda](funcoes.md#f-devolucao_valida_filial_da_venda)); [itens_devolucao](tabelas.md#t-itens_devolucao) ([fn_item_devolucao_devolve_unidade](funcoes.md#f-fn_item_devolucao_devolve_unidade)); [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa) ([movimentacao_caixa_guard](funcoes.md#f-movimentacao_caixa_guard)); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo))
- **Lê:** [contas_receber](tabelas.md#t-contas_receber), [controle_caixa](tabelas.md#t-controle_caixa), [devolucoes](tabelas.md#t-devolucoes), [itens_devolucao](tabelas.md#t-itens_devolucao), [itens_venda](tabelas.md#t-itens_venda), [pedidos_venda](tabelas.md#t-pedidos_venda), [user_profiles](tabelas.md#t-user_profiles), [v_venda_saldo_devolucao](tabelas.md#t-v_venda_saldo_devolucao), [vendas](tabelas.md#t-vendas)
- **Chama:** [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin)
- **Liga flags de sessão:** `app.devolucao_caixa`

<a id="f-criar_matriz_tarefa"></a>
## criar_matriz_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Ao gravar, acorda os gatilhos de:** [matriz_tarefas](tabelas.md#t-matriz_tarefas) ([trg_matriz_tarefas_updated_at](funcoes.md#f-trg_matriz_tarefas_updated_at))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-criar_maxbank_conta_para_colaborador"></a>
## criar_maxbank_conta_para_colaborador (gatilho, SECURITY DEFINER)

- **Dispara em:** [user_profiles](tabelas.md#t-user_profiles)
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at))

<a id="f-criar_meta_estrategica"></a>
## criar_meta_estrategica (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Ao gravar, acorda os gatilhos de:** [metas_estrategicas](tabelas.md#t-metas_estrategicas) ([metas_estrategicas_set_updated_at](funcoes.md#f-metas_estrategicas_set_updated_at))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-criar_meta_maxbank"></a>
## criar_meta_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [maxbank_metas](tabelas.md#t-maxbank_metas)
- **Ao gravar, acorda os gatilhos de:** [maxbank_metas](tabelas.md#t-maxbank_metas) ([maxbank_metas_set_updated_at](funcoes.md#f-maxbank_metas_set_updated_at))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-criar_requisicao_compra"></a>
## criar_requisicao_compra (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)); [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-criar_requisicao_estoque"></a>
## criar_requisicao_estoque (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Grava:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)); [requisicoes_estoque](tabelas.md#t-requisicoes_estoque) ([aprovacao_estoque_segue_a_requisicao](funcoes.md#f-aprovacao_estoque_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard), [requisicao_estoque_marca_reenvio](funcoes.md#f-requisicao_estoque_marca_reenvio))
- **Lê:** [centros_custo](tabelas.md#t-centros_custo), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-criar_requisicoes_compra_lote"></a>
## criar_requisicoes_compra_lote (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Compras › Sugestões de compras](telas.md#s-compras-sugestõesdecompras), [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Grava:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)); [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [embalagem_compra_valida](funcoes.md#f-embalagem_compra_valida), [unidade_fracionaria](funcoes.md#f-unidade_fracionaria)

<a id="f-criar_tarefa_tatica"></a>
## criar_tarefa_tatica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Ao gravar, acorda os gatilhos de:** [tarefas_taticas](tabelas.md#t-tarefas_taticas) ([tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at))
- **Lê:** [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-criar_venda_pdv"></a>
## criar_venda_pdv (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Vendas › PDV](telas.md#s-vendas-pdv)
- **Chamada por outras funções:** [confirmar_pedido_online](funcoes.md#f-confirmar_pedido_online)
- **Grava:** [contas_receber](tabelas.md#t-contas_receber), [itens_venda](tabelas.md#t-itens_venda), [marketing_cupons](tabelas.md#t-marketing_cupons), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [vendas](tabelas.md#t-vendas), [vendas_pagamentos](tabelas.md#t-vendas_pagamentos)
- **Ao gravar, acorda os gatilhos de:** [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [itens_venda](tabelas.md#t-itens_venda) ([fn_item_venda_aloca_unidade](funcoes.md#f-fn_item_venda_aloca_unidade), [fn_item_venda_so_mercadoria](funcoes.md#f-fn_item_venda_so_mercadoria), [fn_itens_venda_carimba_custo](funcoes.md#f-fn_itens_venda_carimba_custo), [fn_valida_filial_item_venda](funcoes.md#f-fn_valida_filial_item_venda)); [marketing_cupons](tabelas.md#t-marketing_cupons) ([trg_marketing_cupons_updated_at](funcoes.md#f-trg_marketing_cupons_updated_at)); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo)); [vendas](tabelas.md#t-vendas) ([fn_venda_cancelada_desfaz](funcoes.md#f-fn_venda_cancelada_desfaz), [fn_venda_de_pedido_so_pelo_pedido](funcoes.md#f-fn_venda_de_pedido_so_pelo_pedido), [fn_venda_dinheiro_exige_caixa](funcoes.md#f-fn_venda_dinheiro_exige_caixa), [venda_fiado_respeita_credito](funcoes.md#f-venda_fiado_respeita_credito))
- **Lê:** [clientes](tabelas.md#t-clientes), [marketing_cupons](tabelas.md#t-marketing_cupons), [produtos](tabelas.md#t-produtos), [servicos](tabelas.md#t-servicos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_tipo_da_forma_pdv](funcoes.md#f-_tipo_da_forma_pdv), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [emitir_nota](funcoes.md#f-emitir_nota), [preco_efetivo](funcoes.md#f-preco_efetivo)

<a id="f-custo_manual_nao_passa_do_preco_de_venda"></a>
## custo_manual_nao_passa_do_preco_de_venda (gatilho, SECURITY DEFINER)

- **Dispara em:** [produtos_custo](tabelas.md#t-produtos_custo)
- **Grava:** —
- **Lê:** [produtos](tabelas.md#t-produtos)

<a id="f-dar_baixa_patrimonio"></a>
## dar_baixa_patrimonio (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
- **Grava:** [produtos](tabelas.md#t-produtos)
- **Ao gravar, acorda os gatilhos de:** [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo))
- **Lê:** [produtos](tabelas.md#t-produtos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-dar_ciencia_atividade"></a>
## dar_ciencia_atividade (RPC)

- **Telas que chamam:** [Atividade da aula](telas.md#s-aula-atividade), [Modo Aula](telas.md#s-aula-modo)
- **Grava:** [aula_atividades_ciencia](tabelas.md#t-aula_atividades_ciencia)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-dar_ciencia_aviso"></a>
## dar_ciencia_aviso (RPC)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes)
- **Grava:** [avisos_matriz_ciencia](tabelas.md#t-avisos_matriz_ciencia)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-dar_ciencia_requisicao"></a>
## dar_ciencia_requisicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [requisicao_ciencia](tabelas.md#t-requisicao_ciencia)
- **Lê:** [requisicoes](tabelas.md#t-requisicoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-dar_ciencia_requisicao_estoque"></a>
## dar_ciencia_requisicao_estoque (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [requisicao_estoque_ciencia](tabelas.md#t-requisicao_estoque_ciencia)
- **Lê:** [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-dar_feedback_arte"></a>
## dar_feedback_arte (RPC)

- **Telas que chamam:** —
- **Grava:** [marketing_arte_feedback](tabelas.md#t-marketing_arte_feedback)
- **Ao gravar, acorda os gatilhos de:** [marketing_arte_feedback](tabelas.md#t-marketing_arte_feedback) ([trg_marketing_arte_feedback_updated_at](funcoes.md#f-trg_marketing_arte_feedback_updated_at))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role), [auth_user_setor](funcoes.md#f-auth_user_setor)

<a id="f-das_competencias"></a>
## das_competencias (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- **Grava:** —
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [das_apuracoes](tabelas.md#t-das_apuracoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_simples_do_mes](funcoes.md#f-_simples_do_mes), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [vencimento_das](funcoes.md#f-vencimento_das)

<a id="f-debitar_maxbank_beneficios"></a>
## debitar_maxbank_beneficios (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura))
- **Lê:** [maxbank_contas](tabelas.md#t-maxbank_contas)

<a id="f-debitar_maxbank_salario"></a>
## debitar_maxbank_salario (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura))
- **Lê:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)

<a id="f-decidir_cotacao"></a>
## decidir_cotacao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **Grava:** [cotacoes](tabelas.md#t-cotacoes)
- **Ao gravar, acorda os gatilhos de:** [cotacoes](tabelas.md#t-cotacoes) ([cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard), [cotacao_proposta_unica_por_fornecedor](funcoes.md#f-cotacao_proposta_unica_por_fornecedor), [cotacoes_unica_aprovada](funcoes.md#f-cotacoes_unica_aprovada), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_cotacao_aprovada_congela](funcoes.md#f-fn_cotacao_aprovada_congela), [fn_cotacao_com_pedido_nao_volta](funcoes.md#f-fn_cotacao_com_pedido_nao_volta), [fn_cotacao_marca_so_na_eventual](funcoes.md#f-fn_cotacao_marca_so_na_eventual), [set_numero_documento](funcoes.md#f-set_numero_documento))
- **Lê:** [cotacoes](tabelas.md#t-cotacoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today)
- **Liga flags de sessão:** `app.cotacao_decisao`

<a id="f-decidir_desligamento"></a>
## decidir_desligamento (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **Grava:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios)
- **Ao gravar, acorda os gatilhos de:** [funcionarios](tabelas.md#t-funcionarios) ([fn_funcionario_excluido_sai_das_tarefas](funcoes.md#f-fn_funcionario_excluido_sai_das_tarefas), [funcionarios_autovincular_user_profile](funcoes.md#f-funcionarios_autovincular_user_profile), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard))
- **Lê:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_aplicar_desligado_em](funcoes.md#f-_aplicar_desligado_em), [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role), [calcular_rescisao](funcoes.md#f-calcular_rescisao), [rescisao_gravar](funcoes.md#f-rescisao_gravar)

<a id="f-decidir_justificativa_falta"></a>
## decidir_justificativa_falta (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Grava:** [justificativas_falta](tabelas.md#t-justificativas_falta), [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Ao gravar, acorda os gatilhos de:** [ponto_eletronico](tabelas.md#t-ponto_eletronico) ([fn_ponto_filial_from_funcionario](funcoes.md#f-fn_ponto_filial_from_funcionario), [fn_ponto_recusa_dia_de_folga](funcoes.md#f-fn_ponto_recusa_dia_de_folga))
- **Lê:** [justificativas_falta](tabelas.md#t-justificativas_falta), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [ponto_jornada](tabelas.md#t-ponto_jornada), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_freq_credito_dia](funcoes.md#f-_freq_credito_dia), [_funcionario_da_conta](funcoes.md#f-_funcionario_da_conta), [auth_user_role](funcoes.md#f-auth_user_role), [ponto_corte_turma](funcoes.md#f-ponto_corte_turma)

<a id="f-decidir_requisicao_compra"></a>
## decidir_requisicao_compra (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **Grava:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [cotacoes](tabelas.md#t-cotacoes), [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)); [cotacoes](tabelas.md#t-cotacoes) ([cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard), [cotacao_proposta_unica_por_fornecedor](funcoes.md#f-cotacao_proposta_unica_por_fornecedor), [cotacoes_unica_aprovada](funcoes.md#f-cotacoes_unica_aprovada), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_cotacao_aprovada_congela](funcoes.md#f-fn_cotacao_aprovada_congela), [fn_cotacao_com_pedido_nao_volta](funcoes.md#f-fn_cotacao_com_pedido_nao_volta), [fn_cotacao_marca_so_na_eventual](funcoes.md#f-fn_cotacao_marca_so_na_eventual), [set_numero_documento](funcoes.md#f-set_numero_documento)); [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [pedidos](tabelas.md#t-pedidos), [requisicoes](tabelas.md#t-requisicoes), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-decidir_vaga"></a>
## decidir_vaga (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [vagas](tabelas.md#t-vagas)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles), [vagas](tabelas.md#t-vagas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-declarar_vencedora"></a>
## declarar_vencedora (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Ao gravar, acorda os gatilhos de:** [competicoes_matriz](tabelas.md#t-competicoes_matriz) ([competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz), [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz), [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Chama:** [_competicao_votos_validos](funcoes.md#f-_competicao_votos_validos), [_sugestao_rejeicao_competicao](funcoes.md#f-_sugestao_rejeicao_competicao), [auth_user_role](funcoes.md#f-auth_user_role), [calcular_placar_competicao](funcoes.md#f-calcular_placar_competicao), [contar_votantes_matriz](funcoes.md#f-contar_votantes_matriz), [participantes_sem_nota_competicao](funcoes.md#f-participantes_sem_nota_competicao), [ranking_competicao](funcoes.md#f-ranking_competicao)

<a id="f-definir_avaliadores_ciclo_tarefa"></a>
## definir_avaliadores_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores)
- **Lê:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_ciclo_tarefa_gestor](funcoes.md#f-_assert_ciclo_tarefa_gestor)

<a id="f-definir_excecao_calendario"></a>
## definir_excecao_calendario (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Grava:** [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes)
- **Lê:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Chama:** [_assert_matriz_admin](funcoes.md#f-_assert_matriz_admin)

<a id="f-definir_ponto_jornada"></a>
## definir_ponto_jornada (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Grava:** [ponto_jornada](tabelas.md#t-ponto_jornada)
- **Lê:** [ponto_jornada](tabelas.md#t-ponto_jornada)
- **Chama:** [_assert_matriz_admin](funcoes.md#f-_assert_matriz_admin), [acre_today](funcoes.md#f-acre_today)

<a id="f-demitir_funcionario"></a>
## demitir_funcionario (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **Grava:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios)
- **Ao gravar, acorda os gatilhos de:** [funcionarios](tabelas.md#t-funcionarios) ([fn_funcionario_excluido_sai_das_tarefas](funcoes.md#f-fn_funcionario_excluido_sai_das_tarefas), [funcionarios_autovincular_user_profile](funcoes.md#f-funcionarios_autovincular_user_profile), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard))
- **Lê:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_aplicar_desligado_em](funcoes.md#f-_aplicar_desligado_em), [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role), [calcular_rescisao](funcoes.md#f-calcular_rescisao), [rescisao_gravar](funcoes.md#f-rescisao_gravar)

<a id="f-descartar_tarefa_briefing"></a>
## descartar_tarefa_briefing (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz › Briefing Diário](telas.md#s-briefing-diario)
- **Grava:** [briefings_diarios](tabelas.md#t-briefings_diarios), [marketing_tarefas](tabelas.md#t-marketing_tarefas), [tarefas](tabelas.md#t-tarefas)
- **Ao gravar, acorda os gatilhos de:** [briefings_diarios](tabelas.md#t-briefings_diarios) ([trg_briefings_diarios_updated_at](funcoes.md#f-trg_briefings_diarios_updated_at))
- **Lê:** [briefings_diarios](tabelas.md#t-briefings_diarios), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-desempenho_funcionarios"></a>
## desempenho_funcionarios (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** —
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [funcionarios](tabelas.md#t-funcionarios), [pdi_itens](tabelas.md#t-pdi_itens)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-desvincular_investimento_conta"></a>
## desvincular_investimento_conta (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Empresa › Filiais](telas.md#s-empresa-filiais)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [filial_investimentos](tabelas.md#t-filial_investimentos), [produtos](tabelas.md#t-produtos)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [filial_investimentos](tabelas.md#t-filial_investimentos) ([fn_filial_investimento_carimba_filial](funcoes.md#f-fn_filial_investimento_carimba_filial), [fn_filial_investimento_trava_gerado](funcoes.md#f-fn_filial_investimento_trava_gerado)); [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [filial_investimentos](tabelas.md#t-filial_investimentos), [produtos](tabelas.md#t-produtos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-devolucao_valida_filial_da_venda"></a>
## devolucao_valida_filial_da_venda (gatilho, SECURITY DEFINER)

- **Dispara em:** [devolucoes](tabelas.md#t-devolucoes)
- **Grava:** —
- **Lê:** [vendas](tabelas.md#t-vendas)
- **Chama:** [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-devolver_cotacao_para_correcao"></a>
## devolver_cotacao_para_correcao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **Grava:** [cotacoes](tabelas.md#t-cotacoes)
- **Ao gravar, acorda os gatilhos de:** [cotacoes](tabelas.md#t-cotacoes) ([cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard), [cotacao_proposta_unica_por_fornecedor](funcoes.md#f-cotacao_proposta_unica_por_fornecedor), [cotacoes_unica_aprovada](funcoes.md#f-cotacoes_unica_aprovada), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_cotacao_aprovada_congela](funcoes.md#f-fn_cotacao_aprovada_congela), [fn_cotacao_com_pedido_nao_volta](funcoes.md#f-fn_cotacao_com_pedido_nao_volta), [fn_cotacao_marca_so_na_eventual](funcoes.md#f-fn_cotacao_marca_so_na_eventual), [set_numero_documento](funcoes.md#f-set_numero_documento))
- **Lê:** [alcadas_compra](tabelas.md#t-alcadas_compra), [cotacoes](tabelas.md#t-cotacoes), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_service_role](funcoes.md#f-auth_is_service_role)
- **Liga flags de sessão:** `app.cotacao_correcao`

<a id="f-devolver_movimentacao_para_correcao"></a>
## devolver_movimentacao_para_correcao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Movimentações](telas.md#s-estoque-movimentações)
- **Grava:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produtos](tabelas.md#t-produtos)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo)); [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo))
- **Lê:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produtos](tabelas.md#t-produtos)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role), [notificar_setor](funcoes.md#f-notificar_setor)
- **Liga flags de sessão:** `app.allow_correcao_update`

<a id="f-devolver_requisicao_estoque_para_correcao"></a>
## devolver_requisicao_estoque_para_correcao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **Grava:** [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [requisicoes_estoque](tabelas.md#t-requisicoes_estoque) ([aprovacao_estoque_segue_a_requisicao](funcoes.md#f-aprovacao_estoque_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard), [requisicao_estoque_marca_reenvio](funcoes.md#f-requisicao_estoque_marca_reenvio))
- **Lê:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [produtos](tabelas.md#t-produtos), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-devolver_requisicao_para_correcao"></a>
## devolver_requisicao_para_correcao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **Grava:** [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [requisicoes](tabelas.md#t-requisicoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-dias_letivos_periodo"></a>
## dias_letivos_periodo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Afastamentos](telas.md#s-rh-afastamentos), [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Chamada por outras funções:** [_frequencia_competicao](funcoes.md#f-_frequencia_competicao), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [minha_frequencia](funcoes.md#f-minha_frequencia)
- **Grava:** —
- **Lê:** [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes), [ponto_jornada](tabelas.md#t-ponto_jornada)
- **Chama:** [_dia_de_folga](funcoes.md#f-_dia_de_folga)

<a id="f-dinheiro_do_caixa"></a>
## dinheiro_do_caixa (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [confirmar_fechamento_caixa](funcoes.md#f-confirmar_fechamento_caixa), [fechar_caixa_conferido](funcoes.md#f-fechar_caixa_conferido), [previa_fechamento_caixa](funcoes.md#f-previa_fechamento_caixa), [registrar_movimentacao_caixa](funcoes.md#f-registrar_movimentacao_caixa), [solicitar_fechamento_caixa](funcoes.md#f-solicitar_fechamento_caixa)
- **Grava:** —
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa), [vendas](tabelas.md#t-vendas)

<a id="f-distribuir_lucro_filial"></a>
## distribuir_lucro_filial (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Capital](telas.md#s-matriz-capital)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos), [distribuicoes_lucro](tabelas.md#t-distribuicoes_lucro)
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [capital_config](tabelas.md#t-capital_config), [distribuicoes_lucro](tabelas.md#t-distribuicoes_lucro), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_capital_holding](funcoes.md#f-_assert_capital_holding), [brl](funcoes.md#f-brl), [calcular_saldo_capital](funcoes.md#f-calcular_saldo_capital), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-documento_alcanca"></a>
## documento_alcanca (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-documento_arquivo_e_de_quem_grava"></a>
## documento_arquivo_e_de_quem_grava (gatilho, SECURITY DEFINER)

- **Dispara em:** [documentos](tabelas.md#t-documentos)
- **Grava:** —
- **Lê:** [documentos](tabelas.md#t-documentos), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-documento_pode_emitir"></a>
## documento_pode_emitir (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [publicar_documento](funcoes.md#f-publicar_documento)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-documento_publicacao_e_so_de_ida"></a>
## documento_publicacao_e_so_de_ida (gatilho, SECURITY DEFINER)

- **Dispara em:** [documentos](tabelas.md#t-documentos)
- **Grava:** —

<a id="f-documento_sem_exclusao"></a>
## documento_sem_exclusao (gatilho, SECURITY DEFINER)

- **Dispara em:** [cotacoes](tabelas.md#t-cotacoes), [orcamentos](tabelas.md#t-orcamentos), [pedidos](tabelas.md#t-pedidos), [pedidos_venda](tabelas.md#t-pedidos_venda), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Grava:** —
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-ean13_interno"></a>
## ean13_interno (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [gerar_grade_variantes](funcoes.md#f-gerar_grade_variantes)
- **Grava:** —
- **Lê:** [produtos](tabelas.md#t-produtos)

<a id="f-ean13_valido"></a>
## ean13_valido (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido)
- **Grava:** —

<a id="f-editar_emprestimo"></a>
## editar_emprestimo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Capital](telas.md#s-matriz-capital)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [historico_operacoes](tabelas.md#t-historico_operacoes), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [emprestimos_filial](tabelas.md#t-emprestimos_filial) ([emprestimo_arquivado_e_historico](funcoes.md#f-emprestimo_arquivado_e_historico), [emprestimo_valida_condicoes](funcoes.md#f-emprestimo_valida_condicoes)); [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo) ([parcela_emprestimo_arquivada_e_historico](funcoes.md#f-parcela_emprestimo_arquivada_e_historico))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_pagar](tabelas.md#t-contas_pagar), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role), [brl](funcoes.md#f-brl)

<a id="f-editar_meta_estrategica"></a>
## editar_meta_estrategica (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Ao gravar, acorda os gatilhos de:** [metas_estrategicas](tabelas.md#t-metas_estrategicas) ([metas_estrategicas_set_updated_at](funcoes.md#f-metas_estrategicas_set_updated_at))
- **Lê:** [metas_estrategicas](tabelas.md#t-metas_estrategicas), [tarefas_taticas](tabelas.md#t-tarefas_taticas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-editar_tarefa_briefing"></a>
## editar_tarefa_briefing (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz › Briefing Diário](telas.md#s-briefing-diario)
- **Grava:** [briefings_diarios](tabelas.md#t-briefings_diarios), [marketing_tarefas](tabelas.md#t-marketing_tarefas), [tarefas](tabelas.md#t-tarefas)
- **Ao gravar, acorda os gatilhos de:** [briefings_diarios](tabelas.md#t-briefings_diarios) ([trg_briefings_diarios_updated_at](funcoes.md#f-trg_briefings_diarios_updated_at))
- **Lê:** [briefings_diarios](tabelas.md#t-briefings_diarios), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-efetivar_contratacao"></a>
## efetivar_contratacao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [candidatura_etapas](tabelas.md#t-candidatura_etapas), [candidaturas](tabelas.md#t-candidaturas), [funcionarios](tabelas.md#t-funcionarios), [vagas](tabelas.md#t-vagas)
- **Ao gravar, acorda os gatilhos de:** [funcionarios](tabelas.md#t-funcionarios) ([fn_funcionario_excluido_sai_das_tarefas](funcoes.md#f-fn_funcionario_excluido_sai_das_tarefas), [funcionarios_autovincular_user_profile](funcoes.md#f-funcionarios_autovincular_user_profile), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard))
- **Lê:** [candidaturas](tabelas.md#t-candidaturas), [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles), [vagas](tabelas.md#t-vagas)
- **Chama:** [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-efetivar_promocao"></a>
## efetivar_promocao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [candidatura_etapas](tabelas.md#t-candidatura_etapas), [candidaturas](tabelas.md#t-candidaturas), [funcionarios](tabelas.md#t-funcionarios), [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [vagas](tabelas.md#t-vagas)
- **Ao gravar, acorda os gatilhos de:** [funcionarios](tabelas.md#t-funcionarios) ([fn_funcionario_excluido_sai_das_tarefas](funcoes.md#f-fn_funcionario_excluido_sai_das_tarefas), [funcionarios_autovincular_user_profile](funcoes.md#f-funcionarios_autovincular_user_profile), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard)); [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira) ([set_filial_movimentacao_carreira](funcoes.md#f-set_filial_movimentacao_carreira))
- **Lê:** [candidaturas](tabelas.md#t-candidaturas), [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles), [vagas](tabelas.md#t-vagas)
- **Chama:** [_assert_interfilial](funcoes.md#f-_assert_interfilial), [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-eh_perfil_admin"></a>
## eh_perfil_admin (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_cotacao_aprovada_congela](funcoes.md#f-fn_cotacao_aprovada_congela), [fn_pedido_congela_compra](funcoes.md#f-fn_pedido_congela_compra), [fn_recebimento_conferido_congela](funcoes.md#f-fn_recebimento_conferido_congela), [recebimento_segregacao_guard](funcoes.md#f-recebimento_segregacao_guard), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-embalagem_compra_valida"></a>
## embalagem_compra_valida (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote)
- **Grava:** —

<a id="f-emitir_nota"></a>
## emitir_nota (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Notas Emitidas](telas.md#s-financeiro-notasemitidas)
- **Chamada por outras funções:** [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [criar_venda_pdv](funcoes.md#f-criar_venda_pdv)
- **Grava:** [notas_emitidas](tabelas.md#t-notas_emitidas)
- **Ao gravar, acorda os gatilhos de:** [notas_emitidas](tabelas.md#t-notas_emitidas) ([nota_emitida_guard](funcoes.md#f-nota_emitida_guard))
- **Lê:** [notas_emitidas](tabelas.md#t-notas_emitidas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-emprestimo_arquivado_e_historico"></a>
## emprestimo_arquivado_e_historico (gatilho, SECURITY DEFINER)

- **Dispara em:** [emprestimos_filial](tabelas.md#t-emprestimos_filial)
- **Grava:** —
- **Chama:** [brl](funcoes.md#f-brl)

<a id="f-emprestimo_valida_condicoes"></a>
## emprestimo_valida_condicoes (gatilho, SECURITY DEFINER)

- **Dispara em:** [emprestimos_filial](tabelas.md#t-emprestimos_filial)
- **Grava:** —
- **Lê:** [capital_config](tabelas.md#t-capital_config)

<a id="f-encerrar_aulas_ociosas"></a>
## encerrar_aulas_ociosas (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Servidor (api/) chama:** `api/cron.ts`
- **Grava:** [aula_config](tabelas.md#t-aula_config), [aula_grupo_apoio_config](tabelas.md#t-aula_grupo_apoio_config), [aula_sessoes](tabelas.md#t-aula_sessoes)
- **Ao gravar, acorda os gatilhos de:** [aula_config](tabelas.md#t-aula_config) ([aula_config_registrar_sessao](funcoes.md#f-aula_config_registrar_sessao))
- **Lê:** [aula_sessoes](tabelas.md#t-aula_sessoes)

<a id="f-encerrar_ciclo_tarefa"></a>
## encerrar_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Ao gravar, acorda os gatilhos de:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas) ([trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at))
- **Lê:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Chama:** [_assert_ciclo_tarefa_gestor](funcoes.md#f-_assert_ciclo_tarefa_gestor)

<a id="f-encerrar_competicao_agora"></a>
## encerrar_competicao_agora (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Ao gravar, acorda os gatilhos de:** [competicoes_matriz](tabelas.md#t-competicoes_matriz) ([competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz), [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz), [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-encerrar_contrato"></a>
## encerrar_contrato (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Contratos](telas.md#s-contratos)
- **Grava:** [contratos](tabelas.md#t-contratos)
- **Ao gravar, acorda os gatilhos de:** [contratos](tabelas.md#t-contratos) ([contratos_carimbo](funcoes.md#f-contratos_carimbo))
- **Lê:** [contratos](tabelas.md#t-contratos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [contrato_representa](funcoes.md#f-contrato_representa)

<a id="f-encerrar_lote_consumido"></a>
## encerrar_lote_consumido (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Validades](telas.md#s-estoque-validades)
- **Grava:** [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Lê:** [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-encerrar_mandato"></a>
## encerrar_mandato (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos)
- **Grava:** [mandatos](tabelas.md#t-mandatos), [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [user_profiles](tabelas.md#t-user_profiles)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira) ([set_filial_movimentacao_carreira](funcoes.md#f-set_filial_movimentacao_carreira)); [user_profiles](tabelas.md#t-user_profiles) ([criar_maxbank_conta_para_colaborador](funcoes.md#f-criar_maxbank_conta_para_colaborador), [fn_conselho_e_da_matriz](funcoes.md#f-fn_conselho_e_da_matriz), [user_profiles_bloquear_privesc](funcoes.md#f-user_profiles_bloquear_privesc), [user_profiles_propagar_filial](funcoes.md#f-user_profiles_propagar_filial))
- **Lê:** [mandatos](tabelas.md#t-mandatos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_is_conselho](funcoes.md#f-auth_is_conselho)

<a id="f-encerrar_matriz_tarefa"></a>
## encerrar_matriz_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [matriz_tarefas](tabelas.md#t-matriz_tarefas), [notificacoes](tabelas.md#t-notificacoes)
- **Ao gravar, acorda os gatilhos de:** [matriz_tarefas](tabelas.md#t-matriz_tarefas) ([trg_matriz_tarefas_updated_at](funcoes.md#f-trg_matriz_tarefas_updated_at))
- **Lê:** [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Chama:** [_assert_matriz_admin](funcoes.md#f-_assert_matriz_admin)

<a id="f-encerrar_meta_estrategica"></a>
## encerrar_meta_estrategica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [cancelar_meta_estrategica](funcoes.md#f-cancelar_meta_estrategica)
- **Grava:** [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Ao gravar, acorda os gatilhos de:** [metas_estrategicas](tabelas.md#t-metas_estrategicas) ([metas_estrategicas_set_updated_at](funcoes.md#f-metas_estrategicas_set_updated_at))
- **Lê:** [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-encerrar_promocao"></a>
## encerrar_promocao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções)
- **Grava:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Ao gravar, acorda os gatilhos de:** [marketing_promocoes](tabelas.md#t-marketing_promocoes) ([promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [trg_marketing_promocoes_soft_delete_arte](funcoes.md#f-trg_marketing_promocoes_soft_delete_arte))
- **Lê:** [marketing_promocoes](tabelas.md#t-marketing_promocoes), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-encerrar_revisao_auditoria"></a>
## encerrar_revisao_auditoria (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [auditoria_revisoes](tabelas.md#t-auditoria_revisoes), [tarefas](tabelas.md#t-tarefas)
- **Lê:** [auditoria_revisoes](tabelas.md#t-auditoria_revisoes), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Chama:** [auth_is_conselho](funcoes.md#f-auth_is_conselho)

<a id="f-encerrar_tarefa_tatica"></a>
## encerrar_tarefa_tatica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Ao gravar, acorda os gatilhos de:** [tarefas_taticas](tabelas.md#t-tarefas_taticas) ([tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at))
- **Lê:** [tarefas_taticas](tabelas.md#t-tarefas_taticas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-enviar_feedback_anonimo"></a>
## enviar_feedback_anonimo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Feedback & Requerimentos](telas.md#s-feedback-org)
- **Grava:** [feedbacks_organizacao](tabelas.md#t-feedbacks_organizacao)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-enviar_justificativa_falta"></a>
## enviar_justificativa_falta (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Meu Crachá](telas.md#s-meu-cracha)
- **Grava:** [justificativas_falta](tabelas.md#t-justificativas_falta)
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [justificativas_falta](tabelas.md#t-justificativas_falta), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [ponto_jornada](tabelas.md#t-ponto_jornada), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_freq_credito_dia](funcoes.md#f-_freq_credito_dia), [_funcionario_da_conta](funcoes.md#f-_funcionario_da_conta), [acre_today](funcoes.md#f-acre_today), [dias_letivos_periodo](funcoes.md#f-dias_letivos_periodo), [notificar_setor](funcoes.md#f-notificar_setor), [ponto_corte_turma](funcoes.md#f-ponto_corte_turma)

<a id="f-estornar_aporte_capital"></a>
## estornar_aporte_capital (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Capital](telas.md#s-matriz-capital)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos), [capital_filial](tabelas.md#t-capital_filial), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao gravar, acorda os gatilhos de:** [capital_filial](tabelas.md#t-capital_filial) ([bloqueia_delete_aporte_com_caixa](funcoes.md#f-bloqueia_delete_aporte_com_caixa))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [capital_filial](tabelas.md#t-capital_filial), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_capital_holding](funcoes.md#f-_assert_capital_holding), [brl](funcoes.md#f-brl)
- **Liga flags de sessão:** `app.estorno_aporte`

<a id="f-excluir_briefing_cascade"></a>
## excluir_briefing_cascade (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz › Briefing Diário](telas.md#s-briefing-diario)
- **Grava:** [briefings_diarios](tabelas.md#t-briefings_diarios), [marketing_tarefas](tabelas.md#t-marketing_tarefas), [tarefas](tabelas.md#t-tarefas)
- **Ao gravar, acorda os gatilhos de:** [briefings_diarios](tabelas.md#t-briefings_diarios) ([trg_briefings_diarios_updated_at](funcoes.md#f-trg_briefings_diarios_updated_at))
- **Lê:** [briefings_diarios](tabelas.md#t-briefings_diarios), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-excluir_ciclo_tarefa"></a>
## excluir_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Ao gravar, acorda os gatilhos de:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas) ([trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at))
- **Lê:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Chama:** [_assert_ciclo_tarefa_gestor](funcoes.md#f-_assert_ciclo_tarefa_gestor)

<a id="f-excluir_competicao_matriz"></a>
## excluir_competicao_matriz (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao), [competicao_votos](tabelas.md#t-competicao_votos), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz) ([fn_avaliacao_matriz_congela_avaliador](funcoes.md#f-fn_avaliacao_matriz_congela_avaliador), [trg_aval_matriz_updated_at](funcoes.md#f-trg_aval_matriz_updated_at)); [competicao_votos](tabelas.md#t-competicao_votos) ([_competicao_voto_touch](funcoes.md#f-_competicao_voto_touch)); [competicoes_matriz](tabelas.md#t-competicoes_matriz) ([competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz), [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz), [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz)); [matriz_tarefas](tabelas.md#t-matriz_tarefas) ([trg_matriz_tarefas_updated_at](funcoes.md#f-trg_matriz_tarefas_updated_at))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-excluir_transacao_maxbank"></a>
## excluir_transacao_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **Chamada por outras funções:** [reverter_folha_maxbank](funcoes.md#f-reverter_folha_maxbank)
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura))
- **Lê:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Chama:** [_maxbank_pode_reverter](funcoes.md#f-_maxbank_pode_reverter)
- **Tem SQL dinâmico** (EXECUTE): o que ele toca não aparece acima.

<a id="f-expedir"></a>
## expedir (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Expedição](telas.md#s-estoque-expedição)
- **Grava:** [expedicao](tabelas.md#t-expedicao), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo))
- **Lê:** [expedicao](tabelas.md#t-expedicao), [produtos](tabelas.md#t-produtos), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-expirar_competicoes"></a>
## expirar_competicoes (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Servidor (api/) chama:** `api/cron.ts`
- **Grava:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Ao gravar, acorda os gatilhos de:** [competicoes_matriz](tabelas.md#t-competicoes_matriz) ([competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz), [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz), [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz))
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-fechar_caixa_conferido"></a>
## fechar_caixa_conferido (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Vendas › PDV](telas.md#s-vendas-pdv)
- **Grava:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Ao gravar, acorda os gatilhos de:** [controle_caixa](tabelas.md#t-controle_caixa) ([avisa_financeiro_do_caixa](funcoes.md#f-avisa_financeiro_do_caixa), [bloqueia_fechamento_com_venda_em_curso](funcoes.md#f-bloqueia_fechamento_com_venda_em_curso), [controle_caixa_guard](funcoes.md#f-controle_caixa_guard))
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_caixa](funcoes.md#f-_assert_caixa), [dinheiro_do_caixa](funcoes.md#f-dinheiro_do_caixa)

<a id="f-fechar_inventario"></a>
## fechar_inventario (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Inventários](telas.md#s-estoque-inventários)
- **Grava:** [inventarios](tabelas.md#t-inventarios), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo))
- **Lê:** [inventarios](tabelas.md#t-inventarios), [produtos](tabelas.md#t-produtos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-fechar_mes_aplicacoes"></a>
## fechar_mes_aplicacoes (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Capital](telas.md#s-matriz-capital)
- **Grava:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Lê:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role), [brl](funcoes.md#f-brl), [pct_br](funcoes.md#f-pct_br)

<a id="f-ferias_decisao_guard"></a>
## ferias_decisao_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [ferias](tabelas.md#t-ferias)
- **Grava:** —
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-fn_aprovacao_carimba_decisao"></a>
## fn_aprovacao_carimba_decisao (gatilho)

- **Dispara em:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque)
- **Grava:** —

<a id="f-fn_arte_produto_e_cota"></a>
## fn_arte_produto_e_cota (gatilho, SECURITY DEFINER)

- **Dispara em:** [marketing_artes](tabelas.md#t-marketing_artes)
- **Grava:** —
- **Lê:** [marketing_artes](tabelas.md#t-marketing_artes), [marketing_config](tabelas.md#t-marketing_config), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [produtos](tabelas.md#t-produtos)

<a id="f-fn_atualiza_estoque_produto"></a>
## fn_atualiza_estoque_produto (gatilho, SECURITY DEFINER)

- **Dispara em:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Grava:** [produtos](tabelas.md#t-produtos)
- **Ao gravar, acorda os gatilhos de:** [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo))
- **Chama:** [mov_estoque_delta](funcoes.md#f-mov_estoque_delta)
- **Liga flags de sessão:** `app.allow_estoque_update`

<a id="f-fn_avaliacao_matriz_congela_avaliador"></a>
## fn_avaliacao_matriz_congela_avaliador (gatilho, SECURITY DEFINER)

- **Dispara em:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-fn_avaliacoes_filial_from_ciclo"></a>
## fn_avaliacoes_filial_from_ciclo (gatilho)

- **Dispara em:** [avaliacoes](tabelas.md#t-avaliacoes)
- **Grava:** —
- **Lê:** [ciclos_avaliacao](tabelas.md#t-ciclos_avaliacao)

<a id="f-fn_block_correcao_manual"></a>
## fn_block_correcao_manual (gatilho, SECURITY DEFINER)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —

<a id="f-fn_block_estoque_manual"></a>
## fn_block_estoque_manual (gatilho, SECURITY DEFINER)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —

<a id="f-fn_carimba_exclusao"></a>
## fn_carimba_exclusao (gatilho, SECURITY DEFINER)

- **Dispara em:** [categorias_produto](tabelas.md#t-categorias_produto), [clientes](tabelas.md#t-clientes), [fornecedores](tabelas.md#t-fornecedores), [produtos](tabelas.md#t-produtos), [servicos](tabelas.md#t-servicos), [subcategorias_produto](tabelas.md#t-subcategorias_produto)
- **Grava:** —

<a id="f-fn_centro_custo_normaliza_grupo"></a>
## fn_centro_custo_normaliza_grupo (gatilho)

- **Dispara em:** [centros_custo](tabelas.md#t-centros_custo)
- **Grava:** —

<a id="f-fn_conselho_e_da_matriz"></a>
## fn_conselho_e_da_matriz (gatilho)

- **Dispara em:** [user_profiles](tabelas.md#t-user_profiles)
- **Grava:** —

<a id="f-fn_consumo_material_do_estoque"></a>
## fn_consumo_material_do_estoque (gatilho, SECURITY DEFINER)

- **Dispara em:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Grava:** [consumos_material](tabelas.md#t-consumos_material)
- **Lê:** [produtos_custo](tabelas.md#t-produtos_custo), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-fn_consumo_material_segue_movimentacao"></a>
## fn_consumo_material_segue_movimentacao (gatilho, SECURITY DEFINER)

- **Dispara em:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Grava:** [consumos_material](tabelas.md#t-consumos_material)
- **Lê:** [consumos_material](tabelas.md#t-consumos_material)

<a id="f-fn_conta_de_das_congela"></a>
## fn_conta_de_das_congela (gatilho)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** —

<a id="f-fn_conta_de_das_inativa"></a>
## fn_conta_de_das_inativa (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** [das_apuracoes](tabelas.md#t-das_apuracoes)

<a id="f-fn_conta_de_frete_congela"></a>
## fn_conta_de_frete_congela (gatilho)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** —

<a id="f-fn_conta_de_frete_inativa"></a>
## fn_conta_de_frete_inativa (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** —
- **Lê:** [fretes_compra](tabelas.md#t-fretes_compra)
- **Chama:** [_cancelar_frete_compra](funcoes.md#f-_cancelar_frete_compra)

<a id="f-fn_conta_de_pedido_congela"></a>
## fn_conta_de_pedido_congela (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin)

<a id="f-fn_conta_de_pedido_nao_exclui"></a>
## fn_conta_de_pedido_nao_exclui (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** —
- **Lê:** [pedidos](tabelas.md#t-pedidos)
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-fn_conta_pagar_natureza"></a>
## fn_conta_pagar_natureza (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** —
- **Lê:** [pedidos](tabelas.md#t-pedidos)

<a id="f-fn_conta_receber_exige_conciliacao"></a>
## fn_conta_receber_exige_conciliacao (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_receber](tabelas.md#t-contas_receber)
- **Grava:** —
- **Lê:** [formas_pagamento](tabelas.md#t-formas_pagamento), [vendas](tabelas.md#t-vendas)

<a id="f-fn_cotacao_aprovada_congela"></a>
## fn_cotacao_aprovada_congela (gatilho, SECURITY DEFINER)

- **Dispara em:** [cotacoes](tabelas.md#t-cotacoes)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin)

<a id="f-fn_cotacao_com_pedido_nao_volta"></a>
## fn_cotacao_com_pedido_nao_volta (gatilho, SECURITY DEFINER)

- **Dispara em:** [cotacoes](tabelas.md#t-cotacoes)
- **Grava:** —
- **Lê:** [pedidos](tabelas.md#t-pedidos)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-fn_cotacao_marca_so_na_eventual"></a>
## fn_cotacao_marca_so_na_eventual (gatilho, SECURITY DEFINER)

- **Dispara em:** [cotacoes](tabelas.md#t-cotacoes)
- **Grava:** —
- **Lê:** [requisicoes](tabelas.md#t-requisicoes)

<a id="f-fn_custo_medio_da_entrada"></a>
## fn_custo_medio_da_entrada (gatilho, SECURITY DEFINER)

- **Dispara em:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Grava:** [produtos_custo](tabelas.md#t-produtos_custo)
- **Ao gravar, acorda os gatilhos de:** [produtos_custo](tabelas.md#t-produtos_custo) ([custo_manual_nao_passa_do_preco_de_venda](funcoes.md#f-custo_manual_nao_passa_do_preco_de_venda))
- **Lê:** [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo), [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-fn_filial_investimento_carimba_filial"></a>
## fn_filial_investimento_carimba_filial (gatilho, SECURITY DEFINER)

- **Dispara em:** [filial_investimentos](tabelas.md#t-filial_investimentos)
- **Grava:** —
- **Lê:** [filiais](tabelas.md#t-filiais)

<a id="f-fn_filial_investimento_trava_gerado"></a>
## fn_filial_investimento_trava_gerado (gatilho, SECURITY DEFINER)

- **Dispara em:** [filial_investimentos](tabelas.md#t-filial_investimentos)
- **Grava:** —

<a id="f-fn_formas_pagamento_normaliza"></a>
## fn_formas_pagamento_normaliza (gatilho)

- **Dispara em:** [formas_pagamento](tabelas.md#t-formas_pagamento)
- **Grava:** —

<a id="f-fn_funcionario_excluido_sai_das_tarefas"></a>
## fn_funcionario_excluido_sai_das_tarefas (gatilho, SECURITY DEFINER)

- **Dispara em:** [funcionarios](tabelas.md#t-funcionarios)
- **Grava:** —
- **Chama:** [_tirar_funcionario_das_tarefas](funcoes.md#f-_tirar_funcionario_das_tarefas)

<a id="f-fn_item_devolucao_devolve_unidade"></a>
## fn_item_devolucao_devolve_unidade (gatilho, SECURITY DEFINER)

- **Dispara em:** [itens_devolucao](tabelas.md#t-itens_devolucao)
- **Grava:** [produto_unidades](tabelas.md#t-produto_unidades)
- **Lê:** [devolucoes](tabelas.md#t-devolucoes), [produto_unidades](tabelas.md#t-produto_unidades)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-fn_item_venda_aloca_unidade"></a>
## fn_item_venda_aloca_unidade (gatilho, SECURITY DEFINER)

- **Dispara em:** [itens_venda](tabelas.md#t-itens_venda)
- **Grava:** [produto_unidades](tabelas.md#t-produto_unidades)
- **Lê:** [produto_unidades](tabelas.md#t-produto_unidades), [produtos](tabelas.md#t-produtos), [vendas](tabelas.md#t-vendas)

<a id="f-fn_item_venda_so_mercadoria"></a>
## fn_item_venda_so_mercadoria (gatilho, SECURITY DEFINER)

- **Dispara em:** [itens_venda](tabelas.md#t-itens_venda)
- **Grava:** —
- **Lê:** [produtos](tabelas.md#t-produtos)

<a id="f-fn_itens_venda_carimba_custo"></a>
## fn_itens_venda_carimba_custo (gatilho, SECURITY DEFINER)

- **Dispara em:** [itens_venda](tabelas.md#t-itens_venda)
- **Grava:** —
- **Lê:** [produtos_custo](tabelas.md#t-produtos_custo)

<a id="f-fn_mesa_anotacoes_carimbo"></a>
## fn_mesa_anotacoes_carimbo (gatilho)

- **Dispara em:** [mesa_anotacoes](tabelas.md#t-mesa_anotacoes)
- **Grava:** —

<a id="f-fn_mov_saldo_abertura_so_na_implantacao"></a>
## fn_mov_saldo_abertura_so_na_implantacao (gatilho, SECURITY DEFINER)

- **Dispara em:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Grava:** —
- **Lê:** [recebimentos](tabelas.md#t-recebimentos)

<a id="f-fn_movimentacao_servico_nao_tem_saldo"></a>
## fn_movimentacao_servico_nao_tem_saldo (gatilho, SECURITY DEFINER)

- **Dispara em:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Grava:** —
- **Lê:** [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos)

<a id="f-fn_orcamento_condicao_pagamento"></a>
## fn_orcamento_condicao_pagamento (gatilho, SECURITY DEFINER)

- **Dispara em:** [orcamentos](tabelas.md#t-orcamentos)
- **Grava:** —
- **Lê:** [formas_pagamento](tabelas.md#t-formas_pagamento)

<a id="f-fn_parcela_emprestimo_segue_o_titulo"></a>
## fn_parcela_emprestimo_segue_o_titulo (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Ao gravar, acorda os gatilhos de:** [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo) ([parcela_emprestimo_arquivada_e_historico](funcoes.md#f-parcela_emprestimo_arquivada_e_historico))

<a id="f-fn_pedido_avisa_estoque"></a>
## fn_pedido_avisa_estoque (gatilho, SECURITY DEFINER)

- **Dispara em:** [pedidos](tabelas.md#t-pedidos)
- **Grava:** —
- **Lê:** [fornecedores](tabelas.md#t-fornecedores), [produtos](tabelas.md#t-produtos)
- **Chama:** [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-fn_pedido_congela_compra"></a>
## fn_pedido_congela_compra (gatilho, SECURITY DEFINER)

- **Dispara em:** [pedidos](tabelas.md#t-pedidos)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin)

<a id="f-fn_pedido_marca_recebimento"></a>
## fn_pedido_marca_recebimento (gatilho, SECURITY DEFINER)

- **Dispara em:** [pedidos](tabelas.md#t-pedidos)
- **Grava:** —
- **Lê:** [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-fn_pedido_transicao_valida"></a>
## fn_pedido_transicao_valida (gatilho, SECURITY DEFINER)

- **Dispara em:** [pedidos](tabelas.md#t-pedidos)
- **Grava:** —
- **Lê:** [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-fn_pedido_venda_status_pelos_marcos"></a>
## fn_pedido_venda_status_pelos_marcos (gatilho, SECURITY DEFINER)

- **Dispara em:** [pedidos_venda](tabelas.md#t-pedidos_venda)
- **Grava:** —

<a id="f-fn_ponto_filial_from_funcionario"></a>
## fn_ponto_filial_from_funcionario (gatilho)

- **Dispara em:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Grava:** —
- **Lê:** [funcionarios](tabelas.md#t-funcionarios)
- **Chama:** [_funcionario_desligado](funcoes.md#f-_funcionario_desligado)

<a id="f-fn_ponto_recusa_dia_de_folga"></a>
## fn_ponto_recusa_dia_de_folga (gatilho)

- **Dispara em:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Grava:** —
- **Lê:** [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes)

<a id="f-fn_produto_com_documento_aberto_nao_sai"></a>
## fn_produto_com_documento_aberto_nao_sai (gatilho, SECURITY DEFINER)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —
- **Lê:** [pedidos](tabelas.md#t-pedidos), [requisicoes](tabelas.md#t-requisicoes)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-fn_produto_ean_valido"></a>
## fn_produto_ean_valido (gatilho)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —
- **Lê:** [produtos](tabelas.md#t-produtos)
- **Chama:** [ean13_valido](funcoes.md#f-ean13_valido)

<a id="f-fn_produto_publicavel"></a>
## fn_produto_publicavel (gatilho)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —

<a id="f-fn_produto_status_segue_ativo"></a>
## fn_produto_status_segue_ativo (gatilho, SECURITY DEFINER)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —

<a id="f-fn_produto_variante_ja_existe"></a>
## fn_produto_variante_ja_existe (gatilho, SECURITY DEFINER)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —
- **Lê:** [produtos](tabelas.md#t-produtos)

<a id="f-fn_recebimento_conferido_congela"></a>
## fn_recebimento_conferido_congela (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin)

<a id="f-fn_recebimento_confirmado_nao_some"></a>
## fn_recebimento_confirmado_nao_some (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** —
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-fn_recebimento_da_entrada"></a>
## fn_recebimento_da_entrada (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo))
- **Lê:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos](tabelas.md#t-pedidos)
- **Chama:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [acre_today](funcoes.md#f-acre_today)
- **Liga flags de sessão:** `app.entrada_recebimento`

<a id="f-fn_recebimento_data_plausivel"></a>
## fn_recebimento_data_plausivel (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** —
- **Lê:** [pedidos](tabelas.md#t-pedidos)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-fn_recebimento_exige_nota"></a>
## fn_recebimento_exige_nota (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** —
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-fn_recebimento_fecha_pedido"></a>
## fn_recebimento_fecha_pedido (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** [pedidos](tabelas.md#t-pedidos)
- **Ao gravar, acorda os gatilhos de:** [pedidos](tabelas.md#t-pedidos) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_pedido_avisa_estoque](funcoes.md#f-fn_pedido_avisa_estoque), [fn_pedido_congela_compra](funcoes.md#f-fn_pedido_congela_compra), [fn_pedido_marca_recebimento](funcoes.md#f-fn_pedido_marca_recebimento), [fn_pedido_transicao_valida](funcoes.md#f-fn_pedido_transicao_valida), [set_numero_documento](funcoes.md#f-set_numero_documento))
- **Lê:** [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos)

<a id="f-fn_recebimento_inativo_estorna_entrada"></a>
## fn_recebimento_inativo_estorna_entrada (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo))
- **Lê:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produtos](tabelas.md#t-produtos)

<a id="f-fn_recebimento_nao_estoura_pedido"></a>
## fn_recebimento_nao_estoura_pedido (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** —
- **Lê:** [v_pedido_saldo](tabelas.md#t-v_pedido_saldo)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-fn_recebimento_status_pelo_saldo"></a>
## fn_recebimento_status_pelo_saldo (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** —
- **Lê:** [recebimentos](tabelas.md#t-recebimentos), [v_pedido_saldo](tabelas.md#t-v_pedido_saldo)

<a id="f-fn_recompute_ponto_eletronico_after_delete"></a>
## fn_recompute_ponto_eletronico_after_delete (gatilho, SECURITY DEFINER)

- **Dispara em:** [ponto_qr_registros](tabelas.md#t-ponto_qr_registros)
- **Grava:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Ao gravar, acorda os gatilhos de:** [ponto_eletronico](tabelas.md#t-ponto_eletronico) ([fn_ponto_filial_from_funcionario](funcoes.md#f-fn_ponto_filial_from_funcionario), [fn_ponto_recusa_dia_de_folga](funcoes.md#f-fn_ponto_recusa_dia_de_folga))
- **Lê:** [ponto_qr_registros](tabelas.md#t-ponto_qr_registros), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-fn_sync_ponto_eletronico"></a>
## fn_sync_ponto_eletronico (gatilho, SECURITY DEFINER)

- **Dispara em:** [ponto_qr_registros](tabelas.md#t-ponto_qr_registros)
- **Grava:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Ao gravar, acorda os gatilhos de:** [ponto_eletronico](tabelas.md#t-ponto_eletronico) ([fn_ponto_filial_from_funcionario](funcoes.md#f-fn_ponto_filial_from_funcionario), [fn_ponto_recusa_dia_de_folga](funcoes.md#f-fn_ponto_recusa_dia_de_folga))
- **Lê:** [ponto_eletronico](tabelas.md#t-ponto_eletronico), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-fn_taxonomia_padrao_protege"></a>
## fn_taxonomia_padrao_protege (gatilho)

- **Dispara em:** [categorias_produto](tabelas.md#t-categorias_produto), [subcategorias_produto](tabelas.md#t-subcategorias_produto)
- **Grava:** —

<a id="f-fn_unidade_imutavel_com_saldo"></a>
## fn_unidade_imutavel_com_saldo (gatilho)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —

<a id="f-fn_valida_filial_item_venda"></a>
## fn_valida_filial_item_venda (gatilho, SECURITY DEFINER)

- **Dispara em:** [itens_venda](tabelas.md#t-itens_venda)
- **Grava:** —
- **Lê:** [produtos](tabelas.md#t-produtos), [servicos](tabelas.md#t-servicos), [vendas](tabelas.md#t-vendas)

<a id="f-fn_venda_cancelada_desfaz"></a>
## fn_venda_cancelada_desfaz (gatilho, SECURITY DEFINER)

- **Dispara em:** [vendas](tabelas.md#t-vendas)
- **Grava:** [contas_receber](tabelas.md#t-contas_receber), [marketing_cupons](tabelas.md#t-marketing_cupons), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [produto_unidades](tabelas.md#t-produto_unidades)
- **Ao gravar, acorda os gatilhos de:** [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [marketing_cupons](tabelas.md#t-marketing_cupons) ([trg_marketing_cupons_updated_at](funcoes.md#f-trg_marketing_cupons_updated_at)); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo))
- **Lê:** [itens_venda](tabelas.md#t-itens_venda), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-fn_venda_de_pedido_so_pelo_pedido"></a>
## fn_venda_de_pedido_so_pelo_pedido (gatilho, SECURITY DEFINER)

- **Dispara em:** [vendas](tabelas.md#t-vendas)
- **Grava:** —
- **Lê:** [pedidos_venda](tabelas.md#t-pedidos_venda)

<a id="f-fn_venda_dinheiro_exige_caixa"></a>
## fn_venda_dinheiro_exige_caixa (gatilho, SECURITY DEFINER)

- **Dispara em:** [vendas](tabelas.md#t-vendas)
- **Grava:** —
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-folha_historico_fechado"></a>
## folha_historico_fechado (gatilho, SECURITY DEFINER)

- **Dispara em:** [folha_pagamento](tabelas.md#t-folha_pagamento)
- **Grava:** —
- **Chama:** [ponto_corte_turma](funcoes.md#f-ponto_corte_turma)

<a id="f-folha_pagamento_set_salario_base"></a>
## folha_pagamento_set_salario_base (gatilho)

- **Dispara em:** [folha_pagamento](tabelas.md#t-folha_pagamento)
- **Grava:** —

<a id="f-formatar_numero_documento"></a>
## formatar_numero_documento (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [set_numero_documento](funcoes.md#f-set_numero_documento)
- **Grava:** —

<a id="f-formatar_numero_requisicao"></a>
## formatar_numero_requisicao (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [set_numero_requisicao](funcoes.md#f-set_numero_requisicao)
- **Grava:** —

<a id="f-frequencia_filiais_competicao"></a>
## frequencia_filiais_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** —
- **Lê:** [ponto_jornada](tabelas.md#t-ponto_jornada), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_frequencia_competicao](funcoes.md#f-_frequencia_competicao)

<a id="f-frequencia_set_updated_at"></a>
## frequencia_set_updated_at (gatilho)

- **Dispara em:** [frequencia_trabalho](tabelas.md#t-frequencia_trabalho)
- **Grava:** —

<a id="f-func_benef_set_filial"></a>
## func_benef_set_filial (gatilho, SECURITY DEFINER)

- **Dispara em:** [funcionario_beneficios](tabelas.md#t-funcionario_beneficios)
- **Grava:** —
- **Lê:** [funcionarios](tabelas.md#t-funcionarios)

<a id="f-funcionario_filial"></a>
## funcionario_filial (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [funcionarios](tabelas.md#t-funcionarios)

<a id="f-funcionarios_autovincular_user_profile"></a>
## funcionarios_autovincular_user_profile (gatilho, SECURITY DEFINER)

- **Dispara em:** [funcionarios](tabelas.md#t-funcionarios)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-funcionarios_vinculo_admin_guard"></a>
## funcionarios_vinculo_admin_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [funcionarios](tabelas.md#t-funcionarios)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-gerar_codigo_pedido_online"></a>
## gerar_codigo_pedido_online (RPC)

- **Telas que chamam:** —
- **Servidor (api/) chama:** `api/loja.ts`
- **Grava:** —
- **Lê:** [pedidos_online](tabelas.md#t-pedidos_online)

<a id="f-gerar_contas_da_montagem"></a>
## gerar_contas_da_montagem (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [filial_investimentos](tabelas.md#t-filial_investimentos), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [filial_investimentos](tabelas.md#t-filial_investimentos) ([fn_filial_investimento_carimba_filial](funcoes.md#f-fn_filial_investimento_carimba_filial), [fn_filial_investimento_trava_gerado](funcoes.md#f-fn_filial_investimento_trava_gerado)); [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo)); [produtos_custo](tabelas.md#t-produtos_custo) ([custo_manual_nao_passa_do_preco_de_venda](funcoes.md#f-custo_manual_nao_passa_do_preco_de_venda))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [filiais](tabelas.md#t-filiais), [filial_investimentos](tabelas.md#t-filial_investimentos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-gerar_dre"></a>
## gerar_dre (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › DRE](telas.md#s-financeiro-dre)
- **Grava:** —
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_dre_calculo](funcoes.md#f-_dre_calculo), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-gerar_folgas_acumulado"></a>
## gerar_folgas_acumulado (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [aprovar_meta_maxbank](funcoes.md#f-aprovar_meta_maxbank), [aprovar_tarefa_tatica](funcoes.md#f-aprovar_tarefa_tatica), [concluir_meta_estrategica](funcoes.md#f-concluir_meta_estrategica)
- **Grava:** [ferias](tabelas.md#t-ferias), [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas)
- **Ao gravar, acorda os gatilhos de:** [ferias](tabelas.md#t-ferias) ([ferias_decisao_guard](funcoes.md#f-ferias_decisao_guard))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [maxbank_config](tabelas.md#t-maxbank_config), [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_folgas_conquistadas](tabelas.md#t-maxbank_folgas_conquistadas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-gerar_grade_variantes"></a>
## gerar_grade_variantes (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos)
- **Grava:** [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **Ao gravar, acorda os gatilhos de:** [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo)); [produtos_custo](tabelas.md#t-produtos_custo) ([custo_manual_nao_passa_do_preco_de_venda](funcoes.md#f-custo_manual_nao_passa_do_preco_de_venda))
- **Lê:** [produtos](tabelas.md#t-produtos), [produtos_codigo_reserva](tabelas.md#t-produtos_codigo_reserva), [produtos_custo](tabelas.md#t-produtos_custo)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [ean13_interno](funcoes.md#f-ean13_interno)

<a id="f-gerar_painel_bi"></a>
## gerar_painel_bi (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Servidor (api/) chama:** `api/ai-bi.ts`, `api/ai-briefing.ts`
- **Grava:** —
- **Lê:** [afastamentos](tabelas.md#t-afastamentos), [contas_pagar](tabelas.md#t-contas_pagar), [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas), [contas_receber](tabelas.md#t-contas_receber), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas), [folha_pagamento](tabelas.md#t-folha_pagamento), [funcionarios](tabelas.md#t-funcionarios), [itens_venda](tabelas.md#t-itens_venda), [marketing_campanhas](tabelas.md#t-marketing_campanhas), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo), [vendas](tabelas.md#t-vendas)
- **Chama:** [_assert_blackout](funcoes.md#f-_assert_blackout), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-gerar_pedido_de_cotacao"></a>
## gerar_pedido_de_cotacao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [pedidos](tabelas.md#t-pedidos), [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [pedidos](tabelas.md#t-pedidos) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_pedido_avisa_estoque](funcoes.md#f-fn_pedido_avisa_estoque), [fn_pedido_congela_compra](funcoes.md#f-fn_pedido_congela_compra), [fn_pedido_marca_recebimento](funcoes.md#f-fn_pedido_marca_recebimento), [fn_pedido_transicao_valida](funcoes.md#f-fn_pedido_transicao_valida), [set_numero_documento](funcoes.md#f-set_numero_documento)); [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [centros_custo](tabelas.md#t-centros_custo), [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes), [servicos](tabelas.md#t-servicos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [condicao_pagamento_dias](funcoes.md#f-condicao_pagamento_dias), [nome_item_normalizado](funcoes.md#f-nome_item_normalizado), [vinculo_item_parece](funcoes.md#f-vinculo_item_parece)

<a id="f-get_vitrine_publica"></a>
## get_vitrine_publica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [marketing_artes](tabelas.md#t-marketing_artes), [marketing_config](tabelas.md#t-marketing_config), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [produtos](tabelas.md#t-produtos), [vitrine_institucional](tabelas.md#t-vitrine_institucional)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-gin_extract_query_trgm"></a>
## gin_extract_query_trgm (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gin_extract_value_trgm"></a>
## gin_extract_value_trgm (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gin_trgm_consistent"></a>
## gin_trgm_consistent (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gin_trgm_triconsistent"></a>
## gin_trgm_triconsistent (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_compress"></a>
## gtrgm_compress (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_consistent"></a>
## gtrgm_consistent (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_decompress"></a>
## gtrgm_decompress (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_distance"></a>
## gtrgm_distance (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_in"></a>
## gtrgm_in (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_options"></a>
## gtrgm_options (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_out"></a>
## gtrgm_out (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_penalty"></a>
## gtrgm_penalty (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_picksplit"></a>
## gtrgm_picksplit (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_same"></a>
## gtrgm_same (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-gtrgm_union"></a>
## gtrgm_union (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-hora_servidor"></a>
## hora_servidor (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-ir_aplicacao_pct"></a>
## ir_aplicacao_pct (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao)
- **Grava:** —

<a id="f-lancar_frete_compra"></a>
## lancar_frete_compra (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [fretes_compra](tabelas.md#t-fretes_compra), [fretes_compra_rateio](tabelas.md#t-fretes_compra_rateio)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [fornecedores](tabelas.md#t-fornecedores), [fretes_compra](tabelas.md#t-fretes_compra), [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [_ajustar_custo_pela_nota](funcoes.md#f-_ajustar_custo_pela_nota), [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial)
- **Liga flags de sessão:** `app.frete_compra`

<a id="f-lancar_investimento_filial"></a>
## lancar_investimento_filial (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [filial_investimentos](tabelas.md#t-filial_investimentos), [produtos](tabelas.md#t-produtos), [produtos_custo](tabelas.md#t-produtos_custo)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [filial_investimentos](tabelas.md#t-filial_investimentos) ([fn_filial_investimento_carimba_filial](funcoes.md#f-fn_filial_investimento_carimba_filial), [fn_filial_investimento_trava_gerado](funcoes.md#f-fn_filial_investimento_trava_gerado)); [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo)); [produtos_custo](tabelas.md#t-produtos_custo) ([custo_manual_nao_passa_do_preco_de_venda](funcoes.md#f-custo_manual_nao_passa_do_preco_de_venda))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [filial_investimentos](tabelas.md#t-filial_investimentos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-lembrar_avaliacoes_pendentes"></a>
## lembrar_avaliacoes_pendentes (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Servidor (api/) chama:** `api/cron.ts`
- **Grava:** [notificacoes](tabelas.md#t-notificacoes)
- **Lê:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [notificacoes](tabelas.md#t-notificacoes)
- **Chama:** [contar_votantes_matriz](funcoes.md#f-contar_votantes_matriz)

<a id="f-liberar_ciclo_tarefa"></a>
## liberar_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [notificacoes](tabelas.md#t-notificacoes)
- **Ao gravar, acorda os gatilhos de:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas) ([trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at))
- **Lê:** [ciclo_tarefa_avaliadores](tabelas.md#t-ciclo_tarefa_avaliadores), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_ciclo_tarefa_gestor](funcoes.md#f-_assert_ciclo_tarefa_gestor)

<a id="f-liberar_cobranca"></a>
## liberar_cobranca (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [cartao_pendentes](tabelas.md#t-cartao_pendentes), [pix_pendentes](tabelas.md#t-pix_pendentes)
- **Ao gravar, acorda os gatilhos de:** [cartao_pendentes](tabelas.md#t-cartao_pendentes) ([cartao_pendentes_set_paid_at](funcoes.md#f-cartao_pendentes_set_paid_at), [pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial), [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate)); [pix_pendentes](tabelas.md#t-pix_pendentes) ([pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial), [pix_pendentes_set_paid_at](funcoes.md#f-pix_pendentes_set_paid_at), [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate))

<a id="f-liberar_codigo_produto"></a>
## liberar_codigo_produto (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos)
- **Grava:** [produtos_codigo_reserva](tabelas.md#t-produtos_codigo_reserva)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-liberar_matriz_tarefa"></a>
## liberar_matriz_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [matriz_tarefas](tabelas.md#t-matriz_tarefas), [notificacoes](tabelas.md#t-notificacoes)
- **Ao gravar, acorda os gatilhos de:** [matriz_tarefas](tabelas.md#t-matriz_tarefas) ([trg_matriz_tarefas_updated_at](funcoes.md#f-trg_matriz_tarefas_updated_at))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Chama:** [_assert_matriz_tarefa_gestor](funcoes.md#f-_assert_matriz_tarefa_gestor)

<a id="f-liberar_requisicao_estoque"></a>
## liberar_requisicao_estoque (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **Grava:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo)); [requisicoes_estoque](tabelas.md#t-requisicoes_estoque) ([aprovacao_estoque_segue_a_requisicao](funcoes.md#f-aprovacao_estoque_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard), [requisicao_estoque_marca_reenvio](funcoes.md#f-requisicao_estoque_marca_reenvio))
- **Lê:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-liberar_trabalho"></a>
## liberar_trabalho (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **Grava:** [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-liberar_trabalho_forcado"></a>
## liberar_trabalho_forcado (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo)
- **Grava:** [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-limpar_ip_hash_pedidos_online"></a>
## limpar_ip_hash_pedidos_online (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Servidor (api/) chama:** `api/cron.ts`
- **Grava:** [pedidos_online](tabelas.md#t-pedidos_online)
- **Ao gravar, acorda os gatilhos de:** [pedidos_online](tabelas.md#t-pedidos_online) ([loja_apelido_limpo](funcoes.md#f-loja_apelido_limpo))
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-listar_pendencias"></a>
## listar_pendencias (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo), [Mesa gestor *(rota mesa-gestor)*](telas.md#s-mesa-gestor), [Pendências](telas.md#s-pendencias)
- **Servidor (api/) chama:** `api/ai-aula-atividade.ts`
- **Chamada por outras funções:** [minha_mesa](funcoes.md#f-minha_mesa)
- **Grava:** —
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [controle_caixa](tabelas.md#t-controle_caixa), [cotacoes](tabelas.md#t-cotacoes), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [marketing_tarefas](tabelas.md#t-marketing_tarefas), [orcamentos](tabelas.md#t-orcamentos), [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_pendencia_responsaveis](funcoes.md#f-_pendencia_responsaveis), [auth_user_filial](funcoes.md#f-auth_user_filial)

<a id="f-listar_pessoas_treinamento_ia"></a>
## listar_pessoas_treinamento_ia (RPC, SECURITY DEFINER)

- **Telas que chamam:** [TI & Suporte › Desenvolvimento com IA](telas.md#s-ti-desenvolvimentocomia)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_in_setor](funcoes.md#f-auth_in_setor)

<a id="f-listar_vitrine_candidatos"></a>
## listar_vitrine_candidatos (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
- **Grava:** —
- **Lê:** [marketing_artes](tabelas.md#t-marketing_artes), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles), [vitrine_institucional](tabelas.md#t-vitrine_institucional)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today)

<a id="f-lixeira_expurgar"></a>
## lixeira_expurgar (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Lixeira](telas.md#s-cadastros-lixeira)
- **Grava:** —
- **Chama:** [_assert_lixeira](funcoes.md#f-_assert_lixeira), [_assert_lixeira_filial](funcoes.md#f-_assert_lixeira_filial), [_lixeira_expr_filial](funcoes.md#f-_lixeira_expr_filial), [lixeira_vinculos](funcoes.md#f-lixeira_vinculos)
- **Tem SQL dinâmico** (EXECUTE): o que ele toca não aparece acima.

<a id="f-lixeira_listar"></a>
## lixeira_listar (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Lixeira](telas.md#s-cadastros-lixeira)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_lixeira](funcoes.md#f-_assert_lixeira), [_assert_lixeira_filial](funcoes.md#f-_assert_lixeira_filial), [_lixeira_expr_filial](funcoes.md#f-_lixeira_expr_filial), [_lixeira_tabelas](funcoes.md#f-_lixeira_tabelas), [lixeira_vinculos](funcoes.md#f-lixeira_vinculos)
- **Tem SQL dinâmico** (EXECUTE): o que ele toca não aparece acima.

<a id="f-lixeira_restaurar"></a>
## lixeira_restaurar (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Lixeira](telas.md#s-cadastros-lixeira)
- **Grava:** —
- **Chama:** [_assert_lixeira](funcoes.md#f-_assert_lixeira), [_assert_lixeira_filial](funcoes.md#f-_assert_lixeira_filial), [_lixeira_expr_filial](funcoes.md#f-_lixeira_expr_filial)
- **Tem SQL dinâmico** (EXECUTE): o que ele toca não aparece acima.

<a id="f-lixeira_vinculos"></a>
## lixeira_vinculos (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [lixeira_expurgar](funcoes.md#f-lixeira_expurgar), [lixeira_listar](funcoes.md#f-lixeira_listar)
- **Grava:** —
- **Chama:** [_assert_lixeira](funcoes.md#f-_assert_lixeira)
- **Tem SQL dinâmico** (EXECUTE): o que ele toca não aparece acima.

<a id="f-loja_apelido_limpo"></a>
## loja_apelido_limpo (gatilho, SECURITY DEFINER)

- **Dispara em:** [pedidos_online](tabelas.md#t-pedidos_online)
- **Grava:** —
- **Lê:** [loja_palavras_bloqueadas](tabelas.md#t-loja_palavras_bloqueadas)
- **Chama:** [_normalizar_texto_loja](funcoes.md#f-_normalizar_texto_loja)

<a id="f-mapa_fluxo_compras"></a>
## mapa_fluxo_compras (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo)
- **Grava:** —
- **Lê:** [aula_sessoes](tabelas.md#t-aula_sessoes), [cotacoes](tabelas.md#t-cotacoes), [fornecedores](tabelas.md#t-fornecedores), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos](tabelas.md#t-pedidos), [produtos](tabelas.md#t-produtos), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-marcar_acesso_ajustado"></a>
## marcar_acesso_ajustado (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira) ([set_filial_movimentacao_carreira](funcoes.md#f-set_filial_movimentacao_carreira))
- **Lê:** [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-marcar_documento_lido"></a>
## marcar_documento_lido (RPC)

- **Telas que chamam:** [Documentos](telas.md#s-documentos)
- **Grava:** [documentos_leitura](tabelas.md#t-documentos_leitura)
- **Lê:** [documentos](tabelas.md#t-documentos), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-marcar_notificacao_lida"></a>
## marcar_notificacao_lida (RPC)

- **Telas que chamam:** —
- **Grava:** —
- **Chama:** [marcar_notificacoes_lidas](funcoes.md#f-marcar_notificacoes_lidas)

<a id="f-marcar_notificacoes_lidas"></a>
## marcar_notificacoes_lidas (RPC)

- **Telas que chamam:** [Matriz › Briefing Diário](telas.md#s-briefing-diario), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Marketing › Promoções](telas.md#s-marketing-promoções), [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **Chamada por outras funções:** [marcar_notificacao_lida](funcoes.md#f-marcar_notificacao_lida)
- **Grava:** [notificacoes_lidas](tabelas.md#t-notificacoes_lidas)
- **Lê:** [notificacoes](tabelas.md#t-notificacoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-marcar_tarefa_aula"></a>
## marcar_tarefa_aula (RPC)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo)
- **Grava:** [aula_tarefas_realizadas](tabelas.md#t-aula_tarefas_realizadas)
- **Lê:** [aula_atividades](tabelas.md#t-aula_atividades), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [atividade_aula_alcanca_perfil](funcoes.md#f-atividade_aula_alcanca_perfil), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-marcar_todas_lidas"></a>
## marcar_todas_lidas (RPC)

- **Telas que chamam:** —
- **Grava:** [notificacoes_lidas](tabelas.md#t-notificacoes_lidas)
- **Lê:** [notificacoes](tabelas.md#t-notificacoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_user_setor](funcoes.md#f-auth_user_setor)

<a id="f-marcar_vitrine"></a>
## marcar_vitrine (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Marketing › Vitrinedateladelogin *(rota marketing-vitrinedateladelogin)*](telas.md#s-marketing-vitrinedateladelogin), [Marketing › Vitrinepública *(rota marketing-vitrinepública)*](telas.md#s-marketing-vitrinepública)
- **Grava:** [marketing_artes](tabelas.md#t-marketing_artes), [produtos](tabelas.md#t-produtos), [vitrine_institucional](tabelas.md#t-vitrine_institucional)
- **Ao gravar, acorda os gatilhos de:** [marketing_artes](tabelas.md#t-marketing_artes) ([fn_arte_produto_e_cota](funcoes.md#f-fn_arte_produto_e_cota), [trg_marketing_artes_updated_at](funcoes.md#f-trg_marketing_artes_updated_at)); [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo))
- **Lê:** [marketing_artes](tabelas.md#t-marketing_artes), [marketing_config](tabelas.md#t-marketing_config), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [produtos](tabelas.md#t-produtos), [user_profiles](tabelas.md#t-user_profiles), [vitrine_institucional](tabelas.md#t-vitrine_institucional)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today)

<a id="f-max_work_is_docente"></a>
## max_work_is_docente (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-max_work_touch_updated_at"></a>
## max_work_touch_updated_at (gatilho, SECURITY DEFINER)

- **Dispara em:** [max_docs](tabelas.md#t-max_docs), [max_planilhas](tabelas.md#t-max_planilhas), [max_shows](tabelas.md#t-max_shows)
- **Grava:** —

<a id="f-maxbank_contas_set_updated_at"></a>
## maxbank_contas_set_updated_at (gatilho)

- **Dispara em:** [maxbank_contas](tabelas.md#t-maxbank_contas)
- **Grava:** —

<a id="f-maxbank_metas_set_updated_at"></a>
## maxbank_metas_set_updated_at (gatilho)

- **Dispara em:** [maxbank_metas](tabelas.md#t-maxbank_metas)
- **Grava:** —

<a id="f-maxbank_tx_protege_abertura"></a>
## maxbank_tx_protege_abertura (gatilho)

- **Dispara em:** [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Grava:** —

<a id="f-media_avaliacao_funcionario"></a>
## media_avaliacao_funcionario (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [convocar_para_vaga](funcoes.md#f-convocar_para_vaga), [registrar_candidatura_interna](funcoes.md#f-registrar_candidatura_interna), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga)
- **Grava:** —
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes), [criterios_avaliacao](tabelas.md#t-criterios_avaliacao), [funcionarios](tabelas.md#t-funcionarios)

<a id="f-media_participantes_ciclo"></a>
## media_participantes_ciclo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** —
- **Lê:** [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-media_participantes_competicao"></a>
## media_participantes_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** —
- **Lê:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_peso_nota_matriz](funcoes.md#f-_peso_nota_matriz)

<a id="f-metas_estrategicas_set_updated_at"></a>
## metas_estrategicas_set_updated_at (gatilho)

- **Dispara em:** [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Grava:** —

<a id="f-minha_frequencia"></a>
## minha_frequencia (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Meu Crachá](telas.md#s-meu-cracha)
- **Grava:** —
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [justificativas_falta](tabelas.md#t-justificativas_falta), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [ponto_jornada](tabelas.md#t-ponto_jornada), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_dia_de_folga](funcoes.md#f-_dia_de_folga), [_freq_credito_dia](funcoes.md#f-_freq_credito_dia), [acre_today](funcoes.md#f-acre_today), [dias_letivos_periodo](funcoes.md#f-dias_letivos_periodo)

<a id="f-minha_mesa"></a>
## minha_mesa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Mesa gestor *(rota mesa-gestor)*](telas.md#s-mesa-gestor)
- **Chamada por outras funções:** [contar_minha_mesa](funcoes.md#f-contar_minha_mesa)
- **Grava:** —
- **Lê:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [candidaturas](tabelas.md#t-candidaturas), [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [contratos](tabelas.md#t-contratos), [demissoes](tabelas.md#t-demissoes), [ferias](tabelas.md#t-ferias), [funcionarios](tabelas.md#t-funcionarios), [justificativas_falta](tabelas.md#t-justificativas_falta), [marketing_promocoes](tabelas.md#t-marketing_promocoes), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [orcamentos](tabelas.md#t-orcamentos), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos](tabelas.md#t-produtos), [requerimentos](tabelas.md#t-requerimentos), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [user_profiles](tabelas.md#t-user_profiles), [vagas](tabelas.md#t-vagas)
- **Chama:** [_funcionario_desligado](funcoes.md#f-_funcionario_desligado), [_pendencia_responsaveis](funcoes.md#f-_pendencia_responsaveis), [auth_user_filial](funcoes.md#f-auth_user_filial), [auth_user_role](funcoes.md#f-auth_user_role), [contrato_representa](funcoes.md#f-contrato_representa), [listar_pendencias](funcoes.md#f-listar_pendencias)

<a id="f-mov_estoque_delta"></a>
## mov_estoque_delta (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto)
- **Grava:** —

<a id="f-mover_candidatura"></a>
## mover_candidatura (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [candidatura_etapas](tabelas.md#t-candidatura_etapas), [candidaturas](tabelas.md#t-candidaturas)
- **Lê:** [candidaturas](tabelas.md#t-candidaturas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-movimentacao_caixa_guard"></a>
## movimentacao_caixa_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa)
- **Grava:** —
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Chama:** [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-movimentar_estoque"></a>
## movimentar_estoque (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Estoque › Movimentações](telas.md#s-estoque-movimentações)
- **Grava:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo))
- **Lê:** [produtos](tabelas.md#t-produtos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-negar_emprestimo"></a>
## negar_emprestimo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Capital](telas.md#s-matriz-capital)
- **Grava:** [emprestimos_filial](tabelas.md#t-emprestimos_filial)
- **Ao gravar, acorda os gatilhos de:** [emprestimos_filial](tabelas.md#t-emprestimos_filial) ([emprestimo_arquivado_e_historico](funcoes.md#f-emprestimo_arquivado_e_historico), [emprestimo_valida_condicoes](funcoes.md#f-emprestimo_valida_condicoes))
- **Lê:** [emprestimos_filial](tabelas.md#t-emprestimos_filial), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_capital_holding](funcoes.md#f-_assert_capital_holding), [_assert_nao_e_o_solicitante](funcoes.md#f-_assert_nao_e_o_solicitante)

<a id="f-nome_item_normalizado"></a>
## nome_item_normalizado (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [aplicar_taxonomia_padrao](funcoes.md#f-aplicar_taxonomia_padrao), [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao)
- **Grava:** —

<a id="f-nomear_mandato"></a>
## nomear_mandato (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Mandatos](telas.md#s-rh-mandatos)
- **Grava:** [mandatos](tabelas.md#t-mandatos), [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [user_profiles](tabelas.md#t-user_profiles)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira) ([set_filial_movimentacao_carreira](funcoes.md#f-set_filial_movimentacao_carreira)); [user_profiles](tabelas.md#t-user_profiles) ([criar_maxbank_conta_para_colaborador](funcoes.md#f-criar_maxbank_conta_para_colaborador), [fn_conselho_e_da_matriz](funcoes.md#f-fn_conselho_e_da_matriz), [user_profiles_bloquear_privesc](funcoes.md#f-user_profiles_bloquear_privesc), [user_profiles_propagar_filial](funcoes.md#f-user_profiles_propagar_filial))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [mandatos](tabelas.md#t-mandatos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_is_conselho](funcoes.md#f-auth_is_conselho), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-nomear_sessao_aula"></a>
## nomear_sessao_aula (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo)
- **Grava:** [aula_sessoes](tabelas.md#t-aula_sessoes)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-normalizar_nome"></a>
## normalizar_nome (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [confirmar_pedido_online](funcoes.md#f-confirmar_pedido_online)
- **Grava:** —

<a id="f-nota_emitida_guard"></a>
## nota_emitida_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [notas_emitidas](tabelas.md#t-notas_emitidas)
- **Grava:** —
- **Chama:** [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-notificar_setor"></a>
## notificar_setor (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz › Briefing Diário](telas.md#s-briefing-diario), [Compras › Cotações](telas.md#s-compras-cotações), [Compras › Pedidos](telas.md#s-compras-pedidos), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação), [Financeiro › Aprovações de Orçamento](telas.md#s-financeiro-aprovaçõesdeorçamento), [Marketing › Promoções](telas.md#s-marketing-promoções), [Recursos Humanos › Treinamentos](telas.md#s-rh-treinamentos), [Matriz › Governança › Cliente Especial](telas.md#s-vendas-clienteespecial), [Vendas › Orçamentos](telas.md#s-vendas-orçamentos)
- **Servidor (api/) chama:** `api/loja.ts`
- **Chamada por outras funções:** [_folha_creditar_e_avancar](funcoes.md#f-_folha_creditar_e_avancar), [abrir_revisao_auditoria](funcoes.md#f-abrir_revisao_auditoria), [abrir_vaga](funcoes.md#f-abrir_vaga), [abrir_vaga_interna](funcoes.md#f-abrir_vaga_interna), [avisa_financeiro_do_caixa](funcoes.md#f-avisa_financeiro_do_caixa), [conceder_mutuo_capital](funcoes.md#f-conceder_mutuo_capital), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [converter_orcamento_em_pedido](funcoes.md#f-converter_orcamento_em_pedido), [decidir_requisicao_compra](funcoes.md#f-decidir_requisicao_compra), [decidir_vaga](funcoes.md#f-decidir_vaga), [devolver_movimentacao_para_correcao](funcoes.md#f-devolver_movimentacao_para_correcao), [devolver_requisicao_estoque_para_correcao](funcoes.md#f-devolver_requisicao_estoque_para_correcao), [devolver_requisicao_para_correcao](funcoes.md#f-devolver_requisicao_para_correcao), [distribuir_lucro_filial](funcoes.md#f-distribuir_lucro_filial), [efetivar_promocao](funcoes.md#f-efetivar_promocao), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [fn_pedido_avisa_estoque](funcoes.md#f-fn_pedido_avisa_estoque), [parecer_justificativa_falta](funcoes.md#f-parecer_justificativa_falta), [reenviar_requisicao_corrigida](funcoes.md#f-reenviar_requisicao_corrigida), [reenviar_requisicao_estoque_corrigida](funcoes.md#f-reenviar_requisicao_estoque_corrigida), [responder_convite_vaga](funcoes.md#f-responder_convite_vaga)
- **Grava:** [notificacoes](tabelas.md#t-notificacoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_user_filial](funcoes.md#f-auth_user_filial), [auth_user_setor](funcoes.md#f-auth_user_setor)

<a id="f-pagar_folha"></a>
## pagar_folha (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **Grava:** —
- **Lê:** [folha_pagamento](tabelas.md#t-folha_pagamento)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_folha_creditar_e_avancar](funcoes.md#f-_folha_creditar_e_avancar), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-pagar_rescisao"></a>
## pagar_rescisao (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [rescisoes](tabelas.md#t-rescisoes)
- **Lê:** [rescisoes](tabelas.md#t-rescisoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [creditar_rescisao_maxbank](funcoes.md#f-creditar_rescisao_maxbank)

<a id="f-palavras_vinculo"></a>
## palavras_vinculo (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [vinculo_item_parece](funcoes.md#f-vinculo_item_parece)
- **Grava:** —

<a id="f-parametros_precificacao"></a>
## parametros_precificacao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- **Chamada por outras funções:** [salvar_lucro_servico](funcoes.md#f-salvar_lucro_servico), [salvar_parametros_precificacao](funcoes.md#f-salvar_parametros_precificacao)
- **Grava:** —
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [filial_precificacao](tabelas.md#t-filial_precificacao), [formas_pagamento](tabelas.md#t-formas_pagamento), [servicos](tabelas.md#t-servicos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_dre_calculo](funcoes.md#f-_dre_calculo), [_receita_simples](funcoes.md#f-_receita_simples), [_simples_rbt12](funcoes.md#f-_simples_rbt12), [_taxa_pelo_mix](funcoes.md#f-_taxa_pelo_mix), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [simples_anexo_i](funcoes.md#f-simples_anexo_i), [simples_anexo_iii](funcoes.md#f-simples_anexo_iii)

<a id="f-parcela_emprestimo_arquivada_e_historico"></a>
## parcela_emprestimo_arquivada_e_historico (gatilho, SECURITY DEFINER)

- **Dispara em:** [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Grava:** —
- **Lê:** [emprestimos_filial](tabelas.md#t-emprestimos_filial)

<a id="f-parecer_justificativa_falta"></a>
## parecer_justificativa_falta (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Grava:** [justificativas_falta](tabelas.md#t-justificativas_falta)
- **Lê:** [justificativas_falta](tabelas.md#t-justificativas_falta), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_user_filial](funcoes.md#f-auth_user_filial), [auth_user_role](funcoes.md#f-auth_user_role), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-participantes_sem_nota_competicao"></a>
## participantes_sem_nota_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Chamada por outras funções:** [declarar_vencedora](funcoes.md#f-declarar_vencedora)
- **Grava:** —
- **Lê:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_funcionario_desligado](funcoes.md#f-_funcionario_desligado), [contar_votantes_matriz](funcoes.md#f-contar_votantes_matriz)

<a id="f-pausar_meta_estrategica"></a>
## pausar_meta_estrategica (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Ao gravar, acorda os gatilhos de:** [metas_estrategicas](tabelas.md#t-metas_estrategicas) ([metas_estrategicas_set_updated_at](funcoes.md#f-metas_estrategicas_set_updated_at))
- **Lê:** [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-pausar_tarefa_tatica"></a>
## pausar_tarefa_tatica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Ao gravar, acorda os gatilhos de:** [tarefas_taticas](tabelas.md#t-tarefas_taticas) ([tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at))
- **Lê:** [tarefas_taticas](tabelas.md#t-tarefas_taticas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-pct_br"></a>
## pct_br (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [aplicar_em_banco](funcoes.md#f-aplicar_em_banco), [fechar_mes_aplicacoes](funcoes.md#f-fechar_mes_aplicacoes), [resgatar_aplicacao](funcoes.md#f-resgatar_aplicacao)
- **Grava:** —

<a id="f-pdv_registrar_credito_misto"></a>
## pdv_registrar_credito_misto (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Vendas › PDV](telas.md#s-vendas-pdv)
- **Grava:** [contas_receber](tabelas.md#t-contas_receber)
- **Ao gravar, acorda os gatilhos de:** [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber))
- **Lê:** [contas_receber](tabelas.md#t-contas_receber), [vendas](tabelas.md#t-vendas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-pedido_saldo"></a>
## pedido_saldo (RPC)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [v_pedido_saldo](tabelas.md#t-v_pedido_saldo)

<a id="f-pedidos_para_frete"></a>
## pedidos_para_frete (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **Grava:** —
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [fornecedores](tabelas.md#t-fornecedores), [fretes_compra](tabelas.md#t-fretes_compra), [fretes_compra_rateio](tabelas.md#t-fretes_compra_rateio), [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-pendente_pagamento_preenche_filial"></a>
## pendente_pagamento_preenche_filial (gatilho, SECURITY DEFINER)

- **Dispara em:** [cartao_pendentes](tabelas.md#t-cartao_pendentes), [pix_pendentes](tabelas.md#t-pix_pendentes)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-perfil_filial"></a>
## perfil_filial (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-pix_pendentes_set_paid_at"></a>
## pix_pendentes_set_paid_at (gatilho)

- **Dispara em:** [pix_pendentes](tabelas.md#t-pix_pendentes)
- **Grava:** —

<a id="f-ponto_corte_turma"></a>
## ponto_corte_turma (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_reverter_ponto_do_afastamento](funcoes.md#f-_reverter_ponto_do_afastamento), [afastamento_valida_periodo](funcoes.md#f-afastamento_valida_periodo), [aplicar_afastamento_no_ponto](funcoes.md#f-aplicar_afastamento_no_ponto), [decidir_justificativa_falta](funcoes.md#f-decidir_justificativa_falta), [enviar_justificativa_falta](funcoes.md#f-enviar_justificativa_falta), [folha_historico_fechado](funcoes.md#f-folha_historico_fechado), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [registrar_ponto_manual](funcoes.md#f-registrar_ponto_manual), [remover_ponto](funcoes.md#f-remover_ponto)
- **Grava:** —
- **Lê:** [configuracoes](tabelas.md#t-configuracoes)

<a id="f-ponto_qr_carimba_hora"></a>
## ponto_qr_carimba_hora (gatilho, SECURITY DEFINER)

- **Dispara em:** [ponto_qr_registros](tabelas.md#t-ponto_qr_registros)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-preco_efetivo"></a>
## preco_efetivo (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [criar_venda_pdv](funcoes.md#f-criar_venda_pdv)
- **Grava:** —
- **Lê:** [produtos](tabelas.md#t-produtos)
- **Chama:** [promocao_vigente_do_produto](funcoes.md#f-promocao_vigente_do_produto)

<a id="f-previa_fechamento_caixa"></a>
## previa_fechamento_caixa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Vendas › PDV](telas.md#s-vendas-pdv)
- **Grava:** —
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa)
- **Chama:** [_assert_caixa](funcoes.md#f-_assert_caixa), [dinheiro_do_caixa](funcoes.md#f-dinheiro_do_caixa)

<a id="f-processar_folha"></a>
## processar_folha (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [folha_pagamento](tabelas.md#t-folha_pagamento)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [folha_pagamento](tabelas.md#t-folha_pagamento) ([folha_historico_fechado](funcoes.md#f-folha_historico_fechado), [folha_pagamento_set_salario_base](funcoes.md#f-folha_pagamento_set_salario_base))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [folha_pagamento](tabelas.md#t-folha_pagamento), [funcionarios](tabelas.md#t-funcionarios)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-processar_rescisao"></a>
## processar_rescisao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [rescisoes](tabelas.md#t-rescisoes)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [funcionarios](tabelas.md#t-funcionarios), [rescisoes](tabelas.md#t-rescisoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-produto_loja_online_guard"></a>
## produto_loja_online_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_opera_loja](funcoes.md#f-auth_opera_loja)

<a id="f-produto_preco_nao_fica_abaixo_do_custo"></a>
## produto_preco_nao_fica_abaixo_do_custo (gatilho, SECURITY DEFINER)

- **Dispara em:** [produtos](tabelas.md#t-produtos)
- **Grava:** —
- **Lê:** [produtos_custo](tabelas.md#t-produtos_custo)

<a id="f-progresso_avaliacao_matriz"></a>
## progresso_avaliacao_matriz (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** —
- **Lê:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_funcionario_desligado](funcoes.md#f-_funcionario_desligado)

<a id="f-progresso_votacao_competicao"></a>
## progresso_votacao_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_competicao_votos_validos](funcoes.md#f-_competicao_votos_validos), [contar_votantes_matriz](funcoes.md#f-contar_votantes_matriz)

<a id="f-promocao_decisao_guard"></a>
## promocao_decisao_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Grava:** —
- **Chama:** [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-promocao_vigente_do_produto"></a>
## promocao_vigente_do_produto (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [aprovar_promocao](funcoes.md#f-aprovar_promocao), [preco_efetivo](funcoes.md#f-preco_efetivo)
- **Grava:** —
- **Lê:** [marketing_promocoes](tabelas.md#t-marketing_promocoes), [produtos](tabelas.md#t-produtos)
- **Chama:** [acre_today](funcoes.md#f-acre_today)

<a id="f-proximo_numero_documento"></a>
## proximo_numero_documento (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [set_numero_documento](funcoes.md#f-set_numero_documento), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao)
- **Grava:** [documento_sequencias](tabelas.md#t-documento_sequencias)

<a id="f-publicar_atividade_aula"></a>
## publicar_atividade_aula (RPC)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo)
- **Grava:** [aula_atividades](tabelas.md#t-aula_atividades)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-publicar_documento"></a>
## publicar_documento (RPC)

- **Telas que chamam:** [Documentos](telas.md#s-documentos)
- **Grava:** [documentos](tabelas.md#t-documentos)
- **Ao gravar, acorda os gatilhos de:** [documentos](tabelas.md#t-documentos) ([documento_arquivo_e_de_quem_grava](funcoes.md#f-documento_arquivo_e_de_quem_grava), [documento_publicacao_e_so_de_ida](funcoes.md#f-documento_publicacao_e_so_de_ida))
- **Lê:** [documentos](tabelas.md#t-documentos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [documento_pode_emitir](funcoes.md#f-documento_pode_emitir)

<a id="f-publicar_meta_estrategica"></a>
## publicar_meta_estrategica (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Ao gravar, acorda os gatilhos de:** [metas_estrategicas](tabelas.md#t-metas_estrategicas) ([metas_estrategicas_set_updated_at](funcoes.md#f-metas_estrategicas_set_updated_at))
- **Lê:** [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-publicar_tarefa_tatica"></a>
## publicar_tarefa_tatica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Ao gravar, acorda os gatilhos de:** [tarefas_taticas](tabelas.md#t-tarefas_taticas) ([tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at))
- **Lê:** [tarefas_taticas](tabelas.md#t-tarefas_taticas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-ranking_competicao"></a>
## ranking_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [declarar_vencedora](funcoes.md#f-declarar_vencedora)
- **Grava:** —
- **Chama:** [calcular_placar_competicao](funcoes.md#f-calcular_placar_competicao)

<a id="f-reabrir_caixa"></a>
## reabrir_caixa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa)
- **Grava:** [controle_caixa](tabelas.md#t-controle_caixa), [controle_caixa_reaberturas](tabelas.md#t-controle_caixa_reaberturas)
- **Ao gravar, acorda os gatilhos de:** [controle_caixa](tabelas.md#t-controle_caixa) ([avisa_financeiro_do_caixa](funcoes.md#f-avisa_financeiro_do_caixa), [bloqueia_fechamento_com_venda_em_curso](funcoes.md#f-bloqueia_fechamento_com_venda_em_curso), [controle_caixa_guard](funcoes.md#f-controle_caixa_guard))
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-reabrir_ciclo_tarefa"></a>
## reabrir_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Ao gravar, acorda os gatilhos de:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas) ([trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at))
- **Lê:** [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Chama:** [_assert_ciclo_tarefa_gestor](funcoes.md#f-_assert_ciclo_tarefa_gestor)

<a id="f-reabrir_competicao"></a>
## reabrir_competicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [competicoes_matriz](tabelas.md#t-competicoes_matriz), [notificacoes](tabelas.md#t-notificacoes)
- **Ao gravar, acorda os gatilhos de:** [competicoes_matriz](tabelas.md#t-competicoes_matriz) ([competicao_apaga_ciclo_matriz](funcoes.md#f-competicao_apaga_ciclo_matriz), [competicao_criar_ciclo_matriz](funcoes.md#f-competicao_criar_ciclo_matriz), [competicao_sync_ciclo_matriz](funcoes.md#f-competicao_sync_ciclo_matriz))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-reabrir_cotacao"></a>
## reabrir_cotacao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **Grava:** [cotacoes](tabelas.md#t-cotacoes)
- **Ao gravar, acorda os gatilhos de:** [cotacoes](tabelas.md#t-cotacoes) ([cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard), [cotacao_proposta_unica_por_fornecedor](funcoes.md#f-cotacao_proposta_unica_por_fornecedor), [cotacoes_unica_aprovada](funcoes.md#f-cotacoes_unica_aprovada), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_cotacao_aprovada_congela](funcoes.md#f-fn_cotacao_aprovada_congela), [fn_cotacao_com_pedido_nao_volta](funcoes.md#f-fn_cotacao_com_pedido_nao_volta), [fn_cotacao_marca_so_na_eventual](funcoes.md#f-fn_cotacao_marca_so_na_eventual), [set_numero_documento](funcoes.md#f-set_numero_documento))
- **Lê:** [cotacoes](tabelas.md#t-cotacoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-reabrir_matriz_tarefa"></a>
## reabrir_matriz_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Ao gravar, acorda os gatilhos de:** [matriz_tarefas](tabelas.md#t-matriz_tarefas) ([trg_matriz_tarefas_updated_at](funcoes.md#f-trg_matriz_tarefas_updated_at))
- **Lê:** [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Chama:** [_assert_matriz_admin](funcoes.md#f-_assert_matriz_admin)

<a id="f-reabrir_meta_estrategica"></a>
## reabrir_meta_estrategica (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes), [Demandas](telas.md#s-demandas), [Demandas conselho *(rota demandas-conselho)*](telas.md#s-demandas-conselho), [Demandas metas *(rota demandas-metas)*](telas.md#s-demandas-metas), [Metas *(rota metas)*](telas.md#s-metas)
- **Grava:** [metas_estrategicas](tabelas.md#t-metas_estrategicas)
- **Ao gravar, acorda os gatilhos de:** [metas_estrategicas](tabelas.md#t-metas_estrategicas) ([metas_estrategicas_set_updated_at](funcoes.md#f-metas_estrategicas_set_updated_at))
- **Lê:** [metas_estrategicas](tabelas.md#t-metas_estrategicas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-reabrir_requisicao"></a>
## reabrir_requisicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Compras › Requisições de Compra](telas.md#s-compras-requisiçõesdecompra), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **Grava:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)); [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [cotacoes](tabelas.md#t-cotacoes), [pedidos](tabelas.md#t-pedidos), [requisicoes](tabelas.md#t-requisicoes), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-reabrir_requisicao_estoque"></a>
## reabrir_requisicao_estoque (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Liberar Requisições](telas.md#s-estoque-liberarrequisições), [Estoque › Requisições de Material](telas.md#s-estoque-requisiçõesdematerial), [Requisições › Aprovações](telas.md#s-requisicoes-aprovações)
- **Grava:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque) ([fn_aprovacao_carimba_decisao](funcoes.md#f-fn_aprovacao_carimba_decisao)); [requisicoes_estoque](tabelas.md#t-requisicoes_estoque) ([aprovacao_estoque_segue_a_requisicao](funcoes.md#f-aprovacao_estoque_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard), [requisicao_estoque_marca_reenvio](funcoes.md#f-requisicao_estoque_marca_reenvio))
- **Lê:** [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-reabrir_tarefa_tatica"></a>
## reabrir_tarefa_tatica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Ao gravar, acorda os gatilhos de:** [tarefas_taticas](tabelas.md#t-tarefas_taticas) ([tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at))
- **Lê:** [tarefas_taticas](tabelas.md#t-tarefas_taticas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-readmitir_funcionario"></a>
## readmitir_funcionario (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **Grava:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [rescisoes](tabelas.md#t-rescisoes)
- **Ao gravar, acorda os gatilhos de:** [funcionarios](tabelas.md#t-funcionarios) ([fn_funcionario_excluido_sai_das_tarefas](funcoes.md#f-fn_funcionario_excluido_sai_das_tarefas), [funcionarios_autovincular_user_profile](funcoes.md#f-funcionarios_autovincular_user_profile), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard))
- **Lê:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [rescisoes](tabelas.md#t-rescisoes)
- **Chama:** [_aplicar_desligado_em](funcoes.md#f-_aplicar_desligado_em), [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-recalcular_folha_do_ponto"></a>
## recalcular_folha_do_ponto (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **Grava:** [folha_pagamento](tabelas.md#t-folha_pagamento), [folha_rubricas](tabelas.md#t-folha_rubricas)
- **Ao gravar, acorda os gatilhos de:** [folha_pagamento](tabelas.md#t-folha_pagamento) ([folha_historico_fechado](funcoes.md#f-folha_historico_fechado), [folha_pagamento_set_salario_base](funcoes.md#f-folha_pagamento_set_salario_base))
- **Lê:** [afastamentos](tabelas.md#t-afastamentos), [folha_pagamento](tabelas.md#t-folha_pagamento), [folha_rubricas](tabelas.md#t-folha_rubricas), [funcionarios](tabelas.md#t-funcionarios), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [rh_parametros](tabelas.md#t-rh_parametros)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [ponto_corte_turma](funcoes.md#f-ponto_corte_turma), [rh_calc_inss](funcoes.md#f-rh_calc_inss), [rh_calc_irrf](funcoes.md#f-rh_calc_irrf), [rh_vigencia_em](funcoes.md#f-rh_vigencia_em)

<a id="f-recebimento_segregacao_guard"></a>
## recebimento_segregacao_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [recebimentos](tabelas.md#t-recebimentos)
- **Grava:** —
- **Lê:** [pedidos](tabelas.md#t-pedidos)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin)

<a id="f-recompute_saldos_maxbank"></a>
## recompute_saldos_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at))
- **Lê:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_maxbank_pode_reverter](funcoes.md#f-_maxbank_pode_reverter)

<a id="f-recusar_contrato"></a>
## recusar_contrato (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Contratos](telas.md#s-contratos)
- **Grava:** [contratos](tabelas.md#t-contratos)
- **Ao gravar, acorda os gatilhos de:** [contratos](tabelas.md#t-contratos) ([contratos_carimbo](funcoes.md#f-contratos_carimbo))
- **Lê:** [contratos](tabelas.md#t-contratos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [contrato_representa](funcoes.md#f-contrato_representa)

<a id="f-reenviar_cotacao_corrigida"></a>
## reenviar_cotacao_corrigida (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **Grava:** [cotacoes](tabelas.md#t-cotacoes)
- **Ao gravar, acorda os gatilhos de:** [cotacoes](tabelas.md#t-cotacoes) ([cotacao_decisao_guard](funcoes.md#f-cotacao_decisao_guard), [cotacao_proposta_unica_por_fornecedor](funcoes.md#f-cotacao_proposta_unica_por_fornecedor), [cotacoes_unica_aprovada](funcoes.md#f-cotacoes_unica_aprovada), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_cotacao_aprovada_congela](funcoes.md#f-fn_cotacao_aprovada_congela), [fn_cotacao_com_pedido_nao_volta](funcoes.md#f-fn_cotacao_com_pedido_nao_volta), [fn_cotacao_marca_so_na_eventual](funcoes.md#f-fn_cotacao_marca_so_na_eventual), [set_numero_documento](funcoes.md#f-set_numero_documento))
- **Lê:** [cotacoes](tabelas.md#t-cotacoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_pode_filial](funcoes.md#f-auth_pode_filial)
- **Liga flags de sessão:** `app.cotacao_correcao`

<a id="f-reenviar_requisicao_corrigida"></a>
## reenviar_requisicao_corrigida (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Grava:** [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-reenviar_requisicao_estoque_corrigida"></a>
## reenviar_requisicao_estoque_corrigida (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Requisições › Do Setor](telas.md#s-requisicoes-dosetor)
- **Grava:** [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Ao gravar, acorda os gatilhos de:** [requisicoes_estoque](tabelas.md#t-requisicoes_estoque) ([aprovacao_estoque_segue_a_requisicao](funcoes.md#f-aprovacao_estoque_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_estoque_decisao_guard](funcoes.md#f-requisicao_estoque_decisao_guard), [requisicao_estoque_marca_reenvio](funcoes.md#f-requisicao_estoque_marca_reenvio))
- **Lê:** [produtos](tabelas.md#t-produtos), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-registrar_aporte_capital"></a>
## registrar_aporte_capital (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Capital](telas.md#s-matriz-capital)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos), [capital_filial](tabelas.md#t-capital_filial)
- **Ao gravar, acorda os gatilhos de:** [capital_filial](tabelas.md#t-capital_filial) ([bloqueia_delete_aporte_com_caixa](funcoes.md#f-bloqueia_delete_aporte_com_caixa))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-registrar_candidatura"></a>
## registrar_candidatura (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [candidatura_etapas](tabelas.md#t-candidatura_etapas), [candidaturas](tabelas.md#t-candidaturas)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles), [vagas](tabelas.md#t-vagas)
- **Chama:** [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-registrar_candidatura_interna"></a>
## registrar_candidatura_interna (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [candidatura_etapas](tabelas.md#t-candidatura_etapas), [candidaturas](tabelas.md#t-candidaturas)
- **Lê:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles), [vagas](tabelas.md#t-vagas)
- **Chama:** [_assert_interfilial](funcoes.md#f-_assert_interfilial), [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc), [media_avaliacao_funcionario](funcoes.md#f-media_avaliacao_funcionario)

<a id="f-registrar_devolucao_fornecedor"></a>
## registrar_devolucao_fornecedor (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [devolucoes_fornecedor](tabelas.md#t-devolucoes_fornecedor), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos](tabelas.md#t-pedidos), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo)); [pedidos](tabelas.md#t-pedidos) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_pedido_avisa_estoque](funcoes.md#f-fn_pedido_avisa_estoque), [fn_pedido_congela_compra](funcoes.md#f-fn_pedido_congela_compra), [fn_pedido_marca_recebimento](funcoes.md#f-fn_pedido_marca_recebimento), [fn_pedido_transicao_valida](funcoes.md#f-fn_pedido_transicao_valida), [set_numero_documento](funcoes.md#f-set_numero_documento))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [devolucoes_fornecedor](tabelas.md#t-devolucoes_fornecedor), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos](tabelas.md#t-pedidos), [recebimentos](tabelas.md#t-recebimentos), [v_pedido_saldo](tabelas.md#t-v_pedido_saldo), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)
- **Liga flags de sessão:** `app.conta_pedido_baixa`

<a id="f-registrar_historico"></a>
## registrar_historico (gatilho, SECURITY DEFINER)

- **Dispara em:** [afastamentos](tabelas.md#t-afastamentos), [aprovacoes_compras](tabelas.md#t-aprovacoes_compras), [aprovacoes_estoque](tabelas.md#t-aprovacoes_estoque), [avaliacoes](tabelas.md#t-avaliacoes), [beneficios](tabelas.md#t-beneficios), [caixa_bancos](tabelas.md#t-caixa_bancos), [candidaturas](tabelas.md#t-candidaturas), [cargos](tabelas.md#t-cargos), [centros_custo](tabelas.md#t-centros_custo), [clientes](tabelas.md#t-clientes), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha), [condicoes_pagamento](tabelas.md#t-condicoes_pagamento), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [controle_caixa](tabelas.md#t-controle_caixa), [cotacoes](tabelas.md#t-cotacoes), [demissoes](tabelas.md#t-demissoes), [departamentos](tabelas.md#t-departamentos), [devolucoes](tabelas.md#t-devolucoes), [expedicao](tabelas.md#t-expedicao), [ferias](tabelas.md#t-ferias), [filiais](tabelas.md#t-filiais), [filial_investimentos](tabelas.md#t-filial_investimentos), [folha_pagamento](tabelas.md#t-folha_pagamento), [formas_pagamento](tabelas.md#t-formas_pagamento), [fornecedores](tabelas.md#t-fornecedores), [funcionarios](tabelas.md#t-funcionarios), [inventarios](tabelas.md#t-inventarios), [mandatos](tabelas.md#t-mandatos), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [notas_emitidas](tabelas.md#t-notas_emitidas), [notas_recebidas](tabelas.md#t-notas_recebidas), [orcamentos](tabelas.md#t-orcamentos), [pdi_itens](tabelas.md#t-pdi_itens), [pedidos](tabelas.md#t-pedidos), [pedidos_venda](tabelas.md#t-pedidos_venda), [produtos](tabelas.md#t-produtos), [projetos](tabelas.md#t-projetos), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [rescisoes](tabelas.md#t-rescisoes), [riscos](tabelas.md#t-riscos), [treinamentos](tabelas.md#t-treinamentos), [vagas](tabelas.md#t-vagas), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque), [vendas](tabelas.md#t-vendas)
- **Grava:** [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-registrar_movimentacao_caixa"></a>
## registrar_movimentacao_caixa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Controle de Caixa](telas.md#s-financeiro-controledecaixa), [Vendas › PDV](telas.md#s-vendas-pdv)
- **Grava:** [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa) ([movimentacao_caixa_guard](funcoes.md#f-movimentacao_caixa_guard))
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_caixa](funcoes.md#f-_assert_caixa), [dinheiro_do_caixa](funcoes.md#f-dinheiro_do_caixa)

<a id="f-registrar_pagamento_conta"></a>
## registrar_pagamento_conta (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar), [Financeiro › Contas a receber](telas.md#s-financeiro-contasareceber)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_pagar](tabelas.md#t-contas_pagar), [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas), [contas_receber](tabelas.md#t-contas_receber), [contas_receber_baixas](tabelas.md#t-contas_receber_baixas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [calcular_valor_atualizado](funcoes.md#f-calcular_valor_atualizado)

<a id="f-registrar_ponto_manual"></a>
## registrar_ponto_manual (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Crachá Virtual](telas.md#s-cracha-virtual), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Grava:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Ao gravar, acorda os gatilhos de:** [ponto_eletronico](tabelas.md#t-ponto_eletronico) ([fn_ponto_filial_from_funcionario](funcoes.md#f-fn_ponto_filial_from_funcionario), [fn_ponto_recusa_dia_de_folga](funcoes.md#f-fn_ponto_recusa_dia_de_folga))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [_funcionario_desligado](funcoes.md#f-_funcionario_desligado), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [auth_user_role](funcoes.md#f-auth_user_role), [ponto_corte_turma](funcoes.md#f-ponto_corte_turma)

<a id="f-registrar_relogio_maquina"></a>
## registrar_relogio_maquina (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [ti_relogio_maquinas](tabelas.md#t-ti_relogio_maquinas)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-registrar_unidades_recebidas"></a>
## registrar_unidades_recebidas (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- **Grava:** [produto_unidades](tabelas.md#t-produto_unidades)
- **Lê:** [produto_unidades](tabelas.md#t-produto_unidades)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-registrar_voto"></a>
## registrar_voto (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [votacoes](tabelas.md#t-votacoes), [votacoes_votos](tabelas.md#t-votacoes_votos)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles), [votacoes](tabelas.md#t-votacoes), [votacoes_votos](tabelas.md#t-votacoes_votos)

<a id="f-rejeitar_meta_maxbank"></a>
## rejeitar_meta_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [maxbank_metas](tabelas.md#t-maxbank_metas)
- **Ao gravar, acorda os gatilhos de:** [maxbank_metas](tabelas.md#t-maxbank_metas) ([maxbank_metas_set_updated_at](funcoes.md#f-maxbank_metas_set_updated_at))
- **Lê:** [maxbank_metas](tabelas.md#t-maxbank_metas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-rejeitar_tarefa_tatica"></a>
## rejeitar_tarefa_tatica (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Ao gravar, acorda os gatilhos de:** [tarefas_taticas](tabelas.md#t-tarefas_taticas) ([tarefas_taticas_set_updated_at](funcoes.md#f-tarefas_taticas_set_updated_at))
- **Lê:** [tarefas_taticas](tabelas.md#t-tarefas_taticas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-remover_atividade_aula"></a>
## remover_atividade_aula (RPC)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo)
- **Grava:** [aula_atividades](tabelas.md#t-aula_atividades)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-remover_avaliacao_ciclo_tarefa"></a>
## remover_avaliacao_ciclo_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes)
- **Ao gravar, acorda os gatilhos de:** [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes) ([trg_ciclo_tarefas_updated_at](funcoes.md#f-trg_ciclo_tarefas_updated_at))
- **Lê:** [ciclo_tarefa_participantes](tabelas.md#t-ciclo_tarefa_participantes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Chama:** [_assert_pode_avaliar_ciclo_tarefa](funcoes.md#f-_assert_pode_avaliar_ciclo_tarefa)

<a id="f-remover_avaliacao_matriz"></a>
## remover_avaliacao_matriz (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz) ([fn_avaliacao_matriz_congela_avaliador](funcoes.md#f-fn_avaliacao_matriz_congela_avaliador), [trg_aval_matriz_updated_at](funcoes.md#f-trg_aval_matriz_updated_at))
- **Lê:** [competicoes_matriz](tabelas.md#t-competicoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-remover_aviso_matriz"></a>
## remover_aviso_matriz (RPC)

- **Telas que chamam:** [Central de Avaliação](telas.md#s-avaliacoes)
- **Grava:** [avisos_matriz](tabelas.md#t-avisos_matriz)
- **Chama:** [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-remover_excecao_calendario"></a>
## remover_excecao_calendario (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao), [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Grava:** [ponto_calendario_excecoes](tabelas.md#t-ponto_calendario_excecoes)
- **Chama:** [_assert_matriz_admin](funcoes.md#f-_assert_matriz_admin)

<a id="f-remover_matriz_participante"></a>
## remover_matriz_participante (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz) ([fn_avaliacao_matriz_congela_avaliador](funcoes.md#f-fn_avaliacao_matriz_congela_avaliador), [trg_aval_matriz_updated_at](funcoes.md#f-trg_aval_matriz_updated_at))
- **Lê:** [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Chama:** [_assert_matriz_tarefa_gestor](funcoes.md#f-_assert_matriz_tarefa_gestor)

<a id="f-remover_matriz_tarefa"></a>
## remover_matriz_tarefa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Matriz avaliacoes *(rota matriz-avaliacoes)*](telas.md#s-matriz-avaliacoes), [Competição](telas.md#s-matriz-competicao)
- **Grava:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz) ([fn_avaliacao_matriz_congela_avaliador](funcoes.md#f-fn_avaliacao_matriz_congela_avaliador), [trg_aval_matriz_updated_at](funcoes.md#f-trg_aval_matriz_updated_at)); [matriz_tarefas](tabelas.md#t-matriz_tarefas) ([trg_matriz_tarefas_updated_at](funcoes.md#f-trg_matriz_tarefas_updated_at))
- **Lê:** [matriz_tarefa_participantes](tabelas.md#t-matriz_tarefa_participantes), [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Chama:** [_assert_matriz_tarefa_gestor](funcoes.md#f-_assert_matriz_tarefa_gestor)

<a id="f-remover_ponto"></a>
## remover_ponto (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Registro de Ponto](telas.md#s-rh-registrodeponto)
- **Grava:** [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Ao gravar, acorda os gatilhos de:** [ponto_eletronico](tabelas.md#t-ponto_eletronico) ([fn_ponto_filial_from_funcionario](funcoes.md#f-fn_ponto_filial_from_funcionario), [fn_ponto_recusa_dia_de_folga](funcoes.md#f-fn_ponto_recusa_dia_de_folga))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [ponto_eletronico](tabelas.md#t-ponto_eletronico)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_user_role](funcoes.md#f-auth_user_role), [ponto_corte_turma](funcoes.md#f-ponto_corte_turma)

<a id="f-renotificar_pix_pago"></a>
## renotificar_pix_pago (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [pix_pendentes](tabelas.md#t-pix_pendentes)
- **Ao gravar, acorda os gatilhos de:** [pix_pendentes](tabelas.md#t-pix_pendentes) ([pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial), [pix_pendentes_set_paid_at](funcoes.md#f-pix_pendentes_set_paid_at), [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate))

<a id="f-renovar_trabalho"></a>
## renovar_trabalho (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **Grava:** [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-reprovar_promocao"></a>
## reprovar_promocao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções)
- **Grava:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Ao gravar, acorda os gatilhos de:** [marketing_promocoes](tabelas.md#t-marketing_promocoes) ([promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [trg_marketing_promocoes_soft_delete_arte](funcoes.md#f-trg_marketing_promocoes_soft_delete_arte))
- **Lê:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-requisicao_decisao_guard"></a>
## requisicao_decisao_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [requisicoes](tabelas.md#t-requisicoes)
- **Grava:** —
- **Lê:** [pedidos](tabelas.md#t-pedidos)
- **Chama:** [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [eh_perfil_admin](funcoes.md#f-eh_perfil_admin)

<a id="f-requisicao_embalagem_coerente"></a>
## requisicao_embalagem_coerente (gatilho)

- **Dispara em:** [requisicoes](tabelas.md#t-requisicoes)
- **Grava:** —

<a id="f-requisicao_estoque_decisao_guard"></a>
## requisicao_estoque_decisao_guard (gatilho, SECURITY DEFINER)

- **Dispara em:** [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Grava:** —
- **Chama:** [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-requisicao_estoque_marca_reenvio"></a>
## requisicao_estoque_marca_reenvio (gatilho)

- **Dispara em:** [requisicoes_estoque](tabelas.md#t-requisicoes_estoque)
- **Grava:** —

<a id="f-requisicao_marca_reenvio"></a>
## requisicao_marca_reenvio (gatilho)

- **Dispara em:** [requisicoes](tabelas.md#t-requisicoes)
- **Grava:** —

<a id="f-rescisao_gravar"></a>
## rescisao_gravar (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [decidir_desligamento](funcoes.md#f-decidir_desligamento), [demitir_funcionario](funcoes.md#f-demitir_funcionario)
- **Grava:** [rescisoes](tabelas.md#t-rescisoes)

<a id="f-reservar_cobranca"></a>
## reservar_cobranca (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [cartao_pendentes](tabelas.md#t-cartao_pendentes), [pix_pendentes](tabelas.md#t-pix_pendentes)
- **Ao gravar, acorda os gatilhos de:** [cartao_pendentes](tabelas.md#t-cartao_pendentes) ([cartao_pendentes_set_paid_at](funcoes.md#f-cartao_pendentes_set_paid_at), [pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial), [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate)); [pix_pendentes](tabelas.md#t-pix_pendentes) ([pendente_pagamento_preenche_filial](funcoes.md#f-pendente_pagamento_preenche_filial), [pix_pendentes_set_paid_at](funcoes.md#f-pix_pendentes_set_paid_at), [trg_pendente_visitor_gate](funcoes.md#f-trg_pendente_visitor_gate))
- **Lê:** [cartao_pendentes](tabelas.md#t-cartao_pendentes), [pix_pendentes](tabelas.md#t-pix_pendentes)

<a id="f-reservar_codigo_produto"></a>
## reservar_codigo_produto (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos)
- **Grava:** [produtos_codigo_reserva](tabelas.md#t-produtos_codigo_reserva)
- **Lê:** [produtos](tabelas.md#t-produtos), [produtos_codigo_reserva](tabelas.md#t-produtos_codigo_reserva)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-reservar_trabalho"></a>
## reservar_trabalho (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Compras › Cotações](telas.md#s-compras-cotações), [Financeiro › Aprovações de Cotação](telas.md#s-financeiro-aprovaçõesdecotação)
- **Grava:** [trabalho_reservas](tabelas.md#t-trabalho_reservas)
- **Lê:** [trabalho_reservas](tabelas.md#t-trabalho_reservas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-resetar_dados_da_filial"></a>
## resetar_dados_da_filial (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Usuários](telas.md#s-usuarios)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos), [emprestimos_filial](tabelas.md#t-emprestimos_filial)
- **Ao gravar, acorda os gatilhos de:** [emprestimos_filial](tabelas.md#t-emprestimos_filial) ([emprestimo_arquivado_e_historico](funcoes.md#f-emprestimo_arquivado_e_historico), [emprestimo_valida_condicoes](funcoes.md#f-emprestimo_valida_condicoes))
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [capital_filial](tabelas.md#t-capital_filial), [devolucoes](tabelas.md#t-devolucoes), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [folha_pagamento](tabelas.md#t-folha_pagamento), [funcionarios](tabelas.md#t-funcionarios), [marketing_artes](tabelas.md#t-marketing_artes), [marketing_campanhas](tabelas.md#t-marketing_campanhas), [maxbank_contas](tabelas.md#t-maxbank_contas), [metas_estrategicas](tabelas.md#t-metas_estrategicas), [orcamentos_periodo](tabelas.md#t-orcamentos_periodo), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [pedidos_online](tabelas.md#t-pedidos_online), [pesquisa_respostas](tabelas.md#t-pesquisa_respostas), [pesquisas](tabelas.md#t-pesquisas), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [prestacoes_contas](tabelas.md#t-prestacoes_contas), [produtos](tabelas.md#t-produtos), [riscos](tabelas.md#t-riscos), [user_profiles](tabelas.md#t-user_profiles), [vendas](tabelas.md#t-vendas), [votacoes](tabelas.md#t-votacoes)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role)
- **Tem SQL dinâmico** (EXECUTE): o que ele toca não aparece acima.

<a id="f-resetar_dados_operacionais"></a>
## resetar_dados_operacionais (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [resetar_dados_operacionais_admin](funcoes.md#f-resetar_dados_operacionais_admin)
- **Grava:** [avaliacoes](tabelas.md#t-avaliacoes), [caixa_bancos](tabelas.md#t-caixa_bancos), [configuracoes](tabelas.md#t-configuracoes), [desenvolvimentos_ia](tabelas.md#t-desenvolvimentos_ia), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [itens_venda](tabelas.md#t-itens_venda), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo)
- **Ao gravar, acorda os gatilhos de:** [avaliacoes](tabelas.md#t-avaliacoes) ([fn_avaliacoes_filial_from_ciclo](funcoes.md#f-fn_avaliacoes_filial_from_ciclo)); [emprestimos_filial](tabelas.md#t-emprestimos_filial) ([emprestimo_arquivado_e_historico](funcoes.md#f-emprestimo_arquivado_e_historico), [emprestimo_valida_condicoes](funcoes.md#f-emprestimo_valida_condicoes)); [itens_venda](tabelas.md#t-itens_venda) ([fn_item_venda_aloca_unidade](funcoes.md#f-fn_item_venda_aloca_unidade), [fn_item_venda_so_mercadoria](funcoes.md#f-fn_item_venda_so_mercadoria), [fn_itens_venda_carimba_custo](funcoes.md#f-fn_itens_venda_carimba_custo), [fn_valida_filial_item_venda](funcoes.md#f-fn_valida_filial_item_venda)); [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo) ([parcela_emprestimo_arquivada_e_historico](funcoes.md#f-parcela_emprestimo_arquivada_e_historico))
- **Lê:** [afastamentos](tabelas.md#t-afastamentos), [avaliacoes](tabelas.md#t-avaliacoes), [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz), [caixa_bancos](tabelas.md#t-caixa_bancos), [cargos](tabelas.md#t-cargos), [categorias_produto](tabelas.md#t-categorias_produto), [centros_custo](tabelas.md#t-centros_custo), [competicoes_matriz](tabelas.md#t-competicoes_matriz), [departamentos](tabelas.md#t-departamentos), [documentos](tabelas.md#t-documentos), [emprestimos_filial](tabelas.md#t-emprestimos_filial), [filiais](tabelas.md#t-filiais), [folha_pagamento](tabelas.md#t-folha_pagamento), [folha_rubricas](tabelas.md#t-folha_rubricas), [fornecedores](tabelas.md#t-fornecedores), [frequencia_trabalho](tabelas.md#t-frequencia_trabalho), [funcionarios](tabelas.md#t-funcionarios), [justificativas_falta](tabelas.md#t-justificativas_falta), [matriz_tarefas](tabelas.md#t-matriz_tarefas), [maxbank_contas](tabelas.md#t-maxbank_contas), [parcelas_emprestimo](tabelas.md#t-parcelas_emprestimo), [ponto_eletronico](tabelas.md#t-ponto_eletronico), [treinamentos](tabelas.md#t-treinamentos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-resetar_dados_operacionais_admin"></a>
## resetar_dados_operacionais_admin (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Usuários](telas.md#s-usuarios)
- **Grava:** [configuracoes](tabelas.md#t-configuracoes)
- **Lê:** [configuracoes](tabelas.md#t-configuracoes)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role), [resetar_dados_operacionais](funcoes.md#f-resetar_dados_operacionais)

<a id="f-resetar_geral_admin"></a>
## resetar_geral_admin (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Usuários](telas.md#s-usuarios)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos), [configuracoes](tabelas.md#t-configuracoes), [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)
- **Ao gravar, acorda os gatilhos de:** [funcionarios](tabelas.md#t-funcionarios) ([fn_funcionario_excluido_sai_das_tarefas](funcoes.md#f-fn_funcionario_excluido_sai_das_tarefas), [funcionarios_autovincular_user_profile](funcoes.md#f-funcionarios_autovincular_user_profile), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard)); [user_profiles](tabelas.md#t-user_profiles) ([criar_maxbank_conta_para_colaborador](funcoes.md#f-criar_maxbank_conta_para_colaborador), [fn_conselho_e_da_matriz](funcoes.md#f-fn_conselho_e_da_matriz), [user_profiles_bloquear_privesc](funcoes.md#f-user_profiles_bloquear_privesc), [user_profiles_propagar_filial](funcoes.md#f-user_profiles_propagar_filial))
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)
- **Tem SQL dinâmico** (EXECUTE): o que ele toca não aparece acima.

<a id="f-resgatar_aplicacao"></a>
## resgatar_aplicacao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Capital](telas.md#s-financeiro-capital), [Capital](telas.md#s-matriz-capital)
- **Grava:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras), [caixa_bancos](tabelas.md#t-caixa_bancos), [contas_receber](tabelas.md#t-contas_receber), [historico_operacoes](tabelas.md#t-historico_operacoes)
- **Ao gravar, acorda os gatilhos de:** [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber))
- **Lê:** [aplicacoes_financeiras](tabelas.md#t-aplicacoes_financeiras), [caixa_bancos](tabelas.md#t-caixa_bancos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [auth_user_role](funcoes.md#f-auth_user_role), [brl](funcoes.md#f-brl), [ir_aplicacao_pct](funcoes.md#f-ir_aplicacao_pct), [pct_br](funcoes.md#f-pct_br)

<a id="f-responder_convite_vaga"></a>
## responder_convite_vaga (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [candidatura_etapas](tabelas.md#t-candidatura_etapas), [candidaturas](tabelas.md#t-candidaturas), [vaga_convites](tabelas.md#t-vaga_convites)
- **Lê:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [vaga_convites](tabelas.md#t-vaga_convites), [vagas](tabelas.md#t-vagas)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [media_avaliacao_funcionario](funcoes.md#f-media_avaliacao_funcionario), [notificar_setor](funcoes.md#f-notificar_setor)

<a id="f-responder_pesquisa"></a>
## responder_pesquisa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Minhas pesquisas *(rota minhas-pesquisas)*](telas.md#s-minhas-pesquisas)
- **Grava:** [pesquisa_resposta_itens](tabelas.md#t-pesquisa_resposta_itens), [pesquisa_respostas](tabelas.md#t-pesquisa_respostas)
- **Lê:** [pesquisa_respostas](tabelas.md#t-pesquisa_respostas), [pesquisas](tabelas.md#t-pesquisas), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-responder_revisao_auditoria"></a>
## responder_revisao_auditoria (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [auditoria_revisoes](tabelas.md#t-auditoria_revisoes)
- **Lê:** [auditoria_revisoes](tabelas.md#t-auditoria_revisoes)
- **Chama:** [auth_pode_filial](funcoes.md#f-auth_pode_filial), [auth_user_filial](funcoes.md#f-auth_user_filial)

<a id="f-resumo_recebimentos"></a>
## resumo_recebimentos (RPC)

- **Telas que chamam:** [Estoque › Recebimentos](telas.md#s-estoque-recebimentos)
- **Grava:** —
- **Lê:** [recebimentos](tabelas.md#t-recebimentos)

<a id="f-reverter_afastamento_no_ponto"></a>
## reverter_afastamento_no_ponto (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Chamada por outras funções:** [afastamento_reverte_ao_inativar](funcoes.md#f-afastamento_reverte_ao_inativar)
- **Grava:** [afastamentos](tabelas.md#t-afastamentos)
- **Ao gravar, acorda os gatilhos de:** [afastamentos](tabelas.md#t-afastamentos) ([afastamento_decisao_guard](funcoes.md#f-afastamento_decisao_guard), [afastamento_nasce_pendente](funcoes.md#f-afastamento_nasce_pendente), [afastamento_reverte_ao_excluir](funcoes.md#f-afastamento_reverte_ao_excluir), [afastamento_reverte_ao_inativar](funcoes.md#f-afastamento_reverte_ao_inativar), [afastamento_valida_periodo](funcoes.md#f-afastamento_valida_periodo), [trg_afastamentos_updated_at](funcoes.md#f-trg_afastamentos_updated_at))
- **Chama:** [_reverter_ponto_do_afastamento](funcoes.md#f-_reverter_ponto_do_afastamento)

<a id="f-reverter_folha_maxbank"></a>
## reverter_folha_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Folha de Pagamento](telas.md#s-rh-folhadepagamento)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar))
- **Lê:** [maxbank_transacoes](tabelas.md#t-maxbank_transacoes)
- **Chama:** [_maxbank_pode_reverter](funcoes.md#f-_maxbank_pode_reverter), [excluir_transacao_maxbank](funcoes.md#f-excluir_transacao_maxbank)

<a id="f-reverter_promocoes_expiradas"></a>
## reverter_promocoes_expiradas (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Aprovações de Promoções](telas.md#s-financeiro-aprovaçõesdepromoções), [Marketing › Promoções](telas.md#s-marketing-promoções)
- **Servidor (api/) chama:** `api/cron.ts`
- **Grava:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Ao gravar, acorda os gatilhos de:** [marketing_promocoes](tabelas.md#t-marketing_promocoes) ([promocao_decisao_guard](funcoes.md#f-promocao_decisao_guard), [trg_marketing_promocoes_soft_delete_arte](funcoes.md#f-trg_marketing_promocoes_soft_delete_arte))
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today)

<a id="f-reverter_rateio_administrativo"></a>
## reverter_rateio_administrativo (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Rateioadministrativo *(rota financeiro-rateioadministrativo)*](telas.md#s-financeiro-rateioadministrativo)
- **Grava:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [rateio_administrativo](tabelas.md#t-rateio_administrativo)
- **Ao gravar, acorda os gatilhos de:** [contas_pagar](tabelas.md#t-contas_pagar) ([bloqueia_conta_pagar_estourado](funcoes.md#f-bloqueia_conta_pagar_estourado), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [conta_pagar_avancar_folha_e_creditar](funcoes.md#f-conta_pagar_avancar_folha_e_creditar), [conta_pagar_avancar_rescisao](funcoes.md#f-conta_pagar_avancar_rescisao), [conta_pagar_exige_recebimento](funcoes.md#f-conta_pagar_exige_recebimento), [fn_conta_de_das_congela](funcoes.md#f-fn_conta_de_das_congela), [fn_conta_de_das_inativa](funcoes.md#f-fn_conta_de_das_inativa), [fn_conta_de_frete_congela](funcoes.md#f-fn_conta_de_frete_congela), [fn_conta_de_frete_inativa](funcoes.md#f-fn_conta_de_frete_inativa), [fn_conta_de_pedido_congela](funcoes.md#f-fn_conta_de_pedido_congela), [fn_conta_de_pedido_nao_exclui](funcoes.md#f-fn_conta_de_pedido_nao_exclui), [fn_conta_pagar_natureza](funcoes.md#f-fn_conta_pagar_natureza), [fn_parcela_emprestimo_segue_o_titulo](funcoes.md#f-fn_parcela_emprestimo_segue_o_titulo), [sync_saldo_caixa_pagar](funcoes.md#f-sync_saldo_caixa_pagar)); [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber))
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [rateio_administrativo](tabelas.md#t-rateio_administrativo), [rateio_administrativo_itens](tabelas.md#t-rateio_administrativo_itens)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-revisar_risco"></a>
## revisar_risco (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [risco_revisoes](tabelas.md#t-risco_revisoes), [riscos](tabelas.md#t-riscos)
- **Lê:** [riscos](tabelas.md#t-riscos), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [auth_desligado](funcoes.md#f-auth_desligado), [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-rh_calc_inss"></a>
## rh_calc_inss (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_inss_simplificado](funcoes.md#f-_inss_simplificado), [calcular_rescisao](funcoes.md#f-calcular_rescisao), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto)
- **Grava:** —
- **Lê:** [rh_faixas](tabelas.md#t-rh_faixas)
- **Chama:** [rh_vigencia_em](funcoes.md#f-rh_vigencia_em)

<a id="f-rh_calc_irrf"></a>
## rh_calc_irrf (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_irrf_simplificado](funcoes.md#f-_irrf_simplificado), [calcular_rescisao](funcoes.md#f-calcular_rescisao), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto)
- **Grava:** —
- **Lê:** [rh_faixas](tabelas.md#t-rh_faixas), [rh_parametros](tabelas.md#t-rh_parametros)
- **Chama:** [rh_vigencia_em](funcoes.md#f-rh_vigencia_em)

<a id="f-rh_fgts_acumulado"></a>
## rh_fgts_acumulado (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [calcular_rescisao](funcoes.md#f-calcular_rescisao)
- **Grava:** —
- **Lê:** [folha_pagamento](tabelas.md#t-folha_pagamento)

<a id="f-rh_media_variaveis"></a>
## rh_media_variaveis (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [calcular_rescisao](funcoes.md#f-calcular_rescisao)
- **Grava:** —
- **Lê:** [folha_pagamento](tabelas.md#t-folha_pagamento), [folha_rubricas](tabelas.md#t-folha_rubricas)

<a id="f-rh_vigencia_em"></a>
## rh_vigencia_em (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [calcular_rescisao](funcoes.md#f-calcular_rescisao), [recalcular_folha_do_ponto](funcoes.md#f-recalcular_folha_do_ponto), [rh_calc_inss](funcoes.md#f-rh_calc_inss), [rh_calc_irrf](funcoes.md#f-rh_calc_irrf)
- **Grava:** —
- **Lê:** [rh_parametros](tabelas.md#t-rh_parametros)

<a id="f-salvar_lucro_servico"></a>
## salvar_lucro_servico (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- **Grava:** [filial_precificacao](tabelas.md#t-filial_precificacao)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [parametros_precificacao](funcoes.md#f-parametros_precificacao)

<a id="f-salvar_parametros_precificacao"></a>
## salvar_parametros_precificacao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos), [Cadastros › Serviços](telas.md#s-cadastros-serviços), [Financeiro › Precificação](telas.md#s-financeiro-precificação)
- **Grava:** [filial_precificacao](tabelas.md#t-filial_precificacao)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [parametros_precificacao](funcoes.md#f-parametros_precificacao)

<a id="f-separar_pedido_venda"></a>
## separar_pedido_venda (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Estoque › Pedidos de Venda](telas.md#s-estoque-pedidosdevenda), [Financeiro › Pedidos de Venda](telas.md#s-financeiro-pedidosdevenda), [Vendas › Pedidos de Venda](telas.md#s-vendas-pedidosdevenda)
- **Grava:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [pedidos_venda](tabelas.md#t-pedidos_venda)
- **Ao gravar, acorda os gatilhos de:** [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque) ([_mov_estoque_casa_com_pedido](funcoes.md#f-_mov_estoque_casa_com_pedido), [fn_atualiza_estoque_produto](funcoes.md#f-fn_atualiza_estoque_produto), [fn_consumo_material_do_estoque](funcoes.md#f-fn_consumo_material_do_estoque), [fn_consumo_material_segue_movimentacao](funcoes.md#f-fn_consumo_material_segue_movimentacao), [fn_custo_medio_da_entrada](funcoes.md#f-fn_custo_medio_da_entrada), [fn_mov_saldo_abertura_so_na_implantacao](funcoes.md#f-fn_mov_saldo_abertura_so_na_implantacao), [fn_movimentacao_servico_nao_tem_saldo](funcoes.md#f-fn_movimentacao_servico_nao_tem_saldo)); [pedidos_venda](tabelas.md#t-pedidos_venda) ([documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [fn_pedido_venda_status_pelos_marcos](funcoes.md#f-fn_pedido_venda_status_pelos_marcos), [set_numero_documento](funcoes.md#f-set_numero_documento))
- **Lê:** [clientes](tabelas.md#t-clientes), [pedidos_venda](tabelas.md#t-pedidos_venda), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-set_auditoria_campos"></a>
## set_auditoria_campos (gatilho)

- **Dispara em:** [beneficios](tabelas.md#t-beneficios), [caixa_bancos](tabelas.md#t-caixa_bancos), [cargos](tabelas.md#t-cargos), [centros_custo](tabelas.md#t-centros_custo), [classificacoes_auxiliares](tabelas.md#t-classificacoes_auxiliares), [clientes](tabelas.md#t-clientes), [conciliacoes_maquininha](tabelas.md#t-conciliacoes_maquininha), [condicoes_pagamento](tabelas.md#t-condicoes_pagamento), [contas_pagar](tabelas.md#t-contas_pagar), [contas_receber](tabelas.md#t-contas_receber), [controle_caixa](tabelas.md#t-controle_caixa), [cotacoes](tabelas.md#t-cotacoes), [departamentos](tabelas.md#t-departamentos), [duplicatas](tabelas.md#t-duplicatas), [expedicao](tabelas.md#t-expedicao), [filiais](tabelas.md#t-filiais), [filial_investimentos](tabelas.md#t-filial_investimentos), [folha_pagamento](tabelas.md#t-folha_pagamento), [formas_pagamento](tabelas.md#t-formas_pagamento), [fornecedores](tabelas.md#t-fornecedores), [funcionarios](tabelas.md#t-funcionarios), [inventarios](tabelas.md#t-inventarios), [mapeamentos_rateio](tabelas.md#t-mapeamentos_rateio), [movimentacoes_estoque](tabelas.md#t-movimentacoes_estoque), [notas_recebidas](tabelas.md#t-notas_recebidas), [orcamentos](tabelas.md#t-orcamentos), [pedidos](tabelas.md#t-pedidos), [pedidos_venda](tabelas.md#t-pedidos_venda), [previsoes](tabelas.md#t-previsoes), [produtos](tabelas.md#t-produtos), [projetos](tabelas.md#t-projetos), [recebimentos](tabelas.md#t-recebimentos), [requisicoes](tabelas.md#t-requisicoes), [requisicoes_estoque](tabelas.md#t-requisicoes_estoque), [servicos](tabelas.md#t-servicos), [vencimentos_estoque](tabelas.md#t-vencimentos_estoque), [vendas](tabelas.md#t-vendas)
- **Grava:** —

<a id="f-set_filial_movimentacao_carreira"></a>
## set_filial_movimentacao_carreira (gatilho, SECURITY DEFINER)

- **Dispara em:** [movimentacoes_carreira](tabelas.md#t-movimentacoes_carreira)
- **Grava:** —
- **Lê:** [funcionarios](tabelas.md#t-funcionarios)

<a id="f-set_filial_pdi_item"></a>
## set_filial_pdi_item (gatilho, SECURITY DEFINER)

- **Dispara em:** [pdi_itens](tabelas.md#t-pdi_itens)
- **Grava:** —
- **Lê:** [avaliacoes](tabelas.md#t-avaliacoes)

<a id="f-set_limit"></a>
## set_limit (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-set_maxbank_threshold"></a>
## set_maxbank_threshold (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [maxbank_config](tabelas.md#t-maxbank_config)
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-set_numero_documento"></a>
## set_numero_documento (gatilho, SECURITY DEFINER)

- **Dispara em:** [cotacoes](tabelas.md#t-cotacoes), [orcamentos](tabelas.md#t-orcamentos), [pedidos](tabelas.md#t-pedidos), [pedidos_venda](tabelas.md#t-pedidos_venda)
- **Grava:** —
- **Chama:** [acre_today](funcoes.md#f-acre_today), [formatar_numero_documento](funcoes.md#f-formatar_numero_documento), [proximo_numero_documento](funcoes.md#f-proximo_numero_documento)

<a id="f-set_numero_requisicao"></a>
## set_numero_requisicao (gatilho, SECURITY DEFINER)

- **Dispara em:** [requisicoes](tabelas.md#t-requisicoes)
- **Grava:** —
- **Chama:** [acre_today](funcoes.md#f-acre_today), [formatar_numero_requisicao](funcoes.md#f-formatar_numero_requisicao), [proximo_numero_documento](funcoes.md#f-proximo_numero_documento)

<a id="f-show_limit"></a>
## show_limit (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-show_trgm"></a>
## show_trgm (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-similarity"></a>
## similarity (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [coletar_textos_fluxo](funcoes.md#f-coletar_textos_fluxo)
- **Grava:** —

<a id="f-similarity_dist"></a>
## similarity_dist (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-similarity_op"></a>
## similarity_op (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-simples_anexo_i"></a>
## simples_anexo_i (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_simples_periodo](funcoes.md#f-_simples_periodo), [parametros_precificacao](funcoes.md#f-parametros_precificacao)
- **Grava:** —

<a id="f-simples_anexo_iii"></a>
## simples_anexo_iii (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [_simples_periodo](funcoes.md#f-_simples_periodo), [parametros_precificacao](funcoes.md#f-parametros_precificacao)
- **Grava:** —

<a id="f-solicitar_desligamento"></a>
## solicitar_desligamento (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Desligamento](telas.md#s-rh-desligamento)
- **Grava:** [demissoes](tabelas.md#t-demissoes)
- **Lê:** [demissoes](tabelas.md#t-demissoes), [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_pode_filial](funcoes.md#f-auth_pode_filial), [calcular_rescisao](funcoes.md#f-calcular_rescisao)

<a id="f-solicitar_fechamento_caixa"></a>
## solicitar_fechamento_caixa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Vendas › PDV](telas.md#s-vendas-pdv)
- **Grava:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Ao gravar, acorda os gatilhos de:** [controle_caixa](tabelas.md#t-controle_caixa) ([avisa_financeiro_do_caixa](funcoes.md#f-avisa_financeiro_do_caixa), [bloqueia_fechamento_com_venda_em_curso](funcoes.md#f-bloqueia_fechamento_com_venda_em_curso), [controle_caixa_guard](funcoes.md#f-controle_caixa_guard))
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa), [movimentacoes_caixa](tabelas.md#t-movimentacoes_caixa), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_caixa](funcoes.md#f-_assert_caixa), [dinheiro_do_caixa](funcoes.md#f-dinheiro_do_caixa)

<a id="f-strict_word_similarity"></a>
## strict_word_similarity (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-strict_word_similarity_commutator_op"></a>
## strict_word_similarity_commutator_op (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-strict_word_similarity_dist_commutator_op"></a>
## strict_word_similarity_dist_commutator_op (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-strict_word_similarity_dist_op"></a>
## strict_word_similarity_dist_op (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-strict_word_similarity_op"></a>
## strict_word_similarity_op (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-suspender_caixa"></a>
## suspender_caixa (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Vendas › PDV](telas.md#s-vendas-pdv)
- **Grava:** [controle_caixa](tabelas.md#t-controle_caixa)
- **Ao gravar, acorda os gatilhos de:** [controle_caixa](tabelas.md#t-controle_caixa) ([avisa_financeiro_do_caixa](funcoes.md#f-avisa_financeiro_do_caixa), [bloqueia_fechamento_com_venda_em_curso](funcoes.md#f-bloqueia_fechamento_com_venda_em_curso), [controle_caixa_guard](funcoes.md#f-controle_caixa_guard))
- **Lê:** [controle_caixa](tabelas.md#t-controle_caixa), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_caixa](funcoes.md#f-_assert_caixa)

<a id="f-sync_saldo_caixa_pagar"></a>
## sync_saldo_caixa_pagar (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_pagar](tabelas.md#t-contas_pagar)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos)

<a id="f-sync_saldo_caixa_receber"></a>
## sync_saldo_caixa_receber (gatilho, SECURITY DEFINER)

- **Dispara em:** [contas_receber](tabelas.md#t-contas_receber)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos)

<a id="f-tarefas_taticas_set_updated_at"></a>
## tarefas_taticas_set_updated_at (gatilho)

- **Dispara em:** [tarefas_taticas](tabelas.md#t-tarefas_taticas)
- **Grava:** —

<a id="f-total_pendente_contas_pagar"></a>
## total_pendente_contas_pagar (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Contas a pagar](telas.md#s-financeiro-contasapagar)
- **Grava:** —
- **Lê:** [contas_pagar](tabelas.md#t-contas_pagar), [contas_pagar_baixas](tabelas.md#t-contas_pagar_baixas), [financeiro_config](tabelas.md#t-financeiro_config)
- **Chama:** [_assert_blackout](funcoes.md#f-_assert_blackout), [acre_today](funcoes.md#f-acre_today), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin)

<a id="f-transferir_entre_contas"></a>
## transferir_entre_contas (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Financeiro › Caixa / Bancos](telas.md#s-financeiro-caixabancos)
- **Grava:** [caixa_bancos](tabelas.md#t-caixa_bancos)
- **Lê:** [caixa_bancos](tabelas.md#t-caixa_bancos), [filial_caixa_config](tabelas.md#t-filial_caixa_config)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-transferir_pix_maxbank"></a>
## transferir_pix_maxbank (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transacoes](tabelas.md#t-maxbank_transacoes), [maxbank_transferencias](tabelas.md#t-maxbank_transferencias)
- **Ao gravar, acorda os gatilhos de:** [maxbank_contas](tabelas.md#t-maxbank_contas) ([maxbank_contas_set_updated_at](funcoes.md#f-maxbank_contas_set_updated_at)); [maxbank_transacoes](tabelas.md#t-maxbank_transacoes) ([maxbank_tx_protege_abertura](funcoes.md#f-maxbank_tx_protege_abertura))
- **Lê:** [maxbank_contas](tabelas.md#t-maxbank_contas), [maxbank_transferencias](tabelas.md#t-maxbank_transferencias), [user_profiles](tabelas.md#t-user_profiles)

<a id="f-trg_afastamentos_updated_at"></a>
## trg_afastamentos_updated_at (gatilho)

- **Dispara em:** [afastamentos](tabelas.md#t-afastamentos)
- **Grava:** —

<a id="f-trg_aval_matriz_updated_at"></a>
## trg_aval_matriz_updated_at (gatilho)

- **Dispara em:** [avaliacoes_matriz](tabelas.md#t-avaliacoes_matriz)
- **Grava:** —

<a id="f-trg_briefings_diarios_updated_at"></a>
## trg_briefings_diarios_updated_at (gatilho)

- **Dispara em:** [briefings_diarios](tabelas.md#t-briefings_diarios)
- **Grava:** —

<a id="f-trg_ciclo_tarefas_updated_at"></a>
## trg_ciclo_tarefas_updated_at (gatilho)

- **Dispara em:** [ciclo_tarefa_avaliacoes](tabelas.md#t-ciclo_tarefa_avaliacoes), [ciclo_tarefas](tabelas.md#t-ciclo_tarefas)
- **Grava:** —

<a id="f-trg_marketing_arte_feedback_updated_at"></a>
## trg_marketing_arte_feedback_updated_at (gatilho)

- **Dispara em:** [marketing_arte_feedback](tabelas.md#t-marketing_arte_feedback)
- **Grava:** —

<a id="f-trg_marketing_artes_updated_at"></a>
## trg_marketing_artes_updated_at (gatilho)

- **Dispara em:** [marketing_artes](tabelas.md#t-marketing_artes)
- **Grava:** —

<a id="f-trg_marketing_calendario_updated_at"></a>
## trg_marketing_calendario_updated_at (gatilho)

- **Dispara em:** [marketing_calendario](tabelas.md#t-marketing_calendario)
- **Grava:** —

<a id="f-trg_marketing_campanhas_updated_at"></a>
## trg_marketing_campanhas_updated_at (gatilho)

- **Dispara em:** [marketing_campanhas](tabelas.md#t-marketing_campanhas)
- **Grava:** —

<a id="f-trg_marketing_cupons_updated_at"></a>
## trg_marketing_cupons_updated_at (gatilho)

- **Dispara em:** [marketing_cupons](tabelas.md#t-marketing_cupons)
- **Grava:** —

<a id="f-trg_marketing_promocoes_soft_delete_arte"></a>
## trg_marketing_promocoes_soft_delete_arte (gatilho, SECURITY DEFINER)

- **Dispara em:** [marketing_promocoes](tabelas.md#t-marketing_promocoes)
- **Grava:** [marketing_artes](tabelas.md#t-marketing_artes)
- **Ao gravar, acorda os gatilhos de:** [marketing_artes](tabelas.md#t-marketing_artes) ([fn_arte_produto_e_cota](funcoes.md#f-fn_arte_produto_e_cota), [trg_marketing_artes_updated_at](funcoes.md#f-trg_marketing_artes_updated_at))

<a id="f-trg_matriz_tarefas_updated_at"></a>
## trg_matriz_tarefas_updated_at (gatilho)

- **Dispara em:** [matriz_tarefas](tabelas.md#t-matriz_tarefas)
- **Grava:** —

<a id="f-trg_pdi_itens_updated_at"></a>
## trg_pdi_itens_updated_at (gatilho)

- **Dispara em:** [pdi_itens](tabelas.md#t-pdi_itens)
- **Grava:** —

<a id="f-trg_pendente_visitor_gate"></a>
## trg_pendente_visitor_gate (gatilho, SECURITY DEFINER)

- **Dispara em:** [cartao_pendentes](tabelas.md#t-cartao_pendentes), [pix_pendentes](tabelas.md#t-pix_pendentes)
- **Grava:** —
- **Lê:** [modo_visitante_config](tabelas.md#t-modo_visitante_config)
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role)

<a id="f-trg_treinamento_inscricoes_updated_at"></a>
## trg_treinamento_inscricoes_updated_at (gatilho)

- **Dispara em:** [treinamento_inscricoes](tabelas.md#t-treinamento_inscricoes)
- **Grava:** —

<a id="f-unidade_fracionaria"></a>
## unidade_fracionaria (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [criar_requisicoes_compra_lote](funcoes.md#f-criar_requisicoes_compra_lote)
- **Grava:** —

<a id="f-user_profiles_bloquear_privesc"></a>
## user_profiles_bloquear_privesc (gatilho, SECURITY DEFINER)

- **Dispara em:** [user_profiles](tabelas.md#t-user_profiles)
- **Grava:** —
- **Chama:** [auth_is_service_role](funcoes.md#f-auth_is_service_role), [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-user_profiles_propagar_filial"></a>
## user_profiles_propagar_filial (gatilho, SECURITY DEFINER)

- **Dispara em:** [user_profiles](tabelas.md#t-user_profiles)
- **Grava:** [funcionarios](tabelas.md#t-funcionarios)
- **Ao gravar, acorda os gatilhos de:** [funcionarios](tabelas.md#t-funcionarios) ([fn_funcionario_excluido_sai_das_tarefas](funcoes.md#f-fn_funcionario_excluido_sai_das_tarefas), [funcionarios_autovincular_user_profile](funcoes.md#f-funcionarios_autovincular_user_profile), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard))

<a id="f-usuarios_visiveis_para_auditoria"></a>
## usuarios_visiveis_para_auditoria (RPC, SECURITY DEFINER)

- **Telas que chamam:** —
- **Grava:** —
- **Lê:** [user_profiles](tabelas.md#t-user_profiles)

<a id="f-validar_cupom"></a>
## validar_cupom (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Vendas › PDV](telas.md#s-vendas-pdv)
- **Grava:** —
- **Lê:** [marketing_cupons](tabelas.md#t-marketing_cupons)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today)

<a id="f-vencimento_das"></a>
## vencimento_das (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [apurar_das](funcoes.md#f-apurar_das), [das_competencias](funcoes.md#f-das_competencias)
- **Grava:** —

<a id="f-venda_fiado_respeita_credito"></a>
## venda_fiado_respeita_credito (gatilho, SECURITY DEFINER)

- **Dispara em:** [vendas](tabelas.md#t-vendas)
- **Grava:** —
- **Lê:** [clientes](tabelas.md#t-clientes)
- **Chama:** [cliente_saldo_devedor](funcoes.md#f-cliente_saldo_devedor), [cliente_titulos_vencidos](funcoes.md#f-cliente_titulos_vencidos)

<a id="f-vender_patrimonio"></a>
## vender_patrimonio (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Empresa › Filiais](telas.md#s-empresa-filiais), [Financeiro › Patrimônio](telas.md#s-financeiro-patrimônio)
- **Grava:** [contas_receber](tabelas.md#t-contas_receber), [produtos](tabelas.md#t-produtos)
- **Ao gravar, acorda os gatilhos de:** [contas_receber](tabelas.md#t-contas_receber) ([_conta_receber_fecha_pedido_venda](funcoes.md#f-_conta_receber_fecha_pedido_venda), [conta_com_dinheiro_nao_exclui](funcoes.md#f-conta_com_dinheiro_nao_exclui), [fn_conta_receber_exige_conciliacao](funcoes.md#f-fn_conta_receber_exige_conciliacao), [sync_saldo_caixa_receber](funcoes.md#f-sync_saldo_caixa_receber)); [produtos](tabelas.md#t-produtos) ([fn_block_correcao_manual](funcoes.md#f-fn_block_correcao_manual), [fn_block_estoque_manual](funcoes.md#f-fn_block_estoque_manual), [fn_carimba_exclusao](funcoes.md#f-fn_carimba_exclusao), [fn_produto_com_documento_aberto_nao_sai](funcoes.md#f-fn_produto_com_documento_aberto_nao_sai), [fn_produto_ean_valido](funcoes.md#f-fn_produto_ean_valido), [fn_produto_publicavel](funcoes.md#f-fn_produto_publicavel), [fn_produto_status_segue_ativo](funcoes.md#f-fn_produto_status_segue_ativo), [fn_produto_variante_ja_existe](funcoes.md#f-fn_produto_variante_ja_existe), [fn_unidade_imutavel_com_saldo](funcoes.md#f-fn_unidade_imutavel_com_saldo), [produto_loja_online_guard](funcoes.md#f-produto_loja_online_guard), [produto_preco_nao_fica_abaixo_do_custo](funcoes.md#f-produto_preco_nao_fica_abaixo_do_custo))
- **Lê:** [produtos](tabelas.md#t-produtos)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [acre_today](funcoes.md#f-acre_today), [auth_gerente_da](funcoes.md#f-auth_gerente_da), [auth_in_setor](funcoes.md#f-auth_in_setor), [auth_is_admin](funcoes.md#f-auth_is_admin), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-vincular_acesso_funcionario"></a>
## vincular_acesso_funcionario (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Recursos Humanos › Recrutamento e Seleção](telas.md#s-rh-recrutamentoeseleção)
- **Grava:** [funcionarios](tabelas.md#t-funcionarios)
- **Ao gravar, acorda os gatilhos de:** [funcionarios](tabelas.md#t-funcionarios) ([fn_funcionario_excluido_sai_das_tarefas](funcoes.md#f-fn_funcionario_excluido_sai_das_tarefas), [funcionarios_autovincular_user_profile](funcoes.md#f-funcionarios_autovincular_user_profile), [funcionarios_vinculo_admin_guard](funcoes.md#f-funcionarios_vinculo_admin_guard))
- **Lê:** [funcionarios](tabelas.md#t-funcionarios), [user_profiles](tabelas.md#t-user_profiles)
- **Chama:** [_assert_recrutamento](funcoes.md#f-_assert_recrutamento), [_assert_rpc](funcoes.md#f-_assert_rpc)

<a id="f-vincular_produto_requisicao"></a>
## vincular_produto_requisicao (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Cadastros › Produtos](telas.md#s-cadastros-produtos)
- **Grava:** [requisicoes](tabelas.md#t-requisicoes)
- **Ao gravar, acorda os gatilhos de:** [requisicoes](tabelas.md#t-requisicoes) ([aprovacao_segue_a_requisicao](funcoes.md#f-aprovacao_segue_a_requisicao), [documento_sem_exclusao](funcoes.md#f-documento_sem_exclusao), [requisicao_decisao_guard](funcoes.md#f-requisicao_decisao_guard), [requisicao_embalagem_coerente](funcoes.md#f-requisicao_embalagem_coerente), [requisicao_marca_reenvio](funcoes.md#f-requisicao_marca_reenvio), [set_numero_requisicao](funcoes.md#f-set_numero_requisicao))
- **Lê:** [produtos](tabelas.md#t-produtos), [requisicoes](tabelas.md#t-requisicoes)
- **Chama:** [_assert_rpc](funcoes.md#f-_assert_rpc), [auth_pode_filial](funcoes.md#f-auth_pode_filial)

<a id="f-vincular_sessao_aula"></a>
## vincular_sessao_aula (RPC, SECURITY DEFINER)

- **Telas que chamam:** [Modo Aula](telas.md#s-aula-modo)
- **Grava:** [aula_sessoes](tabelas.md#t-aula_sessoes)
- **Lê:** [aula_sessoes](tabelas.md#t-aula_sessoes)
- **Chama:** [auth_user_role](funcoes.md#f-auth_user_role)

<a id="f-vinculo_item_parece"></a>
## vinculo_item_parece (RPC)

- **Telas que chamam:** —
- **Chamada por outras funções:** [gerar_pedido_de_cotacao](funcoes.md#f-gerar_pedido_de_cotacao)
- **Grava:** —
- **Chama:** [palavras_vinculo](funcoes.md#f-palavras_vinculo)

<a id="f-word_similarity"></a>
## word_similarity (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-word_similarity_commutator_op"></a>
## word_similarity_commutator_op (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-word_similarity_dist_commutator_op"></a>
## word_similarity_dist_commutator_op (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-word_similarity_dist_op"></a>
## word_similarity_dist_op (RPC)

- **Telas que chamam:** —
- **Grava:** —

<a id="f-word_similarity_op"></a>
## word_similarity_op (RPC)

- **Telas que chamam:** —
- **Grava:** —
