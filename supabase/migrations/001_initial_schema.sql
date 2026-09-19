-- =====================================================================
-- Controle Financeiro Pessoal — schema inicial (PostgreSQL / Supabase)
--
-- Como aplicar: Supabase Dashboard > SQL Editor > cole e execute este arquivo.
-- Todas as tabelas ficam no schema "controle-financeiro" (não usa public).
-- É idempotente apenas na primeira execução (não usa "if not exists" nas
-- tabelas de propósito, para não mascarar divergências de schema).
--
-- DECISÕES DE MODELAGEM (leia antes de mexer)
--
-- 1. transactions é a tabela central. Todo valor que aparece em saldo,
--    relatório, orçamento ou previsão é uma linha aqui. `amount` é sempre
--    POSITIVO; o sinal vem do `type`:
--      expense          saída (conta OU cartão). Conta: baixa o saldo.
--                       Cartão: NÃO baixa saldo; entra na fatura.
--      income           entrada em conta.
--      transfer         account_id (origem) -> to_account_id (destino).
--                       Não é receita nem despesa.
--      investment       saída de conta para investimento (só o aporte).
--      invoice_payment  pagamento de fatura: baixa a conta, mas NÃO é
--                       despesa (a despesa já foi contada na compra).
--
-- 2. Compra parcelada = 1 linha em installment_plans (a compra) + N linhas
--    em transactions (as parcelas), cada uma com installment_number e a
--    data em que cai na fatura. Assim, saldo/fatura/previsão/orçamento
--    somam a MESMA tabela, sem UNION. A "tabela installments" sugerida
--    no briefing foi absorvida por esse desenho para evitar duplicar
--    valor/data/status em dois lugares.
--
-- 3. Recorrência: recurring_transactions guarda a regra; as ocorrências
--    são materializadas como transactions (recurring_id + date, único),
--    o que permite "editar só esta ocorrência" e torna a geração
--    idempotente (rodar duas vezes não duplica).
--
-- 4. Fatura: status Aberta/Fechada/Atrasada é DERIVADO de datas no JS
--    (js/core/finance.js). Só `paid_at` é persistido. Total da fatura vem
--    da view v_invoice_totals.
--
-- 5. Saldo de conta: a view/função entrega somas brutas por tipo; a
--    FÓRMULA do saldo fica no JS (regras financeiras centralizadas).
--
-- 6. Estado "efetivado" é derivado da data (date <= hoje), sem coluna de
--    status em transactions. Simples e sem estados que ficam velhos.
--
-- 7. Preparação para o futuro (sem implementar): transactions.source,
--    external_id (dedupe de importação/Open Finance) e metadata (dados de
--    PDF/IA) permitem plugar essas funcionalidades sem migração pesada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Schema dedicado (o projeto Supabase é compartilhado com outros apps: tudo
-- deste sistema vive em "controle-financeiro" e NADA é tocado em public).
-- O schema também precisa estar em Settings > API > Exposed schemas.
-- ---------------------------------------------------------------------
create schema if not exists "controle-financeiro";
grant usage on schema "controle-financeiro" to authenticated;

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles (1:1 com auth.users; é a "tabela users" do briefing)
-- ---------------------------------------------------------------------
create table "controle-financeiro".profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) <= 60),
  preferences  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------
create table "controle-financeiro".accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 60),
  institution     text check (institution is null or char_length(institution) <= 60),
  type            text not null default 'checking'
                  check (type in ('checking', 'savings', 'cash', 'wallet', 'investment', 'other')),
  initial_balance numeric(14,2) not null default 0,
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index accounts_user_idx on "controle-financeiro".accounts (user_id);
create unique index accounts_user_name_uq on "controle-financeiro".accounts (user_id, lower(name));

-- ---------------------------------------------------------------------
-- credit_cards
-- ---------------------------------------------------------------------
create table "controle-financeiro".credit_cards (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                      text not null check (char_length(btrim(name)) between 1 and 60),
  institution               text check (institution is null or char_length(institution) <= 60),
  credit_limit              numeric(14,2) not null default 0 check (credit_limit >= 0),
  closing_day               smallint not null check (closing_day between 1 and 31),
  due_day                   smallint not null check (due_day between 1 and 31),
  default_payment_account_id uuid references "controle-financeiro".accounts (id) on delete set null,
  status                    text not null default 'active' check (status in ('active', 'archived')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index credit_cards_user_idx on "controle-financeiro".credit_cards (user_id);
create unique index credit_cards_user_name_uq on "controle-financeiro".credit_cards (user_id, lower(name));

-- ---------------------------------------------------------------------
-- categories / subcategories (editáveis pelo usuário; nada fixo no código)
-- ---------------------------------------------------------------------
create table "controle-financeiro".categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  kind       text not null default 'expense' check (kind in ('expense', 'income')),
  color      text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  icon       text check (icon is null or char_length(icon) <= 16),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index categories_user_idx on "controle-financeiro".categories (user_id, kind, sort_order);
create unique index categories_user_kind_name_uq on "controle-financeiro".categories (user_id, kind, lower(name));

create table "controle-financeiro".subcategories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references "controle-financeiro".categories (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index subcategories_category_idx on "controle-financeiro".subcategories (category_id, sort_order);
create unique index subcategories_category_name_uq on "controle-financeiro".subcategories (category_id, lower(name));

-- ---------------------------------------------------------------------
-- credit_card_invoices
-- ---------------------------------------------------------------------
create table "controle-financeiro".credit_card_invoices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  credit_card_id uuid not null references "controle-financeiro".credit_cards (id) on delete cascade,
  period_start   date not null,
  closing_date   date not null,
  due_date       date not null,
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint invoices_period_chk check (period_start <= closing_date),
  constraint invoices_due_chk    check (due_date >= closing_date),
  constraint invoices_card_closing_uq unique (credit_card_id, closing_date)
);
create index invoices_user_due_idx on "controle-financeiro".credit_card_invoices (user_id, due_date);

-- ---------------------------------------------------------------------
-- installment_plans (a compra parcelada; as parcelas são transactions)
-- ---------------------------------------------------------------------
create table "controle-financeiro".installment_plans (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  credit_card_id      uuid not null references "controle-financeiro".credit_cards (id) on delete restrict,
  description         text not null check (char_length(btrim(description)) between 1 and 120),
  total_amount        numeric(14,2) not null check (total_amount > 0),
  installments_count  smallint not null check (installments_count between 2 and 120),
  first_date          date not null,
  category_id         uuid references "controle-financeiro".categories (id) on delete set null,
  subcategory_id      uuid references "controle-financeiro".subcategories (id) on delete set null,
  status              text not null default 'active' check (status in ('active', 'canceled')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index installment_plans_user_idx on "controle-financeiro".installment_plans (user_id);
create index installment_plans_card_idx on "controle-financeiro".installment_plans (credit_card_id);

-- ---------------------------------------------------------------------
-- recurring_transactions (a regra; ocorrências são transactions)
-- ---------------------------------------------------------------------
create table "controle-financeiro".recurring_transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type           text not null check (type in ('expense', 'income')),
  description    text not null check (char_length(btrim(description)) between 1 and 120),
  amount         numeric(14,2) not null check (amount > 0),
  account_id     uuid references "controle-financeiro".accounts (id) on delete restrict,
  credit_card_id uuid references "controle-financeiro".credit_cards (id) on delete restrict,
  category_id    uuid references "controle-financeiro".categories (id) on delete set null,
  subcategory_id uuid references "controle-financeiro".subcategories (id) on delete set null,
  frequency      text not null default 'monthly' check (frequency in ('weekly', 'monthly', 'yearly')),
  -- O dia da recorrência é derivado de start_date (dia 31 vira último dia em meses curtos, no JS).
  start_date     date not null,
  end_date       date,
  status         text not null default 'active' check (status in ('active', 'paused', 'ended')),
  -- Até quando as ocorrências já foram materializadas (geração incremental).
  generated_until date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint recurring_end_chk check (end_date is null or end_date >= start_date),
  constraint recurring_source_chk check (
    (account_id is not null)::int + (credit_card_id is not null)::int = 1
    and (type = 'expense' or credit_card_id is null)
  )
);
create index recurring_user_status_idx on "controle-financeiro".recurring_transactions (user_id, status);

-- ---------------------------------------------------------------------
-- investments (ativo; o aporte em si é uma transaction type='investment')
-- Estrutura mínima agora; rentabilidade poderá entrar em tabela própria depois.
-- ---------------------------------------------------------------------
create table "controle-financeiro".investments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  kind        text not null default 'other'
              check (kind in ('fixed_income', 'stocks', 'funds', 'crypto', 'other')),
  institution text check (institution is null or char_length(institution) <= 60),
  status      text not null default 'active' check (status in ('active', 'closed')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index investments_user_idx on "controle-financeiro".investments (user_id);

-- ---------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------
create table "controle-financeiro".transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type                text not null
                      check (type in ('expense', 'income', 'transfer', 'investment', 'invoice_payment')),
  amount              numeric(14,2) not null check (amount > 0),
  date                date not null,
  description         text check (description is null or char_length(description) <= 120),
  notes               text,

  account_id          uuid references "controle-financeiro".accounts (id) on delete restrict,
  to_account_id       uuid references "controle-financeiro".accounts (id) on delete restrict,
  credit_card_id      uuid references "controle-financeiro".credit_cards (id) on delete restrict,
  invoice_id          uuid references "controle-financeiro".credit_card_invoices (id) on delete restrict,

  category_id         uuid references "controle-financeiro".categories (id) on delete set null,
  subcategory_id      uuid references "controle-financeiro".subcategories (id) on delete set null,

  installment_plan_id uuid references "controle-financeiro".installment_plans (id) on delete cascade,
  installment_number  smallint check (installment_number is null or installment_number >= 1),
  recurring_id        uuid references "controle-financeiro".recurring_transactions (id) on delete set null,
  investment_id       uuid references "controle-financeiro".investments (id) on delete set null,

  -- Preparação para importação CSV/PDF/IA/Open Finance (não usado na Fase 1-5).
  source              text not null default 'manual'
                      check (source in ('manual', 'recurring', 'installment', 'import', 'ai', 'open_finance')),
  external_id         text,
  metadata            jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint transactions_subcategory_needs_category
    check (subcategory_id is null or category_id is not null),
  constraint transactions_installment_chk
    check ((installment_plan_id is null) = (installment_number is null)),
  -- Cada tipo só combina com certos vínculos: garante que uma transferência
  -- nunca vire despesa e que compra no cartão nunca toque em conta.
  constraint transactions_shape_chk check (
    (type = 'expense'
       and ((account_id is not null)::int + (credit_card_id is not null)::int) = 1
       and to_account_id is null)
    or (type = 'income'
       and account_id is not null and credit_card_id is null and to_account_id is null)
    or (type = 'transfer'
       and account_id is not null and to_account_id is not null
       and account_id <> to_account_id and credit_card_id is null)
    or (type = 'investment'
       and account_id is not null and credit_card_id is null and to_account_id is null)
    or (type = 'invoice_payment'
       and account_id is not null and credit_card_id is not null
       and invoice_id is not null and to_account_id is null)
  )
);
create index transactions_user_date_idx    on "controle-financeiro".transactions (user_id, date desc);
create index transactions_account_date_idx on "controle-financeiro".transactions (account_id, date) where account_id is not null;
create index transactions_to_account_idx   on "controle-financeiro".transactions (to_account_id) where to_account_id is not null;
create index transactions_card_date_idx    on "controle-financeiro".transactions (credit_card_id, date) where credit_card_id is not null;
create index transactions_invoice_idx      on "controle-financeiro".transactions (invoice_id) where invoice_id is not null;
create index transactions_category_idx     on "controle-financeiro".transactions (category_id) where category_id is not null;
create index transactions_plan_idx         on "controle-financeiro".transactions (installment_plan_id) where installment_plan_id is not null;
-- Geração de recorrências idempotente: uma ocorrência por regra e data.
create unique index transactions_recurring_date_uq
  on "controle-financeiro".transactions (recurring_id, date) where recurring_id is not null;
-- Dedupe de importações futuras.
create unique index transactions_external_uq
  on "controle-financeiro".transactions (user_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------
-- budgets (limite mensal por categoria)
-- ---------------------------------------------------------------------
create table "controle-financeiro".budgets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id     uuid not null references "controle-financeiro".categories (id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  alert_threshold smallint not null default 80 check (alert_threshold between 1 and 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint budgets_user_category_uq unique (user_id, category_id)
);

-- ---------------------------------------------------------------------
-- financial_goals / goal_contributions
-- "Valor atual" da meta = soma das contribuições (não é coluna, evita divergir).
-- ---------------------------------------------------------------------
create table "controle-financeiro".financial_goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  target_amount numeric(14,2) not null check (target_amount > 0),
  target_date   date,
  status        text not null default 'active' check (status in ('active', 'completed', 'canceled')),
  completed_at  timestamptz,
  color         text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  icon          text check (icon is null or char_length(icon) <= 16),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index financial_goals_user_idx on "controle-financeiro".financial_goals (user_id, status);

create table "controle-financeiro".goal_contributions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id    uuid not null references "controle-financeiro".financial_goals (id) on delete cascade,
  amount     numeric(14,2) not null check (amount > 0),
  date       date not null default current_date,
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goal_contributions_goal_idx on "controle-financeiro".goal_contributions (goal_id, date desc);

-- ---------------------------------------------------------------------
-- Triggers updated_at + RLS (uma policy por tabela: dono vê/altera só o seu)
-- (select auth.uid()) em subselect é avaliado uma vez por query, não por linha.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'accounts', 'credit_cards', 'categories', 'subcategories',
    'credit_card_invoices', 'installment_plans', 'recurring_transactions',
    'investments', 'transactions', 'budgets', 'financial_goals', 'goal_contributions'
  ]
  loop
    execute format('create trigger set_updated_at before update on "controle-financeiro".%I
                    for each row execute function "controle-financeiro".set_updated_at()', t);
    execute format('alter table "controle-financeiro".%I enable row level security', t);
  end loop;

  foreach t in array array[
    'accounts', 'credit_cards', 'categories', 'subcategories',
    'credit_card_invoices', 'installment_plans', 'recurring_transactions',
    'investments', 'transactions', 'budgets', 'financial_goals', 'goal_contributions'
  ]
  loop
    execute format(
      'create policy "own_rows" on "controle-financeiro".%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

create policy "own_profile" on "controle-financeiro".profiles for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Agregações (somas brutas; as REGRAS ficam em js/core/finance.js)
-- security invoker => RLS do usuário que consulta continua valendo.
-- ---------------------------------------------------------------------

-- Somas por conta até p_until (data local do usuário, enviada pelo cliente:
-- current_date do servidor é UTC e erraria o dia à noite no Brasil).
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
  select
    a.id,
    coalesce(sum(t.amount) filter (where t.type = 'income'          and t.account_id    = a.id), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'         and t.account_id    = a.id), 0),
    coalesce(sum(t.amount) filter (where t.type = 'transfer'        and t.to_account_id = a.id), 0),
    coalesce(sum(t.amount) filter (where t.type = 'transfer'        and t.account_id    = a.id), 0),
    coalesce(sum(t.amount) filter (where t.type = 'investment'      and t.account_id    = a.id), 0),
    coalesce(sum(t.amount) filter (where t.type = 'invoice_payment' and t.account_id    = a.id), 0)
  from "controle-financeiro".accounts a
  left join "controle-financeiro".transactions t
    on (t.account_id = a.id or t.to_account_id = a.id)
   and (p_until is null or t.date <= p_until)
  group by a.id
$$;

-- Total de cada fatura = soma das compras (expense). O pagamento da fatura
-- (invoice_payment) compartilha invoice_id mas não entra no total.
create view "controle-financeiro".v_invoice_totals
with (security_invoker = true) as
select
  i.id as invoice_id,
  coalesce(sum(t.amount) filter (where t.type = 'expense'), 0) as total_amount,
  count(t.id) filter (where t.type = 'expense') as purchases_count
from "controle-financeiro".credit_card_invoices i
left join "controle-financeiro".transactions t on t.invoice_id = i.id
group by i.id;

-- ---------------------------------------------------------------------
-- Categorias padrão (editáveis) semeadas no primeiro acesso do usuário.
-- Categorias são dados do usuário, não constantes do código.
-- ---------------------------------------------------------------------
create or replace function "controle-financeiro".seed_default_categories(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  seed jsonb := '[
    {"name":"Alimentação","kind":"expense","color":"#F97316","icon":"🍽️","subs":["Mercado","Restaurante","Delivery","Lanches"]},
    {"name":"Transporte","kind":"expense","color":"#0EA5E9","icon":"🚗","subs":["Combustível","Uber","Estacionamento","Manutenção"]},
    {"name":"Moradia","kind":"expense","color":"#8B5CF6","icon":"🏠","subs":["Aluguel","Condomínio","Energia","Água","Internet"]},
    {"name":"Saúde","kind":"expense","color":"#EF4444","icon":"💊","subs":["Farmácia","Consulta","Plano de saúde"]},
    {"name":"Lazer","kind":"expense","color":"#EC4899","icon":"🎮","subs":["Cinema","Jogos","Viagens"]},
    {"name":"Educação","kind":"expense","color":"#14B8A6","icon":"📚","subs":[]},
    {"name":"Assinaturas","kind":"expense","color":"#6366F1","icon":"🔁","subs":[]},
    {"name":"Compras","kind":"expense","color":"#F59E0B","icon":"🛍️","subs":[]},
    {"name":"Outros","kind":"expense","color":"#64748B","icon":"📦","subs":[]},
    {"name":"Salário","kind":"income","color":"#16A34A","icon":"💰","subs":[]},
    {"name":"Freelance","kind":"income","color":"#22C55E","icon":"💼","subs":[]},
    {"name":"Rendimentos","kind":"income","color":"#10B981","icon":"📈","subs":[]},
    {"name":"Outros","kind":"income","color":"#64748B","icon":"📦","subs":[]}
  ]'::jsonb;
  item   jsonb;
  cat_id uuid;
  pos    integer := 0;
begin
  for item in select * from jsonb_array_elements(seed)
  loop
    insert into "controle-financeiro".categories (user_id, name, kind, color, icon, sort_order)
    values (p_user, item->>'name', item->>'kind', item->>'color', item->>'icon', pos)
    returning id into cat_id;

    insert into "controle-financeiro".subcategories (user_id, category_id, name, sort_order)
    select p_user, cat_id, s.val, s.n - 1
    from jsonb_array_elements_text(item->'subs') with ordinality as s(val, n);

    pos := pos + 1;
  end loop;
end;
$$;

-- Bootstrap sob demanda (em vez de trigger em auth.users): este projeto Supabase
-- é compartilhado com outros apps e auth.users é global, então um trigger
-- criaria perfil/categorias para o cadastro de QUALQUER app. O frontend chama
-- esta função uma vez após o login; ela só cria dados para o usuário atual e
-- só semeia categorias na PRIMEIRA vez (não recria se o usuário apagar todas).
create or replace function "controle-financeiro".bootstrap_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into "controle-financeiro".profiles (id, display_name)
  select u.id, nullif(btrim(coalesce(u.raw_user_meta_data->>'display_name', '')), '')
  from auth.users u
  where u.id = uid
  on conflict (id) do nothing
  returning id into new_id;

  if new_id is not null then
    perform "controle-financeiro".seed_default_categories(uid);
  end if;
end;
$$;

-- Funções internas não devem ser chamáveis via API.
revoke execute on function "controle-financeiro".seed_default_categories(uuid) from public, anon, authenticated;
revoke execute on function "controle-financeiro".bootstrap_user()               from public, anon;
grant  execute on function "controle-financeiro".bootstrap_user()               to authenticated;

-- ---------------------------------------------------------------------
-- Privilégios: somente usuários autenticados; RLS faz o filtro por dono.
-- anon não acessa nada.
-- ---------------------------------------------------------------------
revoke all on all tables in schema "controle-financeiro" from anon;
grant select, insert, update, delete on all tables in schema "controle-financeiro" to authenticated;

revoke execute on function "controle-financeiro".account_flows(date) from public, anon;
grant  execute on function "controle-financeiro".account_flows(date) to authenticated;

-- ---------------------------------------------------------------------
-- Usuário já existente: não precisa de nada manual. Ao entrar, o app chama
-- bootstrap_user(), que cria o perfil e as categorias padrão na primeira vez.
-- ---------------------------------------------------------------------
