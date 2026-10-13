-- =====================================================================
-- Migration 005: importação de fatura de cartão (PDF lido no navegador).
--
-- import_card_lines grava, de uma vez só (tudo ou nada), as compras revisadas pelo
-- usuário em UMA fatura. As regras (qual é a fatura, datas, categoria sugerida) vêm do
-- JS; o banco só garante: cartão do usuário, fatura criada/reaproveitada, fatura paga
-- continua imutável (trigger guard_paid_invoice) e linha já importada não duplica
-- (índice único de external_id por usuário).
--
-- SECURITY INVOKER: roda com as permissões e o RLS de quem chama. Não mexe no schema
-- public nem em auth.users (o projeto é compartilhado com outros apps).
-- =====================================================================

create or replace function "controle-financeiro".import_card_lines(
  p_card    uuid,
  p_invoice jsonb,   -- { period_start, closing_date, due_date }
  p_lines   jsonb    -- [{ date, description, amount, category_id, subcategory_id, external_id }]
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_inv      uuid;
  v_line     jsonb;
  v_cat      uuid;
  v_sub      uuid;
  v_n        integer;
  v_imported integer := 0;
  v_skipped  integer := 0;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nenhuma compra para importar.' using errcode = 'CF003';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'Muitas compras de uma vez (máximo 500).' using errcode = 'CF003';
  end if;

  if not exists (
    select 1 from "controle-financeiro".credit_cards where id = p_card and status = 'active'
  ) then
    raise exception 'Cartão não encontrado ou arquivado.' using errcode = 'CF002';
  end if;

  v_inv := "controle-financeiro".ensure_invoice(p_card, p_invoice);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_cat := nullif(v_line->>'category_id', '')::uuid;
    v_sub := nullif(v_line->>'subcategory_id', '')::uuid;

    -- o RLS só deixa enxergar categorias do próprio usuário
    if v_cat is not null and not exists (
      select 1 from "controle-financeiro".categories where id = v_cat
    ) then
      raise exception 'Categoria não encontrada.' using errcode = 'CF002';
    end if;
    if v_sub is not null and not exists (
      select 1 from "controle-financeiro".subcategories where id = v_sub and category_id = v_cat
    ) then
      v_sub := null;
    end if;

    insert into "controle-financeiro".transactions
      (type, amount, date, description, credit_card_id, invoice_id,
       category_id, subcategory_id, source, external_id)
    values
      ('expense', (v_line->>'amount')::numeric, (v_line->>'date')::date,
       left(nullif(btrim(v_line->>'description'), ''), 120), p_card, v_inv,
       v_cat, v_sub, 'import', nullif(v_line->>'external_id', ''))
    on conflict (user_id, external_id) where external_id is not null do nothing;

    get diagnostics v_n = row_count;
    v_imported := v_imported + v_n;
    v_skipped := v_skipped + (1 - v_n);
  end loop;

  return jsonb_build_object('invoice_id', v_inv, 'imported', v_imported, 'skipped', v_skipped);
end;
$$;

revoke execute on function "controle-financeiro".import_card_lines(uuid, jsonb, jsonb) from public, anon;
grant  execute on function "controle-financeiro".import_card_lines(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
