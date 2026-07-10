import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, MapPin, Building2, Plus, Save, FileDown, Sheet, Phone, User, ImagePlus, X as XIcon, Loader2, Ruler, Clock, Calendar, Car, Users2, Wallet, Package } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation, exportToPDF, exportToExcel, formatCNPJ, formatPhone, formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';
import { uploadLogoFilial, removerLogoFilial, FILIAL_LOGO_ACCEPT, FILIAL_LOGO_MAX_LABEL, validarLogoFilial } from '../lib/filialLogo';
import { FILIAIS_HOLDING, type FilialHolding } from '../lib/filiais';

// Equipamentos comuns a qualquer unidade — energia, manutenção, reposição.
const CAMPOS_COMUNS = [
  ['arCondicionados',  'Ar-condicionados'],
  ['ventiladores',     'Ventiladores'],
  ['caixasAtendimento','Caixas de atendimento'],
  ['computadores',     'Computadores'],
  ['impressoras',      'Impressoras'],
  ['mesas',            'Mesas'],
  ['cadeiras',         'Cadeiras'],
  ['camerasSeguranca', 'Câmeras de segurança'],
  ['extintores',       'Extintores'],
] as const;

// Campos específicos por nicho — só aparecem quando o nome da filial
// bate com o nicho detectado. Padrão herdado do PDV (atributos jsonb por nicho).
const CAMPOS_NICHO: Record<FilialHolding, ReadonlyArray<readonly [string, string]>> = {
  SuperMax: [
    ['gondolas',        'Gôndolas'],
    ['freezers',        'Freezers / Geladeiras'],
    ['balancas',        'Balanças'],
    ['esteirasCaixa',   'Esteiras de caixa'],
    ['carrinhos',       'Carrinhos'],
    ['cestas',          'Cestas'],
    ['setoresEspeciais','Setores (açougue/padaria/etc)'],
  ],
  MaxLook: [
    ['provadores',         'Provadores'],
    ['expositoresPerfume', 'Expositores de perfume'],
    ['balcaoMaquiagem',    'Balcões de maquiagem'],
    ['testers',            'Testers em exposição'],
    ['araras',             'Araras'],
    ['iluminacaoEspecial', 'Spots de iluminação'],
  ],
  TechMax: [
    ['bancadasReparo',     'Bancadas de reparo'],
    ['estacoesSolda',      'Estações de solda'],
    ['multimetros',        'Multímetros'],
    ['ferramentasSet',     'Kits de ferramentas'],
    ['vitrinesAcessorios', 'Vitrines de acessórios'],
    ['estoquePecas',       'Compartimentos de peças'],
  ],
  Matriz: [
    ['salasReuniao',    'Salas de reunião'],
    ['servidoresRack',  'Servidores / Racks'],
    ['telefones',       'Telefones'],
    ['quadrosBrancos',  'Quadros brancos'],
  ],
};

// Nome digitado → nicho conhecido. Match por `includes` case-insensitive
// pra aceitar "SuperMax Rio Branco", "MaxLook Centro" etc.
function detectarNicho(nome: string): FilialHolding | null {
  const n = (nome ?? '').toLowerCase();
  for (const f of FILIAIS_HOLDING) if (n.includes(f.toLowerCase())) return f;
  return null;
}

// Todas as chaves de equipamento (comum + todos os nichos). Usado pra
// inicializar/limpar/salvar em loop, evitando repetir chave por chave.
const TODAS_CHAVES_EQUIP: string[] = [
  ...CAMPOS_COMUNS.map(([k]) => k),
  ...Object.values(CAMPOS_NICHO).flatMap(l => l.map(([k]) => k)),
];

const equipZeros = (): Record<string, string> =>
  Object.fromEntries(TODAS_CHAVES_EQUIP.map(k => [k, '']));

function FilialThumb({ url, size = 'md', alt }: { url?: string | null; size?: 'xs' | 'md' | 'lg'; alt?: string }) {
  const dim = size === 'xs' ? 'w-8 h-8' : size === 'lg' ? 'w-16 h-16' : 'w-10 h-10';
  if (url) return (
    <div className={`${dim} rounded-xl overflow-hidden shrink-0 border border-white/10 bg-white flex items-center justify-center`}>
      <img src={url} alt={alt ?? 'Logo'} className="w-full h-full object-contain p-0.5" />
    </div>
  );
  return (
    <div className={`${dim} neu-circle flex items-center justify-center bg-accent/5 shrink-0`}>
      <Building2 size={size === 'xs' ? 14 : size === 'lg' ? 24 : 18} className="text-accent" />
    </div>
  );
}

export const FiliaisView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/filiaisview');
  const confirm = useConfirm();
  const [isSaving, setIsSaving]     = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [editItem, setEditItem]     = useState<any | null>(null);
  const [search, setSearch]         = useState('');
  const [form, setForm]             = useState({ nome: '', cnpj: '', cidade: '' });
  const [extras, setExtras]         = useState({ celular: '', endereco: '', representante: '' });
  const [detalhes, setDetalhes]     = useState<Record<string, string>>({
    tamanhoM2: '', tipoImovel: '', valorAluguel: '', vagas: '',
    capacidade: '', horarioFuncionamento: '', dataInauguracao: '', investimentoInicial: '',
    ...equipZeros(),
  });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const [imagemUrl, setImagemUrl]             = useState('');
  const [imagemUrlAnterior, setImagemUrlAnterior] = useState('');
  const [imagemUploading, setImagemUploading] = useState(false);
  const imagemInputRef = useRef<HTMLInputElement>(null);

  const filtered = data.filter((item: any) =>
    [item.nome, item.cnpj, item.cidade, item.celular, item.endereco, item.representante]
      .some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const exportCols = ['Nome', 'CNPJ', 'Cidade/UF', 'Celular', 'Representante', 'Status'];
  const exportRows = () => filtered.map((d: any) => [d.nome ?? '', d.cnpj ?? '', d.cidade ?? '', d.celular ?? '', d.representante ?? '', d.status ?? '']);
  const handleExportPDF   = () => exportToPDF('Gestão de Filiais', exportCols, exportRows(), 'logmax-filiais');
  const handleExportExcel = () => exportToExcel('Filiais', exportCols, exportRows(), 'logmax-filiais');

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ nome: item.nome ?? '', cnpj: item.cnpj ?? '', cidade: item.cidade ?? '' });
    setExtras({ celular: item.celular ?? '', endereco: item.endereco ?? '', representante: item.representante ?? '' });
    const d = item.detalhes ?? {};
    const nStr = (v: any) => v != null ? String(v) : '';
    const equipCarregado = Object.fromEntries(
      TODAS_CHAVES_EQUIP.map(k => [k, nStr(d[k])])
    );
    setDetalhes({
      tamanhoM2: nStr(d.tamanhoM2),
      tipoImovel: d.tipoImovel ?? '',
      valorAluguel: d.valorAluguel != null ? formatBRL(d.valorAluguel) : '',
      vagas: nStr(d.vagas),
      capacidade: nStr(d.capacidade),
      horarioFuncionamento: d.horarioFuncionamento ?? '',
      dataInauguracao: d.dataInauguracao ?? '',
      investimentoInicial: d.investimentoInicial != null ? formatBRL(d.investimentoInicial) : '',
      ...equipCarregado,
    });
    setImagemUrl(item.imagem_url ?? '');
    setImagemUrlAnterior(item.imagem_url ?? '');
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    // Se subiu logo mas cancelou sem salvar, remove o órfão do bucket
    if (imagemUrl && imagemUrl !== imagemUrlAnterior)
      removerLogoFilial(imagemUrl).catch(() => {});
    setShowForm(false);
    setEditItem(null);
    setForm({ nome: '', cnpj: '', cidade: '' });
    setExtras({ celular: '', endereco: '', representante: '' });
    setDetalhes({
      tamanhoM2: '', tipoImovel: '', valorAluguel: '', vagas: '',
      capacidade: '', horarioFuncionamento: '', dataInauguracao: '', investimentoInicial: '',
      ...equipZeros(),
    });
    setImagemUrl('');
    setImagemUrlAnterior('');
    setErrors({});
    if (imagemInputRef.current) imagemInputRef.current.value = '';
  };

  const handleImagemChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const v = validarLogoFilial(file);
    if (!v.ok) { showToast(v.motivo, 'error', true); e.target.value = ''; return; }
    setImagemUploading(true);
    try {
      const url = await uploadLogoFilial(file, editItem?.id);
      setImagemUrl(url);
      showToast('Logo carregada!', 'success', true);
    } catch (err: any) {
      showToast(err?.message ?? 'Falha ao enviar logo.', 'error', true);
    } finally {
      setImagemUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast(editItem ? 'Atualizando filial...' : 'Salvando filial...', 'info', false);
    try {
      const num = (v: string) => v !== '' ? Number(v) : null;
      const nicho = detectarNicho(form.nome);
      // Comuns: sempre persistem. Nicho: só o subset do nicho detectado
      // — evita carregar campos de outros nichos que ficaram no state.
      const chavesEquipParaSalvar = [
        ...CAMPOS_COMUNS.map(([k]) => k),
        ...(nicho ? CAMPOS_NICHO[nicho].map(([k]) => k) : []),
      ];
      const equipPayload = Object.fromEntries(
        chavesEquipParaSalvar.map(k => [k, num(detalhes[k])])
      );
      const detalhesPayload = {
        tamanhoM2: num(detalhes.tamanhoM2),
        tipoImovel: detalhes.tipoImovel || null,
        valorAluguel: detalhes.tipoImovel === 'Alugado' && detalhes.valorAluguel ? parseBRL(detalhes.valorAluguel) : null,
        vagas: num(detalhes.vagas),
        capacidade: num(detalhes.capacidade),
        horarioFuncionamento: detalhes.horarioFuncionamento || null,
        dataInauguracao: detalhes.dataInauguracao || null,
        investimentoInicial: detalhes.investimentoInicial ? parseBRL(detalhes.investimentoInicial) : null,
        ...equipPayload,
      };
      const payload = { ...form, ...extras, detalhes: detalhesPayload, imagem_url: imagemUrl || null };
      if (editItem) {
        const updated = await dbUpdate('/api/filiaisview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        if (imagemUrlAnterior && imagemUrlAnterior !== imagemUrl)
          removerLogoFilial(imagemUrlAnterior).catch(() => {});
        showToast('Filial atualizada!', 'success', true);
      } else {
        const saved = await dbInsert('/api/filiaisview', { ...payload, status: 'Ativa' });
        setData([saved ?? { id: Date.now(), ...payload, status: 'Ativa' }, ...data]);
        showToast('Filial criada com sucesso!', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Filiais] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, imagem_url?: string) => {
    if (!await confirm('Excluir esta filial? Esta ação não pode ser desfeita.')) return;
    try {
      await dbDelete('/api/filiaisview', id);
      removerLogoFilial(imagem_url).catch(() => {});
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Filial excluída.', 'success', true);
    } catch (err: any) {
      showToast(`Erro ao excluir: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Gestão de Filiais</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie os locais e unidades físicas da empresa.</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          {data.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={handleExportPDF} icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar filial..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}>
            <Plus size={16} /> Novo
          </NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-5">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Filial' : 'Nova Filial'}</h3>

              {/* Logo */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                  <ImagePlus size={12} /> Logo da Filial
                </p>
                <div className="neu-pressed rounded-2xl p-4 border border-white/5 flex flex-col sm:flex-row items-center gap-4">
                  <FilialThumb url={imagemUrl} size="lg" alt={form.nome || 'Filial'} />
                  <div className="flex-1 flex flex-col gap-2 w-full">
                    <input ref={imagemInputRef} type="file" accept={FILIAL_LOGO_ACCEPT} onChange={handleImagemChange} className="hidden" />
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => imagemInputRef.current?.click()} disabled={imagemUploading}
                        className="neu-button py-2 px-4 rounded-xl text-xs font-bold text-gray-300 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-60">
                        {imagemUploading
                          ? <><Loader2 size={12} className="animate-spin" /> Enviando...</>
                          : <><ImagePlus size={12} /> {imagemUrl ? 'Trocar logo' : 'Selecionar logo'}</>}
                      </button>
                      {imagemUrl && !imagemUploading && (
                        <button type="button" onClick={() => setImagemUrl('')}
                          className="neu-button py-2 px-3 rounded-xl text-xs font-bold text-gray-500 hover:text-red-500 transition-colors flex items-center gap-1.5">
                          <XIcon size={11} /> Remover
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500">
                      JPG, PNG, WEBP ou SVG — máx. <span className="font-bold text-gray-300">{FILIAL_LOGO_MAX_LABEL}</span>.
                      Sem logo, exibe ícone padrão.
                    </p>
                  </div>
                </div>
              </div>

              {/* Campos */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField label="Nome da filial *" error={errors.nome}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`}
                    value={form.nome} onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }}
                    placeholder="Ex: Filial Sul" />
                </FormField>
                <FormField label="CNPJ *" error={errors.cnpj}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm font-mono ${errors.cnpj ? 'border border-red-500/40' : ''}`}
                    value={form.cnpj} onChange={e => { setForm(f => ({ ...f, cnpj: formatCNPJ(e.target.value) })); clearError('cnpj'); }}
                    placeholder="00.000.000/0000-00" inputMode="numeric" />
                </FormField>
                <FormField label="Cidade/UF *" error={errors.cidade}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.cidade ? 'border border-red-500/40' : ''}`}
                    value={form.cidade} onChange={e => { setForm(f => ({ ...f, cidade: e.target.value })); clearError('cidade'); }}
                    placeholder="Ex: Rio Branco/AC" />
                </FormField>
                <FormField label="Celular">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.celular}
                    onChange={e => setExtras(x => ({ ...x, celular: formatPhone(e.target.value) }))}
                    placeholder="(68) 99999-9999" inputMode="numeric" />
                </FormField>
                <FormField label="Endereço">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.endereco}
                    onChange={e => setExtras(x => ({ ...x, endereco: e.target.value }))}
                    placeholder="Rua, número, bairro" />
                </FormField>
                <FormField label="Representante">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.representante}
                    onChange={e => setExtras(x => ({ ...x, representante: e.target.value }))}
                    placeholder="Ex: João Silva" />
                </FormField>
              </div>

              {/* Detalhes operacionais / plano de negócio */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                  <Ruler size={12} /> Detalhes Operacionais
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField label="Tamanho do espaço (m²)">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm" type="number" min="0" value={detalhes.tamanhoM2}
                      onChange={e => setDetalhes(d => ({ ...d, tamanhoM2: e.target.value }))}
                      placeholder="Ex: 180" />
                  </FormField>
                  <FormField label="Tipo de imóvel">
                    <select className="neu-input py-2 px-3 rounded-xl text-sm" value={detalhes.tipoImovel}
                      onChange={e => setDetalhes(d => ({ ...d, tipoImovel: e.target.value, valorAluguel: e.target.value === 'Alugado' ? d.valorAluguel : '' }))}>
                      <option value="">Selecione...</option>
                      <option value="Próprio">Próprio</option>
                      <option value="Alugado">Alugado</option>
                    </select>
                  </FormField>
                  {detalhes.tipoImovel === 'Alugado' && (
                    <FormField label="Valor do aluguel">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm" type="text" inputMode="numeric" value={detalhes.valorAluguel}
                        onChange={e => setDetalhes(d => ({ ...d, valorAluguel: formatBRL(e.target.value) }))}
                        onKeyDown={handleMoneyKeyDown}
                        placeholder="R$ 0,00" />
                    </FormField>
                  )}
                  <FormField label="Vagas de estacionamento">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm" type="number" min="0" value={detalhes.vagas}
                      onChange={e => setDetalhes(d => ({ ...d, vagas: e.target.value }))}
                      placeholder="Ex: 10" />
                  </FormField>
                  <FormField label="Capacidade (pessoas/PDVs)">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm" type="number" min="0" value={detalhes.capacidade}
                      onChange={e => setDetalhes(d => ({ ...d, capacidade: e.target.value }))}
                      placeholder="Ex: 40" />
                  </FormField>
                  <FormField label="Horário de funcionamento">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm" value={detalhes.horarioFuncionamento}
                      onChange={e => setDetalhes(d => ({ ...d, horarioFuncionamento: e.target.value }))}
                      placeholder="Ex: 08h às 18h" />
                  </FormField>
                  <FormField label="Data de inauguração">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm" type="date" value={detalhes.dataInauguracao}
                      onChange={e => setDetalhes(d => ({ ...d, dataInauguracao: e.target.value }))} />
                  </FormField>
                  <FormField label="Investimento inicial">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm" type="text" inputMode="numeric" value={detalhes.investimentoInicial}
                      onChange={e => setDetalhes(d => ({ ...d, investimentoInicial: formatBRL(e.target.value) }))}
                      onKeyDown={handleMoneyKeyDown}
                      placeholder="R$ 0,00" />
                  </FormField>
                </div>
              </div>

              {/* Equipamentos & mobiliário comuns */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                  <Package size={12} /> Equipamentos & Mobiliário
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {CAMPOS_COMUNS.map(([key, label]) => (
                    <FormField key={key} label={label}>
                      <input className="neu-input py-2 px-3 rounded-xl text-sm" type="number" min="0"
                        value={detalhes[key] ?? ''}
                        onChange={e => setDetalhes(d => ({ ...d, [key]: e.target.value }))}
                        placeholder="0" />
                    </FormField>
                  ))}
                </div>
              </div>

              {/* Específicos do nicho — só aparece quando o nome bate com uma das 4 unidades */}
              {(() => {
                const nicho = detectarNicho(form.nome);
                if (!nicho) return null;
                return (
                  <div>
                    <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                      <Package size={12} /> Específicos do nicho <span className="text-accent">· {nicho}</span>
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {CAMPOS_NICHO[nicho].map(([key, label]) => (
                        <FormField key={key} label={label}>
                          <input className="neu-input py-2 px-3 rounded-xl text-sm" type="number" min="0"
                            value={detalhes[key] ?? ''}
                            onChange={e => setDetalhes(d => ({ ...d, [key]: e.target.value }))}
                            placeholder="0" />
                        </FormField>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                  <Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}
                </NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto main-scrollbar pb-6 pr-2">
          {filtered.map((item: any, i: number) => (
            <motion.div key={item.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className="neu-flat p-6 rounded-2xl flex flex-col border border-white/5 group gap-4">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <FilialThumb url={item.imagem_url} size="md" alt={item.nome} />
                  <div>
                    <h3 className="text-sm font-bold text-gray-200 tracking-wide">{item.nome}</h3>
                    <span className="text-xs font-mono text-gray-500">{item.cnpj}</span>
                  </div>
                </div>
                <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest shrink-0 ${item.status === 'Ativa' ? 'bg-accent/10 text-accent' : 'bg-gray-800 text-gray-400'}`}>
                  {item.status}
                </div>
              </div>

              <div className="neu-pressed p-3.5 rounded-xl flex flex-col gap-2 border border-white/5">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <MapPin size={11} className="text-gray-500 shrink-0" />
                  <span>{item.cidade}{item.endereco ? ` — ${item.endereco}` : ''}</span>
                </div>
                {item.celular && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Phone size={11} className="text-gray-500 shrink-0" />{item.celular}
                  </div>
                )}
                {item.representante && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <User size={11} className="text-gray-500 shrink-0" />{item.representante}
                  </div>
                )}
                {item.detalhes?.tamanhoM2 != null && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Ruler size={11} className="text-gray-500 shrink-0" />{item.detalhes.tamanhoM2} m²
                    {item.detalhes.tipoImovel ? ` · ${item.detalhes.tipoImovel}` : ''}
                  </div>
                )}
                {item.detalhes?.horarioFuncionamento && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Clock size={11} className="text-gray-500 shrink-0" />{item.detalhes.horarioFuncionamento}
                  </div>
                )}
                {item.detalhes?.vagas != null && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Car size={11} className="text-gray-500 shrink-0" />{item.detalhes.vagas} vagas
                  </div>
                )}
                {item.detalhes?.capacidade != null && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Users2 size={11} className="text-gray-500 shrink-0" />Capacidade: {item.detalhes.capacidade}
                  </div>
                )}
                {item.detalhes?.dataInauguracao && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Calendar size={11} className="text-gray-500 shrink-0" />Inaugurada em {new Date(item.detalhes.dataInauguracao + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </div>
                )}
                {(item.detalhes?.valorAluguel != null || item.detalhes?.investimentoInicial != null) && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Wallet size={11} className="text-gray-500 shrink-0" />
                    {item.detalhes.valorAluguel != null && `Aluguel: R$ ${formatBRL(item.detalhes.valorAluguel)}`}
                    {item.detalhes.valorAluguel != null && item.detalhes.investimentoInicial != null && ' · '}
                    {item.detalhes.investimentoInicial != null && `Investimento: R$ ${formatBRL(item.detalhes.investimentoInicial)}`}
                  </div>
                )}
                {(() => {
                  const d = item.detalhes ?? {};
                  const nichoItem = detectarNicho(item.nome);
                  const paresRelevantes = [
                    ...CAMPOS_COMUNS,
                    ...(nichoItem ? CAMPOS_NICHO[nichoItem] : []),
                  ];
                  const chips = paresRelevantes
                    .map(([k, l]) => [l, d[k]] as const)
                    .filter(([, v]) => typeof v === 'number' && v > 0);
                  if (chips.length === 0) return null;
                  return (
                    <div className="flex items-start gap-2 text-xs text-gray-400 pt-1 border-t border-white/5">
                      <Package size={11} className="text-gray-500 shrink-0 mt-1" />
                      <div className="flex flex-wrap gap-1">
                        {chips.map(([label, v]) => (
                          <span key={label} className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] font-mono">
                            {v}× {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-auto">
                <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                <button onClick={() => openEdit(item)} className="action-btn-edit"><Edit2 size={12} /></button>
                <button onClick={() => handleDelete(item.id, item.imagem_url)} className="action-btn-delete"><Trash2 size={12} /></button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
