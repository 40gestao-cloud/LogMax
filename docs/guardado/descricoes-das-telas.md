# Descrições das telas (guardadas em 24/09/2026)

Até 24/09/2026 cada tela tinha, logo abaixo do título, um parágrafo explicando
para que ela serve. O professor pediu para tirar do app e guardar aqui, fora
do frontend, para poder pedir de volta um dia.

Cada bloco traz a tela, o título como estava e o trecho exato do JSX removido
(inclusive o comentário que o acompanhava, quando havia). Para devolver uma
descrição: colar o trecho logo depois do `</h2>` do título da tela.

Ficaram na tela, de propósito, os parágrafos que são DADO e não explicação:
Contas a Pagar (total pendente), Contas a Receber (total em aberto), Histórico
de Vendas (período e total), Recibos de Vendas (o total), Conteúdo da Matriz
("Restrito ao professor") e o aviso "somente leitura em Matriz" das telas de
cadastro genéricas.

## Parágrafos removidos das telas

### AfastamentosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Afastamentos — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Registre atestados, licenças e faltas justificadas. O ponto eletrônico recebe o status <strong className="text-gray-300">Justificado</strong> nos dias do período — mas o desconto na folha só é perdoado depois que <strong className="text-gray-300">admin ou CEO</strong> aprovar.
          </p>
```

### AlcadasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2"> <ShieldCheck size={26} /> Alçadas de Aprovação </h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Define quem aprova cotações por faixa de valor em cada filial.
        </p>
```

### AprovacoesComprasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Aprovações — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Tudo o que espera a sua decisão, num sítio só. Em <span className="text-gray-300 font-semibold">Compras a aprovar</span>,
            aprovar não compra nada — libera Compras para cotar fornecedores. Em{' '}
            <span className="text-gray-300 font-semibold">Material a liberar</span>, liberar entrega o que já
            está na prateleira e baixa o saldo na hora.
          </p>
```

### AprovacoesConteudoMarketingView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Aprovações de Conteúdo</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Revise e aprove ou reprove os links de propaganda enviados pelo time de Marketing.</p>
```

### AprovacoesEstoqueView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Liberar Requisições — {filial}</h2>`

```tsx
<p className="text-sm text-gray-400 mt-1">Material pedido pelas áreas — o que já existe na prateleira, e por isso não passa por Compras. Liberar dá baixa no estoque; quem pediu não libera a própria (migr. 284). Esta é a fila do almoxarife; a fila do gerente para os dois documentos, compra e material, fica em Requisições → Aprovações.</p>
```

### AprovacoesPromocaoFinanceiroView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Aprovações — Marketing</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Analise e aprove promoções individuais e itens de campanhas enviados pelo Marketing.</p>
```

### ArtesPromocionaisView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Artes Promocionais — {filial}</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Artes publicadas pelo Marketing para as promoções aprovadas. Clique numa arte
          para vê-la em tela grande.
        </p>
```

### AvaliacoesView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight"> Avaliações de Desempenho{filial ? ` — ${filial}` : ' — Matriz'} </h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            {isAdminOuCEO && isMatriz && 'Gerencie ciclos, avalie CEO/conselheiros, gerentes, colaboradores e filiais, acompanhe o consolidado.'}
            {!(isAdminOuCEO && isMatriz) && 'Acompanhe as avaliações que você recebeu e o desempenho da sua filial na competição.'}
          </p>
```

### BriefingDiarioView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Briefing Diário</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          IA analisa o estado real do ERP e propõe tarefas operacionais por setor. Você revisa, edita e aprova — o que aprovar vai pro submenu <strong className="text-gray-300">Tarefas</strong> de cada módulo.
        </p>
```

### CRMView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">{title}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">{desc}</p>
```

### CaixaBancosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Caixa / Bancos</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            {matrizMode
              ? 'Contas da holding e das três unidades. O que você criar aqui nasce na unidade escolhida no formulário.'
              : `Contas de ${filialAtiva}.`}
          </p>
```

### CalendarioEditorialView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Calendário Editorial — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Agenda de posts por canal × data × responsável × status. Planeje a semana antes de produzir as artes.
          </p>
```

### CampanhasMarketingView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Campanhas — {filial}</h2>`

```tsx
            <p className="text-sm text-gray-400 mt-1">
              Planeje campanhas com orçamento e período, acompanhe ROI cruzando vendas no período e cupons usados.
            </p>
```

### CatalogoProdutosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Catálogo de Produtos</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Vitrine consultiva — toque num produto para ver imagem, ficha e preço.</p>
```

### CentralTempoView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Central de Tempo</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Quatro ferramentas operacionais num só lugar: relógio do Acre,
          alarmes, cronômetro e timer. Toque para abrir.
        </p>
```

### ClienteEspecialView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Cliente Especial</h2>`

```tsx
          <p className="text-sm text-gray-400">
            Acesso restrito (admin/CEO). Aja como o cliente para aprovar ou reprovar propostas em
            <span className="text-cyan-400 font-bold"> Enviado ao Cliente</span>.
          </p>
```

### ConciliacaoMaquininhaView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight"> Conciliação da Maquininha — {filial} </h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          A adquirente deposita a venda menos a taxa. Aqui você casa o extrato com os títulos:
          a receita entra pelo bruto e a taxa vira despesa.
        </p>
```

### ConfigJurosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Juros & Multa</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Política aplicada a Contas a Receber e Contas a Pagar vencidas. Vale também para parcelas de Cartão de Crédito.
        </p>
```

### ControleCaixaView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Controle de Caixa</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          {cross && !filialAtivaOperacional
            ? 'Abertura e fechamento por unidade. O PDV de cada empresa só opera com o respectivo caixa aberto.'
            : `Abertura e fechamento do caixa da unidade ${filiaisVisiveis[0] ?? profile?.filial ?? '—'}.`}
        </p>
```

### CotacoesView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight"> {modoFinanceiro ? 'Aprovações de Cotação' : 'Cotações'} — {filial} </h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            {modoFinanceiro
              ? 'Cotações que o setor de Compras enviou e aguardam a sua decisão.'
              : 'Colete propostas de fornecedores; após aprovação do Financeiro, gere o pedido.'}
          </p>
```

### CrachaVirtualView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2"> <IdCard size={26} /> Crachá Virtual </h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Leia o crachá do aluno para registrar a presença de hoje. O lançamento manual
          em Registro de Ponto continua valendo para correções.
        </p>
```

### CuponsMarketingView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Cupons — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Códigos promocionais aplicáveis no PDV. Use cupom percentual ou valor fixo, com limite de usos e validade.
          </p>
```

### DREView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">DRE — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Resultado por competência: a venda entra na data da venda, a despesa no vencimento.
            Dinheiro no bolso é o Controle de Caixa — a diferença entre os dois é o ponto.
          </p>
```

### DashboardAnalyticsView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Dashboard</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Visão geral da sua operação.</p>
```

### DesenvolvimentoIAView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Desenvolvimento com IA</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-0.5">
            Treinamentos práticos com ferramentas de tecnologia e Inteligência Artificial.
          </p>
```

### DesligamentosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Desligamento</h2>`

```tsx
        <p className="text-xs text-gray-500 mt-1">
          Encerra o vínculo, calcula as verbas rescisórias e retira o acesso de escrita à plataforma.
        </p>
```

### DevolucoesView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Devoluções — {filial}</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Registre a devolução parcial ou total de uma venda. O estoque é revertido e o financeiro estornado.
        </p>
```

### ExpedicaoView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Expedição — {filial}</h2>`

```tsx
<p className="text-sm text-gray-400 mt-1">Gerencie a saída e expedição de produtos do estoque.</p>
```

### FeedbackOrganizacionalView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-3"> <MessageSquare size={24} /> Feedback Organizacional </h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Canal anônimo. Escolha categoria e quem deve receber. {isDiretoria
            ? 'Como diretoria, você vê todos os feedbacks enviados (de qualquer destinatário).'
            : 'Você lê apenas os feedbacks endereçados ao seu papel.'}
        </p>
```

### FeriasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Férias — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Gerencie solicitações e períodos de férias dos funcionários.</p>
```

### FiliaisView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight"> Gestão de Filiais {filialAtiva === null ? '— Matriz (consolidado)' : `— ${nichoAtivo}`} </h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            {filialAtiva === null
              ? 'Consolidado das 4 unidades. Troque para uma filial no topbar para ver apenas ela.'
              : <>Você está vendo apenas as unidades de <span className="text-accent font-bold">{nichoAtivo}</span>. Troque de unidade no topbar para ver outras.</>}
          </p>
```

### FolhaPagamentoView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Folha de Pagamento — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Gerencie a folha mensal dos funcionários.</p>
```

### FrequenciaTrabalhoView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Frequência de Trabalho</h2>`

```tsx
          <p className={`text-sm text-gray-400 ${embedded ? '' : 'mt-1'}`}>
            Lançamento manual do <strong className="text-gray-300">ponto eletrônico</strong> — mesma base do totem, então falta lançada aqui desconta na folha. Período: {periodoLabel}
          </p>
```

### FuncionariosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Funcionários — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Gerencie o quadro de funcionários da unidade.</p>
```

### GerenciamentoComprasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Gerenciamento de Compras</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Visão geral do pipeline de compras — do pedido ao pagamento.</p>
```

### GerenciamentoEstoqueView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Gerenciamento de Estoque</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Visão geral do fluxo de estoque — requisições, aprovações, expedição e movimentações.</p>
```

### GerenciamentoFinanceiroView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Gerenciamento Financeiro</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Visão consolidada do fluxo financeiro — recebimentos, pagamentos e saldos.</p>
```

### GerenciamentoRHView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Gerenciamento de RH</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Visão consolidada do capital humano — funcionários, folha, férias e treinamentos.</p>
```

### IntegracaoBancariaView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Integração Bancária</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Gerencie contas bancárias e o histórico de importações/conciliações.</p>
```

### InventariosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Inventários — {filial}</h2>`

```tsx
<p className="text-sm text-gray-400 mt-1">Realize contagens de estoque e registre divergências.</p>
```

### MarketingConfigView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2"> <Settings size={24} /> Configurações de Marketing </h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Dois limites da turma. Valem para todas as unidades.
        </p>
```

### MatrizAvisosView

Título: `<h2 className="text-lg sm:text-xl font-bold text-accent tracking-tight">Avisos da Matriz</h2>`

```tsx
          <p className="text-xs text-gray-400 mt-1">
            Recado com prazo para gerentes e colaboradores. Aparece como botão flutuante em qualquer
            tela até a pessoa confirmar leitura.
          </p>
```

### MatrizCompeticaoView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2"> <Trophy size={24} /> Competição entre Filiais </h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Média das notas do conselho por filial nas Tarefas da Matriz. Ranking direto pela média.
          </p>
```

### MatrizConteudoView

Título: `<h2 className="text-3xl font-bold text-accent tracking-tight flex items-center gap-2"> <Dices size={26} /> Conteúdo — Sorteio de Catálogo </h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Sorteia produtos reais do catálogo semente para o aluno cadastrar em Cadastros &gt; Produtos.
        </p>
```

### MetasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Metas</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Metas estratégicas da organização.</p>
```

### MetricasRedesSociaisView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Redes Sociais</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Registros de desempenho por plataforma{filialAtiva ? ` — ${filialAtiva}` : ' — todas as filiais'}.</p>
```

### MeuCrachaView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2"> <IdCard size={26} /> Meu Crachá </h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Mostre este QR para registrar sua presença. Ele identifica você — a presença
          só é gravada por quem faz a leitura.
        </p>
```

### MinhasPesquisasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Minhas Pesquisas</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Pesquisas ativas onde sua opinião é esperada.</p>
```

### MovimentacoesEstoqueView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Movimentações de Estoque — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Entradas, saídas e ajustes de estoque.</p>
```

### NotasEmitidasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Notas Emitidas</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Faturamento da <span className="text-accent">{filial}</span>: PDV emite automaticamente,
            {' '}serviços prestados você lança aqui.
          </p>
```

### NotasRecebidasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Notas Recebidas</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Registre notas de fornecedores e a aplicação do <span className="text-accent">Capital Inicial</span> em produtos, equipamentos, mobiliário, aluguel e serviços.
          </p>
```

### OrcamentosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight"> {modoFinanceiro ? `Aprovações de Orçamento — ${filial}` : `Orçamentos & Propostas — ${filial}`} </h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            {modoFinanceiro
              ? 'Aprove ou reprove propostas comerciais enviadas pela equipe de Vendas.'
              : 'Crie propostas com validade, descontos e acompanhe a aprovação até virar pedido.'}
          </p>
```

### PainelBIView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Painel de BI</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Consolidação de Vendas, Financeiro, RH, Estoque e Marketing — análise executiva gerada por IA com base em dados reais do período.
        </p>
```

### PatrimonioView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Controle de Patrimônio — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Bens classificados como patrimônio no cadastro de produtos (Compras). Cadastro novo é feito em <span className="font-bold text-gray-300">Empresa → Produtos</span> marcando o tipo.
          </p>
```

### PedidosOnlineView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pedidos Online — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Pedidos vindos da loja pública. Eles <strong className="text-gray-300">não são vendas</strong> ainda —
            viram venda quando alguém daqui confirma, e aí seguem o caminho normal do PDV.
          </p>
```

### PedidosVendaView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">{tituloModo} — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">{subtituloModo}</p>
```

### PedidosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pedidos de Compra — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Pedidos gerados a partir de cotações aprovadas. Marcar "em entrega" é o que avisa
            o Estoque de que há carga a receber.
          </p>
```

### PesquisasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pesquisas — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Crie pesquisas de clima, satisfação ou feedback e acompanhe os resultados.</p>
```

### PontoEletronicoView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight"> Registro de Ponto{filial ? ` — ${filial}` : ''} </h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          {modoMatriz
            ? 'Todas as unidades. Escolha uma no seletor do topo para trabalhar dentro dela.'
            : 'Registro e acompanhamento de ponto dos funcionários.'}
        </p>
```

### ProdutosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Produtos — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Gerencie o portfólio de itens do estoque e suas informações.</p>
```

### PromocoesMarketingView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Promoções — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Proponha preços promocionais e acompanhe a cadeia: o Financeiro dá o parecer de margem, o gerente da filial libera.</p>
```

### RateioAdministrativoView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Rateio Administrativo</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Distribui o custo da holding entre as unidades que o consomem.
        </p>
```

### RecebimentosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Recebimentos — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Registre o que chegou e confirme a entrada. É a confirmação que move o estoque
            e libera o pagamento do fornecedor.
          </p>
```

### RecrutamentoView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight"> Recrutamento & Seleção{emMatriz ? '' : ` — ${filial}`} </h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            {emMatriz
              ? 'Decida o headcount das 3 unidades e conduza a promoção inter-filiais, que só a Matriz pode fazer.'
              : 'Peça headcount, acompanhe a aprovação da Matriz e conduza o funil até contratar.'}
          </p>
```

### RelatoriosComprasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Relatórios de Compras</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Visão consolidada de requisições, pedidos, recebimentos e notas fiscais.</p>
```

### RelatoriosEstoqueView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Relatórios de Estoque</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Visão consolidada de movimentações, saldos, vencimentos e inventários.</p>
```

### RelatoriosFinanceirosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Relatórios Financeiros</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Visão consolidada de contas e posição de caixa.</p>
```

### RelatoriosRHView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Relatórios — RH</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Consulte e exporte relatórios do módulo de Recursos Humanos.</p>
```

### RelatoriosVendasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Relatório de Vendas</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Visão consolidada de orçamentos, pedidos de venda e histórico das 3 unidades.</p>
```

### RequerimentosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requerimentos</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            {isGerente ? 'Requerimentos da filial' : 'Seus requerimentos enviados à Matriz'}
          </p>
```

### RequisicoesEstoqueView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições de Material — {filial}</h2>`

```tsx
          {/* Esta tela NÃO libera — só confere e corrige. A baixa acontece em
              Estoque → Liberar Requisições. O texto antigo prometia "confere e
              libera" e mandava o almoxarife embora achando que tinha atendido
              o pedido. */}
          <p className="text-sm text-gray-400 mt-1">
            Material que as áreas pediram do almoxarifado. Quem pede abre em Requisições &rarr; Do Setor; aqui o
            Estoque confere e corrige a quantidade, e a baixa é em Liberar Requisições. Não confunda com a
            requisição de <strong className="text-gray-300">compra</strong>: aquela é
            <strong className="text-gray-300"> outro documento</strong>, para o que a empresa não tem e precisa
            comprar — esta sai da prateleira e não passa por Compras. Esta é a tela do almoxarife, para
            conferir e corrigir; quem decide (liberar/negar) usa Estoque &rarr; Liberar Requisições, ou a
            aba Material em Requisições &rarr; Aprovações.
          </p>
```

### RequisicoesSetorView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            O que o seu setor pediu. Material que já existe sai do Estoque; o que falta vai para Compras cotar,
            e o gerente decide. <strong className="text-gray-300">Repor</strong> item do catálogo e{' '}
            <strong className="text-gray-300">comprar</strong> algo fora dele são pedidos diferentes: o primeiro se
            explica pelo saldo, o segundo precisa de justificativa. A requisição que você abre aqui é o mesmo
            documento que Compras trabalha em Compras &rarr; Requisições de compra — clique na linha para ver em que
            etapa ela está.
          </p>
```

### RequisicoesView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Fila da filial. Quem pede é a área que precisa, em Requisições &rarr; Do Setor; aqui Compras confere,
            corrige e leva para cotação — é o <strong className="text-gray-300">mesmo documento</strong>, visto pelo
            papel de quem executa a compra. Clique na linha para abrir a ficha completa: o item sem corte, a ficha do produto, a quantidade, quem pediu, o prazo e em que etapa está.
          </p>
```

### SaldosEstoqueView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Saldos de Estoque — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Posição atual de estoque por produto.</p>
```

### ServicosView

Título: `<h2 className="text-lg sm:text-xl font-black text-accent tracking-tight">Serviços — {filial}</h2>`

```tsx
          <p className="text-xs text-gray-500 mt-0.5">
            {filial === 'MaxLook' && 'Ajustes, customizações e cuidados de peças.'}
            {filial === 'TechMax' && 'Assistência técnica: reparos, trocas e diagnósticos.'}
            {filial === 'SuperMax' && 'Serviços do supermercado.'}
            <span className="block mt-0.5 text-gray-600">
              A lista tem as duas naturezas: o que a unidade presta ao cliente e o que ela
              contrata de terceiro. Só o contratado aparece na cotação e no pedido de compra.
            </span>
          </p>
```

### SugestoesComprasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Sugestões de Compras</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Produtos com estoque crítico ou baixo que precisam de reabastecimento.</p>
```

### TreinamentoVendasView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Treinamento</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Treine a frente de caixa no MaxPOS antes de operar o PDV da sua unidade.
        </p>
```

### TreinamentosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Treinamentos — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">Gerencie treinamentos internos e externos.</p>
```

### UsuariosView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Usuários</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-1">Gerencie todos os usuários do sistema.</p>
```

### ValidadesView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Validades — {filial}</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Lotes ordenados pelo que vence primeiro (FEFO). O que vence antes sai antes — por venda,
            promoção ou perda.
          </p>
```

### VitrinePublicaView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Vitrine da Tela de Login</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Escolha quais artes e produtos passam no carrossel da tela de login.
            <span className="text-gray-500"> Não é a loja online da filial — para publicar produto lá,
            use Vendas → Pedidos Online.</span>
          </p>
```

### AulaAtividadeView

Título: `<h1 className="text-2xl font-bold text-gray-100">Atividade da aula</h1>`

```tsx
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            O roteiro que a Matriz publicou para a sua turma. Cada tarefa diz em que papel
            ela é feita — as suas são as do papel que você ocupa hoje.
          </p>
```

### AulaModoView

Título: `<h1 className="text-2xl font-bold text-gray-100">Modo Aula</h1>`

```tsx
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Habilite apenas os módulos que a turma vai trabalhar hoje. O restante fica oculto pra
            todos os usuários selecionados (admin fica sempre com acesso total pra destravar).
          </p>
```

### CategoriasProdutoView

Título: `<h1 className="text-2xl font-black text-gray-100">Categorias{filial ? ` — ${filial}` : ' — Consolidado'}</h1>`

```tsx
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Dois níveis: a <strong className="text-gray-400 font-semibold">categoria</strong> agrupa a linha de produto
            e define o markup-alvo; a <strong className="text-gray-400 font-semibold">subcategoria</strong> refina dentro dela.
            Usadas em Produtos, Orçamento e Marketing.
            {!filial && ' Visão consolidada de todas as unidades — somente leitura em Matriz.'}
          </p>
```

### MandatosView

Título: `<h1 className="text-2xl font-bold text-gray-100">Mandatos</h1>`

```tsx
        <p className="text-sm text-gray-400 mt-1">
          Nomear é um ato com data e motivo — e com hora marcada para prestar contas
          do posto. Vencido o prazo, o Conselho reconduz, substitui ou encerra; o
          mandato não cai sozinho.
        </p>
```

### MatrizAvaliacoesView

Título: `<h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Central de Avaliação — Matriz</h2>`

```tsx
          <p className="text-sm text-gray-400 mt-1">
            Escolha a competição para ver as tarefas, as notas do conselho e quem participou.
          </p>
```

### MaxShowsView

Título: `<h1 className="text-xl sm:text-2xl font-black text-gray-100 flex items-center gap-2"> <Presentation size={22} className="text-accent shrink-0" /> Max Show </h1>`

```tsx
          <p className="text-xs text-gray-500 mt-1">Monte o slide em PowerPoint/Canva/Slides, exporte como PDF, importe aqui e apresente em tela cheia.</p>
```

### PDVView

Título: `<h2 className="text-2xl sm:text-3xl font-black text-accent tracking-tight">Ponto de Venda</h2>`

```tsx
        <p className="text-sm text-gray-400 mt-2">Selecione o PDV que deseja operar.</p>
```

### RelogioMaquinasView

Título: `<h2 className="text-xl font-bold text-gray-100 flex items-center gap-2"> <AlarmClock size={20} className="text-red-400" /> Relógio das Máquinas </h2>`

```tsx
          <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-relaxed">
            Desvio entre o relógio de cada estação e o do servidor, medido no boot do app.
            Estação muito <strong>adiantada</strong> recebe token de sessão que já nasce vencido:
            ela renova em laço, estoura o limite do servidor e derruba a sessão de quem está
            na mesma rede — inclusive de quem está com a hora certa.
          </p>
```

## Descrições passadas por propriedade e casos à parte

### GenericCRUDView (aviso)

Onde: estrutura

```tsx
          <p className="text-sm text-gray-400 mt-1">
            {subtitle}
            {filialScoped && !escopo && ' Visão consolidada de todas as unidades — somente leitura em Matriz.'}
          </p>
```

### GenericCRUDView — Projetos (empresa-projetos)

Onde: prop subtitle no App.tsx

```tsx
Gerencie os projetos em andamento.
```

### GenericCRUDView — Centros de Custo (financeiro-centrosdecusto)

Onde: prop subtitle no App.tsx

```tsx
Catálogo de centros de custo usado nas requisições, no rateio e no agrupamento de despesas do DRE.
```

### GenericCRUDView — Condições de Pagamento (empresa-condiçõesdepagamento)

Onde: prop subtitle no App.tsx

```tsx
Gerencie as condições e prazos de pagamento.
```

### GenericCRUDView — Formas de Pagamento (empresa-formasdepagamento)

Onde: prop subtitle no App.tsx

```tsx
Cada forma define o preço da proposta: desconto à vista, juros do parcelamento, taxa da maquininha e prazo de recebimento.
```

### GenericCRUDView — Departamentos (rh-departamentos)

Onde: prop subtitle no App.tsx

```tsx
Estrutura departamental desta unidade.
```

### GenericCRUDView — Cargos (rh-cargos)

Onde: prop subtitle no App.tsx

```tsx
Cargos e faixas salariais desta unidade.
```

### GenericCRUDView — Benefícios (rh-benefícios)

Onde: prop subtitle no App.tsx

```tsx
Catálogo de benefícios da unidade. A atribuição por pessoa é feita em Funcionários.
```

### CRMView

Onde: const desc

```tsx
isClientes ? 'Visualize e gerencie a carteira de clientes ativos.' : 'Controle seus parceiros comerciais e rede de suprimentos.'
```

### PedidosVendaView

Onde: const subtituloModo

```tsx
  // O subtítulo descreve o MÓDULO; quem descreve a fila aberta é a dica da aba,
  // logo abaixo dela. Antes o subtítulo falava da primeira aba e continuava lá
  // depois de trocar de aba, contradizendo a lista na tela.
  const subtituloModo =
    mode === 'estoque'
      ? 'O que o almoxarifado separa a partir de proposta aprovada pelo cliente. Separar baixa o estoque.'
    : mode === 'financeiro'
      ? 'O recebimento dos pedidos de venda. O pedido só se dá por pago quando a última parcela é quitada.'
      : 'Pedidos gerados a partir de propostas aprovadas pelo cliente. Logística separa, Financeiro recebe.';

```

### RecibosVendasView

Onde: início do parágrafo abaixo do título (o total continua na tela)

```tsx
            Baixe recibos individuais em PDF ou exporte a listagem em Excel —
```

