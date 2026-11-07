-- =====================================================================
-- Migration 007: Evolução de Investimentos (Resgates + Saldo Atual) e
--                Metas (Contribuição opcionalmente vinculada a uma Conta).
--
-- Como aplicar: SQL Editor > cole e execute (depois das migrations 001..006).
-- É aditiva e idempotente: preserva todos os dados existentes.
--
-- O que muda:
--   1. investments ganha `current_amount` (opcional, >= 0) para acompanhar o
--      saldo atual na corretora e calcular o rendimento em relação ao aportado.
--   2. transactions aceita o novo tipo `investment_redemption` (resgate de
--      investimento de volta para uma conta).
--   3. goal_contributions ganha `account_id` (opcional): quando preenchido,
--      o valor contribuído sai do saldo daquela conta.
--   4. account_flows(p_until) passa a computar os resgates de investimento
--      (somando em `transfer_in` e expondo `investment_redemption`) e as
--      contribuições de meta vinculadas à conta (somando em `investment` e
--      expondo `goal_contribution` nas funções compatíveis).
--      Para não exigir DROP FUNCTION (mantendo a assinatura da tabela retornada
--      por account_flows idêntica e retrocompatível com qualquer versão do app),
--      `transfer_in` inclui os resgates (`investment_redemption`) ou `investment`
--      é líquido (aportes - resgates + contribuições de metas).
-- =====================================================================

-- 1. Saldo atual opcional em investments
alter table "controle-financeiro".investments
  add column if not exists current_amount numeric(14,2)
  check (current_amount is null or current_amount >= 0);

-- 2. Conta opcional em goal_contributions (debita do saldo da conta quando escolhida)
alter table "controle-financeiro".goal_contributions
  add column if not exists account_id uuid
  references "controle-financeiro".accounts (id) on delete restrict;

create index if not exists goal_contributions_account_idx
  on "controle-financeiro".goal_contributions (account_id, date)
  where account_id is not null;

-- 3. Novo tipo `investment_redemption` em transactions
alter table "controle-financeiro".transactions
  drop constraint if exists transactions_type_check,
  drop constraint if exists transactions_shape_chk;

alter table "controle-financeiro".transactions
  add constraint transactions_type_check
    check (type in ('expense', 'income', 'transfer', 'investment', 'investment_redemption', 'invoice_payment')),
  add constraint transactions_shape_chk check (
    (type = 'expense'
       and ((account_id is not null)::int + (credit_card_id is not null)::int) = 1
       and to_account_id is null)
    or (type = 'income'
       and account_id is not null and credit_card_id is null and to_account_id is null)
    or (type = 'transfer'
       and account_id is not null and to_account_id is not null
       and account_id <> to_account_id and credit_card_id is null)
    or (type in ('investment', 'investment_redemption')
       and account_id is not null and credit_card_id is null and to_account_id is null)
    or (type = 'invoice_payment'
       and account_id is not null and credit_card_id is not null
       and invoice_id is not null and to_account_id is null)
  );

-- 4. Atualiza account_flows mantendo as mesmas 7 colunas de saída (sem precisar de DROP FUNCTION):
--    - `transfer_in` soma transferências recebidas + resgates de investimentos (`investment_redemption`)
--    - `investment` soma aportes (`investment`) + contribuições de metas vinculadas à conta (`goal_contributions`)
create or replace function "controle-financeiro".account_flows(p_until date default null)
returns table (
  account_id      uuid,
  income          numeric,
  expense         numeric,
  transfer_in     numeric,
  transfer_out    numeric,
  investment      numeric,
  invoice_payment numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with tx as (
    select
      a.id as account_id,
      coalesce(sum(t.amount) filter (where t.type = 'income'                and t.account_id    = a.id), 0) as income,
      coalesce(sum(t.amount) filter (where t.type = 'expense'               and t.account_id    = a.id), 0) as expense,
      coalesce(sum(t.amount) filter (where (t.type = 'transfer' and t.to_account_id = a.id)
                                        or (t.type = 'investment_redemption' and t.account_id = a.id)), 0) as transfer_in,
      coalesce(sum(t.amount) filter (where t.type = 'transfer'              and t.account_id    = a.id), 0) as transfer_out,
      coalesce(sum(t.amount) filter (where t.type = 'investment'            and t.account_id    = a.id), 0) as investment,
      coalesce(sum(t.amount) filter (where t.type = 'invoice_payment'       and t.account_id    = a.id), 0) as invoice_payment
    from "controle-financeiro".accounts a
    left join "controle-financeiro".transactions t
      on (t.account_id = a.id or t.to_account_id = a.id)
     and (p_until is null or t.date <= p_until)
    group by a.id
  ),
  gc as (
    select
      g.account_id,
      coalesce(sum(g.amount), 0) as goal_saved
    from "controle-financeiro".goal_contributions g
    where g.account_id is not null
      and (p_until is null or g.date <= p_until)
    group by g.account_id
  )
  select
    tx.account_id,
    tx.income,
    tx.expense,
    tx.transfer_in,
    tx.transfer_out,
    tx.investment + coalesce(gc.goal_saved, 0) as investment,
    tx.invoice_payment
  from tx
  left join gc on gc.account_id = tx.account_id
$$;

revoke execute on function "controle-financeiro".account_flows(date) from public, anon;
grant  execute on function "controle-financeiro".account_flows(date) to authenticated;

notify pgrst, 'reload schema';
