-- =====================================================================
-- Gráfico "receitas x despesas por mês" do dashboard.
--
-- Como aplicar: SQL Editor > cole e execute (depois da 001, 002 e 003).
-- ORDEM DE DEPLOY: rode ANTES de publicar o código. Se ela faltar, o dashboard
-- continua funcionando; só o gráfico de meses deixa de aparecer.
--
-- É somente leitura e aditiva. Devolve SOMAS BRUTAS por tipo em cada mês (as
-- REGRAS — o que conta como receita/despesa — continuam em js/core/finance.js).
-- Agregar no banco evita baixar centenas de linhas e o limite de 1.000 linhas
-- por consulta da API. SECURITY INVOKER: o RLS do usuário continua valendo.
-- =====================================================================
create or replace function "controle-financeiro".monthly_flows(p_from date, p_until date)
returns table (
  month_start date,
  income      numeric,
  expense     numeric,
  investment  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    date_trunc('month', t.date::timestamp)::date,
    coalesce(sum(t.amount) filter (where t.type = 'income'),     0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'),    0),
    coalesce(sum(t.amount) filter (where t.type = 'investment'), 0)
  from "controle-financeiro".transactions t
  where t.date >= p_from
    and t.date <= p_until
    and t.type in ('income', 'expense', 'investment')
  group by 1
  order by 1
$$;

revoke execute on function "controle-financeiro".monthly_flows(date, date) from public, anon;
grant  execute on function "controle-financeiro".monthly_flows(date, date) to authenticated;

notify pgrst, 'reload schema';
