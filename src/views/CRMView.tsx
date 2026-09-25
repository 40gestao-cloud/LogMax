import { useRolarAteFormulario } from '../hooks/useRolarAteFormulario';
import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useState, useEffect } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Mail, Phone as PhoneIcon, Plus, Save, FileDown, Sheet, MapPin, CreditCard, ExternalLink } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { ImagemUploader, LogoCadastro } from '../components/ImagemCadastro';
import { uploadImagem, removerImagem, CADASTRO_IMAGEM_BUCKET } from '../lib/imagemCadastro';
import { BotaoModeloPlanilha } from '../components/BotaoModeloPlanilha';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, FilialBadge, Pagination } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useFormValidation, exportToPDF, exportToExcel, formatPhone, formatCPF, formatCNPJ, formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';

type PessoaTipo = 'Empresa' | 'Pessoa Física';

// MaxID — app irmão que gera CPF, CNPJ e celular de treino com dígito
// verificador válido. O aluno precisa de documento para cadastrar cliente e
// fornecedor, e inventar número na mão produz cadastro que nenhuma validação
// aceita (e ensina que documento é enfeite). Abre em aba nova: cadastro pela
// metade nesta tela não se perde.
const MAXID_URL = 'https://max-id.vercel.app';

const makeEmptyExtras = (filial: string) => ({
  pessoa_tipo: 'Empresa' as PessoaTipo,
  telefone: '',
  email: '',
  endereco: '',
  cpf_cnpj: '',
  categoria: '',
  // Campo comum às 3 filiais (migr. 360): prazo de entrega é do processo de
  // compras, não do ramo — alimenta a cotação e a data prometida a quem pediu.
  // Vivia em `atributos` na MaxLook e na TechMax, e não existia no SuperMax.
  prazo_entrega_dias: '',
  // Só cliente (migr. 416). Vazio = sem limite cadastrado, que é diferente de
  // zero: zero é "não leva fiado".
  limite_credito: '',
  // Só fornecedor (migr. 429).
  logo_url: '',
  filial,
  atributos: {} as Record<string, any>,
});

// Atributos JSONB de fornecedor por nicho. Só aplicam quando type='fornecedores'
// e filial for MaxLook ou TechMax. Cliente segue genérico.
type AtributoFornecedorDef = {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'select';
  options?: readonly string[];
};

const ATRIBUTOS_FORNECEDOR: Record<string, AtributoFornecedorDef[]> = {
  MaxLook: [
    { key: 'tipo_fornecedor', label: 'Tipo de fornecedor', type: 'select',
      options: ['Grife', 'Confecção', 'Atacado moda', 'Acessórios', 'Calçados'] as const },
    { key: 'marcas', label: 'Marcas representadas', placeholder: 'Ex: Nike, Adidas, Colcci' },
    { key: 'moq', label: 'MOQ (mín. por pedido, peças)', type: 'number', placeholder: 'Ex: 12' },
  ],
  TechMax: [
    { key: 'tipo_fornecedor', label: 'Tipo de fornecedor', type: 'select',
      options: ['Autorizada', 'Distribuidor', 'Peças', 'Acessórios'] as const },
    { key: 'marcas_atendidas', label: 'Marcas atendidas', placeholder: 'Ex: Apple, Samsung, Motorola' },
    { key: 'garantia_reposicao_dias', label: 'Garantia da peça (dias)', type: 'number', placeholder: 'Ex: 90' },
  ],
  SuperMax: [],
};

const CRMViewInner = ({ type, showToast, filial }: {
  type: 'clientes' | 'fornecedores'; showToast: any; filial: FilialOp;
}) => {
  const isClientes = type === 'clientes';
  const confirm = useConfirm();
  const endpoint = isClientes ? '/api/crmview' : '/api/crmview-fornecedores';
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    endpoint,
    { filial },
    false,
    { page, searchTerm: debouncedSearch, searchColumns: ['nome', 'email', 'telefone', 'cpf_cnpj', 'pessoa_tipo'] }
  );
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState({ nome: '' });
  const [extras, setExtras] = useState(() => makeEmptyExtras(filial));
  // Logo do fornecedor: o arquivo fica pendente até o save. Subir a cada troca
  // de arquivo encheria o bucket de logo de cadastro que o usuário cancelou.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const title = isClientes ? `Clientes — ${filial}` : `Fornecedores — ${filial}`;

  // Pesquisa agora é server-side.
  const filtered = data;

  const exportCols = isClientes
    ? ['Nome', 'Tipo', 'Telefone', 'E-mail', 'CPF/CNPJ', 'Status']
    : ['Nome', 'Categoria', 'Telefone', 'E-mail', 'CPF/CNPJ', 'Status'];
  const exportRows = () => isClientes
    ? filtered.map((d: any) => [d.nome ?? '', d.pessoa_tipo ?? d.tipo ?? '', d.telefone ?? '', d.email ?? '', d.cpf_cnpj ?? '', d.status ?? ''])
    : filtered.map((d: any) => [d.nome ?? '', d.categoria ?? '', d.telefone ?? '', d.email ?? '', d.cpf_cnpj ?? '', d.status ?? '']);
  const exportFilename = isClientes ? 'logmax-clientes' : 'logmax-fornecedores';
  const handleExportPDF   = () => exportToPDF(title, exportCols, exportRows(), exportFilename);
  const handleExportExcel = () => exportToExcel(isClientes ? 'Clientes' : 'Fornecedores', exportCols, exportRows(), exportFilename);

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ nome: item.nome ?? '' });
    setExtras({
      pessoa_tipo: item.pessoa_tipo ?? 'Empresa',
      telefone:    item.telefone   ?? '',
      email:       item.email      ?? '',
      endereco:    item.endereco   ?? '',
      cpf_cnpj:    item.cpf_cnpj   ?? '',
      categoria:   item.categoria  ?? '',
      prazo_entrega_dias: item.prazo_entrega_dias == null ? '' : String(item.prazo_entrega_dias),
      limite_credito: item.limite_credito == null ? '' : formatBRL(Number(item.limite_credito)),
      logo_url:    item.logo_url ?? '',
      filial,
      atributos:   (item.atributos && typeof item.atributos === 'object') ? { ...item.atributos } : {},
    });
    setLogoFile(null);
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    // Cancelar também precisa liberar o blob — só `trocar` e `limpar` faziam
    // isso, então quem escolhia um arquivo e desistia deixava a URL viva.
    if (extras.logo_url.startsWith('blob:')) URL.revokeObjectURL(extras.logo_url);
    setShowForm(false);
    setEditItem(null);
    setForm({ nome: '' });
    setExtras(makeEmptyExtras(filial));
    setLogoFile(null);
    setErrors({});
  };

  const handleLogoPreview = (file: File, url: string) => {
    // Libera o blob anterior antes de trocar — senão cada arquivo escolhido
    // fica preso na memória da aba até o reload.
    if (extras.logo_url.startsWith('blob:')) URL.revokeObjectURL(extras.logo_url);
    setLogoFile(file);
    setExtras(x => ({ ...x, logo_url: url }));
  };

  const handleLogoClear = () => {
    if (extras.logo_url.startsWith('blob:')) URL.revokeObjectURL(extras.logo_url);
    setLogoFile(null);
    setExtras(x => ({ ...x, logo_url: '' }));
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast('Salvando...', 'info', false);
    // Fora do try porque o catch precisa saber o que apagar se o insert falhar.
    let logoNova: string | null = null;
    try {
      // Sobe a logo antes de gravar a linha: sem URL definitiva não há o que
      // salvar. Se o insert/update falhar depois, o arquivo é removido abaixo.
      let logoUrl = extras.logo_url;
      if (!isClientes && logoFile) {
        logoUrl = await uploadImagem(CADASTRO_IMAGEM_BUCKET, logoFile, editItem?.id);
        logoNova = logoUrl;
      }
      const logoAntiga = editItem?.logo_url ?? '';

      const base = {
        nome:        form.nome,
        pessoa_tipo: extras.pessoa_tipo,
        telefone:    extras.telefone,
        email:       extras.email,
        endereco:    extras.endereco,
        cpf_cnpj:    extras.cpf_cnpj,
        filial,
        ...(isClientes ? {
          // String vazia vira NULL, não 0: "sem limite" e "não leva fiado" são
          // decisões diferentes e o banco distingue as duas.
          limite_credito: extras.limite_credito.trim() === ''
            ? null : parseBRL(extras.limite_credito),
        } : {
          prazo_entrega_dias: extras.prazo_entrega_dias.trim() === ''
            ? null : Number(extras.prazo_entrega_dias),
          logo_url: logoUrl || null,
        }),
      };
      // Atributos JSONB (fornecedor apenas). Filtra pra manter só campos
      // válidos do nicho da filial atual — evita salvar lixo.
      const buildAtributosFornecedor = () => {
        const defs = ATRIBUTOS_FORNECEDOR[extras.filial] ?? [];
        const out: Record<string, any> = {};
        for (const d of defs) {
          const v = extras.atributos?.[d.key];
          if (v === undefined || v === null || v === '') continue;
          out[d.key] = d.type === 'number' ? Number(v) : v;
        }
        return out;
      };
      if (editItem) {
        const payload = isClientes
          ? base
          : { ...base, categoria: extras.categoria, atributos: buildAtributosFornecedor() };
        const updated = await dbUpdate(endpoint, editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Registro atualizado!', 'success', true);
      } else {
        // ultima_compra é coluna date no schema — preenchida pelo trigger de venda PDV,
        // não pelo cadastro inicial. Omitir aqui (NULL até primeira compra).
        const payload = isClientes
          ? { ...base, status: 'Ativo' }
          : { ...base, categoria: extras.categoria, atributos: buildAtributosFornecedor(), status: 'Homologado' };
        const saved = await dbInsert(endpoint, payload);
        setData([saved ?? { id: Date.now(), ...payload }, ...data]);
        showToast('Registro criado com sucesso!', 'success', true);
      }
      // A logo antiga só sai depois que a linha confirmou a nova — o contrário
      // deixaria o card sem imagem se o update falhasse.
      if (!isClientes && logoAntiga && logoAntiga !== logoUrl) {
        removerImagem(CADASTRO_IMAGEM_BUCKET, logoAntiga);
      }
      closeForm();
    } catch (err: any) {
      if (logoNova) removerImagem(CADASTRO_IMAGEM_BUCKET, logoNova);
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[CRM] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: any) => {
    const label = isClientes ? 'cliente' : 'fornecedor';
    if (!await confirm(`Excluir este ${label}?`)) return;
    try {
      // `fornecedores` está em TABLES_WITH_ATIVO: dbDelete inativa a linha em
      // vez de apagá-la. A logo fica no bucket de propósito — o registro ainda
      // existe e pode ser reativado, e arquivo apagado não volta.
      await dbDelete(endpoint, item.id);
      setData((prev: any[]) => prev.filter(d => d.id !== item.id));
      showToast('Registro excluído.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[CRM] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  const formEdicaoRef = useRolarAteFormulario(isFormOpen, editItem?.id);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">{title}</h2>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          <BotaoModeloPlanilha entidade={isClientes ? 'clientes' : 'fornecedores'} filial={filial} showToast={showToast} />
          {data.length > 0 && (
            <>
              <ExportButton label="PDF"   onClick={handleExportPDF}   icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder={`Buscar ${isClientes ? 'cliente' : 'fornecedor'}...`}
              className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Novo</NeuButtonAccent>
        </div>
      </div>

      {/* Formulário */}
      <AnimatePresence>
        {isFormOpen && (
          <motion.div ref={formEdicaoRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-5">
              <div className="flex items-start justify-between gap-4">
                <h3 className="text-sm font-bold text-gray-200">
                  {editItem ? (isClientes ? 'Editar Cliente' : 'Editar Fornecedor') : (isClientes ? 'Novo Cliente' : 'Novo Fornecedor')}
                </h3>
                {/* MaxID no alto à direita: é ferramenta do formulário inteiro
                    (documento e celular saem de lá), não do campo de CPF/CNPJ
                    sozinho — e ali o aluno o encontra assim que a tela abre.
                    O PNG tem fundo preto próprio, daí o canto arredondado em
                    vez de tentar dissolvê-lo no fundo do tema. */}
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <button type="button"
                    onClick={() => window.open(MAXID_URL, '_blank', 'noopener,noreferrer')}
                    className="neu-button py-2.5 px-5 rounded-xl text-sm font-bold text-accent hover:bg-accent/10 inline-flex items-center gap-3 transition-colors">
                    <img src="/icon-maxid.png" alt="" className="h-11 w-auto rounded-md" />
                    Gerar no MaxID <ExternalLink size={13} />
                  </button>
                  {/* Dizer o que o botão faz vale mais que o tooltip: em tablet
                      não há hover, e é justamente ali que a turma preenche. */}
                  <p className="text-[10px] text-gray-500 leading-relaxed text-right max-w-[15rem]">
                    Precisa de {extras.pessoa_tipo === 'Empresa' ? 'CNPJ' : 'CPF'} e celular para preencher?
                    Acesse o MaxID, gere os dados e volte para colar aqui — abre em outra aba, o que você já
                    digitou continua nesta.
                  </p>
                </div>
              </div>

              {/* Logo — só fornecedor (migr. 429). O card do cliente cai no
                  monograma, que não precisa de campo. */}
              {!isClientes && (
                <div className="flex flex-wrap items-center gap-5">
                  <FormField label="Logo do fornecedor">
                    <ImagemUploader
                      imagemUrl={extras.logo_url} rotulo="logo"
                      onPreview={handleLogoPreview} onClear={handleLogoClear} />
                  </FormField>
                  <div className="flex items-center gap-3 pt-4">
                    <LogoCadastro imagemUrl={extras.logo_url} nome={form.nome} size={44} />
                    <p className="text-[10px] text-gray-500 max-w-[16rem] leading-relaxed">
                      Sem logo, o card usa as iniciais do nome sobre uma cor fixa — já dá para
                      distinguir na lista. A logo só melhora o reconhecimento.
                    </p>
                  </div>
                </div>
              )}

              {/* Toggle Empresa / Pessoa Física */}
              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-2" id="crm-tipo-pessoa-label">Tipo de pessoa</span>
                <div className="flex gap-1 neu-pressed rounded-xl p-1 w-fit border border-white/5" role="radiogroup" aria-labelledby="crm-tipo-pessoa-label">
                  {(['Empresa', 'Pessoa Física'] as PessoaTipo[]).map(tipo => (
                    <button key={tipo} type="button"
                      onClick={() => setExtras(x => ({ ...x, pessoa_tipo: tipo, cpf_cnpj: '' }))}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                        extras.pessoa_tipo === tipo
                          ? 'neu-flat text-gray-200 border border-white/10'
                          : 'text-gray-600 hover:text-gray-400'
                      }`}>
                      {tipo}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField label="Nome *" error={errors.nome}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`}
                    value={form.nome}
                    onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }}
                    placeholder={extras.pessoa_tipo === 'Empresa' ? 'Razão social ou nome fantasia' : 'Nome completo'} />
                </FormField>

                <FormField label="Telefone / Celular">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.telefone}
                    onChange={e => setExtras(x => ({ ...x, telefone: formatPhone(e.target.value) }))}
                    placeholder="(11) 99999-9999" />
                </FormField>

                <FormField label="E-mail">
                  <input type="email" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.email}
                    onChange={e => setExtras(x => ({ ...x, email: e.target.value }))}
                    placeholder="email@exemplo.com" />
                </FormField>

                <FormField label="Endereço">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.endereco}
                    onChange={e => setExtras(x => ({ ...x, endereco: e.target.value }))}
                    placeholder="Rua, número, bairro, cidade" />
                </FormField>

                <FormField label={extras.pessoa_tipo === 'Empresa' ? 'CNPJ' : 'CPF'}>
                  <input className="neu-input py-2 px-3 rounded-xl text-sm font-mono"
                    value={extras.cpf_cnpj}
                    onChange={e => setExtras(x => ({ ...x, cpf_cnpj: extras.pessoa_tipo === 'Empresa' ? formatCNPJ(e.target.value) : formatCPF(e.target.value) }))}
                    placeholder={extras.pessoa_tipo === 'Empresa' ? '00.000.000/0001-00' : '000.000.000-00'} />
                  <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                    {extras.pessoa_tipo === 'Empresa' ? 'CNPJ' : 'CPF'} de treino com dígito verificador válido —
                    gere no MaxID (canto superior direito), copie e cole aqui.
                  </p>
                </FormField>

                {!isClientes && (
                  <FormField label="Categoria">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.categoria}
                      onChange={e => setExtras(x => ({ ...x, categoria: e.target.value }))}
                      placeholder="Ex: Materiais, Serviços" />
                  </FormField>
                )}

                {isClientes && (
                  <div>
                    <FormField label="Limite de crédito (R$)">
                      <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                        value={extras.limite_credito}
                        onChange={e => setExtras(x => ({ ...x, limite_credito: formatBRL(e.target.value) }))}
                        onKeyDown={handleMoneyKeyDown} placeholder="Em branco = sem limite" />
                    </FormField>
                    <span className="text-[10px] text-gray-500 block mt-1">
                      Teto da venda a prazo (Fiado). Em branco, a casa não definiu limite e o PDV não trava.
                      Zero significa "este cliente não leva fiado". Título vencido bloqueia a venda a prazo de
                      qualquer jeito, com ou sem limite.
                    </span>
                  </div>
                )}

                {!isClientes && (
                  <div>
                    <FormField label="Prazo médio de entrega (dias)">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm" inputMode="numeric"
                        value={extras.prazo_entrega_dias}
                        onChange={e => setExtras(x => ({ ...x, prazo_entrega_dias: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
                        placeholder="Ex: 15" />
                    </FormField>
                    <span className="text-[10px] text-gray-500 block mt-1">
                      Quanto ele costuma levar do pedido à entrega. Compras usa na cotação e para prometer data a quem requisitou.
                    </span>
                  </div>
                )}
              </div>

              {/* Atributos JSONB — só fornecedor + MaxLook/TechMax. Cliente e
                  SuperMax mantêm o form padrão sem seção extra. */}
              {!isClientes && (ATRIBUTOS_FORNECEDOR[extras.filial] ?? []).length > 0 && (
                <div className="mt-2 pt-6 border-t border-white/5">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-3">
                    {extras.filial === 'MaxLook' ? 'Perfil do parceiro (Moda)' : 'Perfil do parceiro (Assistência)'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(ATRIBUTOS_FORNECEDOR[extras.filial] ?? []).map(d => {
                      const val = extras.atributos?.[d.key] ?? '';
                      const setAtr = (v: any) => setExtras(x => ({
                        ...x, atributos: { ...(x.atributos ?? {}), [d.key]: v }
                      }));
                      if (d.type === 'select' && d.options) {
                        return (
                          <FormField key={d.key} label={d.label}>
                            <select className="neu-input py-2 px-3 rounded-xl text-sm"
                              value={String(val)} onChange={e => setAtr(e.target.value)}>
                              <option value="">— Selecione —</option>
                              {d.options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </FormField>
                        );
                      }
                      return (
                        <FormField key={d.key} label={d.label}>
                          <input className="neu-input py-2 px-3 rounded-xl text-sm"
                            type={d.type === 'number' ? 'number' : 'text'}
                            inputMode={d.type === 'number' ? 'numeric' : undefined}
                            value={String(val)} onChange={e => setAtr(e.target.value)}
                            placeholder={d.placeholder} />
                        </FormField>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cards */}
      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState /> : (
        <div className="flex flex-col gap-4 overflow-y-auto main-scrollbar pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pr-2">
          {filtered.map((item: any, i: number) => {
            const pessoaTipo: string = item.pessoa_tipo ?? (isClientes ? item.tipo : item.categoria) ?? '—';
            const docLabel = item.pessoa_tipo === 'Pessoa Física' ? 'CPF' : 'CNPJ';
            return (
              <motion.div key={item.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                className="neu-flat p-6 rounded-3xl flex flex-col border border-white/5 gap-4 group">
                <div className="flex justify-between items-start gap-3">
                  {/* A identidade veio para a esquerda, ao lado do nome. Ficava
                      solta na direita, com o mesmo ícone em todos os cards —
                      trinta fornecedores eram trinta caixas idênticas. */}
                  <div className="flex items-start gap-3 min-w-0">
                    <LogoCadastro imagemUrl={item.logo_url} nome={item.nome} size={44} />
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-gray-200 mb-2 tracking-wide">{item.nome}</h3>
                      <div className="flex gap-2 items-center flex-wrap">
                        <span className="text-[10px] uppercase px-2 py-0.5 rounded text-gray-400 tracking-widest neu-pressed" style={{ background: 'var(--color-badge-neutral-bg)' }}>{pessoaTipo}</span>
                        <FilialBadge filial={item.filial} />
                        <span className="w-1 h-1 rounded-full bg-accent"></span>
                        <span className="text-xs text-accent font-medium">{item.status}</span>
                      </div>
                    </div>
                  </div>
                  {/* No toque não existe hover: as ações ficavam invisíveis e
                      inalcançáveis no celular. Escondidas só a partir de md. */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => openEdit(item)} className="action-btn-edit"><Edit2 size={12} /></button>
                    <MenuMais>
                      {fechar => (
                        <>
                          <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade={type} entidadeId={item.id} titulo={item.nome} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                          <ItemMenu onClick={() => { fechar(); handleDelete(item); }}
                            cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                            Excluir
                          </ItemMenu>
                        </>
                      )}
                    </MenuMais>
                  </div>
                </div>

                <div className="neu-pressed p-4 rounded-2xl flex flex-col gap-2.5 border border-white/5">
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold border-b border-white/5 pb-2">Contato</span>
                  {item.email ? (
                    <div className="flex items-center gap-2.5 text-xs text-gray-300">
                      <Mail size={11} className="text-gray-500 shrink-0" />{item.email}
                    </div>
                  ) : null}
                  {item.telefone ? (
                    <div className="flex items-center gap-2.5 text-xs text-gray-300">
                      <PhoneIcon size={11} className="text-gray-500 shrink-0" />{item.telefone}
                    </div>
                  ) : null}
                  {item.cpf_cnpj ? (
                    <div className="flex items-center gap-2.5 text-xs text-gray-300">
                      <CreditCard size={11} className="text-gray-500 shrink-0" />
                      <span className="font-mono">{docLabel}: {item.cpf_cnpj}</span>
                    </div>
                  ) : null}
                  {item.endereco ? (
                    <div className="flex items-center gap-2.5 text-xs text-gray-400">
                      <MapPin size={11} className="text-gray-500 shrink-0" />{item.endereco}
                    </div>
                  ) : null}
                  {!item.email && !item.telefone && !item.cpf_cnpj && !item.endereco && (
                    <span className="text-xs text-gray-600">Sem informações de contato</span>
                  )}
                </div>

                {isClientes && (
                  <div className="text-[11px] text-gray-500 border-t border-white/5 pt-3 mt-auto flex justify-between">
                    <span>Última compra:</span>
                    <strong className="text-gray-200">{item.ultima_compra ?? '—'}</strong>
                  </div>
                )}
              </motion.div>
            );
          })}
          </div>
          <Pagination
            page={page}
            totalCount={totalCount}
            isLoading={isLoading}
            onPrev={() => setPage(p => Math.max(0, p - 1))}
            onNext={() => setPage(p => p + 1)}
            onReload={reload}
          />
        </div>
      )}
    </motion.div>
  );
};

export const CRMView = ({ type, showToast }: { type: 'clientes' | 'fornecedores'; showToast: any }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <CRMViewInner type={type} showToast={showToast} filial={filialAtiva} />;
};
