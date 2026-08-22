import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, MapPin, Building2, Plus, Save, FileDown, Sheet, Phone, User, ImagePlus, X as XIcon, Loader2, Ruler, Clock, Calendar, Car, Users2, Wallet, Package } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation, exportToPDF, exportToExcel, formatCNPJ, formatPhone, formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';
import { uploadLogoFilial, removerLogoFilial, FILIAL_LOGO_ACCEPT, FILIAL_LOGO_MAX_LABEL, validarLogoFilial } from '../lib/filialLogo';
import { FILIAIS_HOLDING, type FilialHolding } from '../lib/filiais';
import { useUserProfile } from '../hooks/useUserProfile';
import { isConselheiro } from '../lib/rbac';
import { useFilial } from '../contexts/FilialContext';

// Equipamentos & mobiliário por nicho — cada unidade tem sua grade completa,
// curada pra realidade do negócio. Padrão herdado do PDV (atributos jsonb).
const CAMPOS_NICHO: Record<FilialHolding, ReadonlyArray<readonly [string, string]>> = {
  SuperMax: [
    ['gondolas',         'Gôndolas'],
    ['freezers',         'Freezers / Geladeiras'],
    ['camarasFrias',     'Câmaras frias'],
    ['balancas',         'Balanças'],
    ['esteirasCaixa',    'Esteiras de caixa'],
    ['pdvs',             'PDVs (checkouts)'],
    ['carrinhos',        'Carrinhos'],
    ['cestas',           'Cestas'],
    ['setoresEspeciais', 'Setores (açougue/padaria/hortifruti)'],
    ['arCondicionados',  'Ar-condicionados'],
    ['camerasSeguranca', 'Câmeras de segurança'],
    ['extintores',       'Extintores'],
  ],
  MaxLook: [
    ['provadores',         'Provadores'],
    ['araras',             'Araras (roupas)'],
    ['manequins',          'Manequins'],
    ['prateleirasCalcado', 'Prateleiras de calçados'],
    ['espelhos',           'Espelhos'],
    ['expositoresPerfume', 'Expositores de perfume'],
    ['balcaoMaquiagem',    'Balcões de maquiagem'],
    ['testers',            'Testers em exposição'],
    ['iluminacaoEspecial', 'Spots de iluminação'],
    ['antifurtos',         'Sensores antifurto'],
    ['pdvs',               'PDVs (caixas)'],
    ['arCondicionados',    'Ar-condicionados'],
    ['camerasSeguranca',   'Câmeras de segurança'],
  ],
  TechMax: [
    ['bancadasReparo',     'Bancadas de reparo'],
    ['estacoesSolda',      'Estações de solda'],
    ['multimetros',        'Multímetros'],
    ['osciloscopios',      'Osciloscópios'],
    ['ferramentasSet',     'Kits de ferramentas'],
    ['estacoesEsd',        'Estações antiestática (ESD)'],
    ['vitrinesExposicao',  'Vitrines de exposição'],
    ['vitrinesAcessorios', 'Vitrines de acessórios'],
    ['estoquePecas',       'Compartimentos de peças'],
    ['pdvs',               'PDVs (caixas)'],
    ['arCondicionados',    'Ar-condicionados'],
    ['camerasSeguranca',   'Câmeras de segurança'],
  ],
  Matriz: [
    ['salasReuniao',    'Salas de reunião'],
    ['estacoesTrabalho','Estações de trabalho'],
    ['servidoresRack',  'Servidores / Racks'],
    ['telefones',       'Telefones'],
    ['quadrosBrancos',  'Quadros brancos'],
    ['impressoras',     'Impressoras'],
    ['arCondicionados', 'Ar-condicionados'],
    ['camerasSeguranca','Câmeras de segurança'],
    ['extintores',      'Extintores'],
  ],
};

// Nicho da unidade. Inferido do nome (SuperMax Rio Branco, MaxLook Centro etc.).
// Aceita `explicit` só como compatibilidade com registros antigos que
// gravaram `detalhes.nicho` manualmente — se bater com uma holding, tem
// prioridade; senão cai no nome.
function detectarNicho(explicit: string | undefined | null, nome?: string): FilialHolding | null {
  const e = (explicit ?? '').trim();
  if (e && (FILIAIS_HOLDING as readonly string[]).includes(e)) return e as FilialHolding;
  const n = (nome ?? '').toLowerCase();
  for (const f of FILIAIS_HOLDING) if (n.includes(f.toLowerCase())) return f;
  return null;
}

// Todas as chaves de equipamento (união de todos os nichos). Usado pra
// inicializar/limpar/salvar em loop, evitando repetir chave por chave.
const TODAS_CHAVES_EQUIP: string[] = Array.from(new Set(
  Object.values(CAMPOS_NICHO).flatMap(l => l.map(([k]) => k))
));

const equipZeros = (): Record<string, string> =>
  Object.fromEntries(TODAS_CHAVES_EQUIP.map(k => [k, '']));

// Preço unitário por item — chave irmã `${key}Preco`, mesma grade.
const precoKey = (k: string) => `${k}Preco`;
const equipPrecoZeros = (): Record<string, string> =>
  Object.fromEntries(TODAS_CHAVES_EQUIP.map(k => [precoKey(k), '']));

function FilialThumb({ url, size = 'md', alt }: { url?: string | null; size?: 'xs' | 'md' | 'lg'; alt?: string }) {
  const dim = size === 'xs' ? 'w-8 h-8' : size === 'lg' ? 'w-16 h-16' : 'w-10 h-10';
  if (url) return (
    <div className={`${dim} rounded-xl overflow-hidden shrink-0 border border-white/10 bg-white flex items-center justify-center`}>
      <img src={url} alt={alt ?? 'Logo'} className="w-full h-full object-contain p-0.5"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
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
  const { data: centrosCusto } = useFetchData<any>('/api/centroscustoview');
  const { profile } = useUserProfile();
  // Unidade ativa vinda do topbar (SUPERMAX/MAXLOOK/TECHMAX). null = Matriz.
  // É essa que define a grade de equipamentos & mobiliário do formulário.
  const { filialAtiva } = useFilial();
  const nichoAtivo: FilialHolding = filialAtiva ?? 'Matriz';
  // RLS (migr. 187 + 200): admin/CEO/conselheiro fazem tudo. Gerente também
  // faz CRUD, mas só na própria filial (nicho === profile.filial). Espelha
  // no frontend: botão "Novo" aparece pra gerente e o INSERT amarra o nicho
  // do payload em profile.filial pra a policy WITH CHECK passar.
  const canManage = profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);
  const canCreate = canManage || profile?.role === 'gerente';
  const canEditRow = (item: any) => {
    if (canManage) return true;
    if (profile?.role !== 'gerente') return false;
    const nicho = item?.detalhes?.nicho ?? 'Matriz';
    return profile.filial === nicho;
  };
  const canDeleteRow = canEditRow;
  const [isSaving, setIsSaving]     = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [editItem, setEditItem]     = useState<any | null>(null);
  // Fase 1/2 do plano de desembolso da montagem de filial (migr. 509): os
  // itens de investimento só existem amarrados a uma filial já salva — sem
  // editItem, o filtro cai no sentinel e a lista fica vazia (não é erro).
  const SEM_FILIAL_SENTINEL = '00000000-0000-0000-0000-000000000000';
  const { data: itens, reload: reloadItens } = useFetchData<any>(
    '/api/filialinvestimentosview',
    { filial_id: editItem?.id ?? SEM_FILIAL_SENTINEL },
    false,
    { orderBy: 'created_at', ascending: true },
  );
  // Nicho da filial ABERTA no formulário — não o do topbar. Em modo Matriz
  // (consolidado) a lista mostra todas as unidades, então `nichoAtivo` seria
  // 'Matriz' mesmo editando a SuperMax: item, grade e conta a pagar sairiam
  // na unidade errada. Só cai em `nichoAtivo` quando não há filial aberta
  // (criação), que é o único caso em que o topbar manda.
  const nichoDoForm: FilialHolding = editItem
    ? (detectarNicho(editItem.detalhes?.nicho, editItem.nome) ?? nichoAtivo)
    : nichoAtivo;
  const [search, setSearch]         = useState('');
  const [form, setForm]             = useState({ nome: '', cnpj: '', cidade: '' });
  const [extras, setExtras]         = useState({ celular: '', endereco: '', representante: '' });
  const [detalhes, setDetalhes]     = useState<Record<string, string>>({
    nicho: '',
    tamanhoM2: '', tipoImovel: '', valorAluguel: '', vagas: '',
    capacidade: '', horarioFuncionamento: '', dataInauguracao: '', investimentoInicial: '',
    folhaPagamento: '',
    ...equipZeros(),
    ...equipPrecoZeros(),
  });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const [imagemUrl, setImagemUrl]             = useState('');
  const [imagemUrlAnterior, setImagemUrlAnterior] = useState('');
  const [imagemUploading, setImagemUploading] = useState(false);
  const imagemInputRef = useRef<HTMLInputElement>(null);

  // Isolamento por filial: dentro de uma unidade específica (SuperMax/MaxLook
  // /TechMax), mostra apenas os registros do nicho correspondente. Em modo
  // Matriz (filialAtiva === null) mostra TODAS as unidades — é o consolidado.
  // Registros históricos sem `detalhes.nicho` gravado caem no fallback do
  // nome via detectarNicho.
  const escopadoPorFilial = filialAtiva === null
    ? data
    : data.filter((item: any) => {
        const nichoItem = detectarNicho(item.detalhes?.nicho, item.nome);
        return nichoItem === nichoAtivo;
      });
  const filtered = escopadoPorFilial.filter((item: any) =>
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
    const precoCarregado = Object.fromEntries(
      TODAS_CHAVES_EQUIP.map(k => [precoKey(k), d[precoKey(k)] != null ? formatBRL(d[precoKey(k)]) : ''])
    );
    setDetalhes({
      nicho: d.nicho ?? '',
      tamanhoM2: nStr(d.tamanhoM2),
      tipoImovel: d.tipoImovel ?? '',
      valorAluguel: d.valorAluguel != null ? formatBRL(d.valorAluguel) : '',
      vagas: nStr(d.vagas),
      capacidade: nStr(d.capacidade),
      horarioFuncionamento: d.horarioFuncionamento ?? '',
      dataInauguracao: d.dataInauguracao ?? '',
      investimentoInicial: d.investimentoInicial != null ? formatBRL(d.investimentoInicial) : '',
      folhaPagamento: d.folhaPagamento != null ? formatBRL(d.folhaPagamento) : '',
      ...equipCarregado,
      ...precoCarregado,
    });
    setImagemUrl(item.imagem_url ?? '');
    setImagemUrlAnterior(item.imagem_url ?? '');
    setErrors({});
    setShowForm(false);
  };

  const closeForm = (opts?: { skipOrphanCleanup?: boolean }) => {
    // Se subiu logo mas cancelou sem salvar, remove o órfão do bucket.
    // Pulado após save bem-sucedido — nesse caso imagemUrl já foi persistida.
    if (!opts?.skipOrphanCleanup && imagemUrl && imagemUrl !== imagemUrlAnterior)
      removerLogoFilial(imagemUrl).catch(() => {});
    setShowForm(false);
    setEditItem(null);
    setForm({ nome: '', cnpj: '', cidade: '' });
    setExtras({ celular: '', endereco: '', representante: '' });
    setDetalhes({
      nicho: '',
      tamanhoM2: '', tipoImovel: '', valorAluguel: '', vagas: '',
      capacidade: '', horarioFuncionamento: '', dataInauguracao: '', investimentoInicial: '',
      folhaPagamento: '',
      ...equipZeros(),
      ...equipPrecoZeros(),
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
      // Nicho da filial aberta (ver `nichoDoForm`). Só uma filial nova herda
      // o nicho do topbar — salvar a SuperMax a partir da Matriz não pode
      // reescrever o nicho dela.
      const nicho = nichoDoForm;
      // `detalhes` continua sendo gravado (migr. 509/Fase 2) para não quebrar
      // quem ainda lê as chaves fixas — mas espelhado a partir da lista de
      // itens (filial_investimentos), que é a fonte da verdade agora. O
      // espelho e os totais vêm de `espelhoInvestimento`, o mesmo que o
      // rodapé do formulário mostra. Investimento inicial fica de fora — é
      // entrada manual separada (aporte de abertura).
      const { equipPayload, precoPayload } = espelhoInvestimento;
      const valorTotalEquipamentos = espelhoInvestimento.equipamentos;
      const valorAluguel           = espelhoInvestimento.aluguel;
      const folhaPagamento         = espelhoInvestimento.folha;
      const valorTotalInvestido    = espelhoInvestimento.total;
      const detalhesPayload = {
        nicho,
        tamanhoM2: num(detalhes.tamanhoM2),
        tipoImovel: detalhes.tipoImovel || null,
        valorAluguel: valorAluguel > 0 ? valorAluguel : null,
        vagas: num(detalhes.vagas),
        capacidade: num(detalhes.capacidade),
        horarioFuncionamento: detalhes.horarioFuncionamento || null,
        dataInauguracao: detalhes.dataInauguracao || null,
        investimentoInicial: detalhes.investimentoInicial ? parseBRL(detalhes.investimentoInicial) : null,
        folhaPagamento: folhaPagamento > 0 ? folhaPagamento : null,
        valorTotalEquipamentos: valorTotalEquipamentos > 0 ? valorTotalEquipamentos : null,
        valorTotalInvestido: valorTotalInvestido > 0 ? valorTotalInvestido : null,
        ...equipPayload,
        ...precoPayload,
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
      closeForm({ skipOrphanCleanup: true });
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

  // Fase 2 do plano de desembolso da montagem de filial (migr. 509): o total
  // passa a somar da lista de itens (filial_investimentos), não das chaves
  // fixas de `detalhes`. Cada item persiste na hora (não espera o Salvar da
  // filial) — é o que dá o botão "Gerar contas a pagar" da Fase 3 algo
  // estável pra ler depois.
  const valorNum = (v: string) => { const n = parseBRL(v || '0'); return Number.isFinite(n) ? n : 0; };

  // Espelho de `detalhes` + totais, num lugar só: é o que o Salvar grava e o
  // que o rodapé do formulário mostra. Chave de grade sem item usa o valor
  // que já estava em `detalhes` — filial ainda não importada não pode ser
  // zerada pelo simples ato de salvar (e sem qtd > 0 o botão "Importar de
  // Detalhes" some, deixando o dado velho inalcançável).
  const espelhoInvestimento = useMemo(() => {
    const num = (v: string) => v !== '' && v != null ? Number(v) : null;
    const chaves = CAMPOS_NICHO[nichoDoForm].map(([k]) => k);
    const itensGrade = (itens ?? []).filter((i: any) => i.origem_campo === 'grade');
    const equipPayload: Record<string, number | null> = {};
    const precoPayload: Record<string, number | null> = {};
    let totalGrade = 0;
    for (const k of chaves) {
      const it = itensGrade.find((i: any) => i.chave === k);
      const qtd   = it ? Number(it.quantidade)     : num(detalhes[k]);
      const preco = it ? Number(it.preco_unitario) : (detalhes[precoKey(k)] ? parseBRL(detalhes[precoKey(k)]) : null);
      equipPayload[k] = qtd;
      precoPayload[precoKey(k)] = preco;
      totalGrade += Number(qtd ?? 0) * Number(preco ?? 0);
    }
    const totalCustom = (cats: string[]) => (itens ?? [])
      .filter((i: any) => i.origem_campo === 'customizado' && cats.includes(i.categoria))
      .reduce((acc: number, i: any) => acc + Number(i.valor_total ?? 0), 0);
    const totalAluguelItens = (itens ?? [])
      .filter((i: any) => i.categoria === 'aluguel')
      .reduce((acc: number, i: any) => acc + Number(i.valor_total ?? 0), 0);
    const aluguelLegado = detalhes.tipoImovel === 'Alugado' && detalhes.valorAluguel
      ? parseBRL(detalhes.valorAluguel) : 0;
    const equipamentos = totalGrade + totalCustom(['equipamento']);
    const aluguel      = totalAluguelItens > 0 ? totalAluguelItens : aluguelLegado;
    const outros       = totalCustom(['outro']);
    const folha        = detalhes.folhaPagamento ? parseBRL(detalhes.folhaPagamento) : 0;
    return {
      equipPayload, precoPayload, equipamentos, aluguel, outros, folha,
      total: equipamentos + aluguel + outros + folha,
    };
  }, [itens, detalhes, nichoDoForm]);

  const itemJaNaLista = (chave: string) => (itens ?? []).some((i: any) => i.chave === chave);

  const handleAddItemGrade = async (chave: string, rotulo: string) => {
    if (!editItem?.id || itemJaNaLista(chave)) return;
    try {
      await dbInsert('/api/filialinvestimentosview', {
        filial_id: editItem.id, filial: nichoDoForm, chave, rotulo,
        origem_campo: 'grade', categoria: 'equipamento', quantidade: 1, preco_unitario: 0,
      });
      reloadItens();
    } catch (err: any) {
      showToast(`Erro ao adicionar item: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const handleAddItemCustom = async () => {
    if (!editItem?.id) return;
    try {
      await dbInsert('/api/filialinvestimentosview', {
        filial_id: editItem.id, filial: nichoDoForm, chave: `custom_${Date.now()}`, rotulo: '',
        origem_campo: 'customizado', categoria: 'outro', quantidade: 1, preco_unitario: 0,
      });
      reloadItens();
    } catch (err: any) {
      showToast(`Erro ao adicionar item: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const handleUpdateItem = async (id: string, patch: Record<string, any>) => {
    try {
      await dbUpdate('/api/filialinvestimentosview', id, patch);
      reloadItens();
    } catch (err: any) {
      showToast(`Erro ao atualizar item: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const handleRemoveItem = async (item: any) => {
    if (item.conta_pagar_id) {
      showToast('Este item já gerou uma conta a pagar — desvincule antes de remover.', 'error', true);
      return;
    }
    if (!await confirm(`Remover "${item.rotulo}" da lista de investimento?`)) return;
    try {
      await dbDelete('/api/filialinvestimentosview', item.id);
      reloadItens();
    } catch (err: any) {
      showToast(`Erro ao remover item: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  // Migração de dados (uma vez por filial): converte o que já estava em
  // `detalhes` (chaves fixas + aluguel) em linhas de filial_investimentos.
  // `detalhes` continua sendo gravado depois disso — não quebra quem o lê.
  const handleImportarParaItens = async () => {
    if (!editItem?.id) return;
    const d = editItem.detalhes ?? {};
    const nichoItem = nichoDoForm;
    const rows: any[] = [];
    for (const [chave, rotulo] of CAMPOS_NICHO[nichoItem]) {
      const qtd = Number(d[chave] || 0);
      if (qtd > 0) {
        rows.push({
          filial_id: editItem.id, filial: nichoItem, chave, rotulo,
          origem_campo: 'grade', categoria: 'equipamento',
          quantidade: qtd, preco_unitario: Number(d[precoKey(chave)] || 0),
        });
      }
    }
    if (d.tipoImovel === 'Alugado' && Number(d.valorAluguel) > 0) {
      rows.push({
        filial_id: editItem.id, filial: nichoItem, chave: 'aluguel', rotulo: 'Aluguel',
        origem_campo: 'customizado', categoria: 'aluguel',
        quantidade: 1, preco_unitario: Number(d.valorAluguel),
      });
    }
    if (rows.length === 0) {
      showToast('Nada em Detalhes para importar.', 'info', true);
      return;
    }
    setIsSaving(true);
    try {
      await Promise.all(rows.map(r => dbInsert('/api/filialinvestimentosview', r)));
      reloadItens();
      showToast(`${rows.length} item(ns) importado(s).`, 'success', true);
    } catch (err: any) {
      showToast(`Erro ao importar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  // Fase 3: "Gerar contas a pagar" — nunca automático, é botão explícito.
  const [gerarAberto, setGerarAberto] = useState(false);
  const [gerando, setGerando]         = useState(false);
  const [gerarForm, setGerarForm] = useState({
    dataVencimento: '', diaAluguel: '10', parcelasAluguel: '1', naturezaOutro: 'despesa',
  });
  const itensPendentes = (itens ?? []).filter((i: any) => !i.conta_pagar_id && Number(i.valor_total) > 0);
  const temPendenteAluguel = itensPendentes.some((i: any) => i.categoria === 'aluguel');
  const temPendenteOutro   = itensPendentes.some((i: any) => i.categoria === 'outro');

  const handleGerarContas = async () => {
    if (!editItem?.id || !supabase) return;
    if (!gerarForm.dataVencimento) {
      showToast('Informe a data de vencimento.', 'error', true);
      return;
    }
    setGerando(true);
    try {
      const { data: res, error } = await supabase.rpc('gerar_contas_da_montagem', {
        p_filial_id:              editItem.id,
        p_data_vencimento:        gerarForm.dataVencimento,
        p_dia_vencimento_aluguel: temPendenteAluguel ? Number(gerarForm.diaAluguel) || null : null,
        p_parcelas_aluguel:       Number(gerarForm.parcelasAluguel) || 1,
        p_natureza_outro:         gerarForm.naturezaOutro,
      });
      if (error) throw new Error(error.message);
      const r = (res ?? {}) as any;
      showToast(`${r.itens_gerados ?? 0} conta(s) gerada(s), ${r.itens_pulados ?? 0} já existente(s)/vazio(s).`, 'success', true);
      reloadItens();
      setGerarAberto(false);
    } catch (err: any) {
      showToast(`Erro ao gerar contas: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setGerando(false);
    }
  };

  const handleDesvincular = async (item: any) => {
    if (!supabase) return;
    if (!await confirm(`Desvincular "${item.rotulo}"? A conta gerada é CANCELADA (não apagada).`)) return;
    try {
      const { error } = await supabase.rpc('desvincular_investimento_conta', { p_item_id: item.id });
      if (error) throw new Error(error.message);
      showToast('Desvinculado — conta cancelada.', 'success', true);
      reloadItens();
    } catch (err: any) {
      showToast(`Erro ao desvincular: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            Gestão de Filiais {filialAtiva === null ? '— Matriz (consolidado)' : `— ${nichoAtivo}`}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {filialAtiva === null
              ? 'Consolidado das 4 unidades. Troque para uma filial no topbar para ver apenas ela.'
              : <>Você está vendo apenas as unidades de <span className="text-accent font-bold">{nichoAtivo}</span>. Troque de unidade no topbar para ver outras.</>}
          </p>
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
          {canCreate && (
            <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}>
              <Plus size={16} /> Novo
            </NeuButtonAccent>
          )}
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
                      JPG, PNG, WEBP ou SVG — até <span className="font-bold text-gray-300">{FILIAL_LOGO_MAX_LABEL}</span>.
                      Raster é comprimido para WebP 512 px automaticamente; SVG sobe inalterado. Sem logo, exibe ícone padrão.
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
                      onChange={e => setDetalhes(d => ({ ...d, tipoImovel: e.target.value }))}>
                      <option value="">Selecione...</option>
                      <option value="Próprio">Próprio</option>
                      <option value="Alugado">Alugado</option>
                    </select>
                  </FormField>
                  {detalhes.tipoImovel === 'Alugado' && (
                    <div className="md:col-span-2 lg:col-span-3 text-xs text-gray-500 -mt-1">
                      O valor do aluguel agora entra como item da lista de investimento
                      abaixo (categoria "Aluguel") — é o que vira parcela mensal na Fase 3.
                    </div>
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
                  <FormField label="Funcionários — Valor total da folha de pagamento">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm" type="text" inputMode="numeric" value={detalhes.folhaPagamento}
                      onChange={e => setDetalhes(d => ({ ...d, folhaPagamento: formatBRL(e.target.value) }))}
                      onKeyDown={handleMoneyKeyDown}
                      placeholder="R$ 0,00" />
                  </FormField>
                </div>
              </div>

              {/* Investimento item a item (migr. 509, Fase 2) — cada linha é uma
                  filial_investimentos amarrada a esta filial. Só existe depois
                  que a filial tem id (salva ao menos uma vez). */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                  <Package size={12} /> Investimento — Item a Item <span className="text-accent">· {nichoDoForm}</span>
                </p>

                {!editItem ? (
                  <div className="neu-pressed rounded-xl p-4 text-xs text-gray-500">
                    Salve a filial primeiro — os itens de investimento se amarram a ela.
                  </div>
                ) : (
                  <>
                    {(itens ?? []).length === 0 && CAMPOS_NICHO[nichoDoForm]
                      .some(([k]) => Number(editItem.detalhes?.[k] || 0) > 0) && (
                      <button type="button" onClick={handleImportarParaItens}
                        className="neu-button py-2 px-4 rounded-xl text-xs text-accent mb-3">
                        Importar de Detalhes (uma vez)
                      </button>
                    )}

                    <div className="flex flex-wrap gap-2 mb-3">
                      {CAMPOS_NICHO[nichoDoForm].filter(([k]) => !itemJaNaLista(k)).map(([k, label]) => (
                        <button type="button" key={k} onClick={() => handleAddItemGrade(k, label)}
                          className="neu-button py-1.5 px-3 rounded-lg text-[11px] text-gray-400 hover:text-accent">
                          + {label}
                        </button>
                      ))}
                      <button type="button" onClick={handleAddItemCustom}
                        className="neu-button py-1.5 px-3 rounded-lg text-[11px] text-accent font-bold">
                        <Plus size={11} className="inline -mt-0.5 mr-1" /> Adicionar item
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      {(itens ?? []).map((item: any) => (
                        <div key={item.id + '_' + item.updated_at} className="flex flex-col gap-1.5">
                        <div className="neu-pressed rounded-xl p-3 border border-white/5 grid grid-cols-2 md:grid-cols-6 gap-2 items-center">
                          {item.origem_campo === 'customizado' ? (
                            <input className="neu-input py-2 px-3 rounded-lg text-sm col-span-2"
                              defaultValue={item.rotulo}
                              onBlur={e => { const v = e.target.value.trim(); if (v && v !== item.rotulo) handleUpdateItem(item.id, { rotulo: v }); }}
                              placeholder="Rótulo do item" />
                          ) : (
                            <span className="text-xs text-gray-300 col-span-2 truncate" title={item.rotulo}>{item.rotulo}</span>
                          )}
                          {item.origem_campo === 'customizado' ? (
                            <select className="neu-input py-2 px-2 rounded-lg text-xs" value={item.categoria}
                              onChange={e => handleUpdateItem(item.id, { categoria: e.target.value })}>
                              <option value="outro">Outro</option>
                              <option value="equipamento">Equipamento</option>
                              <option value="aluguel">Aluguel</option>
                            </select>
                          ) : (
                            <span className="text-[10px] text-gray-500 uppercase tracking-wide">Equipamento</span>
                          )}
                          <input className="neu-input py-2 px-2 rounded-lg text-sm" type="number" min="0" step="0.01"
                            defaultValue={item.quantidade}
                            onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== Number(item.quantidade)) handleUpdateItem(item.id, { quantidade: v }); }}
                            title="Quantidade" />
                          <input className="neu-input py-2 px-2 rounded-lg text-sm" type="text" inputMode="numeric"
                            defaultValue={formatBRL(item.preco_unitario)}
                            onKeyDown={handleMoneyKeyDown}
                            onBlur={e => { const v = valorNum(e.target.value); if (v !== Number(item.preco_unitario)) handleUpdateItem(item.id, { preco_unitario: v }); }}
                            title="Preço unitário" />
                          <select className="neu-input py-2 px-2 rounded-lg text-xs" value={item.centro_custo_id ?? ''}
                            onChange={e => handleUpdateItem(item.id, { centro_custo_id: e.target.value || null })}>
                            <option value="">Centro de custo...</option>
                            {(centrosCusto ?? []).map((cc: any) => (
                              <option key={cc.id} value={cc.id}>{cc.nome}</option>
                            ))}
                          </select>
                          <div className="flex items-center justify-between col-span-2 md:col-span-1">
                            <span className="text-xs font-bold text-gray-300 tabular-nums">R$ {formatBRL(item.valor_total)}</span>
                            <button type="button" onClick={() => handleRemoveItem(item)}
                              disabled={!!item.conta_pagar_id}
                              title={item.conta_pagar_id ? 'Conta já gerada — desvincule antes de remover' : 'Remover'}
                              className="action-btn-delete disabled:opacity-30 disabled:cursor-not-allowed">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        {item.conta_pagar_id && (
                          <div className="flex items-center justify-between px-3 text-[10px] text-gray-500">
                            <span>Conta gerada em {new Date(item.updated_at).toLocaleDateString('pt-BR')} por R$ {formatBRL(item.valor_total)}</span>
                            <button type="button" onClick={() => handleDesvincular(item)}
                              className="text-accent hover:underline">Desvincular</button>
                          </div>
                        )}
                        </div>
                      ))}
                      {(itens ?? []).length === 0 && (
                        <p className="text-xs text-gray-500 py-2">Nenhum item ainda — use os atalhos acima ou "Adicionar item".</p>
                      )}
                    </div>

                    {itensPendentes.length > 0 && (
                      <div className="mt-3">
                        {!gerarAberto ? (
                          <button type="button" onClick={() => setGerarAberto(true)}
                            className="neu-button py-2 px-4 rounded-xl text-xs text-accent font-bold flex items-center gap-1.5">
                            <Wallet size={12} /> Gerar contas a pagar ({itensPendentes.length} pendente{itensPendentes.length > 1 ? 's' : ''})
                          </button>
                        ) : (
                          <div className="neu-pressed rounded-xl p-4 flex flex-col gap-3 border border-accent/20">
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                              Gerar {itensPendentes.length} conta(s) a pagar
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <FormField label="Vencimento (equipamento/outro)">
                                <input className="neu-input py-2 px-3 rounded-xl text-sm" type="date"
                                  value={gerarForm.dataVencimento}
                                  onChange={e => setGerarForm(f => ({ ...f, dataVencimento: e.target.value }))} />
                              </FormField>
                              {temPendenteAluguel && (
                                <>
                                  <FormField label="Dia do vencimento do aluguel">
                                    <input className="neu-input py-2 px-3 rounded-xl text-sm" type="number" min="1" max="28"
                                      value={gerarForm.diaAluguel}
                                      onChange={e => setGerarForm(f => ({ ...f, diaAluguel: e.target.value }))} />
                                  </FormField>
                                  <FormField label="Parcelas do aluguel">
                                    <input className="neu-input py-2 px-3 rounded-xl text-sm" type="number" min="1"
                                      value={gerarForm.parcelasAluguel}
                                      onChange={e => setGerarForm(f => ({ ...f, parcelasAluguel: e.target.value }))} />
                                  </FormField>
                                </>
                              )}
                              {temPendenteOutro && (
                                <FormField label='Natureza dos itens "Outro"'>
                                  <select className="neu-input py-2 px-3 rounded-xl text-sm" value={gerarForm.naturezaOutro}
                                    onChange={e => setGerarForm(f => ({ ...f, naturezaOutro: e.target.value }))}>
                                    <option value="despesa">Despesa</option>
                                    <option value="imobilizado">Imobilizado (bem)</option>
                                    <option value="estoque">Estoque</option>
                                  </select>
                                </FormField>
                              )}
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button type="button" onClick={() => setGerarAberto(false)}
                                className="neu-button py-2 px-4 rounded-xl text-xs text-gray-400">Cancelar</button>
                              <NeuButtonAccent onClick={handleGerarContas} isLoading={gerando}>
                                Gerar
                              </NeuButtonAccent>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                <div className="neu-flat rounded-xl p-4 mt-4 border border-accent/20 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>Equipamentos & mobiliário</span>
                    <span className="tabular-nums">R$ {formatBRL(espelhoInvestimento.equipamentos)}</span>
                  </div>
                  {espelhoInvestimento.aluguel > 0 && (
                    <div className="flex items-center justify-between text-[11px] text-gray-500">
                      <span>Aluguel</span>
                      <span className="tabular-nums">R$ {formatBRL(espelhoInvestimento.aluguel)}</span>
                    </div>
                  )}
                  {espelhoInvestimento.outros > 0 && (
                    <div className="flex items-center justify-between text-[11px] text-gray-500">
                      <span>Outros itens</span>
                      <span className="tabular-nums">R$ {formatBRL(espelhoInvestimento.outros)}</span>
                    </div>
                  )}
                  {detalhes.folhaPagamento && (
                    <div className="flex items-center justify-between text-[11px] text-gray-500">
                      <span>Folha de pagamento</span>
                      <span className="tabular-nums">R$ {detalhes.folhaPagamento}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Valor total investido</span>
                    <span className="text-lg font-black text-accent tabular-nums">R$ {formatBRL(espelhoInvestimento.total)}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={() => closeForm()} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
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
                {(item.detalhes?.valorAluguel != null || item.detalhes?.investimentoInicial != null
                  || item.detalhes?.folhaPagamento != null || item.detalhes?.valorTotalEquipamentos != null) && (
                  <div className="flex items-start gap-2 text-xs text-gray-400">
                    <Wallet size={11} className="text-gray-500 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-0.5">
                      {item.detalhes.valorAluguel != null && <span>Aluguel: R$ {formatBRL(item.detalhes.valorAluguel)}</span>}
                      {item.detalhes.folhaPagamento != null && <span>Folha de pagamento: R$ {formatBRL(item.detalhes.folhaPagamento)}</span>}
                      {item.detalhes.investimentoInicial != null && <span>Investimento inicial: R$ {formatBRL(item.detalhes.investimentoInicial)}</span>}
                      {item.detalhes.valorTotalEquipamentos != null && <span>Equip. & mobiliário: R$ {formatBRL(item.detalhes.valorTotalEquipamentos)}</span>}
                      {item.detalhes.valorTotalInvestido != null && (
                        <span className="text-accent font-bold">Total investido: R$ {formatBRL(item.detalhes.valorTotalInvestido)}</span>
                      )}
                    </div>
                  </div>
                )}
                {(() => {
                  const d = item.detalhes ?? {};
                  const nichoItem = detectarNicho(d.nicho, item.nome);
                  const paresRelevantes = nichoItem ? CAMPOS_NICHO[nichoItem] : [];
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
                <HistoricoOperacoes entidade="filiais" entidadeId={item.id} titulo={item.nome} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                {canEditRow(item) && (
                  <button onClick={() => openEdit(item)} className="action-btn-edit"><Edit2 size={12} /></button>
                )}
                {canDeleteRow(item) && (
                  <button onClick={() => handleDelete(item.id, item.imagem_url)} className="action-btn-delete"><Trash2 size={12} /></button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
