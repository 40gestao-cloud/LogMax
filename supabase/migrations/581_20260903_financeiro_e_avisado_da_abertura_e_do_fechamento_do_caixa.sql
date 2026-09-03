-- O Financeiro é AVISADO da abertura e do fechamento do caixa.
--
-- Quem abre o caixa é o operador, na tela do PDV — é ele que conta o fundo de
-- troco e assume a gaveta. Na loja de verdade o Financeiro não abre caixa de
-- ninguém: ele acompanha, confere e responde pela diferença no fim do turno.
--
-- Faltava o elo do meio. O operador abria e fechava, e o Financeiro só ficava
-- sabendo se resolvesse abrir a tela de Controle de Caixa e olhar. Numa rede
-- isso chega como aviso: "caixa 3 abriu com R$ 200 de fundo", "caixa 3 fechou
-- com falta de R$ 12,40". É o que o supervisor de frente de loja recebe.
--
-- Por que gatilho e não chamada na tela: o caixa abre por DUAS portas (o PDV do
-- supermercado e o dos nichos) e fecha por outras duas (a conferência do
-- Financeiro e o fechamento do próprio PDV). Avisar em cada uma seria quatro
-- lugares para esquecer um. No gatilho, qualquer caminho que mude a linha
-- avisa — inclusive os que vierem depois.
--
-- O aviso NUNCA pode derrubar a operação: se a notificação falhar, o caixa abre
-- do mesmo jeito. Por isso o corpo inteiro está dentro de um bloco com EXCEPTION
-- — gaveta aberta é o que importa, aviso é conveniência.

BEGIN;

-- ─── Dinheiro em português ───────────────────────────────────────
-- `to_char(..., 'FML...')` usa o locale do banco, que aqui é en_US: sairia
-- "$250.00" num aviso lido por aluno brasileiro. O swap de separadores é o
-- caminho usual — e fica num lugar só para não se repetir a cada mensagem.
CREATE OR REPLACE FUNCTION public.brl(p_valor numeric)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT 'R$ ' || replace(replace(replace(
           to_char(COALESCE(p_valor, 0), 'FM999G999G990D00'),
         '.', '|'), ',', '.'), '|', ',');
$function$;

CREATE OR REPLACE FUNCTION public.avisa_financeiro_do_caixa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dif   numeric(15,2);
  v_texto text;
BEGIN
  BEGIN
    -- ─── Abertura ───────────────────────────────────────────
    IF TG_OP = 'INSERT' AND NEW.status = 'Aberto' THEN
      PERFORM public.notificar_setor(
        'financeiro',
        'info',
        'Caixa aberto — ' || COALESCE(NEW.filial, 'unidade'),
        COALESCE(NEW.aberto_por_nome, 'O operador')
          || ' abriu o caixa com '
          || public.brl(NEW.valor_abertura)
          || ' de fundo de troco.',
        'financeiro-controledecaixa',
        'Baixa',
        NEW.id,
        NULL,
        NEW.filial
      );
      RETURN NULL;
    END IF;

    -- ─── Fechamento ─────────────────────────────────────────
    -- Só na transição: um UPDATE qualquer numa linha já fechada não avisa de novo.
    IF TG_OP = 'UPDATE'
       AND NEW.status = 'Fechado'
       AND COALESCE(OLD.status, '') <> 'Fechado' THEN

      v_dif := COALESCE(NEW.diferenca, 0);
      v_texto := COALESCE(NEW.fechado_por_nome, 'O operador')
        || ' fechou o caixa. Contado '
        || public.brl(NEW.valor_fechamento)
        || ' sobre esperado '
        || public.brl(NEW.valor_esperado)
        || '. '
        || CASE
             WHEN v_dif >  0.005 THEN 'SOBRA de ' || public.brl(v_dif) || '.'
             WHEN v_dif < -0.005 THEN 'FALTA de ' || public.brl(-v_dif) || '.'
             ELSE 'Conferência exata.'
           END;

      PERFORM public.notificar_setor(
        'financeiro',
        'info',
        'Caixa fechado — ' || COALESCE(NEW.filial, 'unidade')
          || CASE
               WHEN v_dif >  0.005 THEN ' (sobra)'
               WHEN v_dif < -0.005 THEN ' (falta)'
               ELSE ''
             END,
        v_texto,
        'financeiro-controledecaixa',
        -- Diferença na gaveta é o que o Financeiro precisa ver primeiro.
        CASE WHEN ABS(v_dif) > 0.005 THEN 'Alta' ELSE 'Baixa' END,
        NEW.id,
        NULL,
        NEW.filial
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Aviso não derruba turno: gaveta aberta (ou conferida) é o que importa.
    -- Mas também não pode sumir em silêncio — foi assim que a primeira versão
    -- deste gatilho passou despercebida gravando `tipo = 'Caixa'`, que o
    -- `chk_notif_tipo` recusa. WARNING deixa a falha no log do Postgres.
    RAISE WARNING 'avisa_financeiro_do_caixa falhou [%]: %', SQLSTATE, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_avisa_financeiro_do_caixa ON public.controle_caixa;
CREATE TRIGGER trg_avisa_financeiro_do_caixa
  AFTER INSERT OR UPDATE ON public.controle_caixa
  FOR EACH ROW EXECUTE FUNCTION public.avisa_financeiro_do_caixa();

COMMIT;

NOTIFY pgrst, 'reload schema';
