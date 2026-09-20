-- =====================================================================
-- Fase 3: cartões, faturas e parcelamentos.
--
-- Como aplicar: SQL Editor > cole e execute (depois da 001 e da 002).
-- ORDEM DE DEPLOY: rode esta migration ANTES de publicar o código da Fase 3.
-- É aditiva: não altera nem apaga dados existentes.
--
-- PRINCÍPIO: as REGRAS (qual fatura recebe uma compra, datas de
-- fechamento/vencimento, divisão das parcelas) ficam no JS (js/core/cards.js).
-- O banco só PERSISTE de forma atômica o que o JS calculou e protege a
-- integridade (fatura paga é imutável). Todas as funções são SECURITY INVOKER:
-- o RLS do usuário continua valendo dentro delas.
--
-- Códigos de erro próprios (SQLSTATE) que o frontend traduz:
--   CF001 compra em fatura já paga (bloqueada)     CF004 fatura já paga
--   CF002 cartão/compra/conta/fatura inexistente   CF005 fatura sem valor a pagar
--   CF003 dados da compra inconsistentes
-- =====================================================================

-- ---------------------------------------------------------------------
-- Faturas com total (uma consulta só: faturas + soma das compras).
-- O pagamento (invoice_payment) compartilha invoice_id mas NÃO entra no total.
-- ---------------------------------------------------------------------
create view "controle-financeiro".v_invoices
with (security_invoker = true) as
select
  i.id,
  i.user_id,
  i.credit_card_id,
  i.period_start,
  i.closing_date,
  i.due_date,
  i.paid_at,
  coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)::numeric(14,2) as total_amount,
  (count(t.id) filter (where t.type = 'expense'))::integer as purchases_count
from "controle-financeiro".credit_card_invoices i
left join "controle-financeiro".transactions t on t.invoice_id = i.id
group by i.id;

grant select on "controle-financeiro".v_invoices to authenticated;

-- ---------------------------------------------------------------------
-- Fatura paga é imutável: impede inserir, apagar ou mudar valor/data/fatura de
-- uma compra que pertence (ou passaria a pertencer) a uma fatura paga.
-- Editar só descrição/categoria continua permitido.
-- Sem usuário autenticado (ex.: exclusão em cascata da conta) não interfere.
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".guard_paid_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_paid boolean;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.type = 'expense' and old.invoice_id is not null then
    if tg_op = 'DELETE'
       or new.amount is distinct from old.amount
       or new.date is distinct from old.date
       or new.invoice_id is distinct from old.invoice_id
       or new.type is distinct from old.type
       or new.credit_card_id is distinct from old.credit_card_id then
      select i.paid_at is not null into v_paid
      from "controle-financeiro".credit_card_invoices i where i.id = old.invoice_id;
      if coalesce(v_paid, false) then
        raise exception 'Esta compra está em uma fatura já paga.' using errcode = 'CF001';
      end if;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.type = 'expense' and new.invoice_id is not null
     and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id) then
    select i.paid_at is not null into v_paid
    from "controle-financeiro".credit_card_invoices i where i.id = new.invoice_id;
    if coalesce(v_paid, false) then
      raise exception 'Esta fatura já foi paga.' using errcode = 'CF001';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_paid_invoice
  before insert or update or delete on "controle-financeiro".transactions
  for each row execute function "controle-financeiro".guard_paid_invoice();

-- ---------------------------------------------------------------------
-- Auxiliar: obtém a fatura de um cartão pelo fechamento, criando se não existir.
-- Se já existir, mantém as datas gravadas (ex.: o usuário mudou o dia de
-- fechamento do cartão; faturas já criadas não são reescritas).
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".ensure_invoice(p_card uuid, p_invoice jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_closing date := (p_invoice->>'closing_date')::date;
  v_id uuid;
begin
  if not exists (select 1 from "controle-financeiro".credit_cards where id = p_card) then
    raise exception 'Cartão não encontrado.' using errcode = 'CF002';
  end if;

  insert into "controle-financeiro".credit_card_invoices (credit_card_id, period_start, closing_date, due_date)
  values (p_card, (p_invoice->>'period_start')::date, v_closing, (p_invoice->>'due_date')::date)
  on conflict (credit_card_id, closing_date) do nothing;

  select i.id into v_id
  from "controle-financeiro".credit_card_invoices i
  where i.credit_card_id = p_card and i.closing_date = v_closing;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Compra no cartão (à vista = 1 parcela; parcelada = plano + N parcelas), atômica.
-- p_purchase: { credit_card_id, description, notes, category_id, subcategory_id,
--               total_amount, installments_count,
--               parcels: [{ number, amount, date, invoice: {period_start, closing_date, due_date} }] }
-- Retorna o id do plano (parcelada) ou da transação (à vista).
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".create_card_purchase(p_purchase jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_card    uuid    := (p_purchase->>'credit_card_id')::uuid;
  v_count   integer := coalesce((p_purchase->>'installments_count')::integer, 1);
  v_total   numeric := (p_purchase->>'total_amount')::numeric;
  v_desc    text    := nullif(btrim(coalesce(p_purchase->>'description', '')), '');
  v_notes   text    := nullif(btrim(coalesce(p_purchase->>'notes', '')), '');
  v_cat     uuid    := (p_purchase->>'category_id')::uuid;
  v_sub     uuid    := (p_purchase->>'subcategory_id')::uuid;
  v_parcels jsonb   := p_purchase->'parcels';
  v_plan uuid;
  v_tx   uuid;
  v_inv  uuid;
  v_parcel jsonb;
begin
  if not exists (select 1 from "controle-financeiro".credit_cards where id = v_card and status = 'active') then
    raise exception 'Cartão não encontrado ou arquivado.' using errcode = 'CF002';
  end if;
  if jsonb_typeof(v_parcels) is distinct from 'array' or jsonb_array_length(v_parcels) <> v_count then
    raise exception 'Parcelas inconsistentes com a quantidade informada.' using errcode = 'CF003';
  end if;
  if (select coalesce(sum((x->>'amount')::numeric), 0) from jsonb_array_elements(v_parcels) x) <> v_total then
    raise exception 'A soma das parcelas difere do valor total.' using errcode = 'CF003';
  end if;

  if v_count > 1 then
    insert into "controle-financeiro".installment_plans
      (credit_card_id, description, total_amount, installments_count, first_date, category_id, subcategory_id)
    values
      (v_card, coalesce(v_desc, 'Compra parcelada'), v_total, v_count,
       (select min((x->>'date')::date) from jsonb_array_elements(v_parcels) x), v_cat, v_sub)
    returning id into v_plan;
  end if;

  for v_parcel in select * from jsonb_array_elements(v_parcels)
  loop
    v_inv := "controle-financeiro".ensure_invoice(v_card, v_parcel->'invoice');

    insert into "controle-financeiro".transactions
      (type, amount, date, description, notes, credit_card_id, invoice_id,
       category_id, subcategory_id, installment_plan_id, installment_number, source)
    values
      ('expense', (v_parcel->>'amount')::numeric, (v_parcel->>'date')::date,
       case when v_count > 1 then coalesce(v_desc, 'Compra parcelada') else v_desc end,
       v_notes, v_card, v_inv, v_cat, v_sub, v_plan,
       case when v_count > 1 then (v_parcel->>'number')::smallint end,
       case when v_count > 1 then 'installment' else 'manual' end)
    returning id into v_tx;
  end loop;

  return coalesce(v_plan, v_tx);
end;
$$;

-- ---------------------------------------------------------------------
-- Edita uma compra à vista no cartão. Se a data mudou, o JS envia a nova
-- fatura em p_invoice (senão null e a compra continua na fatura atual).
-- Compras parceladas usam update_installment_plan / delete_installments.
-- p_values: { amount, date, description, notes, category_id, subcategory_id }
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".update_card_purchase(
  p_transaction_id uuid, p_values jsonb, p_invoice jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_card uuid;
  v_inv  uuid;
begin
  select t.credit_card_id, t.invoice_id into v_card, v_inv
  from "controle-financeiro".transactions t
  where t.id = p_transaction_id and t.type = 'expense'
    and t.credit_card_id is not null and t.installment_plan_id is null;
  if not found then
    raise exception 'Compra não encontrada.' using errcode = 'CF002';
  end if;

  if p_invoice is not null then
    v_inv := "controle-financeiro".ensure_invoice(v_card, p_invoice);
  end if;

  update "controle-financeiro".transactions set
    amount         = (p_values->>'amount')::numeric,
    date           = (p_values->>'date')::date,
    description    = nullif(btrim(coalesce(p_values->>'description', '')), ''),
    notes          = nullif(btrim(coalesce(p_values->>'notes', '')), ''),
    category_id    = (p_values->>'category_id')::uuid,
    subcategory_id = (p_values->>'subcategory_id')::uuid,
    invoice_id     = v_inv
  where id = p_transaction_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Edita descrição/categoria de uma compra parcelada: plano e TODAS as parcelas,
-- juntos. Valores e datas não mudam (não corrompe faturas nem parcelas pagas).
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".update_installment_plan(
  p_plan_id uuid, p_description text, p_category_id uuid, p_subcategory_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_desc text := coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'Compra parcelada');
begin
  update "controle-financeiro".installment_plans
     set description = v_desc, category_id = p_category_id, subcategory_id = p_subcategory_id
   where id = p_plan_id;
  if not found then
    raise exception 'Compra parcelada não encontrada.' using errcode = 'CF002';
  end if;

  update "controle-financeiro".transactions
     set description = v_desc, category_id = p_category_id, subcategory_id = p_subcategory_id
   where installment_plan_id = p_plan_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Exclui parcelas de um plano. Parcelas em faturas PAGAS nunca são removidas.
--   p_only_this = true  : só a parcela p_from_number
--   p_only_this = false : da parcela p_from_number em diante (1 = toda a compra)
-- Se não sobrar parcela, o plano some; se sobrar (pagas), o plano vira 'canceled'.
-- Retorna { deleted, locked, remaining }.
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".delete_installments(
  p_plan_id uuid, p_from_number integer, p_only_this boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_deleted integer;
  v_locked  integer;
  v_left    integer;
begin
  if not exists (select 1 from "controle-financeiro".installment_plans where id = p_plan_id) then
    raise exception 'Compra parcelada não encontrada.' using errcode = 'CF002';
  end if;

  delete from "controle-financeiro".transactions t
  using "controle-financeiro".credit_card_invoices i
  where t.installment_plan_id = p_plan_id
    and t.invoice_id = i.id
    and i.paid_at is null
    and (case when p_only_this then t.installment_number = p_from_number
              else t.installment_number >= p_from_number end);
  get diagnostics v_deleted = row_count;

  select count(*) into v_locked
  from "controle-financeiro".transactions t
  where t.installment_plan_id = p_plan_id
    and (case when p_only_this then t.installment_number = p_from_number
              else t.installment_number >= p_from_number end);

  select count(*) into v_left
  from "controle-financeiro".transactions where installment_plan_id = p_plan_id;

  if v_left = 0 then
    delete from "controle-financeiro".installment_plans where id = p_plan_id;
  elsif not p_only_this then
    update "controle-financeiro".installment_plans set status = 'canceled' where id = p_plan_id;
  end if;

  return jsonb_build_object('deleted', v_deleted, 'locked', v_locked, 'remaining', v_left);
end;
$$;

-- ---------------------------------------------------------------------
-- Paga a fatura inteira: cria a saída da conta (invoice_payment) e marca paga.
-- O valor é calculado aqui a partir das compras, nunca vem do cliente.
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".pay_invoice(
  p_invoice_id uuid, p_account_id uuid, p_date date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_card    uuid;
  v_paid    timestamptz;
  v_name    text;
  v_total   numeric;
  v_tx      uuid;
begin
  select i.credit_card_id, i.paid_at, c.name into v_card, v_paid, v_name
  from "controle-financeiro".credit_card_invoices i
  join "controle-financeiro".credit_cards c on c.id = i.credit_card_id
  where i.id = p_invoice_id;
  if not found then
    raise exception 'Fatura não encontrada.' using errcode = 'CF002';
  end if;
  if v_paid is not null then
    raise exception 'Esta fatura já foi paga.' using errcode = 'CF004';
  end if;
  if not exists (select 1 from "controle-financeiro".accounts where id = p_account_id and status = 'active') then
    raise exception 'Conta não encontrada ou arquivada.' using errcode = 'CF002';
  end if;

  select v.total_amount into v_total from "controle-financeiro".v_invoices v where v.id = p_invoice_id;
  if coalesce(v_total, 0) <= 0 then
    raise exception 'Esta fatura não tem valor a pagar.' using errcode = 'CF005';
  end if;

  insert into "controle-financeiro".transactions
    (type, amount, date, description, account_id, credit_card_id, invoice_id, source)
  values
    ('invoice_payment', v_total, p_date, 'Fatura ' || v_name, p_account_id, v_card, p_invoice_id, 'manual')
  returning id into v_tx;

  update "controle-financeiro".credit_card_invoices set paid_at = now() where id = p_invoice_id;
  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------
-- Desfaz o pagamento (útil se foi pago por engano): reabre a fatura e remove a saída da conta.
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".unpay_invoice(p_invoice_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update "controle-financeiro".credit_card_invoices set paid_at = null
   where id = p_invoice_id and paid_at is not null;
  if not found then
    raise exception 'Fatura não encontrada ou não está paga.' using errcode = 'CF002';
  end if;

  delete from "controle-financeiro".transactions
   where invoice_id = p_invoice_id and type = 'invoice_payment';
end;
$$;

-- ---------------------------------------------------------------------
-- Privilégios: só usuários autenticados chamam as funções.
-- ---------------------------------------------------------------------
revoke execute on function "controle-financeiro".ensure_invoice(uuid, jsonb)                          from public, anon;
revoke execute on function "controle-financeiro".create_card_purchase(jsonb)                          from public, anon;
revoke execute on function "controle-financeiro".update_card_purchase(uuid, jsonb, jsonb)             from public, anon;
revoke execute on function "controle-financeiro".update_installment_plan(uuid, text, uuid, uuid)      from public, anon;
revoke execute on function "controle-financeiro".delete_installments(uuid, integer, boolean)          from public, anon;
revoke execute on function "controle-financeiro".pay_invoice(uuid, uuid, date)                        from public, anon;
revoke execute on function "controle-financeiro".unpay_invoice(uuid)                                  from public, anon;

grant execute on function "controle-financeiro".ensure_invoice(uuid, jsonb)                           to authenticated;
grant execute on function "controle-financeiro".create_card_purchase(jsonb)                           to authenticated;
grant execute on function "controle-financeiro".update_card_purchase(uuid, jsonb, jsonb)              to authenticated;
grant execute on function "controle-financeiro".update_installment_plan(uuid, text, uuid, uuid)       to authenticated;
grant execute on function "controle-financeiro".delete_installments(uuid, integer, boolean)           to authenticated;
grant execute on function "controle-financeiro".pay_invoice(uuid, uuid, date)                         to authenticated;
grant execute on function "controle-financeiro".unpay_invoice(uuid)                                   to authenticated;

-- Faz a API (PostgREST) enxergar a view e as funções novas sem reiniciar.
notify pgrst, 'reload schema';
