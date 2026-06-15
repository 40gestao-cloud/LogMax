import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { X, UserPlus, UserMinus, Check, Loader2, Award, CheckCircle2, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Treinamento = {
  id: string;
  nome: string;
  instrutor: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  status: string;
};

type Inscricao = {
  id: string;
  treinamento_id: string;
  funcionario_id: string;
  nome_funcionario: string | null;
  status: 'Inscrito' | 'Presente' | 'Ausente' | 'Concluído' | 'Cancelado';
  nota: number | null;
  data_emissao: string | null;
  created_at: string;
};

type Funcionario = { id: string; nome: string; cargo?: string | null; status?: string | null };

const STATUS_BADGE: Record<string, string> = {
  'Inscrito':   'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Presente':   'bg-accent/10   text-accent   border-accent/20',
  'Ausente':    'bg-red-500/10  text-red-500  border-red-500/20',
  'Concluído':  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Cancelado':  'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const STATUS_OPTIONS = ['Inscrito', 'Presente', 'Ausente', 'Concluído'] as const;

const fmtDataBR = (s: string | null) => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

// Gera HTML imprimível pro certificado. Abre numa nova aba sem dependência
// de PDF nativo — o aluno usa Ctrl+P → "Salvar como PDF" do navegador.
// Mantém o documento autocontido (CSS inline) pra funcionar offline e em
// qualquer browser. O código de verificação é o `id` da inscrição, que o
// admin pode consultar na tabela `treinamento_inscricoes` se precisar.
const renderCertificadoHtml = (treinamento: Treinamento, inscricao: Inscricao): string => `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<title>Certificado · ${treinamento.nome}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, 'Times New Roman', serif; background: #f1eee4; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px; }
  .cert { width: 100%; max-width: 1024px; aspect-ratio: 1.414/1; background: linear-gradient(135deg, #fff 0%, #fbf8ee 100%); border: 14px double #b58a3a; padding: 60px 72px; position: relative; box-shadow: 0 20px 60px rgba(0,0,0,0.18); }
  .cert::before { content: ''; position: absolute; inset: 18px; border: 1px solid #b58a3a; pointer-events: none; }
  .head { text-align: center; }
  .badge { display: inline-block; padding: 6px 18px; border-radius: 999px; background: #b58a3a; color: #fff; font-family: 'Helvetica', sans-serif; font-weight: 800; letter-spacing: .25em; font-size: 11px; }
  h1 { font-size: 44px; margin: 18px 0 6px; color: #2c2418; letter-spacing: .02em; }
  .subtitle { color: #6b5d44; font-size: 14px; letter-spacing: .35em; text-transform: uppercase; }
  .body { margin-top: 40px; text-align: center; color: #2c2418; line-height: 1.7; font-size: 18px; }
  .nome { font-size: 38px; font-weight: 800; margin: 18px 0; color: #4a3a1a; font-style: italic; }
  .curso { font-size: 24px; font-weight: 700; margin: 16px 0; color: #2c2418; }
  .meta { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; font-family: 'Helvetica', sans-serif; font-size: 12px; color: #6b5d44; }
  .meta .label { text-transform: uppercase; letter-spacing: .25em; font-weight: 700; margin-bottom: 4px; }
  .meta .value { color: #2c2418; font-size: 14px; font-weight: 600; }
  .footer { position: absolute; bottom: 50px; left: 72px; right: 72px; display: flex; justify-content: space-between; align-items: flex-end; font-family: 'Helvetica', sans-serif; font-size: 11px; color: #6b5d44; }
  .signature { text-align: center; }
  .signature .line { width: 220px; border-top: 1px solid #6b5d44; margin-bottom: 6px; }
  .verify { font-size: 9px; letter-spacing: .15em; text-transform: uppercase; color: #8a7a55; }
  .verify code { font-family: 'Courier New', monospace; color: #4a3a1a; }
  @media print { body { background: #fff; padding: 0; } .cert { box-shadow: none; border-color: #b58a3a; max-width: none; aspect-ratio: auto; } }
</style>
</head><body>
  <div class="cert">
    <div class="head">
      <span class="badge">Certificado</span>
      <h1>Conclusão de Treinamento</h1>
      <p class="subtitle">LogMax · Recursos Humanos</p>
    </div>

    <div class="body">
      Certificamos que
      <div class="nome">${inscricao.nome_funcionario ?? '—'}</div>
      participou e concluiu o treinamento
      <div class="curso">${treinamento.nome}</div>
      ${treinamento.instrutor ? `ministrado por <strong>${treinamento.instrutor}</strong>` : ''}
      ${inscricao.nota != null ? `<div style="margin-top:14px;font-size:14px;color:#6b5d44;">Nota final: <strong style="color:#4a3a1a">${Number(inscricao.nota).toFixed(1)}/10</strong></div>` : ''}
    </div>

    <div class="meta">
      <div>
        <div class="label">Período</div>
        <div class="value">${fmtDataBR(treinamento.data_inicio)}${treinamento.data_fim ? ` — ${fmtDataBR(treinamento.data_fim)}` : ''}</div>
      </div>
      <div>
        <div class="label">Emitido em</div>
        <div class="value">${new Date().toLocaleDateString('pt-BR')}</div>
      </div>
    </div>

    <div class="footer">
      <div class="signature">
        <div class="line"></div>
        <div>Coordenação de RH</div>
      </div>
      <div class="verify">
        Verificação: <code>${inscricao.id.slice(0, 8).toUpperCase()}</code>
      </div>
    </div>
  </div>
  <script>setTimeout(function(){ window.print(); }, 350);</script>
</body></html>`;

export const TreinamentoInscricoesModal: React.FC<{
  treinamento: Treinamento;
  onClose: () => void;
  showToast?: any;
}> = ({ treinamento, onClose, showToast }) => {
  const [inscricoes, setInscricoes] = useState<Inscricao[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(true);
  const [adicionando, setAdicionando] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const podeEmitirCertificado = treinamento.status === 'Concluído';

  const carregar = async () => {
    if (!supabase) return;
    setLoading(true);
    const [inscR, funcR] = await Promise.all([
      supabase.from('treinamento_inscricoes').select('*')
        .eq('treinamento_id', treinamento.id)
        .eq('ativo', true)
        .order('created_at', { ascending: true }),
      supabase.from('funcionarios').select('id, nome, cargo, status').order('nome'),
    ]);
    if (inscR.error) showToast?.(`Erro ao carregar: ${inscR.error.message}`, 'error');
    setInscricoes(inscR.data ?? []);
    setFuncionarios(funcR.data ?? []);
    setLoading(false);
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [treinamento.id]);

  const inscritosIds = useMemo(() => new Set(inscricoes.map(i => i.funcionario_id)), [inscricoes]);
  const disponiveis = useMemo(
    () => funcionarios.filter(f => !inscritosIds.has(f.id) && (f.status ?? 'Ativo') === 'Ativo'),
    [funcionarios, inscritosIds],
  );

  const handleAdd = async () => {
    if (!supabase || !adicionando) return;
    const func = funcionarios.find(f => f.id === adicionando);
    if (!func) return;
    setSavingAdd(true);
    try {
      const { data, error } = await supabase.from('treinamento_inscricoes').insert({
        treinamento_id:    treinamento.id,
        funcionario_id:    func.id,
        nome_funcionario:  func.nome,
        status:            'Inscrito',
      }).select().single();
      if (error) throw error;
      setInscricoes(prev => [...prev, data]);
      setAdicionando('');
      showToast?.('Inscrição registrada.', 'success');
    } catch (err: any) {
      // 23505 = UNIQUE violation (já inscrito).
      const msg = /23505|duplicate/i.test(err?.message ?? '')
        ? 'Este funcionário já está inscrito neste treinamento.'
        : (err?.message ?? 'tente novamente');
      showToast?.(`Erro: ${msg}`, 'error');
    }
    setSavingAdd(false);
  };

  const handleStatus = async (insc: Inscricao, novo: Inscricao['status']) => {
    if (!supabase) return;
    setUpdatingId(insc.id);
    try {
      const { data, error } = await supabase.from('treinamento_inscricoes')
        .update({ status: novo })
        .eq('id', insc.id)
        .select().single();
      if (error) throw error;
      setInscricoes(prev => prev.map(i => i.id === insc.id ? data : i));
    } catch (err: any) {
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error');
    }
    setUpdatingId(null);
  };

  const handleRemover = async (insc: Inscricao) => {
    if (!supabase) return;
    if (!confirm(`Remover inscrição de ${insc.nome_funcionario ?? 'colaborador'}?`)) return;
    try {
      // Soft delete pra liberar o UNIQUE parcial (treinamento, funcionario)
      // — assim o RH pode re-inscrever depois sem conflito de chave.
      const { error } = await supabase.from('treinamento_inscricoes')
        .update({ ativo: false })
        .eq('id', insc.id);
      if (error) throw error;
      setInscricoes(prev => prev.filter(i => i.id !== insc.id));
      showToast?.('Inscrição removida.', 'success');
    } catch (err: any) {
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error');
    }
  };

  const emitirCertificado = async (insc: Inscricao) => {
    // Marca data_emissao no banco (audit) e abre nova aba imprimível.
    if (!supabase) return;
    if (insc.status !== 'Presente' && insc.status !== 'Concluído') {
      showToast?.('Marque como Presente ou Concluído antes de emitir o certificado.', 'error');
      return;
    }
    try {
      if (!insc.data_emissao) {
        const { data, error } = await supabase.from('treinamento_inscricoes')
          .update({ data_emissao: new Date().toISOString() })
          .eq('id', insc.id)
          .select().single();
        if (error) throw error;
        setInscricoes(prev => prev.map(i => i.id === insc.id ? data : i));
        insc = data;
      }
      const html = renderCertificadoHtml(treinamento, insc);
      const win = window.open('', '_blank');
      if (!win) {
        showToast?.('Permita pop-ups deste site pra emitir o certificado.', 'error');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (err: any) {
      showToast?.(`Erro ao emitir: ${err?.message ?? '—'}`, 'error');
    }
  };

  const totalPresentes  = inscricoes.filter(i => i.status === 'Presente' || i.status === 'Concluído').length;
  const totalAusentes   = inscricoes.filter(i => i.status === 'Ausente').length;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={e => e.stopPropagation()}
        className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-gray-200">Inscrições · {treinamento.nome}</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {inscricoes.length} inscrito(s) · {totalPresentes} presente(s) · {totalAusentes} ausente(s)
            </p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
            <X size={14} />
          </button>
        </div>

        {/* Form: adicionar inscrito */}
        <div className="neu-pressed rounded-xl p-3 mb-3 shrink-0">
          <div className="flex items-center gap-2">
            <UserPlus size={12} className="text-accent shrink-0" />
            <select
              value={adicionando}
              onChange={e => setAdicionando(e.target.value)}
              className="neu-input flex-1 rounded-lg px-3 py-2 text-xs"
            >
              <option value="">Selecione um colaborador pra inscrever…</option>
              {disponiveis.map(f => (
                <option key={f.id} value={f.id}>
                  {f.nome}{f.cargo ? ` · ${f.cargo}` : ''}
                </option>
              ))}
            </select>
            <button onClick={handleAdd} disabled={!adicionando || savingAdd}
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 rounded-lg px-3 py-2 hover:bg-accent/10 disabled:opacity-40 shrink-0">
              {savingAdd ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
              Inscrever
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto main-scrollbar pr-1 flex flex-col gap-2">
          {loading ? (
            <p className="text-xs text-gray-500 text-center py-6">Carregando inscrições…</p>
          ) : inscricoes.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">Nenhum colaborador inscrito ainda.</p>
          ) : (
            inscricoes.map(insc => (
              <div key={insc.id} className="neu-flat rounded-xl p-3 border border-white/5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-200 truncate">{insc.nome_funcionario ?? '—'}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[insc.status]}`}>
                        {insc.status}
                      </span>
                      {insc.data_emissao && (
                        <span className="text-[10px] text-emerald-400">
                          ✓ certificado emitido
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <select
                      value={insc.status}
                      onChange={e => handleStatus(insc, e.target.value as any)}
                      disabled={updatingId === insc.id}
                      className="neu-input text-[10px] px-2 py-1 rounded-md uppercase font-bold tracking-wider"
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {podeEmitirCertificado && (insc.status === 'Presente' || insc.status === 'Concluído') && (
                      <button onClick={() => emitirCertificado(insc)} title="Emitir certificado (abre pra impressão)"
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-yellow-400 border border-yellow-400/30 rounded-md px-2 py-1 hover:bg-yellow-400/10">
                        <Award size={10} />Certificado
                      </button>
                    )}
                    <button onClick={() => handleRemover(insc)} title="Remover inscrição"
                      className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-red-400 transition-colors">
                      <UserMinus size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {!podeEmitirCertificado && (
          <p className="text-[10px] text-gray-500 mt-3 shrink-0">
            <CheckCircle2 size={10} className="inline mr-1" />
            Avance o treinamento pra <strong className="text-gray-300">Concluído</strong> pra liberar a emissão de certificados.
          </p>
        )}
      </motion.div>
    </motion.div>
  );
};
