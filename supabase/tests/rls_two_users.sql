-- =====================================================================
-- Teste de isolamento (RLS) entre dois usuários.
--
-- Como usar:
--   1. Supabase > Authentication > Users: copie o UUID de DOIS usuários
--      diferentes (podem ser de qualquer app do projeto; crie uma segunda
--      conta se só houver uma).
--   2. Cole abaixo no lugar de USER_A e USER_B.
--   3. SQL Editor > Run.
--
-- Resultado esperado: o script termina com um "erro" que começa com
--   "RLS OK ..."
-- Isso é proposital: a exceção final desfaz TUDO (rollback), então nada é
-- gravado no seu banco. Qualquer outra mensagem (começando com "FALHA") indica
-- um vazamento e o RLS NÃO deve ser considerado seguro.
--
-- O que é verificado:
--   A cria uma conta -> B não consegue ler, alterar, apagar nem inserir em nome
--   de A; a função account_flows de B não retorna dados de A; e o papel anon
--   (visitante sem login) não acessa o schema.
-- =====================================================================
do $$
declare
  a uuid := 'USER_A'::uuid;
  b uuid := 'USER_B'::uuid;
  acc_id uuid;
  n integer;
begin
  if a = b then raise exception 'FALHA de uso: USER_A e USER_B precisam ser diferentes'; end if;

  -- ---- como usuário A: cria uma conta ----
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into "controle-financeiro".accounts (name) values ('zz_rls_teste') returning id into acc_id;

  select count(*) into n from "controle-financeiro".accounts where id = acc_id;
  if n <> 1 then raise exception 'FALHA: A não enxerga a própria conta'; end if;

  -- ---- como usuário B: não pode ver nem mexer nos dados de A ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  select count(*) into n from "controle-financeiro".accounts where id = acc_id;
  if n <> 0 then raise exception 'FALHA: B LEU a conta de A'; end if;

  select count(*) into n from "controle-financeiro".accounts where user_id = a;
  if n <> 0 then raise exception 'FALHA: B listou contas de A'; end if;

  update "controle-financeiro".accounts set name = 'invadido' where id = acc_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: B ALTEROU a conta de A'; end if;

  delete from "controle-financeiro".accounts where id = acc_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: B APAGOU a conta de A'; end if;

  begin
    insert into "controle-financeiro".accounts (user_id, name) values (a, 'zz_invasor');
    raise exception 'FALHA: B INSERIU uma conta em nome de A';
  exception when insufficient_privilege then
    null; -- esperado: RLS bloqueou (SQLSTATE 42501)
  end;

  select count(*) into n from "controle-financeiro".account_flows() where account_id = acc_id;
  if n <> 0 then raise exception 'FALHA: account_flows de B retornou dados de A'; end if;

  -- ---- visitante sem login ----
  perform set_config('role', 'anon', true);
  begin
    perform 1 from "controle-financeiro".accounts limit 1;
    raise exception 'FALHA: anon conseguiu consultar o schema';
  exception when insufficient_privilege then
    null; -- esperado
  end;

  raise exception 'RLS OK: A, B e anon estão isolados (nada foi gravado: rollback proposital)';
end;
$$;
