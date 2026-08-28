-- O professor apaga a linha da estação que não existe mais.
--
-- A tela "Relógio das Máquinas" conta NAVEGADOR, não computador: a chave é um
-- id sorteado no `localStorage`, que é por origem e por navegador. Dois
-- navegadores no mesmo PC (Chrome e um segundo qualquer) viram duas linhas, e
-- foi exatamente o que aconteceu no dia da entrega — o professor viu "duas
-- estações" com um computador só, porque o navegador embutido de uma
-- ferramenta de depuração tinha aberto o app naquela máquina.
--
-- Não dá para juntar as duas por conta própria: sem cookie de terceiros nem
-- fingerprint, o navegador não sabe que é o mesmo PC — e fingerprint é
-- exatamente o que NÃO se quer num sistema didático com menores.
--
-- Então a saída é a honesta: a tela passa a dizer que a unidade é o navegador,
-- e quem administra ganha o direito de apagar linha que virou lixo (máquina
-- reinstalada, navegador de teste, aluno que abriu no celular uma vez só). A
-- linha volta sozinha no próximo acesso daquele navegador, então apagar não
-- destrói informação: é limpar o que não vai mais se repetir.
--
-- `role = 'admin'` literal, como na escrita dos comandos da turma: CEO e
-- conselheiro são alunos. `COALESCE(..., false)` porque sem perfil o predicado
-- seria NULL e o guard sumiria (migr. 495-497).

BEGIN;

DROP POLICY IF EXISTS ti_relogio_apaga_admin ON public.ti_relogio_maquinas;
CREATE POLICY ti_relogio_apaga_admin
  ON public.ti_relogio_maquinas
  FOR DELETE TO authenticated
  USING (COALESCE(public.auth_user_role() = 'admin', false));

GRANT DELETE ON TABLE public.ti_relogio_maquinas TO authenticated;

COMMIT;
