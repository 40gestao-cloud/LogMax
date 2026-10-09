// Mesa do Gestor (migr. 667/668) — o nome acompanha o cargo de quem abre.
// Mora fora da view porque o menu lateral também usa, e importar a view puxaria
// o chunk dela para o carregamento inicial.

const NOMES: Record<string, string> = {
  admin: 'Mesa do Gestor',
  ceo: 'Mesa do CEO',
  conselheiro: 'Mesa do Conselheiro',
  gerente: 'Mesa do Gerente',
  gerente_assistente: 'Mesa do Gerente Assistente',
};

export const nomeDaMesa = (role?: string | null): string => NOMES[role ?? ''] ?? 'Mesa do Gestor';
