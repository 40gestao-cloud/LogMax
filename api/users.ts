import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';

// Endpoint unificado de gestão de usuários (Auth + user_profiles).
// Roteia por body.action ∈ 'create' | 'update' | 'delete' | 'reset-password'.
// Substitui os endpoints separados (fusão pra caber no limite 12 functions do
// Vercel Hobby). Toda a lógica RBAC/validação idêntica à das versões antigas.

const VALID_ROLES = ['admin', 'ceo', 'gerente', 'colaborador', 'conselheiro'];
const VALID_SETORES = ['all', 'logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti', 'gerencia'];
const VALID_SETORES_EXTRAS = ['logistica','vendas','financeiro','rh','marketing','ti','compras','estoque','gerencia'];
const VALID_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax', 'Matriz'];

type Log = ReturnType<typeof createLogger>;

// Rótulo do papel como a turma o lê. É a GÊMEA de `ROLE_LABEL` em
// `src/lib/rbac.ts` — mudou lá, muda aqui. A cópia existe porque `api/` é
// serverless Node e não importa de `src/`; é o mesmo motivo de `VALID_ROLES`
// acima ser uma segunda lista.
const ROLE_CARGO: Record<string, string> = {
  admin:       'Administrador',
  ceo:         'CEO',
  gerente:     'Gerente',
  colaborador: 'Colaborador',
  conselheiro: 'Conselheiro',
};

/**
 * O papel mudou em Usuários → o cargo do cadastro de RH acompanha.
 *
 * `user_profiles.role` (o acesso) e `funcionarios.cargo` (o título do RH) são
 * campos diferentes, e o crachá mostra o SEGUNDO. Sem esta ponte, rebaixar um
 * gerente a colaborador deixava o crachá dele dizendo "Gerente" — e o crachá é
 * justamente o que a pessoa mostra para se identificar. O cadastro de RH nasce
 * com `roleLabel(role)` no momento do vínculo (RH → Funcionários); o que
 * faltava era ele seguir a mudança depois disso.
 *
 * Sobrescreve o texto inteiro, de propósito: um cargo como "Gerente De Vendas
 * e Atendimentos" numa pessoa que não é mais gerente é exatamente o que se
 * quer apagar. O RH pode reescrever o título em Funcionários logo depois — a
 * régua aqui é "nunca contradizer o papel", não "redigir o cargo".
 *
 * O vínculo é gravado nos DOIS lados e nem sempre nos dois ao mesmo tempo, daí
 * casar por `funcionario_id` OU por `user_profile_id`.
 *
 * Falha NÃO derruba a edição: o papel já mudou no perfil, e reverter o acesso
 * de alguém porque o texto do crachá não gravou seria pior que o texto velho.
 */
async function sincronizarCargoFuncionario(
  admin: SupabaseClient, userId: string, funcionarioId: string | null,
  role: string, log: Log,
) {
  const cargo = ROLE_CARGO[role];
  if (!cargo) return;
  const alvo = admin.from('funcionarios').update({ cargo });
  const { error } = funcionarioId
    ? await alvo.eq('id', funcionarioId)
    : await alvo.eq('user_profile_id', userId);
  if (error) log.warn('funcionario.cargo_sync_failed', { target_id: userId, error: error.message });
  else log.info('funcionario.cargo_synced', { target_id: userId, cargo });
}

// ── Cofre de senhas (migr. 409) ─────────────────────────────────────────
// O hash do Auth é irreversível, então a senha só existe legível no instante
// em que o painel a define. Aqui é esse instante. Falha ao anotar NÃO derruba
// a operação: o usuário já foi criado/atualizado no Auth, e reverter isso por
// causa de uma anotação seria pior do que a coluna ficar sem registro.
async function anotarSenha(
  admin: SupabaseClient, userId: string, senha: string, callerId: string, log: Log,
) {
  const { error } = await admin.from('senhas_visiveis').upsert({
    user_id: userId, senha, definida_em: new Date().toISOString(), definida_por: callerId,
  }, { onConflict: 'user_id' });
  if (error) log.warn('senha.vault_write_failed', { target_id: userId, error: error.message });
}

// Senha ditável em voz alta: uma palavra do vocabulário do curso + 4 dígitos.
// Sem caracteres ambíguos e sem símbolo — ela vai ser lida para o aluno.
const PALAVRAS_SENHA = [
  'venda', 'caixa', 'estoque', 'compra', 'pedido', 'entrega',
  'lucro', 'meta', 'equipe', 'filial', 'balanco', 'cliente',
];

function gerarSenha(): string {
  const bytes = new Uint32Array(2);
  globalThis.crypto.getRandomValues(bytes);
  const palavra = PALAVRAS_SENHA[bytes[0] % PALAVRAS_SENHA.length];
  const digitos = String(bytes[1] % 10000).padStart(4, '0');
  return `${palavra}${digitos}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = (req.body?.action ?? req.query?.action) as string | undefined;
  const log = createLogger(req, `users:${action ?? '?'}`);

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const admin = getAdminClient(res);
    if (!admin) return;

    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (!token) {
      log.warn('auth.missing_token');
      return res.status(401).json({ error: 'Token obrigatório.' });
    }
    const { data: { user: caller }, error: tokenErr } = await admin.auth.getUser(token);
    if (tokenErr || !caller) {
      log.warn('auth.invalid_token', { error: tokenErr?.message });
      // "Token inválido" não dizia o que fazer, e o estado que ele descreve é
      // invisível: o token continua com assinatura boa, então o app segue
      // lendo pelo PostgREST e só ESTE endpoint recusa — a tela parecia
      // funcionar e o botão de salvar, não. (A causa mais comum era o
      // `signOut` em escopo global derrubando a sessão de outra máquina; vide
      // useAuth.signOut. Sobra o caso legítimo: sessão encerrada em outro
      // lugar, ou expirada com a aba aberta.)
      return res.status(401).json({
        error: 'Sua sessão não vale mais — ela foi encerrada em outro lugar ou expirou. Saia e entre de novo para continuar.',
      });
    }
    const { data: callerProfile } = await admin
      .from('user_profiles')
      .select('role, setor, setores_extras, filial, pode_acessar_usuarios, is_conselheiro')
      .eq('id', caller.id)
      .single();

    if (!callerProfile) {
      log.warn('caller.profile_missing', { caller_id: caller.id });
      return res.status(403).json({ error: 'Perfil não encontrado.' });
    }

    // ── Portão do módulo Usuários: escrita é do professor ──────────────
    //
    // Antes, cada ação tinha a própria régua e soltava CEO, conselheiro e
    // gerente sobre recortes da turma. Todos esses cargos são ALUNOS: quem
    // cria conta, troca senha ou muda cargo de colega manda no acesso do
    // colega, e as filiais competem entre si. A TELA de Usuários é leitura
    // para quem não é `role = 'admin'`, e este portão é a mesma regra onde o
    // F12 alcança.
    //
    // As réguas por ação continuam abaixo de propósito, mesmo inalcançáveis:
    // elas dizem quem poderia o quê caso este portão um dia se abra.
    //
    // FORA DO PORTÃO ficam as duas ações que o RH e o conselho exercem sem
    // ser sobre conta de colega — cada uma com a própria régua, mais estreita
    // que um `update` genérico:
    //   criar-acesso            → RH/gerente dão login a QUEM ACABOU DE SER
    //                             CONTRATADO, sem escolher nem ver a senha.
    //   ajustar-acesso-carreira → admin/CEO movem de unidade quem TEM
    //                             movimentação pendente, e só para o destino
    //                             que a movimentação já registrou.
    const ACOES_DO_ADMIN = ['create', 'update', 'delete', 'reset-password'];
    if (ACOES_DO_ADMIN.includes(action ?? '') && callerProfile.role !== 'admin') {
      log.warn('users.permission_denied', {
        caller_id: caller.id, caller_role: callerProfile.role, action, reason: 'modulo_somente_leitura',
      });
      return res.status(403).json({
        error: 'Somente o administrador pode criar, editar ou excluir usuários.',
      });
    }

    if (action === 'create') return await handleCreate(req, res, admin, caller.id, callerProfile, log);
    if (action === 'update') return await handleUpdate(req, res, admin, caller.id, callerProfile, log);
    if (action === 'delete') return await handleDelete(req, res, admin, caller.id, callerProfile, log);
    if (action === 'reset-password') return await handleResetPassword(req, res, admin, caller.id, callerProfile, log);
    if (action === 'criar-acesso') return await handleCriarAcesso(req, res, admin, caller.id, callerProfile, log);
    if (action === 'ajustar-acesso-carreira') return await handleAjustarAcessoCarreira(req, res, admin, caller.id, callerProfile, log);
    return res.status(400).json({ error: 'action inválida.' });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

// ── CREATE ──────────────────────────────────────────────────────────────
async function handleCreate(
  req: VercelRequest, res: VercelResponse, admin: SupabaseClient,
  callerId: string, callerProfile: any, log: Log,
) {
  if (callerProfile.role !== 'admin' && callerProfile.role !== 'ceo' && callerProfile.role !== 'gerente') {
    log.warn('user.permission_denied', { caller_id: callerId, caller_role: callerProfile.role });
    return res.status(403).json({ error: 'Sem permissão para criar usuários.' });
  }
  if (callerProfile.role === 'gerente' && callerProfile.pode_acessar_usuarios === false) {
    log.warn('user.permission_denied', { caller_id: callerId, reason: 'gerente_access_revoked' });
    return res.status(403).json({ error: 'Acesso ao módulo Usuários foi desabilitado pelo administrador.' });
  }

  const { email, password, nome, role, filial, setores_extras } = req.body ?? {};
  let { setor } = req.body ?? {};

  let extras: string[] = [];
  if (Array.isArray(setores_extras)) {
    extras = [...new Set(setores_extras as unknown[])]
      .filter((s): s is string => typeof s === 'string' && VALID_SETORES_EXTRAS.includes(s));
  }

  if (!email || !password || !nome || !role || !setor) {
    log.warn('request.validation_failed', { missing: { email: !email, password: !password, nome: !nome, role: !role, setor: !setor } });
    return res.status(400).json({ error: 'Campos obrigatórios: email, password, nome, role, setor.' });
  }
  if (!VALID_ROLES.includes(role))    return res.status(400).json({ error: 'Cargo inválido.' });
  if (!VALID_SETORES.includes(setor)) return res.status(400).json({ error: 'Setor inválido.' });

  if (role === 'ceo' || role === 'conselheiro') {
    if (callerProfile.role !== 'admin') {
      log.warn('user.permission_denied', { caller_id: callerId, caller_role: callerProfile.role, target_role: role, reason: 'non_admin_creating_global' });
      return res.status(403).json({ error: 'Apenas administradores podem criar CEO ou Conselheiro.' });
    }
    setor = 'all'; extras = [];
  }
  // Mesma trava da edição: 'all' é escopo de cargo global, não setor.
  if (setor === 'all' && role !== 'admin' && role !== 'ceo' && role !== 'conselheiro') {
    return res.status(400).json({
      error: 'Escopo global é exclusivo de admin, CEO e conselheiro. Escolha um setor.',
    });
  }

  if (extras.length > 0 && callerProfile.role !== 'admin' && callerProfile.role !== 'ceo') {
    log.warn('user.permission_denied', { caller_id: callerId, reason: 'gerente_setores_extras' });
    return res.status(403).json({ error: 'Apenas admin/CEO podem atribuir setores extras.' });
  }
  extras = extras.filter(s => s !== setor);

  if (setor === 'gerencia') {
    extras = ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'];
  }

  if (role === 'admin' && callerProfile.role !== 'admin') {
    log.warn('user.permission_denied', { caller_id: callerId, caller_role: callerProfile.role, target_role: role, reason: 'non_admin_creating_admin' });
    return res.status(403).json({ error: 'Apenas administradores podem criar administradores.' });
  }

  // Filial pode vir vazia de propósito: "criado, alocação depois" (migr. 411).
  // Montar turma é dezenas de contas numa sentada, e a unidade é a parte que
  // se decide com a turma na frente. `null` aqui é esse estado — diferente de
  // 'Matriz', que para cargo operacional continua sendo erro.
  const filialInformada = typeof filial === 'string' ? filial.trim() : '';
  const semAlocacao = filial === null || filialInformada === '';

  if (callerProfile.role === 'gerente') {
    if (role !== 'colaborador') {
      log.warn('user.permission_denied', { caller_id: callerId, target_role: role, reason: 'gerente_role_mismatch' });
      return res.status(403).json({ error: 'Gerentes só podem criar colaboradores.' });
    }
    // Gerente não deixa aluno em aberto: a conta que ele cria é da unidade
    // dele, e "sem alocação" é decisão de quem organiza a turma inteira.
    if (semAlocacao || filialInformada !== callerProfile.filial) {
      log.warn('user.permission_denied', { caller_id: callerId, target_filial: filialInformada || null, caller_filial: callerProfile.filial, reason: 'gerente_outra_filial' });
      return res.status(403).json({ error: 'Gerentes só podem criar colaboradores da própria filial.' });
    }
  }

  if (!semAlocacao && !VALID_FILIAIS.includes(filialInformada)) {
    return res.status(400).json({ error: 'Filial inválida.' });
  }

  if ((role === 'colaborador' || role === 'gerente') && filialInformada === 'Matriz') {
    log.warn('user.validation_failed', { caller_id: callerId, target_role: role, reason: 'operational_role_needs_unit' });
    return res.status(400).json({ error: 'Colaboradores e gerentes precisam de uma unidade operacional (SuperMax, MaxLook ou TechMax) — ou de nenhuma, para alocar depois.' });
  }

  const { data: { user: newUser }, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr || !newUser) {
    const msg = createErr?.message ?? 'Erro ao criar usuário.';
    const friendly = msg.includes('already registered') ? 'E-mail já cadastrado.' : msg;
    log.warn('auth.create_failed', { error: msg, friendly });
    return res.status(400).json({ error: friendly });
  }

  const profilePayload: any = {
    id: newUser.id, nome, email, role, setor,
    setores_extras: extras,
    criado_por: callerId,
  };
  // Explícito nos dois casos: omitir a coluna cairia no DEFAULT 'Matriz' da
  // migr. 017, e "ainda não alocado" viraria "lotado na holding".
  profilePayload.filial = semAlocacao ? null : filialInformada;
  const { error: profileErr } = await admin.from('user_profiles').insert(profilePayload);
  if (profileErr) {
    log.error('profile.insert_failed', profileErr, { new_user_id: newUser.id, rollback: 'deleting_auth_user' });
    await admin.auth.admin.deleteUser(newUser.id);
    return res.status(500).json({ error: 'Erro ao criar perfil. Usuário removido.' });
  }

  await anotarSenha(admin, newUser.id, password, callerId, log);

  log.info('user.created', { user_id: newUser.id, role, setor, caller_id: callerId });
  return res.status(200).json({ success: true, userId: newUser.id });
}

// ── UPDATE ──────────────────────────────────────────────────────────────
async function handleUpdate(
  req: VercelRequest, res: VercelResponse, admin: SupabaseClient,
  callerId: string, callerProfile: any, log: Log,
) {
  const isConselheiroCaller = callerProfile?.role === 'conselheiro'
    || (callerProfile?.role === 'gerente' && callerProfile?.is_conselheiro === true);
  if (callerProfile.role !== 'admin' && callerProfile.role !== 'ceo' && callerProfile.role !== 'gerente' && !isConselheiroCaller) {
    log.warn('user.permission_denied', { caller_id: callerId, caller_role: callerProfile.role });
    return res.status(403).json({ error: 'Sem permissão para editar usuários.' });
  }
  if (callerProfile.role === 'gerente' && callerProfile.pode_acessar_usuarios === false) {
    log.warn('user.permission_denied', { caller_id: callerId, reason: 'gerente_access_revoked' });
    return res.status(403).json({ error: 'Acesso ao módulo Usuários foi desabilitado pelo administrador.' });
  }

  const { userId, nome, email, role, setor, filial, password, setores_extras, pode_acessar_usuarios, is_conselheiro } = req.body ?? {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId obrigatório.' });
  }

  const { data: targetProfile } = await admin
    .from('user_profiles').select('role, setor, filial, funcionario_id').eq('id', userId).single();
  if (!targetProfile) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (targetProfile.role === 'admin' && callerId !== userId) {
    return res.status(403).json({ error: 'Administradores não podem ser editados.' });
  }
  if (targetProfile.role === 'ceo' && callerProfile.role !== 'admin' && callerId !== userId) {
    return res.status(403).json({ error: 'Apenas administradores podem editar CEO.' });
  }
  if (callerProfile.role === 'gerente') {
    if (targetProfile.role !== 'colaborador') {
      return res.status(403).json({ error: 'Gerentes só podem editar colaboradores.' });
    }
    if (targetProfile.filial !== callerProfile.filial) {
      return res.status(403).json({ error: 'Gerentes só podem editar colaboradores da própria filial.' });
    }
  }

  const updates: Record<string, any> = {};
  if (typeof nome === 'string' && nome.trim()) updates.nome = nome.trim();
  if (typeof email === 'string' && email.trim()) updates.email = email.trim();

  const isGlobalCaller = callerProfile.role === 'admin' || callerProfile.role === 'ceo' || isConselheiroCaller;

  if (role !== undefined) {
    if (!isGlobalCaller) return res.status(403).json({ error: 'Gerentes não podem alterar cargo.' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Cargo inválido.' });
    if (role === 'admin' && callerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem atribuir cargo de administrador.' });
    }
    if ((role === 'ceo' || role === 'conselheiro') && callerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem atribuir cargo de CEO ou Conselheiro.' });
    }
    updates.role = role;
  }
  if (setor !== undefined) {
    if (!VALID_SETORES.includes(setor)) return res.status(400).json({ error: 'Setor inválido.' });
    if (!isGlobalCaller && setor === 'all') {
      return res.status(403).json({ error: 'Gerentes não podem atribuir o escopo global.' });
    }
    updates.setor = setor;
  }
  if (updates.role === 'ceo' || updates.role === 'conselheiro') {
    updates.setor = 'all';
    updates.setores_extras = [];
  }
  // 'all' é escopo de cargo global, não um setor que se atribui. Sem esta
  // trava, rebaixar um CEO deixava um colaborador com escopo global: o select
  // da tela perdia a option 'all' sem disparar onChange, exibia "Logística" e
  // mandava 'all' assim mesmo (três alunos ficaram assim em 2026-08-07).
  // Vale para o role que fica DEPOIS da edição, não só para o que veio no
  // corpo — editar só o setor de um colaborador também passa por aqui.
  const roleFinal = updates.role ?? targetProfile.role;
  const escopoGlobalPermitido = roleFinal === 'admin' || roleFinal === 'ceo' || roleFinal === 'conselheiro';
  if (updates.setor === 'all' && !escopoGlobalPermitido) {
    return res.status(400).json({
      error: 'Escopo global é exclusivo de admin, CEO e conselheiro. Escolha um setor.',
    });
  }
  if (updates.setor === 'gerencia') {
    updates.setores_extras = ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'];
  }
  if (setores_extras !== undefined && updates.role !== 'ceo' && updates.role !== 'conselheiro') {
    if (!isGlobalCaller) return res.status(403).json({ error: 'Gerentes não podem alterar setores extras.' });
    if (!Array.isArray(setores_extras)) return res.status(400).json({ error: 'setores_extras deve ser um array.' });
    const extras = [...new Set(setores_extras as unknown[])]
      .filter((s): s is string => typeof s === 'string' && VALID_SETORES_EXTRAS.includes(s));
    const primaryAfter = updates.setor ?? targetProfile.setor;
    updates.setores_extras = extras.filter(s => s !== primaryAfter);
  }
  if (filial !== undefined) {
    // `null` (ou string vazia) devolve a conta para a fila de alocação — o
    // mesmo estado em que ela pode nascer (migr. 411). Útil quando o aluno sai
    // de uma unidade e ainda não se sabe para onde vai.
    if (filial === null || (typeof filial === 'string' && filial.trim() === '')) {
      if (!isGlobalCaller) {
        return res.status(403).json({ error: 'Apenas admin/CEO podem deixar um usuário sem unidade.' });
      }
      updates.filial = null;
    } else if (typeof filial !== 'string' || !VALID_FILIAIS.includes(filial)) {
      return res.status(400).json({ error: 'Filial inválida.' });
    } else {
      if (!isGlobalCaller && filial === 'Matriz') {
        return res.status(403).json({ error: 'Gerentes não podem atribuir a filial Matriz.' });
      }
      if (callerProfile.role === 'gerente' && filial !== callerProfile.filial) {
        return res.status(403).json({ error: 'Gerentes só podem atribuir a própria filial.' });
      }
      const targetRoleAfter = updates.role ?? targetProfile.role;
      if ((targetRoleAfter === 'colaborador' || targetRoleAfter === 'gerente') && filial === 'Matriz') {
        return res.status(400).json({ error: 'Colaboradores e gerentes precisam de uma unidade operacional (SuperMax, MaxLook ou TechMax).' });
      }
      updates.filial = filial;
    }
  }
  if (is_conselheiro !== undefined) {
    if (callerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem ativar o modo Conselheiro.' });
    }
    const targetRoleAfter = updates.role ?? targetProfile.role;
    if (targetRoleAfter !== 'gerente') {
      return res.status(400).json({ error: 'O modo Conselheiro só se aplica a gerentes.' });
    }
    if (typeof is_conselheiro !== 'boolean') {
      return res.status(400).json({ error: 'is_conselheiro deve ser booleano.' });
    }
    updates.is_conselheiro = is_conselheiro;
  }
  if (pode_acessar_usuarios !== undefined) {
    if (!isGlobalCaller) return res.status(403).json({ error: 'Apenas admin/CEO podem alterar o acesso ao módulo Usuários.' });
    const targetRoleAfter = updates.role ?? targetProfile.role;
    if (targetRoleAfter !== 'gerente') {
      return res.status(400).json({ error: 'O toggle só se aplica a gerentes.' });
    }
    if (typeof pode_acessar_usuarios !== 'boolean') {
      return res.status(400).json({ error: 'pode_acessar_usuarios deve ser booleano.' });
    }
    updates.pode_acessar_usuarios = pode_acessar_usuarios;
  }

  const authUpdates: { email?: string; password?: string } = {};
  if (updates.email) authUpdates.email = updates.email;
  // Trocar a senha de OUTRA pessoa é só do admin (o professor). Gerente e CEO
  // são alunos: quem define a senha de um colega entra na conta dele, e num
  // ambiente onde as filiais competem entre si isso não é detalhe. Mudar a
  // PRÓPRIA senha segue liberado — não impersona ninguém, e o cofre continua
  // refletindo a senha em vigor.
  if (typeof password === 'string' && password.length >= 6) {
    if (callerProfile.role !== 'admin' && callerId !== userId) {
      log.warn('user.permission_denied', { caller_id: callerId, target_id: userId, reason: 'senha_de_terceiro' });
      return res.status(403).json({ error: 'Apenas o administrador pode trocar a senha de outro usuário.' });
    }
    authUpdates.password = password;
  }

  if (Object.keys(authUpdates).length > 0) {
    const { error: authErr } = await admin.auth.admin.updateUserById(userId, authUpdates);
    if (authErr) {
      const msg = authErr.message ?? 'Erro ao atualizar credenciais.';
      const friendly = msg.includes('already registered') ? 'E-mail já cadastrado.' : msg;
      log.warn('auth.update_failed', { error: msg, target_id: userId });
      return res.status(400).json({ error: friendly });
    }
    if (authUpdates.password) await anotarSenha(admin, userId, authUpdates.password, callerId, log);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(200).json({ success: true, noop: true });
  }

  const { error: profileErr } = await admin.from('user_profiles').update(updates).eq('id', userId);
  if (profileErr) {
    log.error('profile.update_failed', profileErr, { target_id: userId });
    return res.status(500).json({ error: 'Erro ao atualizar perfil.' });
  }

  // Só quando o papel REALMENTE mudou: reenviar o mesmo cargo no formulário
  // não pode apagar um título que o RH redigiu à mão depois do vínculo.
  if (updates.role && updates.role !== targetProfile.role) {
    await sincronizarCargoFuncionario(
      admin, userId, targetProfile.funcionario_id ?? null, updates.role, log,
    );
  }

  log.info('user.updated', { target_id: userId, caller_id: callerId, fields: Object.keys(updates) });
  return res.status(200).json({ success: true });
}

// ── RESET-PASSWORD ──────────────────────────────────────────────────────
// Gera uma senha nova, aplica no Auth e anota no cofre. Existe separado do
// 'update' porque o caso de uso é outro: no update quem escolhe a senha é
// quem edita; aqui ninguém escolhe — o professor só quer uma senha válida na
// tela pra ditar ao aluno.
//
// ADMIN E MAIS NINGUÉM. Não vale a régua do 'update' (que solta gerente sobre
// a própria filial), porque esta ação devolve a senha em texto na resposta:
// quem chama entra na conta do alvo. CEO, conselheiro e gerente são ALUNOS —
// dar isso a eles é dar login de colega em ano de competição entre filiais.
// Pela mesma razão a leitura do cofre (migr. 409) é `role = 'admin'` literal,
// e não `auth_is_admin()`.
async function handleResetPassword(
  req: VercelRequest, res: VercelResponse, admin: SupabaseClient,
  callerId: string, callerProfile: any, log: Log,
) {
  if (callerProfile.role !== 'admin') {
    log.warn('user.permission_denied', { caller_id: callerId, caller_role: callerProfile.role, reason: 'reset_nao_admin' });
    return res.status(403).json({ error: 'Apenas o administrador pode redefinir senhas.' });
  }

  const { userId } = req.body ?? {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId obrigatório.' });
  }

  const { data: targetProfile } = await admin
    .from('user_profiles').select('role').eq('id', userId).single();
  if (!targetProfile) return res.status(404).json({ error: 'Usuário não encontrado.' });

  // Outro admin (outro professor) continua fora de alcance — a régua do
  // 'update' vale aqui também.
  if (targetProfile.role === 'admin' && callerId !== userId) {
    return res.status(403).json({ error: 'Administradores não podem ser editados.' });
  }

  const password = gerarSenha();
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, { password });
  if (authErr) {
    log.warn('auth.reset_failed', { error: authErr.message, target_id: userId });
    return res.status(400).json({ error: authErr.message ?? 'Erro ao redefinir senha.' });
  }

  await anotarSenha(admin, userId, password, callerId, log);

  log.info('user.password_reset', { target_id: userId, caller_id: callerId });
  return res.status(200).json({ success: true, password });
}

// ── CRIAR-ACESSO ────────────────────────────────────────────────────────
// O RH dá login a quem acabou de ser contratado, SEM escolher e SEM ver a
// senha: o servidor gera, grava no cofre (migr. 409) e não devolve nada. A
// contratação fecha sem o professor; a credencial continua só com ele.
//
// A régua é estreita de propósito — não é um `create` genérico:
//   • o alvo tem de ser um funcionário EXISTENTE, ATIVO e AINDA SEM login;
//   • a filial vem da ficha do funcionário, nunca do corpo da request, senão
//     o RH criaria conta em unidade adversária;
//   • cargo acima de colaborador só admin/CEO atribuem.
//
// Sobra um caminho, e é aceitável: quem administra Funcionários pode cadastrar
// uma ficha e depois dar login a ela. É um passo a mais, some da lista de
// pendências e aparece no módulo Usuários do professor.
async function handleCriarAcesso(
  req: VercelRequest, res: VercelResponse, admin: SupabaseClient,
  callerId: string, callerProfile: any, log: Log,
) {
  // hasSetor do frontend, replicado: setor primário, extras ou escopo global.
  const setoresDoCaller: string[] = [
    callerProfile.setor,
    ...(Array.isArray(callerProfile.setores_extras) ? callerProfile.setores_extras : []),
  ];
  const ehRH = callerProfile.setor === 'all' || setoresDoCaller.includes('rh');
  const podeOperar = callerProfile.role === 'admin' || callerProfile.role === 'ceo'
    || callerProfile.role === 'gerente' || ehRH;
  if (!podeOperar) {
    log.warn('acesso.permission_denied', { caller_id: callerId, caller_role: callerProfile.role });
    return res.status(403).json({ error: 'Sem permissão para criar acesso de contratado.' });
  }

  const { funcionarioId, email, nome, setor } = req.body ?? {};
  let { role } = req.body ?? {};
  if (!funcionarioId || typeof funcionarioId !== 'string') {
    return res.status(400).json({ error: 'funcionarioId obrigatório.' });
  }

  const { data: func } = await admin
    .from('funcionarios')
    .select('id, nome, email, filial, status, user_profile_id')
    .eq('id', funcionarioId)
    .single();
  if (!func) return res.status(404).json({ error: 'Funcionário não encontrado.' });
  if (func.user_profile_id) {
    return res.status(400).json({ error: 'Este funcionário já tem login.' });
  }
  if (func.status !== 'Ativo') {
    return res.status(400).json({ error: 'Só funcionário ativo recebe acesso.' });
  }

  // Gerente e RH de filial não criam acesso em outra unidade.
  if (callerProfile.role !== 'admin' && callerProfile.role !== 'ceo'
      && callerProfile.filial && func.filial !== callerProfile.filial) {
    log.warn('acesso.permission_denied', { caller_id: callerId, alvo_filial: func.filial, reason: 'outra_filial' });
    return res.status(403).json({ error: 'Só é possível dar acesso a funcionário da própria unidade.' });
  }

  const emailFinal = (typeof email === 'string' && email.trim()) || func.email;
  const nomeFinal  = (typeof nome  === 'string' && nome.trim())  || func.nome;
  if (!emailFinal) return res.status(400).json({ error: 'Informe o e-mail do novo acesso.' });

  if (role !== 'colaborador' && role !== 'gerente') role = 'colaborador';
  if (role === 'gerente' && callerProfile.role !== 'admin' && callerProfile.role !== 'ceo') {
    return res.status(403).json({ error: 'Apenas admin ou CEO podem criar acesso de gerente.' });
  }
  if (!VALID_SETORES.includes(setor) || setor === 'all') {
    return res.status(400).json({ error: 'Setor inválido.' });
  }
  // 'gerencia' não é um departamento: é o escopo que abre os seis setores de
  // uma vez (o insert abaixo preenche `setores_extras` com todos). Quem
  // contrata não distribui isso sozinho.
  if (setor === 'gerencia' && callerProfile.role !== 'admin' && callerProfile.role !== 'ceo') {
    return res.status(403).json({ error: 'Apenas admin ou CEO podem dar acesso de Gerência.' });
  }
  // Mesma trava do create: cargo operacional não vive na Matriz, senão o
  // FilialContext barra o login com "Filial não configurada".
  if (!func.filial || func.filial === 'Matriz') {
    return res.status(400).json({ error: 'Funcionário precisa estar numa unidade operacional para receber acesso.' });
  }

  const password = gerarSenha();
  const { data: { user: newUser }, error: createErr } = await admin.auth.admin.createUser({
    email: emailFinal, password, email_confirm: true,
  });
  if (createErr || !newUser) {
    const msg = createErr?.message ?? 'Erro ao criar acesso.';
    const friendly = msg.includes('already registered') ? 'E-mail já cadastrado.' : msg;
    log.warn('acesso.create_failed', { error: msg, funcionario_id: funcionarioId });
    return res.status(400).json({ error: friendly });
  }

  const { error: profileErr } = await admin.from('user_profiles').insert({
    id: newUser.id, nome: nomeFinal, email: emailFinal,
    role, setor, setores_extras: setor === 'gerencia'
      ? ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'] : [],
    filial: func.filial, criado_por: callerId,
  });
  if (profileErr) {
    log.error('acesso.profile_insert_failed', profileErr, { new_user_id: newUser.id, rollback: 'deleting_auth_user' });
    await admin.auth.admin.deleteUser(newUser.id);
    return res.status(500).json({ error: 'Erro ao criar perfil. Acesso removido.' });
  }

  await anotarSenha(admin, newUser.id, password, callerId, log);

  log.info('acesso.created', { user_id: newUser.id, funcionario_id: funcionarioId, caller_id: callerId });
  // A senha NÃO volta na resposta: é o ponto inteiro deste endpoint.
  return res.status(200).json({ success: true, userId: newUser.id, senhaNoCofre: true });
}

// ── AJUSTAR-ACESSO-CARREIRA ─────────────────────────────────────────────
// Movimentação de carreira mexe em unidade e cargo — decisão de holding, e por
// isso admin e CEO, a mesma régua do `decidir_vaga` e do `_assert_interfilial`
// (migr. 312). O que impede isso de virar um `update` disfarçado é o destino
// não vir do corpo da request: ele é LIDO da movimentação pendente. Não há
// como pedir "mova fulano para a minha filial" — só "aplique o que a promoção
// já decidiu".
async function handleAjustarAcessoCarreira(
  req: VercelRequest, res: VercelResponse, admin: SupabaseClient,
  callerId: string, callerProfile: any, log: Log,
) {
  if (callerProfile.role !== 'admin' && callerProfile.role !== 'ceo') {
    log.warn('carreira.permission_denied', { caller_id: callerId, caller_role: callerProfile.role });
    return res.status(403).json({ error: 'Apenas admin ou CEO ajustam acesso de movimentação de carreira.' });
  }

  const { movimentacaoId } = req.body ?? {};
  if (!movimentacaoId || typeof movimentacaoId !== 'string') {
    return res.status(400).json({ error: 'movimentacaoId obrigatório.' });
  }

  const { data: mov } = await admin
    .from('movimentacoes_carreira')
    .select('id, user_profile_id, filial_nova, role_nova, acesso_pendente, ativo')
    .eq('id', movimentacaoId)
    .single();
  if (!mov) return res.status(404).json({ error: 'Movimentação não encontrada.' });
  if (!mov.acesso_pendente || mov.ativo === false) {
    return res.status(400).json({ error: 'Esta movimentação não tem acesso pendente.' });
  }
  if (!mov.user_profile_id) {
    return res.status(400).json({ error: 'Esta movimentação não tem login vinculado.' });
  }

  const { data: alvo } = await admin
    .from('user_profiles').select('role').eq('id', mov.user_profile_id).single();
  if (!alvo) return res.status(404).json({ error: 'Usuário da movimentação não encontrado.' });
  if (alvo.role === 'admin') {
    return res.status(403).json({ error: 'Administradores não podem ser editados.' });
  }

  const updates: Record<string, any> = {};
  if (!VALID_FILIAIS.includes(mov.filial_nova)) {
    return res.status(400).json({ error: 'A movimentação aponta para uma filial inválida.' });
  }
  updates.filial = mov.filial_nova;
  if (mov.role_nova) {
    if (!VALID_ROLES.includes(mov.role_nova) || mov.role_nova === 'admin') {
      return res.status(400).json({ error: 'A movimentação aponta para um cargo inválido.' });
    }
    if ((mov.role_nova === 'ceo' || mov.role_nova === 'conselheiro') && callerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores promovem a CEO ou Conselheiro.' });
    }
    updates.role = mov.role_nova;
  }
  const roleFinal = updates.role ?? alvo.role;
  if ((roleFinal === 'colaborador' || roleFinal === 'gerente') && updates.filial === 'Matriz') {
    return res.status(400).json({ error: 'Colaboradores e gerentes precisam de uma unidade operacional.' });
  }

  const { error } = await admin.from('user_profiles').update(updates).eq('id', mov.user_profile_id);
  if (error) {
    log.error('carreira.update_failed', error, { movimentacao_id: movimentacaoId });
    return res.status(500).json({ error: 'Erro ao ajustar o acesso.' });
  }

  log.info('carreira.acesso_ajustado', {
    movimentacao_id: movimentacaoId, target_id: mov.user_profile_id, caller_id: callerId, fields: Object.keys(updates),
  });
  return res.status(200).json({ success: true });
}

// ── DELETE ──────────────────────────────────────────────────────────────
async function handleDelete(
  req: VercelRequest, res: VercelResponse, admin: SupabaseClient,
  callerId: string, callerProfile: any, log: Log,
) {
  const isConselheiroCaller = callerProfile?.role === 'conselheiro'
    || (callerProfile?.role === 'gerente' && callerProfile?.is_conselheiro === true);
  const AUTHORIZED_ROLES = ['admin', 'ceo', 'gerente'];
  if (!AUTHORIZED_ROLES.includes(callerProfile.role) && !isConselheiroCaller) {
    return res.status(403).json({ error: 'Sem permissão para excluir usuários.' });
  }
  if (callerProfile.role === 'gerente' && callerProfile.pode_acessar_usuarios === false) {
    return res.status(403).json({ error: 'Acesso ao módulo Usuários foi desabilitado pelo administrador.' });
  }

  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId obrigatório.' });
  if (userId === callerId) return res.status(400).json({ error: 'Não é possível excluir sua própria conta.' });

  const { data: targetProfile } = await admin
    .from('user_profiles').select('role, setor').eq('id', userId).single();
  if (!targetProfile) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (targetProfile.role === 'admin') {
    return res.status(403).json({ error: 'Administradores não podem ser excluídos.' });
  }
  if (targetProfile.role === 'ceo' && callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem excluir CEO.' });
  }
  if (callerProfile.role === 'gerente' || isConselheiroCaller) {
    if (targetProfile.role !== 'colaborador') {
      return res.status(403).json({ error: 'Gerentes e conselheiros só podem excluir colaboradores.' });
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    log.error('auth.delete_failed', error, { target_id: userId });
    return res.status(500).json({ error: error.message });
  }

  log.info('user.deleted', { target_id: userId, target_role: targetProfile.role, caller_id: callerId });
  return res.status(200).json({ success: true });
}
