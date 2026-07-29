import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';
import { getAdminClient, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';

// Loja online pública — o único ponto de contato entre o hub de cada filial e
// o LogMax.
//
// TRÊS AÇÕES NUM ARQUIVO SÓ. O plano Vercel Hobby tem teto de 12 serverless
// functions e estávamos em 10/12. `?acao=catalogo|checkout|status` gasta um
// slot em vez de três.
//
// O COMPRADOR NÃO É AUTENTICADO — e por isso nada aqui confia nele:
//   • preço NUNCA vem do navegador; é relido de `produtos` a cada pedido
//   • filial só vale se existir em `loja_config` e estiver `aberta`
//   • produto só entra se `loja_online`, `ativo` e com estoque
//   • cupom é revalidado contra `marketing_cupons` (e de novo na confirmação,
//     dentro de `criar_venda_pdv` — o pedido pode ficar horas na fila)
//
// O que este endpoint NÃO faz: vender. Ele cria um pedido. A venda nasce
// quando alguém da filial confirma no LogMax — vide migração 293.

const FORMAS_ACEITAS: Record<string, string> = {
  pix:    'Pix',
  cartao: 'Cartão',
  boleto: 'Boleto',
};

const MAX_APELIDO = 40;
const MAX_QTD_ITEM = 99;

/**
 * Janela do contador de origem mostrado a quem atende. Não é limite: é
 * indício. O limite de vazão é `max_pedidos_hora`, por rede.
 */
const JANELA_ORIGEM_MS = 24 * 3600_000;

/**
 * Só o suficiente para contar pedidos por janela. O IP cru nunca é gravado.
 *
 * CUIDADO ao tratar isto como identidade de pessoa: a turma toda sai pela
 * mesma internet da escola, então 20 alunos compartilham um hash. Serve para
 * vazão (`max_pedidos_hora`), não para dizer "foi o mesmo comprador" — para
 * isso existe o `origem_token`, que é por dispositivo.
 */
function hashIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || 'sem-ip';
  const salt = process.env.LOJA_IP_SALT || process.env.CRON_SECRET || 'logmax-loja';
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);
}

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Apelido do comprador: tira caracteres de controle e corta no limite.
 *
 * Escapar HTML e responsabilidade de quem renderiza (a tela do aluno), mas
 * control char nao tem por que chegar la: quebra log, cola mal em relatorio
 * e serve para disfarcar texto.
 */
function limparApelido(v: unknown): string {
  if (typeof v !== 'string') return '';
  return Array.from(v)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c > 0x1f && (c < 0x7f || c > 0x9f);
    })
    .join('')
    .trim()
    .slice(0, MAX_APELIDO);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'loja');

  try {
    // As lojas vivem em projeto Vercel próprio, então falam com esta API
    // cross-origin. `LOJA_ORIGINS` é a lista separada por vírgula das origens
    // publicadas (ex.: "https://maxlook-loja.vercel.app,https://maxlook.com.br").
    //
    // Sem a env, só o próprio LogMax chama — que é o comportamento seguro por
    // omissão: loja nova não passa a ser aceita porque alguém esqueceu de
    // configurar, ela simplesmente não funciona e o erro aparece na hora.
    const lojaOrigins = (process.env.LOJA_ORIGINS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (applyCors(req, res, lojaOrigins)) return;

    const admin = getAdminClient(res);
    if (!admin) return;

    const acao = String(req.query.acao ?? '');

    // ───────────────────────────────────────────────────────────────────────
    // CATÁLOGO
    // ───────────────────────────────────────────────────────────────────────
    if (acao === 'catalogo') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

      const filial = String(req.query.filial ?? '');
      if (!filial) return res.status(400).json({ error: 'Filial não informada.' });

      const { data: cfg } = await admin
        .from('loja_config')
        .select('aberta, mensagem_fechada, max_itens_pedido, max_valor_pedido')
        .eq('filial', filial)
        .maybeSingle();

      if (!cfg) return res.status(404).json({ error: 'Loja não encontrada.' });
      if (!cfg.aberta) {
        return res.status(200).json({
          aberta: false,
          mensagem: cfg.mensagem_fechada || 'A loja está fechada no momento.',
          produtos: [],
        });
      }

      const { data: produtos, error } = await admin
        .from('produtos')
        .select('id, nome, categoria, preco, estoque, marca, imagem_url, atributos')
        .eq('filial', filial)
        .eq('loja_online', true)
        .eq('ativo', true)
        .gt('estoque', 0)
        .order('nome', { ascending: true });

      if (error) {
        log.error('catalogo.query_failed', error);
        return res.status(500).json({ error: 'Não foi possível carregar o catálogo.' });
      }

      // O hub filtra por `filtro`; o dado real mora em atributos->genero, que
      // os alunos preenchem no cadastro do produto. Calçados viram acessórios
      // por categoria, que é como a MaxLook organiza a vitrine.
      const mapaFiltro = (p: any): string => {
        const genero = String(p.atributos?.genero ?? '').toLowerCase();
        const cat = String(p.categoria ?? '').toLowerCase();
        if (cat.includes('calçado') || cat.includes('calcado') || cat.includes('acessór')) return 'acessorios';
        if (genero.startsWith('infant')) return 'infantil';
        if (genero.startsWith('femin')) return 'feminino';
        if (genero.startsWith('mascul')) return 'masculino';
        return 'acessorios';
      };

      return res.status(200).json({
        aberta: true,
        max_itens: cfg.max_itens_pedido,
        max_valor: Number(cfg.max_valor_pedido),
        produtos: (produtos ?? []).map((p: any) => ({
          id:        p.id,
          nome:      p.nome,
          categoria: p.categoria ?? 'Geral',
          marca:     p.marca ?? null,
          preco:     Number(p.preco),
          estoque:   Number(p.estoque),
          imagem:    p.imagem_url,
          genero:    p.atributos?.genero ?? null,
          tamanho:   p.atributos?.tamanho ?? null,
          cor:       p.atributos?.cor ?? null,
          filtro:    mapaFiltro(p),
        })),
      });
    }

    // ───────────────────────────────────────────────────────────────────────
    // STATUS — a credencial é o próprio código do pedido
    // ───────────────────────────────────────────────────────────────────────
    if (acao === 'status') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

      const codigo = String(req.query.codigo ?? '').toUpperCase().trim();
      if (!/^[A-Z2-9]{8}$/.test(codigo)) {
        return res.status(400).json({ error: 'Código inválido.' });
      }

      const { data: pedido } = await admin
        .from('pedidos_online')
        .select('id, codigo, status, total_final, created_at, atendido_em')
        .eq('codigo', codigo)
        .eq('ativo', true)
        .maybeSingle();

      if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado.' });

      const { data: itens } = await admin
        .from('pedidos_online_itens')
        .select('nome_produto, qtd, preco_unitario, subtotal')
        .eq('pedido_id', pedido.id)
        .order('created_at', { ascending: true });

      // Nada de atendente, motivo interno ou venda_id: é a tela do comprador.
      return res.status(200).json({
        codigo:      pedido.codigo,
        status:      pedido.status,
        total:       Number(pedido.total_final),
        criado_em:   pedido.created_at,
        atendido_em: pedido.atendido_em,
        itens:       itens ?? [],
      });
    }

    // ───────────────────────────────────────────────────────────────────────
    // CHECKOUT
    // ───────────────────────────────────────────────────────────────────────
    if (acao === 'checkout') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

      const body = (req.body ?? {}) as Record<string, any>;
      const filial = String(body.filial ?? '');
      const apelido = limparApelido(body.apelido);
      const formaKey = String(body.forma_pagamento ?? '').toLowerCase();
      const cupomCodigo = typeof body.cupom === 'string' ? body.cupom.trim().toUpperCase() : '';
      const indicacao = typeof body.indicacao === 'string' ? body.indicacao.trim().slice(0, 40) : null;
      const requestId = isUuid(body.request_id) ? body.request_id : null;
      // UUID aleatório que a página guarda no localStorage. Distingue
      // dispositivos atrás do mesmo IP da escola. Só aceita formato de UUID:
      // string arbitrária do cliente não vira coluna nossa.
      const origemToken = isUuid(body.origem_token) ? body.origem_token : null;

      if (!filial) return res.status(400).json({ error: 'Filial não informada.' });
      if (!apelido) return res.status(400).json({ error: 'Informe como quer ser chamado.' });
      if (!FORMAS_ACEITAS[formaKey]) return res.status(400).json({ error: 'Forma de pagamento inválida.' });

      // Idempotência: segundo clique devolve o pedido que já existe.
      if (requestId) {
        const { data: existente } = await admin
          .from('pedidos_online')
          .select('codigo, total_final, status')
          .eq('request_id', requestId)
          .maybeSingle();
        if (existente) {
          return res.status(200).json({
            codigo: existente.codigo,
            total:  Number(existente.total_final),
            status: existente.status,
            repetido: true,
          });
        }
      }

      const { data: cfg } = await admin
        .from('loja_config')
        .select('aberta, max_itens_pedido, max_valor_pedido, max_pedidos_hora, max_pedidos_hora_origem')
        .eq('filial', filial)
        .maybeSingle();

      if (!cfg) return res.status(404).json({ error: 'Loja não encontrada.' });
      if (!cfg.aberta) return res.status(409).json({ error: 'A loja está fechada no momento.' });

      const itensBrutos = Array.isArray(body.items) ? body.items : [];
      if (itensBrutos.length === 0) return res.status(400).json({ error: 'Carrinho vazio.' });

      // Consolida por produto: dois lançamentos do mesmo id viram um.
      const pedidoPorProduto = new Map<string, number>();
      for (const it of itensBrutos) {
        if (!isUuid(it?.produto_id)) return res.status(400).json({ error: 'Produto inválido no carrinho.' });
        const qtd = Number(it?.qtd);
        if (!Number.isInteger(qtd) || qtd < 1 || qtd > MAX_QTD_ITEM) {
          return res.status(400).json({ error: 'Quantidade inválida no carrinho.' });
        }
        pedidoPorProduto.set(it.produto_id, (pedidoPorProduto.get(it.produto_id) ?? 0) + qtd);
      }

      const totalUnidades = [...pedidoPorProduto.values()].reduce((a, b) => a + b, 0);
      if (totalUnidades > cfg.max_itens_pedido) {
        return res.status(400).json({ error: `Máximo de ${cfg.max_itens_pedido} itens por pedido.` });
      }

      // Enxurrada — DOIS tetos, porque são duas perguntas diferentes (migr. 300):
      //
      //   rede       → a turma inteira sai pelo mesmo IP da escola, então este
      //                número é da sala. Folgado de propósito: apertar aqui
      //                para conter uma pessoa para a aula toda.
      //   dispositivo→ este sim é por pessoa, na prática. Curto.
      //
      // As mensagens são diferentes porque as saídas são diferentes: uma pede
      // esperar, a outra é a loja dizendo que já tem pedido seu na fila.
      const ipHash = hashIp(req);
      const umaHoraAtras = new Date(Date.now() - 3600_000).toISOString();

      const { count: recentesRede } = await admin
        .from('pedidos_online')
        .select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', umaHoraAtras);

      if ((recentesRede ?? 0) >= cfg.max_pedidos_hora) {
        log.warn('checkout.rate_limited_rede', { filial, recentes: recentesRede });
        return res.status(429).json({
          error: 'A loja recebeu muitos pedidos desta rede na última hora. Tente de novo em alguns minutos.',
        });
      }

      if (origemToken) {
        const limiteOrigem = cfg.max_pedidos_hora_origem ?? 8;
        const { count: recentesOrigem } = await admin
          .from('pedidos_online')
          .select('id', { count: 'exact', head: true })
          .eq('origem_token', origemToken)
          .gte('created_at', umaHoraAtras);

        if ((recentesOrigem ?? 0) >= limiteOrigem) {
          log.warn('checkout.rate_limited_origem', { filial, recentes: recentesOrigem });
          return res.status(429).json({
            error: `Você já fez ${recentesOrigem} pedidos na última hora. Espere a equipe atender os que estão na fila.`,
          });
        }
      }

      // Quantos pedidos vieram desta mesma origem nas últimas 24h, contando
      // este. Vai gravado no pedido como indício para quem atende — NÃO barra
      // nada: numa sala inteira atrás do mesmo IP, barrar por origem trancaria
      // a turma. Sem token (localStorage bloqueado), cai no hash de rede, que
      // é grosseiro e por isso não vira acusação na tela.
      let origem24h = 1;
      {
        const desde = new Date(Date.now() - JANELA_ORIGEM_MS).toISOString();
        const q = admin
          .from('pedidos_online')
          .select('id', { count: 'exact', head: true })
          .eq('filial', filial)
          .gte('created_at', desde);
        const { count } = origemToken
          ? await q.eq('origem_token', origemToken)
          : await q.eq('ip_hash', ipHash);
        origem24h = (count ?? 0) + 1;
      }

      // O preço vem daqui, nunca do navegador.
      const { data: produtos, error: errProd } = await admin
        .from('produtos')
        .select('id, nome, preco, estoque, filial, loja_online, ativo')
        .in('id', [...pedidoPorProduto.keys()]);

      if (errProd) {
        log.error('checkout.produtos_failed', errProd);
        return res.status(500).json({ error: 'Não foi possível montar o pedido.' });
      }

      const itens: Array<{ produto_id: string; nome_produto: string; qtd: number; preco_unitario: number; subtotal: number }> = [];
      let total = 0;

      for (const [produtoId, qtd] of pedidoPorProduto) {
        const p = (produtos ?? []).find((x: any) => x.id === produtoId);
        if (!p || !p.ativo || !p.loja_online || p.filial !== filial) {
          return res.status(409).json({ error: 'Um dos produtos saiu do catálogo. Atualize a página.' });
        }
        if (Number(p.estoque) < qtd) {
          return res.status(409).json({ error: `Estoque insuficiente de "${p.nome}". Disponível: ${Number(p.estoque)}.` });
        }
        const precoUnit = Number(p.preco);
        const subtotal = Math.round(precoUnit * qtd * 100) / 100;
        total += subtotal;
        itens.push({ produto_id: p.id, nome_produto: p.nome, qtd, preco_unitario: precoUnit, subtotal });
      }
      total = Math.round(total * 100) / 100;

      if (total > Number(cfg.max_valor_pedido)) {
        return res.status(400).json({ error: 'Pedido acima do valor máximo permitido.' });
      }

      // Cupom: quem decide desconto é marketing/financeiro, então o valor sai
      // de `marketing_cupons` e não de nada que a página tenha anunciado.
      let cupomDesconto = 0;
      let cupomAplicado: string | null = null;

      if (cupomCodigo) {
        const { data: cupom } = await admin
          .from('marketing_cupons')
          .select('codigo, tipo, valor, valor_minimo, desconto_maximo, filial, validade_inicio, validade_fim, limite_uso, usos')
          .ilike('codigo', cupomCodigo)
          .eq('ativo', true)
          .maybeSingle();

        if (!cupom) return res.status(400).json({ error: 'Cupom não encontrado.' });

        const hoje = new Date().toISOString().slice(0, 10);
        if (cupom.validade_inicio && hoje < cupom.validade_inicio) {
          return res.status(400).json({ error: 'Cupom ainda não está valendo.' });
        }
        if (cupom.validade_fim && hoje > cupom.validade_fim) {
          return res.status(400).json({ error: 'Cupom expirado.' });
        }
        if (cupom.filial && cupom.filial !== filial) {
          return res.status(400).json({ error: 'Cupom não vale nesta loja.' });
        }
        if (total < Number(cupom.valor_minimo ?? 0)) {
          return res.status(400).json({ error: `Compra mínima de R$ ${Number(cupom.valor_minimo).toFixed(2)} para este cupom.` });
        }
        if (cupom.limite_uso != null && Number(cupom.usos) >= Number(cupom.limite_uso)) {
          return res.status(400).json({ error: 'Cupom atingiu o limite de usos.' });
        }

        cupomDesconto = cupom.tipo === 'percentual'
          ? Math.round(total * Number(cupom.valor) / 100 * 100) / 100
          : Number(cupom.valor);
        if (cupom.desconto_maximo != null && cupomDesconto > Number(cupom.desconto_maximo)) {
          cupomDesconto = Number(cupom.desconto_maximo);
        }
        if (cupomDesconto > total) cupomDesconto = total;
        cupomAplicado = cupom.codigo;
      }

      const totalFinal = Math.round((total - cupomDesconto) * 100) / 100;

      const { data: codigoRow, error: errCod } = await admin.rpc('gerar_codigo_pedido_online');
      if (errCod || !codigoRow) {
        log.error('checkout.codigo_failed', errCod);
        return res.status(500).json({ error: 'Não foi possível gerar o pedido.' });
      }

      const { data: pedido, error: errPedido } = await admin
        .from('pedidos_online')
        .insert({
          codigo:            codigoRow,
          filial,
          comprador_apelido: apelido,
          forma_desejada:    FORMAS_ACEITAS[formaKey],
          cupom_codigo:      cupomAplicado,
          cupom_desconto:    cupomDesconto,
          total,
          total_final:       totalFinal,
          indicacao,
          request_id:        requestId,
          ip_hash:           ipHash,
          origem_token:      origemToken,
          origem_pedidos_24h: origem24h,
        })
        .select('id, codigo')
        .single();

      if (errPedido || !pedido) {
        log.error('checkout.insert_failed', errPedido);
        return res.status(500).json({ error: 'Não foi possível registrar o pedido.' });
      }

      const { error: errItens } = await admin
        .from('pedidos_online_itens')
        .insert(itens.map(i => ({ ...i, pedido_id: pedido.id })));

      if (errItens) {
        // Pedido sem item é lixo na fila do aluno — remove o cabeçalho órfão.
        await admin.from('pedidos_online').delete().eq('id', pedido.id);
        log.error('checkout.itens_failed', errItens);
        return res.status(500).json({ error: 'Não foi possível registrar os itens.' });
      }

      // Toca o sino do setor vendas DAQUELA filial (migr. 301). O realtime só
      // ajuda quem está com a tela de Pedidos Online aberta; quem está no PDV
      // ou no caixa não fica sabendo que tem comprador esperando.
      //
      // Falha aqui NÃO derruba o pedido: ele já está gravado, e devolver erro
      // ao comprador porque um sino não tocou seria trocar o problema de lugar.
      // Fica no log para quem for investigar "por que ninguém foi avisado".
      const { error: errNotif } = await admin.rpc('notificar_setor', {
        p_setor:     'vendas',
        p_tipo:      'info',
        p_titulo:    `Pedido novo na loja — ${pedido.codigo}`,
        p_mensagem:  `${apelido} pediu ${itens.length} item(ns), ${totalFinal.toFixed(2).replace('.', ',')} em ${FORMAS_ACEITAS[formaKey]}. Confira em Vendas → Pedidos Online.`,
        p_link_view: 'vendas-pedidosonline',
        p_urgencia:  'Média',
        p_ref_id:    pedido.id,
        p_filial:    filial,
      });
      if (errNotif) log.warn('checkout.notificacao_falhou', { filial, erro: errNotif.message });

      log.info('checkout.pedido_criado', {
        filial, codigo: pedido.codigo, itens: itens.length, total_final: totalFinal,
        origem_24h: origem24h,
      });

      return res.status(201).json({
        codigo: pedido.codigo,
        total:  totalFinal,
        desconto: cupomDesconto,
        status: 'Novo',
      });
    }

    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
