import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Tag } from 'lucide-react';
import { useFilial } from '../contexts/FilialContext';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';
import { MatrizConsolidado } from '../components/MatrizConsolidado';
import { BotaoModeloPlanilha } from '../components/BotaoModeloPlanilha';
import { ImagemUploader, LogoCadastro } from '../components/ImagemCadastro';
import { uploadImagem, removerImagem, CADASTRO_IMAGEM_BUCKET } from '../lib/imagemCadastro';
import { lerCadastroDaCotacao, esquecerCadastroDaCotacao } from '../lib/cadastroDaCotacao';
import { NATUREZAS_SERVICO, NATUREZA_LABEL, NATUREZA_AJUDA, NATUREZA_VALOR_LABEL,
         normalizarNatureza, ehContratado } from '../lib/naturezaServico';

type AtributoDef = {
  key: string;
  label: string;
  placeholder?: string;
  req?: boolean;
  type?: 'text' | 'number' | 'select' | 'bool';
  options?: readonly string[];
  wide?: boolean;
};

// Atributos JSONB por nicho — dirige o form de serviços.
// MaxLook (moda): ajustes e customização de peças.
// TechMax (eletrônico): assistência técnica é metade do negócio, então tem
// mais campos (categoria da OS, tempo, marca, garantia).
// SuperMax: mantém genérico — supermercado presta pouco serviço.
const ATRIBUTOS_SERVICO: Record<string, AtributoDef[]> = {
  MaxLook: [
    { key: 'categoria_svc', label: 'Categoria *', type: 'select', req: true,
      options: ['Ajuste de barra', 'Bainha', 'Costura', 'Personalização', 'Lavagem', 'Outro'] as const },
    { key: 'tempo_estimado_min', label: 'Tempo estimado (min)', type: 'number', placeholder: 'Ex: 30' },
    { key: 'garantia_dias', label: 'Garantia (dias)', type: 'number', placeholder: 'Ex: 30' },
  ],
  TechMax: [
    // Taxonomia padrão (migr. 629): serviço de assistência não é categoria de
    // PRODUTO — as categorias dele vivem aqui. A 629 levou os valores antigos
    // (Formatação, Software → "Formatação e instalação de software";
    // Instalação → "Configuração").
    { key: 'categoria_svc', label: 'Categoria *', type: 'select', req: true,
      options: ['Diagnóstico', 'Troca de tela', 'Troca de bateria', 'Reparo de conector', 'Reparo de placa',
                'Manutenção e limpeza', 'Formatação e instalação de software', 'Recuperação de dados',
                'Configuração', 'Orientação técnica', 'Outro'] as const },
    { key: 'tempo_estimado_min', label: 'Tempo estimado (min)', type: 'number', placeholder: 'Ex: 120' },
    { key: 'marcas_atendidas', label: 'Marcas atendidas', placeholder: 'Ex: Apple, Samsung, Motorola' },
    { key: 'garantia_dias', label: 'Garantia do serviço (dias) *', type: 'number', placeholder: 'Ex: 90', req: true },
    { key: 'requer_peca', label: 'Serviço requer peça de reposição', type: 'bool', wide: true },
  ],
  // SuperMax presta pouco serviço, mas o que presta (entrega, corte no açougue,
  // montagem de cesta) tem duração — e sem campo de tempo o serviço só cabia na
  // descrição, onde nenhuma tela consegue ler.
  SuperMax: [
    { key: 'tempo_estimado_min', label: 'Tempo estimado (min)', type: 'number', placeholder: 'Ex: 15' },
  ],
};

const EMPTY_FORM = {
  codigo: '',
  nome: '',
  // Migr. 516: quem presta. Nasce 'prestado' porque é o que a tela sempre foi.
  natureza: 'prestado' as string,
  tipo: '',
  valor: '',
  status: 'Ativo',
  imagem_url: '',
  atributos: {} as Record<string, any>,
};

export const ServicosView = ({ showToast, onNavigate }: { showToast: any; onNavigate?: (view: string) => void }) => {
  const { filialAtiva } = useFilial();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  // Arquivo escolhido mas ainda não enviado — sobe só no save.
  const [imagemFile, setImagemFile] = useState<File | null>(null);

  // Escopo de unidade: `auth_pode_filial()` deixa admin, CEO e conselheiro
  // passarem em todas as filiais, então a RLS sozinha não basta — quem opera
  // dentro de uma unidade via catálogo/cadastro de outra.
  const { data: rawData, setData, isLoading } = useFetchData<any>('/api/servicosview', filialAtiva ? { filial: filialAtiva } : undefined);

  // Chegou pelo "Cadastrar serviço" das Cotações (migr. 628): o formulário
  // abre já como contratado e com o NOME DA REQUISIÇÃO, porque é pelo nome
  // idêntico que o pedido reconhece o serviço — o cadastro de serviços não tem
  // campo de origem como o de produtos. Salvo, a tela devolve o comprador às
  // Cotações, onde a linha já aparece pronta para o pedido.
  const nomeDaRequisicaoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!filialAtiva) return;
    const pedido = lerCadastroDaCotacao(filialAtiva, 'servico');
    if (!pedido) return;
    esquecerCadastroDaCotacao();
    nomeDaRequisicaoRef.current = pedido.nome;
    setEditItem(null);
    setForm({ ...EMPTY_FORM, nome: pedido.nome, natureza: 'contratado' });
    setImagemFile(null);
    setErrors({});
    setShowForm(true);
  }, [filialAtiva]);

  const filial = filialAtiva ?? '';
  // Os atributos por nicho são todos do lado da VENDA — garantia ao cliente,
  // marcas atendidas, tempo da OS. Perguntar "garantia do serviço" para uma
  // dedetização contratada é pedir número que ninguém tem. Contratado fica sem
  // seção extra; o que ele precisa (centro de custo, prazo) já vem da
  // requisição e da cotação.
  const atrDefs = useMemo(
    () => ehContratado(form.natureza) ? [] : (ATRIBUTOS_SERVICO[filial] ?? []),
    [filial, form.natureza],
  );

  const data = useMemo(
    () => rawData.filter((s: any) => s.filial === filial || (!s.filial && !filial)),
    [rawData, filial]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((s: any) =>
      [s.nome, s.codigo, s.tipo, s.atributos?.categoria_svc].some((v: any) =>
        String(v ?? '').toLowerCase().includes(q)
      )
    );
  }, [data, search]);

  if (!filialAtiva) {
    return (
      <MatrizConsolidado
        titulo="Serviços"
        descricao="Visão consolidada dos serviços nas 3 filiais."
        endpoint="/api/servicosview"
        colunas={[
          { key: 'codigo', label: 'Código', render: r => <span className="font-mono text-xs text-accent">{r.codigo ?? '—'}</span> },
          { key: 'nome', label: 'Nome', render: r => (
            <span className="flex items-center gap-2">
              <LogoCadastro imagemUrl={r.imagem_url} nome={r.nome} size={24} ajuste="cover" />
              <span className="font-semibold text-gray-100">{r.nome ?? '—'}</span>
            </span>
          ) },
          { key: 'tipo', label: 'Tipo' },
          { key: 'natureza', label: 'Natureza', render: r => NATUREZA_LABEL[normalizarNatureza(r.natureza)] },
          { key: 'valor', label: 'Valor', render: r => r.valor != null ? `R$ ${Number(r.valor).toFixed(2).replace('.', ',')}` : '—' },
          { key: 'status', label: 'Status' },
        ]}
        ordenarPor={(a, b) => String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''))}
      />
    );
  }
  if (isLoading) return <LoadingSpinner />;

  // Mesma normalização de `nome_item_normalizado` no banco (migr. 627).
  const normNome = (t: string) => String(t ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const mesmoNomeDaRequisicao = nomeDaRequisicaoRef.current === null
    || normNome(form.nome) === normNome(nomeDaRequisicaoRef.current);

  const openNew = () => {
    setEditItem(null);
    setForm({ ...EMPTY_FORM });
    setImagemFile(null);
    setErrors({});
    setShowForm(true);
  };

  const handleImagemPreview = (file: File, url: string) => {
    // Libera o blob anterior antes de trocar — senão cada arquivo escolhido
    // fica preso na memória da aba até o reload.
    if (form.imagem_url.startsWith('blob:')) URL.revokeObjectURL(form.imagem_url);
    setImagemFile(file);
    setForm(f => ({ ...f, imagem_url: url }));
  };

  const handleImagemClear = () => {
    if (form.imagem_url.startsWith('blob:')) URL.revokeObjectURL(form.imagem_url);
    setImagemFile(null);
    setForm(f => ({ ...f, imagem_url: '' }));
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    // A TechMax cadastrava em horas, o que não escreve "troca de bateria: 40
    // min". Agora é minuto em todas as unidades; o serviço antigo entra
    // convertido, porque salvar só grava os campos declarados — sem isto o
    // tempo desapareceria na primeira edição.
    const atrs: Record<string, any> =
      (item.atributos && typeof item.atributos === 'object') ? { ...item.atributos } : {};
    if (atrs.tempo_estimado_min == null && atrs.tempo_estimado_horas != null) {
      const h = Number(atrs.tempo_estimado_horas);
      if (Number.isFinite(h) && h > 0) atrs.tempo_estimado_min = Math.round(h * 60);
    }
    setForm({
      codigo: item.codigo ?? '',
      nome:   item.nome   ?? '',
      natureza: normalizarNatureza(item.natureza),
      tipo:   item.tipo   ?? '',
      valor:  item.valor != null ? formatBRL(Number(item.valor)) : '',
      status: item.status ?? 'Ativo',
      imagem_url: item.imagem_url ?? '',
      atributos: atrs,
    });
    setImagemFile(null);
    setErrors({});
    setShowForm(true);
  };

  const closeForm = () => {
    // Cancelar também precisa liberar o blob — só `trocar` e `limpar` faziam
    // isso, então quem escolhia um arquivo e desistia deixava a URL viva.
    if (form.imagem_url.startsWith('blob:')) URL.revokeObjectURL(form.imagem_url);
    setShowForm(false);
    setEditItem(null);
    setForm({ ...EMPTY_FORM });
    setImagemFile(null);
    setErrors({});
    nomeDaRequisicaoRef.current = null;
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.codigo.trim()) e.codigo = 'Obrigatório';
    if (!form.nome.trim())   e.nome   = 'Obrigatório';
    // Preço é obrigatório em quem vende — é o que o cliente paga. No contratado
    // o número vem da cotação; exigir aqui seria pedir chute, o mesmo motivo
    // pelo qual o custo saiu do cadastro de produto (migr. 480/417).
    if (!ehContratado(form.natureza) && !form.valor.trim()) e.valor = 'Obrigatório';
    for (const d of atrDefs) {
      if (!d.req) continue;
      const v = form.atributos?.[d.key];
      if (v === undefined || v === null || String(v).trim() === '') {
        e[`atr_${d.key}`] = 'Obrigatório';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      showToast('Preencha todos os campos obrigatórios.', 'error', true);
      return;
    }
    setIsSaving(true);
    // Fora do try porque o catch precisa saber o que apagar se a linha falhar.
    let imagemNova: string | null = null;
    let voltar = false;
    try {
      // Sobe a imagem antes de gravar: sem URL definitiva não há o que salvar.
      let imagemUrl = form.imagem_url;
      if (imagemFile) {
        imagemUrl = await uploadImagem(CADASTRO_IMAGEM_BUCKET, imagemFile, editItem?.id);
        imagemNova = imagemUrl;
      }
      const imagemAntiga = editItem?.imagem_url ?? '';

      // Filtra atributos apenas com campos declarados na filial atual —
      // evita salvar lixo se filial mudou no meio do fluxo.
      const atributos: Record<string, any> = {};
      for (const d of atrDefs) {
        const v = form.atributos?.[d.key];
        if (v === undefined || v === null || v === '') continue;
        atributos[d.key] = d.type === 'bool' ? !!v : d.type === 'number' ? Number(v) : v;
      }
      const payload: any = {
        codigo: form.codigo,
        nome:   form.nome,
        natureza: normalizarNatureza(form.natureza),
        tipo:   form.tipo || null,
        valor:  parseBRL(form.valor),
        status: form.status,
        imagem_url: imagemUrl || null,
        filial,
        atributos,
      };
      if (editItem) {
        const updated = await dbUpdate('/api/servicosview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Serviço atualizado!', 'success', true);
      } else {
        const saved = await dbInsert<any>('/api/servicosview', payload);
        if (saved) setData((prev: any[]) => [saved, ...prev]);
        voltar = nomeDaRequisicaoRef.current !== null && !!onNavigate;
        showToast(voltar
          ? (mesmoNomeDaRequisicao
              ? 'Serviço cadastrado. De volta às Cotações — a requisição já está na aba "Gerar pedidos", pronta para o pedido.'
              : 'Serviço cadastrado, mas com nome diferente do da requisição — em Cotações ela continua como não cadastrada.')
          : 'Serviço cadastrado!', voltar && !mesmoNomeDaRequisicao ? 'error' : 'success', true);
      }
      // A imagem antiga só sai depois que a linha confirmou a nova.
      if (imagemAntiga && imagemAntiga !== imagemUrl) {
        removerImagem(CADASTRO_IMAGEM_BUCKET, imagemAntiga);
      }
      closeForm();
      if (voltar) onNavigate?.('compras-cotações');
    } catch (err: any) {
      if (imagemNova) removerImagem(CADASTRO_IMAGEM_BUCKET, imagemNova);
      showToast(err?.message ?? 'Erro ao salvar.', 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, nome: string) => {
    const ok = await confirm({
      message: `Excluir o serviço "${nome}"? Essa ação é permanente.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await dbDelete('/api/servicosview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Serviço excluído.', 'success', true);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao excluir.', 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Serviços — {filial}</h2>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <BotaoModeloPlanilha entidade="servicos" filial={filial} showToast={showToast} />
          <NeuButtonAccent onClick={openNew}><Plus size={14} /> Novo serviço</NeuButtonAccent>
        </div>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input className="neu-input py-2 pl-9 pr-3 rounded-xl text-sm w-full"
          placeholder="Buscar por nome, código, categoria..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message={`Nenhum serviço cadastrado para ${filial}. Clique em "Novo serviço" para começar.`} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s: any) => (
            <motion.div key={s.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                {/* Imagem do serviço, ou as iniciais sobre uma cor derivada do
                    nome. O card era só texto: numa grade de doze, achar "troca
                    de bateria" exigia ler os doze. */}
                <LogoCadastro imagemUrl={s.imagem_url} nome={s.nome} size={44} ajuste="cover" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono font-bold text-gray-500 uppercase tracking-widest">{s.codigo}</span>
                    <StatusBadge status={s.status} />
                    {ehContratado(s.natureza) && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 neu-pressed rounded-md px-1.5 py-0.5"
                        title="Serviço que a unidade contrata de terceiro — entra em pedido de compra, não em venda.">
                        Contratado
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-gray-100 mt-1 leading-tight">{s.nome}</p>
                  {s.atributos?.categoria_svc && (
                    <p className="text-[11px] text-accent font-bold mt-1 uppercase tracking-wider">
                      {s.atributos.categoria_svc}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(s)} className="action-btn-edit"><Edit2 size={12} /></button>
                  <button onClick={() => handleDelete(s.id, s.nome)} className="action-btn-delete"><Trash2 size={12} /></button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
                {s.atributos?.tempo_estimado_min && <span>⏱ {s.atributos.tempo_estimado_min} min</span>}
                {s.atributos?.tempo_estimado_horas && <span>⏱ {s.atributos.tempo_estimado_horas} h</span>}
                {s.atributos?.marcas_atendidas && <span>🏷 {s.atributos.marcas_atendidas}</span>}
                {s.atributos?.garantia_dias && <span>🛡 {s.atributos.garantia_dias} dias</span>}
                {s.atributos?.requer_peca && <span>🔩 requer peça</span>}
              </div>
              <div className="flex items-end justify-between mt-1 pt-2 border-t border-white/5">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  {ehContratado(s.natureza) ? 'Custo ref.' : 'Preço'}
                </span>
                <span className="text-lg font-black text-accent tabular-nums">
                  {Number(s.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}>
            <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
              className="neu-flat rounded-3xl w-full max-w-2xl p-6 flex flex-col gap-4 border border-white/5 max-h-[90vh] overflow-y-auto"
              style={{ background: 'var(--color-bg-base)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-accent">{editItem ? 'Editar serviço' : 'Novo serviço'} — {filial}</h3>
                <button onClick={closeForm} className="text-xs text-gray-500 hover:text-white">Fechar</button>
              </div>

              <div className="flex flex-wrap items-center gap-5">
                <FormField label="Imagem do serviço">
                  <ImagemUploader
                    imagemUrl={form.imagem_url} rotulo="imagem"
                    onPreview={handleImagemPreview} onClear={handleImagemClear} />
                </FormField>
                <div className="flex items-center gap-3 pt-4">
                  <LogoCadastro imagemUrl={form.imagem_url} nome={form.nome} size={44} ajuste="cover" />
                  <p className="text-[10px] text-gray-500 max-w-[16rem] leading-relaxed">
                    Sem imagem, o card usa as iniciais do nome sobre uma cor fixa. Uma foto do
                    serviço pronto ajuda o cliente a entender o que está comprando.
                  </p>
                </div>
              </div>

              {/* A natureza é a PRIMEIRA pergunta, não um detalhe de cadastro:
                  ela decide se o serviço é vendável (preço, garantia, promoção)
                  ou comprável (item de pedido, aceite da execução). Mesma régua
                  do Tipo em Cadastros > Produtos. */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Natureza</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {NATUREZAS_SERVICO.map(n => (
                    <button key={n} type="button"
                      onClick={() => setForm(f => ({ ...f, natureza: n }))}
                      className={`text-left p-3 rounded-xl border transition-colors ${
                        normalizarNatureza(form.natureza) === n
                          ? 'neu-pressed border-accent/40'
                          : 'neu-button border-transparent'}`}>
                      <span className={`block text-xs font-bold ${
                        normalizarNatureza(form.natureza) === n ? 'text-accent' : 'text-gray-300'}`}>
                        {NATUREZA_LABEL[n]}
                      </span>
                      <span className="block text-[10px] text-gray-500 leading-snug mt-1">
                        {NATUREZA_AJUDA[n]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Código *" error={errors.codigo}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.codigo ? 'border border-red-500/40' : ''}`}
                    value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                    placeholder={filial === 'TechMax' ? 'Ex: SRV-TL-001' : filial === 'MaxLook' ? 'Ex: SRV-AJ-001' : 'Ex: SRV-001'} />
                </FormField>
                <FormField label="Nome do serviço *" error={errors.nome}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`}
                    value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder={filial === 'TechMax' ? 'Ex: Troca de tela iPhone 12' : filial === 'MaxLook' ? 'Ex: Ajuste de bainha calça jeans' : 'Ex: Instalação'} />
                  {nomeDaRequisicaoRef.current !== null && (
                    <p className={`text-[10px] mt-1 leading-snug ${mesmoNomeDaRequisicao ? 'text-gray-500' : 'text-amber-300'}`}>
                      {mesmoNomeDaRequisicao
                        ? 'Veio da requisição. Mantenha este nome: é por ele que o pedido reconhece o serviço.'
                        : `O nome mudou. O pedido só reconhece o serviço com o nome da requisição: “${nomeDaRequisicaoRef.current}”. Se ela está escrita errado, devolva-a para correção.`}
                    </p>
                  )}
                </FormField>
                <FormField label={NATUREZA_VALOR_LABEL[normalizarNatureza(form.natureza)]} error={errors.valor}>
                  <input type="text" inputMode="numeric" onKeyDown={handleMoneyKeyDown}
                    className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${errors.valor ? 'border border-red-500/40' : ''}`}
                    value={form.valor} onChange={e => setForm(f => ({ ...f, valor: formatBRL(parseBRL(e.target.value)) }))}
                    placeholder="0,00" />
                </FormField>
                <FormField label="Status">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    <option value="Ativo">Ativo</option>
                    <option value="Inativo">Inativo</option>
                  </select>
                </FormField>
              </div>

              {/* Atributos nicho — MaxLook e TechMax. SuperMax fica sem seção extra. */}
              {atrDefs.length > 0 && (
                <div className="mt-2 pt-4 border-t border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Tag size={12} className="text-accent" />
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      {filial === 'MaxLook' ? 'Detalhes do serviço (Ateliê)'
                        : filial === 'TechMax' ? 'Detalhes da OS (Assistência)'
                        : 'Detalhes do serviço'}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {atrDefs.map(d => {
                      const errKey = `atr_${d.key}`;
                      const err = errors[errKey];
                      const val = form.atributos?.[d.key] ?? '';
                      const setAtr = (v: any) => {
                        setForm(f => ({ ...f, atributos: { ...(f.atributos ?? {}), [d.key]: v } }));
                        setErrors(ev => ({ ...ev, [errKey]: '' }));
                      };
                      if (d.type === 'bool') {
                        return (
                          <label key={d.key}
                            className={`flex items-center gap-3 cursor-pointer neu-flat rounded-xl px-4 py-3 border border-white/5 ${d.wide ? 'sm:col-span-2' : ''}`}>
                            <input type="checkbox" checked={!!val}
                              onChange={e => setAtr(e.target.checked)}
                              className="accent-accent w-4 h-4" />
                            <span className="text-xs font-bold text-gray-200">{d.label}</span>
                          </label>
                        );
                      }
                      if (d.type === 'select' && d.options) {
                        return (
                          <FormField key={d.key} label={d.label} error={err}>
                            <select className={`neu-input py-2 px-3 rounded-xl text-sm ${err ? 'border border-red-500/40' : ''}`}
                              value={String(val)} onChange={e => setAtr(e.target.value)}>
                              <option value="">— Selecione —</option>
                              {d.options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </FormField>
                        );
                      }
                      return (
                        <FormField key={d.key} label={d.label} error={err}>
                          <input className={`neu-input py-2 px-3 rounded-xl text-sm ${err ? 'border border-red-500/40' : ''}`}
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

              <div className="flex justify-end gap-3 pt-4">
                <button onClick={closeForm} className="neu-button py-2 px-4 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                  <Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
