import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserMinus, LogOut } from 'lucide-react';
import type { UserProfile } from '../hooks/useUserProfile';

/**
 * Aviso de vínculo encerrado (migr. 307).
 *
 * IMPORTANTE: isto é comunicação, não segurança. Quem impede o desligado de
 * escrever é a RLS — as funções `auth_user_role/filial/setores` e
 * `auth_is_admin` ignoram o perfil com `desligado_em` preenchido, e as
 * policies escopadas por elas negam sozinhas. Fechar este modal pelo DevTools
 * devolve a tela, não devolve a permissão.
 *
 * Por isso ele é dispensável: prender o usuário num overlay sem saída daria a
 * impressão de que o bloqueio mora aqui, e ainda impediria a pessoa de
 * consultar o próprio histórico e a própria rescisão — que ela tem direito de
 * ver.
 */
export const DesligamentoAviso = ({ profile }: { profile: UserProfile | null }) => {
  const [aberto, setAberto] = useState(true);

  if (!profile?.desligado_em) return null;

  const data = new Date(profile.desligado_em).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Rio_Branco',
  });

  return (
    <AnimatePresence>
      {aberto && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="neu-flat rounded-3xl p-7 border border-white/10 max-w-md w-full text-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
              <UserMinus size={24} className="text-red-400" />
            </div>

            <h2 className="text-lg font-bold text-gray-100">Vínculo encerrado</h2>
            <p className="text-sm text-gray-400 leading-relaxed mt-3">
              Seu vínculo com a organização foi encerrado em <strong className="text-gray-200">{data}</strong>.
            </p>
            <p className="text-sm text-gray-500 leading-relaxed mt-2">
              Você continua com acesso para consultar seus registros e sua rescisão, mas não pode mais
              lançar nem editar informações. Fale com seu gestor se tiver dúvidas.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 justify-center mt-6">
              <button
                onClick={() => setAberto(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-bold border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition"
              >
                Entendi
              </button>
              <button
                onClick={() => { void import('../lib/supabase').then(m => m.supabase?.auth.signOut()); }}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition inline-flex items-center justify-center gap-1.5"
              >
                <LogOut size={13} />
                Sair
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
