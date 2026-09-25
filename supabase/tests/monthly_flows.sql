-- =====================================================================
-- Teste da função monthly_flows (migration 004).
--
-- Como usar: troque USER_A e USER_B por UUIDs de DOIS usuários diferentes
-- (Supabase > Authentication > Users) e rode no SQL Editor.
-- Resultado esperado: termina com um "erro" que começa com "MONTHLY_FLOWS OK"
-- (proposital: a exceção final desfaz tudo; nada fica gravado).
-- =====================================================================
do $$
declare
  a uuid := 'USER_A'::uuid;
  b uuid := 'USER_B'::uuid;
  acc uuid; acc2 uuid; n integer; r record;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  insert into "controle-financeiro".accounts (name) values ('zz_conta') returning id into acc;
  insert into "controle-financeiro".accounts (name) values ('zz_conta2') returning id into acc2;

  insert into "controle-financeiro".transactions (type, amount, date, account_id, to_account_id) values
    ('income',   5000,   '2026-07-05', acc, null),
    ('expense',  1200.5, '2026-07-10', acc, null),
    ('expense',  99.5,   '2026-07-31', acc, null),
    ('investment', 300,  '2026-07-20', acc, null),
    ('transfer', 700,    '2026-07-21', acc, acc2),         -- transferência não entra
    ('expense',  40,     '2026-08-01', acc, null),
    ('income',   5200,   '2026-09-30', acc, null),
    ('expense',  10,     '2026-10-01', acc, null);          -- fora do intervalo

  -- meses com movimento aparecem; mês sem movimento não aparece (o JS completa com zero)
  select count(*) into n from "controle-financeiro".monthly_flows('2026-07-01', '2026-09-30');
  if n <> 3 then raise exception 'FALHA 1: esperava 3 meses, veio %', n; end if;

  select * into r from "controle-financeiro".monthly_flows('2026-07-01', '2026-09-30') where month_start = '2026-07-01';
  if r.income <> 5000 or r.expense <> 1300 or r.investment <> 300 then
    raise exception 'FALHA 2: julho income=% expense=% investment=%', r.income, r.expense, r.investment;
  end if;

  -- limites do intervalo são inclusivos (31/07 entra; 01/10 fica de fora)
  select expense into r from "controle-financeiro".monthly_flows('2026-07-31', '2026-07-31');
  if r.expense <> 99.5 then raise exception 'FALHA 3: limite inclusivo (%)', r.expense; end if;
  select count(*) into n from "controle-financeiro".monthly_flows('2026-10-01', '2026-10-01');
  if n <> 1 then raise exception 'FALHA 3b'; end if;

  -- outro usuário não enxerga nada
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from "controle-financeiro".monthly_flows('2000-01-01', '2100-01-01');
  if n <> 0 then raise exception 'FALHA 4: B viu dados de A'; end if;

  -- visitante sem login não acessa
  perform set_config('role', 'anon', true);
  begin
    perform 1 from "controle-financeiro".monthly_flows('2000-01-01', '2100-01-01');
    raise exception 'FALHA 5: anon executou a função';
  exception when insufficient_privilege then null; end;

  raise exception 'MONTHLY_FLOWS OK: somas por tipo, transferência ignorada, limites inclusivos e isolamento';
end;
$$;
