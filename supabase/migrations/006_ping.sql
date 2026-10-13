-- =====================================================================
-- Migration 006: função ping() para manter o projeto Supabase ativo.
--
-- O plano gratuito pausa projetos sem atividade por ~7 dias. O workflow
-- .github/workflows/keepalive.yml chama esta função todo dia: é uma ida real ao banco
-- (PostgREST -> Postgres), então conta como atividade.
--
-- Só devolve a hora do servidor: não lê nem expõe nenhuma tabela. O papel anon (visitante
-- sem login) precisa de USAGE no schema para chamar qualquer função dele, e recebe só isso:
-- as tabelas e as demais funções continuam SEM permissão para anon (tudo é só para
-- authenticated, com RLS), então ele não lê nem executa mais nada. Não toca no schema
-- public nem em auth.users.
-- =====================================================================

create or replace function "controle-financeiro".ping()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select now() $$;

grant usage on schema "controle-financeiro" to anon;

revoke execute on function "controle-financeiro".ping() from public;
grant  execute on function "controle-financeiro".ping() to anon, authenticated;

notify pgrst, 'reload schema';
