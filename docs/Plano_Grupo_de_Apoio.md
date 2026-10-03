# Plano — Grupo de apoio no Modo Aula

> Situação: **migração nas 4 turmas** (02/10/2026). Falta o push para o app novo chegar às turmas.

## O problema

Dois alunos da turma (um com TDAH, outro com autismo) rendem mais quando o professor explica a etapa antes, só para eles, com as mediadoras junto. Depois eles se juntam às equipes. A turma não pode parar enquanto isso acontece.

Hoje o Modo Aula tem **uma configuração para a turma inteira**, então não dá para liberar uma etapa só para esse grupo.

## A ideia

Uma **segunda configuração do Modo Aula**, só para o grupo de apoio:

- **A turma** segue no Modo Aula de sempre, sem perceber nada.
- **O grupo de apoio** (os 2 alunos e as 2 mediadoras, cada uma com usuário próprio, fazendo as mesmas atividades) fica com as telas que o professor liberou para ele.
- **Juntar com as equipes** = desligar o grupo. Na hora, eles passam a seguir a configuração da turma.

Enquanto o professor está com o grupo, a turma anda pelo que já existe: atividade publicada, alarmes da aula, pendências e conferência.

## Privacidade

Quem está no grupo é informação de saúde (LGPD, dado sensível) e não pode chegar aos colegas. A lista de Usuários é vista por alunos com papel de CEO, conselheiro e gerente, então:

- O nome é **"Grupo de apoio"**, sem diagnóstico e sem símbolo de deficiência.
- A lista fica numa **tabela à parte**, não numa coluna de `user_profiles`. Só `role = 'admin'` literal edita e vê a lista inteira; cada integrante vê só a própria linha.
- A configuração do grupo também só é lida pelo professor e pelos integrantes.
- Para o integrante, a tela é igual à de qualquer aluno em Modo Aula: mesma faixa "Modo Aula ativo", nada que diga "grupo de apoio".

## Desenho

### Banco — migração nova (só na Aprendiz até validar)

- `aula_grupo_apoio` — integrantes: `user_id` (PK, FK `user_profiles`, apaga junto), `papel` (`aluno` | `mediador`), `incluido_por`, `created_at`.
- `aula_grupo_apoio_config` — linha única (id = 1), no formato da `aula_config`: `ativo`, `modulos_ativos`, `submenus_ativos`, `atualizado_por`, `atualizado_em`. Publicada no realtime.
- `auth_aula_setores()` passa a escolher a configuração por pessoa: integrante com o grupo ligado recebe os setores dos módulos do **grupo**; os demais, os da **turma**, como hoje. É a função que alimenta `auth_user_setores()`, e por ela a RLS das tabelas e do Storage, então o acesso aos dados acompanha sozinho.

**Por que tabelas próprias, e não uma segunda linha na `aula_config`:** o gatilho `trg_aula_config_sessao` abriria e fecharia sessões no histórico da turma ao mexer no grupo; `bloqueia_fechamento_com_venda_em_curso` e `encerrar_aulas_ociosas` leem a `aula_config` sem olhar a linha; e todo ouvinte em tempo real da `aula_config` aplicaria a configuração do grupo à turma inteira.

### Front

- Hook `useGrupoApoio` — lê a própria participação e a config do grupo (realtime na config).
- `App.tsx`: integrante com o grupo ligado usa a config do grupo no lugar da `aula_config`. O resto do Modo Aula (menu, guardas, setores concedidos, faixa) não muda, porque já recebe uma config pronta.
- Modo Aula ganha a aba **Grupo de apoio** (só admin): integrantes (incluir/remover, aluno ou mediadora), telas liberadas para o grupo (com "Copiar da turma") e o botão Ligar/Desligar.

**Reset geral:** ele esvazia toda tabela fora da lista dele. A lista de integrantes some junto com as contas de aluno, como deve. A config do grupo também some; em vez de mexer na função do reset, a tela grava por upsert e linha ausente vale "desligado".

**Revisão de 02/10 (depois do teste):**
- Grupo esquecido ligado não desligava (a aula da turma desliga no cron das 22:10). A migr. 670 (aplicada nas 4 em 02/10) põe o grupo no mesmo `encerrar_aulas_ociosas`: desliga o que ninguém tocou há mais de 6 h.
- O admin não lê mais nada do grupo no boot, e quem está fora faz 1 leitura (não 4). A primeira assinatura do canal não relê.
- Incluir alguém com o grupo ligado "toca" a config, para o evento chegar na máquina da pessoa. Quem é tirado do grupo não recebe evento (a RLS já não deixa); o integrante reconfere a participação a cada 1 min.
- Não dá para salvar o grupo ligado sem nenhuma tela.

### Fora do escopo

- A trava do caixa em Modo Aula (`bloqueia_fechamento_com_venda_em_curso`) continua olhando só a aula da turma.
- O histórico de aulas registra só a aula da turma.

## Ordem de execução

1. Migração (tabelas, RLS, realtime, `auth_aula_setores`) na Aprendiz + teste com JWT simulado (integrante, não integrante, admin).
2. `useGrupoApoio` + troca de config no `App.tsx`.
3. Aba Grupo de apoio no Modo Aula.
4. Teste na Aprendiz: professor + 1 conta do grupo + 1 conta de fora, com a turma e o grupo em configurações diferentes. **Feito em 02/10:** turma com a montagem completa, grupo só em Cadastros › Produtos. O integrante viu só Produtos; quem estava fora viu a turma; "Desligar e juntar à turma" trocou o menu do integrante na hora, sem recarregar.
5. Validado: aplicar nas outras 3 turmas, rodar `npm run drift` e `npm run rls:check`. **Feito em 02/10:** drift sem divergência, rls:check limpo nos 4.

| Migração | Aprendiz | LogMax-ERP | Contabilidade | Adm |
|---|---|---|---|---|
| 669 `grupo_de_apoio_no_modo_aula` | 02/10/2026 | 02/10/2026 | 02/10/2026 | 02/10/2026 |
| 670 `grupo_de_apoio_esquecido_ligado_desliga_a_noite` | 02/10/2026 | 02/10/2026 | 02/10/2026 | 02/10/2026 |
