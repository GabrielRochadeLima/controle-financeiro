-- =====================================================================
-- Testes da Migration 007 (Investimentos com resgate/saldo atual e Metas com conta).
--
-- Como usar:
--   1. Substitua USER_A pelo UUID de um usuário de teste (Authentication > Users).
--   2. Execute no SQL Editor do Supabase.
--   3. Termina com "TESTES 007 OK" (rollback automático: não grava nada no banco).
-- =====================================================================
do $$
declare
  u uuid := 'USER_A'::uuid;
  v_acc uuid;
  v_inv uuid;
  v_goal uuid;
  v_flow record;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  insert into "controle-financeiro".accounts (name, initial_balance)
  values ('zz_conta_007', 1000) returning id into v_acc;

  insert into "controle-financeiro".investments (name, kind, current_amount)
  values ('zz_inv_007', 'fixed_income', 650) returning id into v_inv;

  -- Aporte de 600 e resgate de 100
  insert into "controle-financeiro".transactions (type, amount, date, account_id, investment_id)
  values
    ('investment', 600, current_date, v_acc, v_inv),
    ('investment_redemption', 100, current_date, v_acc, v_inv);

  -- Meta com contribuição de 150 debitada da conta
  insert into "controle-financeiro".financial_goals (name, target_amount)
  values ('zz_meta_007', 1000) returning id into v_goal;

  insert into "controle-financeiro".goal_contributions (goal_id, account_id, amount, date)
  values (v_goal, v_acc, 150, current_date);

  select * into v_flow from "controle-financeiro".account_flows(current_date) where account_id = v_acc;
  if v_flow.transfer_in <> 100 then
    raise exception 'FALHA: transfer_in (resgate) esperado 100, obtido %', v_flow.transfer_in;
  end if;
  if v_flow.investment <> 750 then
    raise exception 'FALHA: investment (aporte 600 + meta 150) esperado 750, obtido %', v_flow.investment;
  end if;

  raise exception 'TESTES 007 OK (rollback proposital)';
end;
$$;
