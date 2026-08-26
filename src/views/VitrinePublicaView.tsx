import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, ImageOff, Check, Plus, X, ImagePlus, Edit3, Trash2, ArrowUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FormField } from '../components/ui';
import {
  uploadImagemArte, validarImagemArte, avaliarResolucaoArte, removerArteAntiga,
  ARTE_IMAGEM_ACCEPT, ARTE_IMAGEM_OUTPUT_MAX_LABEL,
} from '../lib/arteImagem';

type Candidato = {
  // 'institucional' = peça do professor, sem promoção nem produto (migr. 541).
  tipo: 'arte' | 'produto' | 'institucional';
  id: string;
  titulo: string;
  descricao: string | null;
  imagem_url: string | null;
  imagem_fallback: string | null;  // produto.imagem_url quando arte_url quebrar
  preco_promocional: number | null;
  vitrine_publica: boolean;
  prioridade: number;
  created_at: string;
};

// Formulário da peça institucional. `imagem_url` só existe depois do upload.
type FormInst = {
  id: string | null;
  titulo: string;
  descricao: string;
  imagem_url: string;
  data_inicio: string;
  data_fim: string;
  prioridade: number;
};

const FORM_INST_VAZIO: FormInst = {
  id: null, titulo: '', descricao: '', imagem_url: '',
  data_inicio: '', data_fim: '', prioridade: 0,
};

const formatBRL = (v: number | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export const VitrinePublicaView = ({ showToast, profile }: any) => {
  const [items, setItems] = useState<Candidato[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [aba, setAba] = useState<'tudo' | 'arte' | 'produto' | 'institucional'>('tudo');
  // Teto do carrossel (migr. 539/540). Vem para a tela dizer "12 de 12" e
  // desabilitar o que não cabe — antes ele cortava em silêncio na leitura, e
  // o professor aprovava 20 sem saber que 8 nunca apareceriam.
  const [maxVitrine, setMaxVitrine] = useState<number | null>(null);
  // Só o professor cria peça institucional (migr. 541) — `role='admin'`
  // literal, porque CEO e conselheiro são alunos e essa é a porta que
  // dispensa promoção.
  const ehProfessor = profile?.role === 'admin';
  const [formInst, setFormInst] = useState<FormInst | null>(null);
  const [arqInst, setArqInst] = useState<File | null>(null);
  const [previewInst, setPreviewInst] = useState<string | null>(null);
  const [avisoInst, setAvisoInst] = useState<string | null>(null);
  const [salvandoInst, setSalvandoInst] = useState(false);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('listar_vitrine_candidatos');
    if (error) {
      showToast(`Erro ao carregar candidatos: ${error.message}`, 'error', true);
      setItems([]);
    } else {
      setItems(Array.isArray(data) ? (data as Candidato[]) : []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.from('marketing_config').select('max_vitrine').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data?.max_vitrine) setMaxVitrine(data.max_vitrine); });
  }, []);

  const toggle = async (item: Candidato) => {
    if (!supabase) return;
    const key = `${item.tipo}:${item.id}`;
    const novoEstado = !item.vitrine_publica;

    // Optimistic update — reverte se a RPC falhar.
    setItems(prev => prev.map(x => x.id === item.id && x.tipo === item.tipo ? { ...x, vitrine_publica: novoEstado } : x));
    setSaving(key);

    const { error } = await supabase.rpc('marcar_vitrine', {
      p_tipo:    item.tipo,
      p_id:      item.id,
      p_incluir: novoEstado,
    });

    setSaving(null);
    if (error) {
      setItems(prev => prev.map(x => x.id === item.id && x.tipo === item.tipo ? { ...x, vitrine_publica: item.vitrine_publica } : x));
      showToast(`Erro: ${error.message}`, 'error', true);
      return;
    }
    showToast(novoEstado ? 'Adicionado à vitrine.' : 'Removido da vitrine.', 'success', true);
  };

  const abrirFormInst = (item?: Candidato) => {
    if (!item) { setFormInst({ ...FORM_INST_VAZIO }); setArqInst(null); setPreviewInst(null); setAvisoInst(null); return; }
    // Editar: a RPC de candidatos não devolve datas, então busca a linha.
    void supabase!.from('vitrine_institucional').select('*').eq('id', item.id).maybeSingle()
      .then(({ data }) => {
        setFormInst({
          id: item.id,
          titulo: data?.titulo ?? item.titulo,
          descricao: data?.descricao ?? '',
          imagem_url: data?.imagem_url ?? item.imagem_url ?? '',
          data_inicio: data?.data_inicio ?? '',
          data_fim: data?.data_fim ?? '',
          prioridade: data?.prioridade ?? 0,
        });
        setArqInst(null); setPreviewInst(null); setAvisoInst(null);
      });
  };

  const fecharFormInst = () => {
    if (previewInst) URL.revokeObjectURL(previewInst);
    setFormInst(null); setArqInst(null); setPreviewInst(null); setAvisoInst(null);
  };

  const escolherArqInst = async (file: File | null) => {
    if (previewInst) URL.revokeObjectURL(previewInst);
    if (!file) { setArqInst(null); setPreviewInst(null); setAvisoInst(null); return; }
    const v = validarImagemArte(file);
    if (!v.ok) { setArqInst(null); setPreviewInst(null); showToast(v.motivo, 'error', true); return; }
    setArqInst(file);
    setPreviewInst(URL.createObjectURL(file));
    setAvisoInst(await avaliarResolucaoArte(file));
  };

  const salvarInst = async () => {
    if (!formInst || !supabase) return;
    if (!formInst.titulo.trim()) { showToast('Dê um título à peça.', 'error', true); return; }
    if (!arqInst && !formInst.imagem_url) { showToast('Envie a imagem da peça.', 'error', true); return; }
    setSalvandoInst(true);
    try {
      let url = formInst.imagem_url;
      const urlAntiga = formInst.imagem_url;
      // Só sobe no Salvar — escolher e desistir não pode deixar lixo no bucket.
      if (arqInst) url = await uploadImagemArte(arqInst, 'institucional');

      const payload = {
        titulo: formInst.titulo.trim(),
        descricao: formInst.descricao.trim() || null,
        imagem_url: url,
        data_inicio: formInst.data_inicio || null,
        data_fim: formInst.data_fim || null,
        prioridade: formInst.prioridade,
        atualizado_em: new Date().toISOString(),
      };

      if (formInst.id) {
        const { error } = await supabase.from('vitrine_institucional').update(payload).eq('id', formInst.id);
        if (error) throw error;
        if (arqInst && urlAntiga && urlAntiga !== url) await removerArteAntiga(urlAntiga);
        showToast('Peça atualizada.', 'success', true);
      } else {
        const { error } = await supabase.from('vitrine_institucional').insert({
          ...payload, criado_por: profile?.id ?? null, nome_criador: profile?.nome ?? null,
        });
        if (error) throw error;
        // Nasce FORA da vitrine (default do banco): dá ao professor montar o
        // banner na véspera e ligar na hora da aula.
        showToast('Peça criada. Ligue-a na vitrine quando quiser publicar.', 'success', true);
      }
      fecharFormInst();
      await load();
    } catch (err: any) {
      showToast(`Não foi possível salvar: ${err?.message ?? 'tente novamente'}`, 'error', true);
    }
    setSalvandoInst(false);
  };

  const apagarInst = async (item: Candidato) => {
    if (!supabase) return;
    const { error } = await supabase.from('vitrine_institucional').delete().eq('id', item.id);
    if (error) { showToast(`Não foi possível apagar: ${error.message}`, 'error', true); return; }
    await removerArteAntiga(item.imagem_url);
    setItems(prev => prev.filter(x => !(x.tipo === 'institucional' && x.id === item.id)));
    showToast('Peça apagada.', 'success', true);
  };

  const ativos = items.filter(i => i.vitrine_publica).length;
  // Abas por tipo em vez de um interruptor global "só artes"/"só produtos":
  // o interruptor criaria um estado que mente — o professor liga um produto,
  // não vê aparecer, e não descobre que o modo estava em "só artes". A aba
  // organiza sem inventar regra nova.
  const doTipo = aba === 'tudo' ? items : items.filter(i => i.tipo === aba);
  const naVitrine = doTipo.filter(i => i.vitrine_publica);
  const fora      = doTipo.filter(i => !i.vitrine_publica);
  const cheia     = maxVitrine != null && ativos >= maxVitrine;

  const ABAS: { id: typeof aba; label: string; n: number }[] = [
    { id: 'tudo',          label: 'Tudo',           n: items.length },
    { id: 'arte',          label: 'Artes e Design', n: items.filter(i => i.tipo === 'arte').length },
    { id: 'produto',       label: 'Produtos',       n: items.filter(i => i.tipo === 'produto').length },
    { id: 'institucional', label: 'Institucional',  n: items.filter(i => i.tipo === 'institucional').length },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Vitrine da Tela de Login</h2>
          <p className="text-sm text-gray-400 mt-1">
            Escolha quais artes e produtos passam no carrossel da tela de login.
            <span className="text-gray-500"> Não é a loja online da filial — para publicar produto lá,
            use Vendas → Pedidos Online.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
        {ehProfessor && (
          <NeuButtonAccent variant="" onClick={() => abrirFormInst()}>
            <Plus size={13} /> Nova peça
          </NeuButtonAccent>
        )}
        <div className={`neu-pressed px-4 py-2 rounded-xl text-xs border ${cheia ? 'border-yellow-500/40' : 'border-transparent'}`}>
          <span className="text-gray-500 uppercase tracking-widest font-bold">Na vitrine</span>
          <span className={`ml-3 font-bold text-base ${cheia ? 'text-yellow-400' : 'text-accent'}`}>{ativos}</span>
          <span className="text-gray-500"> / {maxVitrine ?? items.length}</span>
          {cheia && (
            <span className="block text-[10px] text-yellow-400/90 mt-0.5 normal-case tracking-normal">
              Limite atingido — tire um para incluir outro.
            </span>
          )}
        </div>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1 border-b border-white/5">
        {ABAS.map(t => (
          <button key={t.id} type="button" onClick={() => setAba(t.id)}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-colors ${
              aba === t.id ? 'text-accent border-accent' : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}>
            {t.label} <span className="text-gray-600">({t.n})</span>
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : items.length === 0 ? (
        <EmptyState message="Nenhuma arte ou produto com imagem encontrado. Publique uma arte em Promoções ou adicione imagem em um produto." />
      ) : (
        <div className="flex flex-col gap-8 overflow-y-auto main-scrollbar pr-2 pb-6">
          {naVitrine.length > 0 && (
            <Section
              titulo="Em destaque"
              subtitulo="Itens que estão aparecendo no carrossel agora."
              items={naVitrine}
              saving={saving}
              onToggle={toggle}
              onEditar={ehProfessor ? abrirFormInst : undefined}
              onApagar={ehProfessor ? apagarInst : undefined}
            />
          )}
          {fora.length > 0 && (
            <Section
              titulo="Disponíveis"
              subtitulo={cheia
                ? `A vitrine está cheia (${ativos} de ${maxVitrine}). Tire um item de "Em destaque" para liberar vaga.`
                : 'Itens elegíveis para entrar na vitrine.'}
              items={fora}
              saving={saving}
              onToggle={toggle}
              bloqueado={cheia}
              onEditar={ehProfessor ? abrirFormInst : undefined}
              onApagar={ehProfessor ? apagarInst : undefined}
            />
          )}
          {naVitrine.length === 0 && fora.length === 0 && (
            <p className="text-xs text-gray-500 py-8 text-center">
              Nada nesta aba ainda.
            </p>
          )}
        </div>
      )}

      {/* Peça institucional — só o professor (migr. 541). Não pede promoção
          nem produto: forçá-lo a inventar os dois só para pôr um banner na
          tela de login criaria dado falso no catálogo e no DRE. */}
      {formInst && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={fecharFormInst}>
          <div onClick={e => e.stopPropagation()}
            className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg max-h-[90vh] overflow-y-auto main-scrollbar">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-accent" />
                <h3 className="text-sm font-bold text-gray-200">
                  {formInst.id ? 'Editar peça institucional' : 'Nova peça institucional'}
                </h3>
              </div>
              <button onClick={fecharFormInst} className="modal-close-btn"><X size={16} /></button>
            </div>

            <div className="flex flex-col gap-3">
              <FormField label="Título *">
                <input className="neu-input rounded-xl px-3 py-2 text-sm w-full"
                  value={formInst.titulo}
                  onChange={e => setFormInst(f => f && ({ ...f, titulo: e.target.value }))}
                  placeholder="Bem-vindos, turma de Contabilidade" autoFocus />
              </FormField>

              <FormField label="Descrição">
                <input className="neu-input rounded-xl px-3 py-2 text-sm w-full"
                  value={formInst.descricao}
                  onChange={e => setFormInst(f => f && ({ ...f, descricao: e.target.value }))}
                  placeholder="Aparece abaixo do título no carrossel" />
              </FormField>

              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Imagem *</span>
                <div className="mt-1.5 flex items-center gap-3">
                  <label className="neu-button rounded-xl px-3 py-2 text-xs font-bold text-gray-300 hover:text-accent cursor-pointer border border-white/10 flex items-center gap-1.5 shrink-0">
                    <ImagePlus size={13} /> Escolher arquivo
                    <input type="file" accept={ARTE_IMAGEM_ACCEPT} className="hidden"
                      onChange={e => { void escolherArqInst(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  </label>
                  {(previewInst || formInst.imagem_url) ? (
                    <img src={previewInst ?? formInst.imagem_url} alt="Prévia"
                      className="h-14 w-20 rounded-lg object-cover border border-white/10" />
                  ) : (
                    <span className="text-[10px] text-gray-600 leading-snug">
                      JPG, PNG ou WEBP. Reduzida para até {ARTE_IMAGEM_OUTPUT_MAX_LABEL}.
                    </span>
                  )}
                </div>
                {avisoInst && <p className="text-[11px] text-yellow-400 mt-2 leading-relaxed">{avisoInst}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Aparece a partir de">
                  <input type="date" className="neu-input rounded-xl px-3 py-2 text-sm w-full"
                    value={formInst.data_inicio}
                    onChange={e => setFormInst(f => f && ({ ...f, data_inicio: e.target.value }))} />
                </FormField>
                <FormField label="Sai em">
                  <input type="date" className="neu-input rounded-xl px-3 py-2 text-sm w-full"
                    value={formInst.data_fim}
                    onChange={e => setFormInst(f => f && ({ ...f, data_fim: e.target.value }))} />
                </FormField>
              </div>
              <p className="text-[10px] text-gray-600 -mt-1">Datas em branco = sem prazo.</p>

              <FormField label="Prioridade">
                <input type="number" min={0} max={100}
                  className="neu-input rounded-xl px-3 py-2 text-sm w-28"
                  value={formInst.prioridade}
                  onChange={e => setFormInst(f => f && ({ ...f, prioridade: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} />
              </FormField>
              <p className="text-[10px] text-gray-600 -mt-1 leading-relaxed">
                Maior aparece primeiro no carrossel. Arte e produto entram como zero — deixe 0 para
                esta peça entrar no rodízio normal, ou suba para fixá-la no topo.
              </p>

              <div className="flex justify-end gap-2 mt-2">
                <button onClick={fecharFormInst}
                  className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">
                  Cancelar
                </button>
                <NeuButtonAccent variant="" onClick={salvarInst} disabled={salvandoInst}>
                  {salvandoInst ? 'Salvando…' : (formInst.id ? 'Salvar' : 'Criar peça')}
                </NeuButtonAccent>
              </div>
              {!formInst.id && (
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  A peça nasce <span className="text-gray-400">fora da vitrine</span>. Você a liga quando
                  quiser publicar — dá para montar hoje e mostrar na aula.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

function Section({
  titulo, subtitulo, items, saving, onToggle, bloqueado = false, onEditar, onApagar,
}: {
  titulo: string;
  subtitulo: string;
  items: Candidato[];
  saving: string | null;
  onToggle: (item: Candidato) => void;
  /** Vitrine cheia: incluir mais um seria recusado pela RPC (migr. 540). */
  bloqueado?: boolean;
  /** Só para peça institucional, e só para o professor (migr. 541). */
  onEditar?: (item: Candidato) => void;
  onApagar?: (item: Candidato) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-bold text-gray-200">{titulo}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{subtitulo}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {items.map(item => (
          <Card key={`${item.tipo}:${item.id}`} item={item} saving={saving} onToggle={onToggle} bloqueado={bloqueado} onEditar={onEditar} onApagar={onApagar} />
        ))}
      </div>
    </div>
  );
}

function Card({
  item, saving, onToggle, bloqueado = false, onEditar, onApagar,
}: {
  item: Candidato;
  saving: string | null;
  onToggle: (item: Candidato) => void;
  bloqueado?: boolean;
  onEditar?: (item: Candidato) => void;
  onApagar?: (item: Candidato) => void;
}) {
  // Tenta imagem_url primeiro; em onError, troca pra fallback (produto.imagem_url).
  const [imgSrc, setImgSrc] = useState<string | null>(item.imagem_url);
  const [usedFallback, setUsedFallback] = useState(false);
  const [imgError, setImgError] = useState(false);
  const handleImgError = () => {
    if (!usedFallback && item.imagem_fallback && item.imagem_fallback !== imgSrc) {
      setImgSrc(item.imagem_fallback);
      setUsedFallback(true);
    } else {
      setImgError(true);
    }
  };
  const preco = formatBRL(item.preco_promocional);
  const key = `${item.tipo}:${item.id}`;
  const isSaving = saving === key;
  const ativo = item.vitrine_publica;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="neu-flat rounded-2xl overflow-hidden border border-white/5 flex flex-col"
      style={{ outline: ativo ? '2px solid rgba(212,175,55,0.55)' : 'none' }}
    >
      <div style={{ aspectRatio: '4 / 3', position: 'relative', overflow: 'hidden', background: 'rgba(212,175,55,0.04)' }}>
        {imgSrc && !imgError ? (
          <img
            src={imgSrc}
            alt={item.titulo}
            onError={handleImgError}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff size={32} style={{ color: 'rgba(212,175,55,0.3)' }} />
          </div>
        )}
        {ativo && (
          <div
            style={{
              position: 'absolute', top: 8, right: 8,
              background: 'linear-gradient(135deg, #D4AF37, #B8941F)',
              color: '#0A0A0A',
              borderRadius: '999px',
              padding: '0.25rem 0.5rem',
              fontSize: '0.55rem',
              fontWeight: 800,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: '0.25rem',
            }}
          >
            <Sparkles size={10} /> Na vitrine
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1 flex-1">
        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
          {item.tipo === 'arte' ? 'Promoção' : 'Produto'}
        </span>
        <p className="text-sm font-bold text-gray-200 leading-snug line-clamp-2">{item.titulo}</p>
        {preco && <p className="text-sm font-bold text-accent">{preco}</p>}

        {/* Peça do professor: prioridade e as ações que só ela tem. */}
        {item.tipo === 'institucional' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 flex items-center gap-1">
              {item.prioridade > 0
                ? <><ArrowUp size={10} className="text-accent" /> Prioridade {item.prioridade}</>
                : 'Institucional'}
            </span>
            {(onEditar || onApagar) && (
              <span className="flex items-center gap-1">
                {onEditar && (
                  <button onClick={() => onEditar(item)} title="Editar peça" className="action-btn-edit">
                    <Edit3 size={11} />
                  </button>
                )}
                {onApagar && (
                  <button onClick={() => onApagar(item)} title="Apagar peça" className="action-btn-delete">
                    <Trash2 size={11} />
                  </button>
                )}
              </span>
            )}
          </div>
        )}

        {/* `disabled` honesto: com a vitrine cheia a RPC recusaria de verdade
            (migr. 540). Remover nunca é bloqueado — é justamente o que libera
            a vaga. */}
        <button
          onClick={() => onToggle(item)}
          disabled={isSaving || (bloqueado && !ativo)}
          title={bloqueado && !ativo ? 'A vitrine está cheia — tire um item para liberar vaga' : undefined}
          className="mt-auto neu-button py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          style={ativo ? {
            background: 'linear-gradient(135deg, rgba(212,175,55,0.15), rgba(212,175,55,0.05))',
            border: '1px solid rgba(212,175,55,0.4)',
            color: '#D4AF37',
          } : undefined}
        >
          {isSaving ? '...'
            : ativo ? (<><Check size={12} /> Remover da vitrine</>)
            : bloqueado ? 'Vitrine cheia'
            : 'Adicionar à vitrine'}
        </button>
      </div>
    </motion.div>
  );
}
