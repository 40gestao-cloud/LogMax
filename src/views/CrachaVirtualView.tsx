// Crachá Virtual — a tela do professor, na Matriz.
//
// Aqui a leitura do crachá vira presença. O QR do aluno carrega só o
// `funcionarios.id`: ele NÃO autoriza nada, e quem grava é a RPC
// `registrar_ponto_manual` (migr. 559), que exige RH ou gerente da filial.
// Forjar um crachá não dá a ninguém um poder que quem está com o leitor na mão
// já não tivesse — o crachá substitui a DIGITAÇÃO do nome, não a autorização.
//
// A defesa contra "mostrar o crachá do colega que faltou" é humana, não
// criptográfica: a confirmação exibe a FOTO em tamanho grande antes de gravar,
// e quem lê está olhando para a pessoa.
//
// Escopo Matriz de propósito: o professor lê o crachá de qualquer unidade, e a
// lista aqui não é filtrada por filial. A RLS de `funcionarios` já recorta o
// que cada um pode ver — admin/CEO passam em todas.

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { IdCard, ScanLine, Search, User, Loader2, Clock, AlertTriangle, Building2, ShieldAlert, RotateCcw, X, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { QRScanner } from '../components/QRScanner';
import { CrachaModal, type CrachaPessoa } from '../components/CrachaVirtual';
import { lerCracha } from '../lib/cracha';
import { FILIAIS_HOLDING, isFilialHolding, identidadeDaFilial } from '../lib/filiais';
import { todayBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';

export const CrachaVirtualView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  // Guarda de papel DENTRO da view, não só no menu. Esconder o botão da barra
  // lateral não fecha a rota: `activeView` também é definido pelo link de uma
  // notificação, pelo histórico de navegação e pelos comandos globais. A RLS de
  // `funcionarios` já limitaria o que cada um enxerga (aluno vê só a própria
  // linha), mas quem tem setor RH veria a unidade inteira e teria o botão de
  // gravar presença a um clique — é a régua do menu que tem de valer aqui.
  const podeLer = profile?.role === 'admin';

  // Sem filtro de filial de propósito: a fila da turma atravessa as unidades, e
  // a RLS de `funcionarios` é quem recorta (admin passa em todas). Sem
  // paginação porque a turma cabe folgada no teto de linhas do PostgREST.
  const { data: funcionarios, isLoading } = useFetchData<any>('/api/funcionariosview');

  const [scannerAberto, setScannerAberto] = useState(false);
  const [crachaAberto, setCrachaAberto] = useState<CrachaPessoa | null>(null);
  const [confirmando, setConfirmando] = useState<CrachaPessoa | null>(null);
  const [gravando, setGravando] = useState(false);
  const [busca, setBusca] = useState('');
  const [lidosAgora, setLidosAgora] = useState<{ nome: string; hora: string }[]>([]);
  // O que já existe de ponto HOJE para quem acabou de ser lido. `registrar_ponto_manual`
  // faz ON CONFLICT DO UPDATE: uma segunda leitura reescreve a hora de entrada,
  // e — pior — transforma em 'Normal' uma falta justificada que o RH tinha
  // lançado, sem dizer nada a ninguém. Aqui isso vira aviso e um botão que diz
  // o que vai fazer.
  const [jaRegistrado, setJaRegistrado] = useState<{ id: string; status: string; entrada: string | null } | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // Foto de perfil por funcionário. A foto do cadastro do RH (`funcionarios.foto_url`)
  // quase sempre vem vazia — o formulário grava string vazia e o upload de lá é
  // recusado pela policy do bucket para quem não é admin —, enquanto o aluno tem
  // a foto que ele mesmo mandou, em `user_profiles.foto_url`. Como a confirmação
  // existe justamente para o professor olhar a cara antes de gravar, sem esta
  // ponte a tela mostrava um boneco cinza e a conferência humana perdia o sentido.
  //
  // Dois índices porque o vínculo perfil↔funcionário é gravado nos DOIS lados e
  // nem sempre nos dois ao mesmo tempo: há turma inteira (contabilidade) em que
  // `user_profiles.funcionario_id` está nulo e quem aponta é
  // `funcionarios.user_profile_id`. Ler só um lado deixaria a turma sem foto.
  const [fotosPorFuncionario, setFotosPorFuncionario] = useState<Record<string, string>>({});
  const [fotosPorPerfil, setFotosPorPerfil] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!supabase || !podeLer) return;
    let cancelado = false;
    supabase
      .from('user_profiles')
      .select('id, funcionario_id, foto_url')
      .not('foto_url', 'is', null)
      .then(({ data }) => {
        if (cancelado || !data) return;
        const porFuncionario: Record<string, string> = {};
        const porPerfil: Record<string, string> = {};
        for (const u of data as any[]) {
          if (!u.foto_url) continue;
          if (u.funcionario_id) porFuncionario[u.funcionario_id] = u.foto_url;
          if (u.id) porPerfil[u.id] = u.foto_url;
        }
        setFotosPorFuncionario(porFuncionario);
        setFotosPorPerfil(porPerfil);
      });
    return () => { cancelado = true; };
  }, [podeLer]);

  // `||` e não `??`: o formulário do RH grava string vazia, que não é nula mas
  // também não é foto.
  const fotoDe = (f: any): string | null =>
    f?.foto_url || fotosPorFuncionario[f?.id] || fotosPorPerfil[f?.user_profile_id] || null;

  const ativos = useMemo(
    () => (funcionarios ?? [])
      .filter((f: any) => (f.status ?? 'Ativo') !== 'Inativo')
      .map((f: any) => ({ ...f, foto_url: fotoDe(f) }))
      .sort((a: any, b: any) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [funcionarios, fotosPorFuncionario, fotosPorPerfil],
  );

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return ativos;
    return ativos.filter((f: any) =>
      String(f.nome ?? '').toLowerCase().includes(q) ||
      String(f.cargo ?? '').toLowerCase().includes(q) ||
      String(f.filial ?? '').toLowerCase().includes(q));
  }, [ativos, busca]);

  // Agrupado por unidade porque é assim que a turma se organiza: o professor
  // procura "o pessoal da TechMax", não um nome no meio de trinta. A ordem
  // segue FILIAIS_HOLDING (a mesma do seletor de unidade) para a tela não
  // reordenar sozinha quando alguém troca de filial; quem tiver filial
  // desconhecida ou nula cai num grupo próprio no fim, visível — some é pior.
  const grupos = useMemo(() => {
    const mapa = new Map<string, any[]>();
    for (const f of filtrados) {
      const chave = isFilialHolding(f.filial) ? f.filial : 'Sem unidade';
      const lista = mapa.get(chave) ?? [];
      lista.push(f);
      mapa.set(chave, lista);
    }
    const ordem = [...FILIAIS_HOLDING, 'Sem unidade'];
    return ordem
      .filter(u => mapa.has(u))
      .map(u => ({
        unidade: u,
        // Gerente no topo da unidade: é a cabeça daquela coluna, e quem procura
        // "quem responde pela TechMax" não deve varrer a lista inteira.
        // `cargo` é texto livre e vem da turma com maiúscula irregular e espaço
        // sobrando ("Gerente ", "Gerente De Vendas e Atendimentos") — por isso
        // busca por substring no texto normalizado, não igualdade.
        pessoas: [...mapa.get(u)!].sort((a, b) => {
          const ehGerente = (f: any) => /gerente/.test(String(f.cargo ?? '').trim().toLowerCase()) ? 0 : 1;
          const d = ehGerente(a) - ehGerente(b);
          return d !== 0 ? d
            : String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR');
        }),
      }));
  }, [filtrados]);

  const handleLeitura = (bruto: string) => {
    setScannerAberto(false);
    const funcionarioId = lerCracha(bruto);
    if (!funcionarioId) {
      showToast('Isto não é um crachá do LogMax. Aponte para o QR do crachá.', 'error', true);
      return;
    }
    const achado = ativos.find((f: any) => f.id === funcionarioId);
    if (!achado) {
      showToast('Crachá lido, mas não achei essa pessoa entre os funcionários ativos.', 'error', true);
      return;
    }
    setJaRegistrado(null);
    setConfirmando(achado);
    void conferirPontoDeHoje(funcionarioId);
  };

  // Leitura à parte, e não junto do fetch da lista: interessa só a pessoa que
  // acabou de ser lida, e no dia de hoje.
  const conferirPontoDeHoje = async (funcionarioId: string) => {
    if (!supabase) return;
    setConferindo(true);
    try {
      const { data } = await supabase
        .from('ponto_eletronico')
        .select('id, status, entrada')
        .eq('funcionario_id', funcionarioId)
        .eq('data', todayBR())
        .maybeSingle();
      setJaRegistrado(data ? { id: data.id, status: data.status, entrada: data.entrada } : null);
    } finally {
      setConferindo(false);
    }
  };

  // Apagar o registro do dia, aqui mesmo. A exclusão já existia na aba
  // Registros do Ponto Eletrônico, mas aquela aba é por FILIAL — e a leitura de
  // crachá acontece na Matriz, onde ela nem aparece. Quem lê errado tinha de
  // entrar na unidade para desfazer; o conserto ficava longe do erro.
  //
  // A RLS de `ponto_eletronico` é quem autoriza de verdade (`ponto_rh_delete`);
  // aqui só se oferece o botão a quem a tela já restringe.
  const handleExcluir = async () => {
    if (!jaRegistrado || !confirmando || !supabase) return;
    setExcluindo(true);
    try {
      const { error } = await supabase
        .from('ponto_eletronico')
        .delete()
        .eq('id', jaRegistrado.id);
      if (error) throw error;
      showToast(`Registro de hoje de ${confirmando.nome} excluído.`, 'success', true);
      setJaRegistrado(null);
      setLidosAgora(prev => prev.filter(l => l.nome !== confirmando.nome));
    } catch (err: any) {
      showToast(err?.message ?? 'Não consegui excluir o registro.', 'error', true);
    } finally {
      setExcluindo(false);
    }
  };

  const handleGravar = async () => {
    if (!confirmando || !supabase) return;
    setGravando(true);
    try {
      const hora = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco',
      });
      const { error } = await supabase.rpc('registrar_ponto_manual', {
        p_funcionario_id: confirmando.id,
        p_data:           todayBR(),
        p_status:         'Normal',
        p_entrada:        hora,
        p_observacao:     null,
        p_horas:          null,
        p_origem:         'cracha',
      });
      if (error) throw error;
      showToast(`Presença de ${confirmando.nome} registrada às ${hora}.`, 'success', true);
      setLidosAgora(prev => [{ nome: confirmando.nome, hora }, ...prev].slice(0, 12));
      setConfirmando(null);
      setJaRegistrado(null);
      // Reabre o leitor: com a turma em fila, voltar ao botão a cada leitura é
      // o gesto repetido que mais custa.
      setScannerAberto(true);
    } catch (err: any) {
      showToast(err?.message ?? 'Não consegui registrar a presença.', 'error', true);
    } finally {
      setGravando(false);
    }
  };

  if (!podeLer) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="neu-flat rounded-3xl p-8 border border-white/5 max-w-md flex items-start gap-3">
          <ShieldAlert size={20} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-gray-200">Tela restrita</p>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              A leitura de crachá registra presença de outras pessoas, e por isso fica só com
              quem conduz a turma. Seu próprio crachá está em <span className="text-gray-300">Meu Crachá</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <IdCard size={26} /> Crachá Virtual
        </h2>
      </div>

      {/* Só o botão. A explicação que morava aqui dizia o que a própria tela de
          confirmação já mostra na hora — texto que se lê uma vez e depois vira
          moldura ao redor da única coisa que se clica. */}
      <div className="flex justify-center shrink-0">
        <button
          type="button"
          onClick={() => setScannerAberto(true)}
          className="inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl text-sm font-bold uppercase tracking-widest bg-accent/10 text-accent border border-accent/40 hover:bg-accent/15 transition-colors"
        >
          <ScanLine size={18} /> Ler crachá
        </button>
      </div>

      {/* Fila da sessão: quem já passou nesta rodada. Some ao recarregar — a
          verdade continua sendo o Registro de Ponto; isto é só o retorno visual
          de quem está com trinta pessoas na frente. */}
      {lidosAgora.length > 0 && (
        <div className="neu-flat rounded-3xl p-5 border border-emerald-500/20 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/80 mb-3">
            Lidos agora ({lidosAgora.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {lidosAgora.map((l, i) => (
              <span key={`${l.nome}-${i}`}
                className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                {l.nome} · {l.hora}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Crachás da turma ({filtrados.length})
          </p>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar pessoa…"
              className="neu-input rounded-xl pl-8 pr-3 py-2 text-sm w-[200px]"
            />
          </div>
        </div>

        {isLoading ? <LoadingSpinner /> : filtrados.length === 0 ? (
          <EmptyState message="Nenhum funcionário ativo encontrado." />
        ) : (
          // Uma coluna por unidade, lado a lado: a turma se lê em paralelo, não
          // em pilha — e três unidades cabem numa tela de notebook.
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
            {grupos.map(({ unidade, pessoas }) => {
              const ident = identidadeDaFilial(unidade === 'Sem unidade' ? null : unidade);
              return (
                <div key={unidade} className="flex flex-col gap-3">
                  {/* Cabeçalho do grupo: o logo da unidade, o mesmo que vai no
                      crachá — é assim que o olho casa a coluna com o cartão que
                      vai ser lido. A placa por trás repete a do crachá pelo
                      mesmo motivo: os PNGs vieram com fundo queimado e cada um
                      pede um fundo diferente para fechar.

                      "Sem unidade" fica em texto: ali não há logo que diga a
                      verdade, e emprestar o do LogMax seria dizer que aquelas
                      pessoas são da holding. */}
                  <div className="flex items-center gap-2.5">
                    {unidade === 'Sem unidade' ? (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
                        <Building2 size={12} /> Sem unidade
                      </span>
                    ) : (
                      <div
                        className="h-9 px-3 rounded-lg flex items-center justify-center shrink-0"
                        style={ident.plate ? { background: ident.plate } : undefined}
                      >
                        <img src={ident.logo} alt={unidade}
                          className="h-6 w-auto max-w-[110px] object-contain" />
                      </div>
                    )}
                    <span className="text-[10px] text-gray-600 font-mono">({pessoas.length})</span>
                    <span className="flex-1 h-px" style={{ background: `${ident.claro}26` }} />
                  </div>

                  <div className="flex flex-col gap-2">
                    {pessoas.map((f: any) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setCrachaAberto(f)}
                        title="Abrir o crachá"
                        className="flex items-center gap-3 p-3 rounded-2xl border transition-colors text-left hover:bg-white/5"
                        style={{ borderColor: `${ident.claro}33` }}
                      >
                        <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/30 flex items-center justify-center shrink-0"
                          style={{ border: `1px solid ${ident.claro}55` }}>
                          {f.foto_url
                            ? <img src={f.foto_url} alt="" className="w-full h-full object-cover" />
                            : <User size={18} className="text-gray-600" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-200 truncate">{f.nome}</p>
                          <p className="text-[10px] text-gray-500 truncate">{f.cargo || 'sem cargo'}</p>
                        </div>
                        <IdCard size={14} className="text-gray-600 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* O QRScanner NÃO é um modal: ele devolve um bloco comum, feito para ser
          posto dentro de um por quem chama (era assim no totem antigo). Solto
          aqui no fim da árvore, ele nascia embaixo da lista de crachás — a
          câmera até abria, mas fora da tela, e o clique parecia não fazer nada.
          A moldura é nossa. */}
      {scannerAberto && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setScannerAberto(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-sm flex flex-col items-center gap-4"
          >
            <div className="flex items-center justify-between w-full gap-3">
              <p className="text-sm font-bold text-gray-200 flex items-center gap-2">
                <ScanLine size={15} className="text-accent" /> Ler crachá
              </p>
              <button type="button" onClick={() => setScannerAberto(false)} title="Fechar"
                className="modal-close-btn">
                <X size={16} />
              </button>
            </div>
            <QRScanner onResult={handleLeitura} onClose={() => setScannerAberto(false)} />
          </div>
        </div>
      )}

      {crachaAberto && (
        <CrachaModal pessoa={crachaAberto} onClose={() => setCrachaAberto(null)} />
      )}

      {/* Confirmação da leitura — a foto é o controle desta tela. */}
      {confirmando && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { if (!gravando) { setConfirmando(null); setJaRegistrado(null); } }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-sm flex flex-col items-center gap-4"
          >
            <div className="w-32 h-32 rounded-2xl overflow-hidden border-2 border-accent/40 bg-black/40 flex items-center justify-center">
              {/* Resolvido de novo aqui, e não só herdado do objeto: a confirmação
                  pode ter sido aberta antes de o índice de fotos chegar. */}
              {fotoDe(confirmando)
                ? <img src={fotoDe(confirmando)!} alt={confirmando.nome} className="w-full h-full object-cover" />
                : <User size={44} className="text-accent/50" />}
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-100 leading-tight">{confirmando.nome}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {[confirmando.filial, confirmando.cargo].filter(Boolean).join(' · ')}
              </p>
            </div>

            {!fotoDe(confirmando) && (
              <p className="text-[11px] text-amber-400/90 flex items-start gap-1.5 text-center">
                <AlertTriangle size={12} className="shrink-0 mt-px" />
                <span>Esta pessoa não tem foto no cadastro — confira o nome antes de gravar.</span>
              </p>
            )}

            {conferindo ? (
              <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" /> conferindo o ponto de hoje…
              </p>
            ) : jaRegistrado ? (
              <div className="rounded-xl p-3 border border-amber-500/30 bg-amber-500/5 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  Já existe ponto hoje para esta pessoa
                  {jaRegistrado.entrada ? ` (entrada ${jaRegistrado.entrada}` : ` (${jaRegistrado.status}`}
                  {jaRegistrado.entrada ? `, ${jaRegistrado.status})` : ')'}.
                  Gravar de novo <span className="font-semibold">substitui</span> o registro —
                  inclusive uma falta justificada, que voltaria a ser presença normal.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-gray-500 text-center">
                É esta pessoa que está na sua frente? A presença de hoje será registrada como
                <span className="text-gray-300 font-semibold"> Normal</span>.
              </p>
            )}

            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={() => { setConfirmando(null); setJaRegistrado(null); }}
                disabled={gravando}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest border border-white/15 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
              >
                {jaRegistrado ? 'Deixar como está' : 'Não é'}
              </button>
              <button
                type="button"
                onClick={handleGravar}
                disabled={gravando || conferindo}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest border transition-colors disabled:opacity-40 inline-flex items-center justify-center gap-2 ${
                  jaRegistrado
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/40 hover:bg-amber-500/15'
                    : 'bg-accent/10 text-accent border-accent/40 hover:bg-accent/15'
                }`}
              >
                {gravando ? <Loader2 size={12} className="animate-spin" />
                  : jaRegistrado ? <RotateCcw size={12} /> : <Clock size={12} />}
                {jaRegistrado ? 'Substituir registro' : 'Registrar presença'}
              </button>
            </div>

            {/* Terceira saída, e só quando há o que apagar: substituir conserta
                a hora, apagar desfaz a leitura inteira — quem marcou a pessoa
                errada quer isto, não um registro corrigido. */}
            {jaRegistrado && (
              <button
                type="button"
                onClick={handleExcluir}
                disabled={excluindo || gravando}
                className="text-[10px] font-bold uppercase tracking-widest text-red-400/80 hover:text-red-300 transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                {excluindo ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                Excluir o registro de hoje
              </button>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
};
