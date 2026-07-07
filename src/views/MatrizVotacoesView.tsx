import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Vote, Plus, X, ThumbsUp, ThumbsDown, CheckCircle2, Clock, FileEdit,
  Trash2, Image as ImageIcon, Upload, Loader2, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';
import { isConselheiro } from '../lib/rbac';
import { useConfirm } from '../contexts/ConfirmContext';

// ── Tipos ──────────────────────────────────────────────────────────────────
type TipoVotacao = 'conselho' | 'total';
type StatusVotacao = 'Rascunho' | 'Em Votação' | 'Decidido';

type Votacao = {
  id: string;
  tipo: TipoVotacao;
  criador_id: string | null;
  pauta: string;
  descricao: string | null;
  imagem_url: string | null;
  data_votacao: string;
  horario_votacao: string;
  status: StatusVotacao;
  votos_favor: number;
  votos_contra: number;
  resultado: 'Aceito' | 'Rejeitado' | null;
  created_at: string;
};

type VotoRow = { votacao_id: string; user_id: string; voto: 'favor' | 'contra' };

// ── Permissões ─────────────────────────────────────────────────────────────
function podeCriar(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo' || isConselheiro(p);
}

function podeVotarConselho(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'ceo' || isConselheiro(p);
}

function podeVotarTotal(_p: UserProfile | null) {
  return !!_p; // todos os autenticados
}

function podeGerenciarStatus(p: UserProfile | null) {
  return podeCriar(p);
}

// ── Helpers visuais ────────────────────────────────────────────────────────
const STATUS_COLOR: Record<StatusVotacao, string> = {
  'Rascunho':   'bg-gray-500/20 text-gray-400 border border-gray-500/30',
  'Em Votação': 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  'Decidido':   'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
};

const RESULTADO_COLOR: Record<string, string> = {
  'Aceito':    'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  'Rejeitado': 'bg-red-500/20 text-red-300 border border-red-500/30',
};

function fmtData(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function fmtHora(t: string) {
  return t.slice(0, 5);
}

// ── Constantes de imagem ───────────────────────────────────────────────────
const BUCKET = 'votacoes-imagens';
const MAX_BYTES = 200 * 1024;
const ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp';

async function uploadImagem(file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase não configurado.');
  if (file.size > MAX_BYTES) throw new Error(`Imagem muito grande (máx 200 KB).`);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${crypto.randomUUID()}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(`Falha ao enviar imagem: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('URL pública não gerada.');
  return data.publicUrl;
}

async function removerImagem(url: string | null | undefined) {
  if (!supabase || !url) return;
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length);
  await supabase.storage.from(BUCKET).remove([path]);
}

// ── Modal de criação/edição ────────────────────────────────────────────────
function ModalVotacao({
  tipo, editando, onClose, onSaved, showToast,
}: {
  tipo: TipoVotacao;
  editando?: Votacao | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const isEdicao = !!editando;
  const [pauta, setPauta] = useState(editando?.pauta ?? '');
  const [descricao, setDescricao] = useState(editando?.descricao ?? '');
  const [dataVotacao, setDataVotacao] = useState(editando?.data_votacao ?? '');
  const [horario, setHorario] = useState(editando?.horario_votacao?.slice(0,5) ?? '');
  const [imagemUrl, setImagemUrl] = useState<string | null>(editando?.imagem_url ?? null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleImagem = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const url = await uploadImagem(file);
      if (imagemUrl) await removerImagem(imagemUrl);
      setImagemUrl(url);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setUploadingImg(false);
    }
  };

  const handleSalvar = async () => {
    if (!supabase) return;
    if (!pauta.trim() || !dataVotacao || !horario) {
      showToast('Preencha pauta, data e horário.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (isEdicao) {
        const { error } = await supabase
          .from('votacoes')
          .update({ pauta, descricao: descricao || null, data_votacao: dataVotacao, horario_votacao: horario, imagem_url: imagemUrl })
          .eq('id', editando!.id);
        if (error) throw error;
        showToast('Votação atualizada.', 'success');
      } else {
        const { error } = await supabase.from('votacoes').insert({
          tipo, pauta, descricao: descricao || null,
          data_votacao: dataVotacao, horario_votacao: horario,
          imagem_url: imagemUrl,
        });
        if (error) throw error;
        showToast('Votação criada.', 'success');
      }
      onSaved();
      onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-100">
            {isEdicao ? 'Editar Votação' : `Nova Votação ${tipo === 'conselho' ? 'do Conselho' : 'Total'}`}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Imagem */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Imagem (opcional)</span>
          {imagemUrl ? (
            <div className="relative group rounded-xl overflow-hidden h-28">
              <img src={imagemUrl} alt="capa" className="w-full h-full object-cover" />
              <button
                onClick={() => setImagemUrl(null)}
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={20} className="text-white" />
              </button>
            </div>
          ) : (
            <label className="neu-pressed rounded-xl flex items-center justify-center gap-2 h-20 cursor-pointer text-gray-500 hover:text-gray-300 transition-colors border border-dashed border-gray-600">
              {uploadingImg ? <Loader2 size={16} className="animate-spin" /> : <><Upload size={15} /><span className="text-xs">Carregar imagem</span></>}
              <input type="file" accept={ACCEPT} className="hidden" onChange={handleImagem} disabled={uploadingImg} />
            </label>
          )}
        </div>

        {/* Pauta */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Pauta *</label>
          <input
            value={pauta} onChange={e => setPauta(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none"
            placeholder="Título da pauta"
          />
        </div>

        {/* Descrição */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Descrição</label>
          <textarea
            value={descricao} onChange={e => setDescricao(e.target.value)}
            rows={3}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="Detalhes sobre a votação"
          />
        </div>

        {/* Data e Horário */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Data *</label>
            <input
              type="date" value={dataVotacao} onChange={e => setDataVotacao(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Horário *</label>
            <input
              type="time" value={horario} onChange={e => setHorario(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none"
            />
          </div>
        </div>

        <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>
          {isEdicao ? 'Salvar Alterações' : 'Criar Votação'}
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Card de votação ────────────────────────────────────────────────────────
function VotacaoCard({
  v, meuVoto, profile, onVotar, onStatus, onEditar, onExcluir, tipo,
}: {
  v: Votacao;
  meuVoto: VotoRow | undefined;
  profile: UserProfile | null;
  onVotar: (id: string, voto: 'favor' | 'contra') => void;
  onStatus: (id: string, novoStatus: StatusVotacao, resultado?: 'Aceito' | 'Rejeitado') => void;
  onEditar: (v: Votacao) => void;
  onExcluir: (id: string) => void;
  tipo: TipoVotacao;
}) {
  const podeVotar = tipo === 'conselho' ? podeVotarConselho(profile) : podeVotarTotal(profile);
  const podeGerenciar = podeGerenciarStatus(profile);
  const podeExcluir = profile?.role === 'admin' || profile?.role === 'ceo';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="neu-flat rounded-3xl border border-accent/20 overflow-hidden"
    >
      {/* Imagem de capa */}
      {v.imagem_url && (
        <img src={v.imagem_url} alt="capa" className="w-full h-32 object-cover" />
      )}

      <div className="p-4 flex flex-col gap-3">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${STATUS_COLOR[v.status]}`}>
                {v.status}
              </span>
              {v.resultado && (
                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${RESULTADO_COLOR[v.resultado]}`}>
                  {v.resultado}
                </span>
              )}
            </div>
            <h3 className="text-sm font-bold text-gray-100 mt-1">{v.pauta}</h3>
            {v.descricao && <p className="text-xs text-gray-400 line-clamp-2">{v.descricao}</p>}
          </div>
          {/* Ações de gerenciamento */}
          {podeGerenciar && v.status === 'Rascunho' && (
            <div className="flex gap-1 shrink-0">
              <button onClick={() => onEditar(v)} className="p-1.5 rounded-lg text-gray-400 hover:text-accent transition-colors">
                <FileEdit size={14} />
              </button>
              {podeExcluir && (
                <button onClick={() => onExcluir(v.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Data/Hora */}
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Clock size={12} />
          <span>{fmtData(v.data_votacao)} às {fmtHora(v.horario_votacao)}</span>
        </div>

        {/* Resultado de votos */}
        {(v.status === 'Em Votação' || v.status === 'Decidido') && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <ThumbsUp size={13} className="text-emerald-400" />
              <span className="font-bold text-emerald-400">{v.votos_favor}</span>
              <span className="text-gray-500">a favor</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <ThumbsDown size={13} className="text-red-400" />
              <span className="font-bold text-red-400">{v.votos_contra}</span>
              <span className="text-gray-500">contra</span>
            </div>
            {meuVoto && (
              <span className="ml-auto text-[10px] text-gray-500">
                Você votou: <span className={meuVoto.voto === 'favor' ? 'text-emerald-400' : 'text-red-400'}>
                  {meuVoto.voto === 'favor' ? 'a favor' : 'contra'}
                </span>
              </span>
            )}
          </div>
        )}

        {/* Botões de voto */}
        {v.status === 'Em Votação' && podeVotar && (
          <div className="flex gap-2">
            <button
              onClick={() => onVotar(v.id, 'favor')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                meuVoto?.voto === 'favor'
                  ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                  : 'neu-pressed text-gray-400 hover:text-emerald-300'
              }`}
            >
              <ThumbsUp size={13} /> A Favor
            </button>
            <button
              onClick={() => onVotar(v.id, 'contra')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                meuVoto?.voto === 'contra'
                  ? 'bg-red-500/30 text-red-300 border border-red-500/50'
                  : 'neu-pressed text-gray-400 hover:text-red-300'
              }`}
            >
              <ThumbsDown size={13} /> Contra
            </button>
          </div>
        )}

        {/* Transições de status */}
        {podeGerenciar && (
          <div className="flex gap-2 flex-wrap">
            {v.status === 'Rascunho' && (
              <button
                onClick={() => onStatus(v.id, 'Em Votação')}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
              >
                <ChevronRight size={12} /> Abrir Votação
              </button>
            )}
            {v.status === 'Em Votação' && (
              <>
                <button
                  onClick={() => onStatus(v.id, 'Decidido', v.votos_favor >= v.votos_contra ? 'Aceito' : 'Rejeitado')}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
                >
                  <CheckCircle2 size={12} /> Encerrar — Aceito
                </button>
                <button
                  onClick={() => onStatus(v.id, 'Decidido', 'Rejeitado')}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                >
                  <X size={12} /> Encerrar — Rejeitado
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Painel por tipo ────────────────────────────────────────────────────────
function PainelVotacoes({
  tipo, label, profile, showToast,
}: {
  tipo: TipoVotacao;
  label: string;
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Votacao | null>(null);
  const confirm = useConfirm();

  const { data: votacoes = [], isLoading, reload: reloadVotacoes } = useFetchData<Votacao>(
    'votacoes', { tipo }, false,
  );

  const { data: meusVotos = [], reload: reloadVotos } = useFetchData<VotoRow>(
    'votacoes_votos', profile?.id ? { user_id: profile.id } : undefined, false,
  );

  const refetch = useCallback(() => { reloadVotacoes(); reloadVotos(); }, [reloadVotacoes, reloadVotos]);

  const meuVotoMap = Object.fromEntries(meusVotos.map(v => [v.votacao_id, v]));

  const handleVotar = useCallback(async (id: string, voto: 'favor' | 'contra') => {
    if (!supabase) return;
    const { error } = await supabase.rpc('registrar_voto', { p_votacao_id: id, p_voto: voto });
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Voto registrado.', 'success');
    refetch();
  }, [refetch, showToast]);

  const handleStatus = useCallback(async (id: string, novoStatus: StatusVotacao, resultado?: 'Aceito' | 'Rejeitado') => {
    if (!supabase) return;
    const payload: any = { status: novoStatus };
    if (resultado) payload.resultado = resultado;
    const { error } = await supabase.from('votacoes').update(payload).eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast(`Status atualizado para ${novoStatus}.`, 'success');
    refetch();
  }, [refetch, showToast]);

  const handleExcluir = useCallback(async (id: string) => {
    const ok = await confirm({ message: 'Excluir esta votação? Esta ação não pode ser desfeita.', danger: true });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('votacoes').delete().eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Votação excluída.', 'success');
    refetch();
  }, [confirm, refetch, showToast]);

  // Separar por status
  const emAndamento = votacoes.filter(v => v.status !== 'Decidido');
  const historico = votacoes.filter(v => v.status === 'Decidido');

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho do painel */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Vote size={16} className="text-accent" />
          <h2 className="text-base font-bold text-gray-100">{label}</h2>
          <span className="text-xs text-gray-500 font-mono">({votacoes.length})</span>
        </div>
        {podeCriar(profile) && (
          <button
            onClick={() => { setEditando(null); setModalAberto(true); }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
          >
            <Plus size={13} /> Nova
          </button>
        )}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : votacoes.length === 0 ? (
        <EmptyState message="Nenhuma votação registrada." />
      ) : (
        <>
          {emAndamento.length > 0 && (
            <div className="flex flex-col gap-3">
              {emAndamento.map(v => (
                <VotacaoCard
                  key={v.id} v={v} tipo={tipo}
                  meuVoto={meuVotoMap[v.id]}
                  profile={profile}
                  onVotar={handleVotar}
                  onStatus={handleStatus}
                  onEditar={(vt) => { setEditando(vt); setModalAberto(true); }}
                  onExcluir={handleExcluir}
                />
              ))}
            </div>
          )}

          {historico.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Histórico de Decisões</span>
              {historico.map(v => (
                <VotacaoCard
                  key={v.id} v={v} tipo={tipo}
                  meuVoto={meuVotoMap[v.id]}
                  profile={profile}
                  onVotar={handleVotar}
                  onStatus={handleStatus}
                  onEditar={(vt) => { setEditando(vt); setModalAberto(true); }}
                  onExcluir={handleExcluir}
                />
              ))}
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {modalAberto && (
          <ModalVotacao
            tipo={tipo}
            editando={editando}
            onClose={() => setModalAberto(false)}
            onSaved={refetch}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── View principal ─────────────────────────────────────────────────────────
export function MatrizVotacoesView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-8 pb-16"
    >
      {/* Votações do Conselho */}
      <div className="neu-flat rounded-3xl p-5 border border-accent/20">
        <PainelVotacoes
          tipo="conselho"
          label="Votações do Conselho"
          profile={profile}
          showToast={showToast}
        />
      </div>

      {/* Votações Totais */}
      <div className="neu-flat rounded-3xl p-5 border border-accent/20">
        <PainelVotacoes
          tipo="total"
          label="Votações Totais"
          profile={profile}
          showToast={showToast}
        />
      </div>
    </motion.div>
  );
}
