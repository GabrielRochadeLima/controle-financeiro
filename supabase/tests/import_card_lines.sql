-- =====================================================================
-- Teste da função import_card_lines (migration 005).
--
-- Como usar: troque USER_A e USER_B por UUIDs de DOIS usuários diferentes
-- (Supabase > Authentication > Users) e rode no SQL Editor.
-- Resultado esperado: termina com um "erro" que começa com "IMPORT OK"
-- (proposital: a exceção final desfaz tudo; nada fica gravado).
-- =====================================================================
do $$
declare
  a uuid := 'USER_A'::uuid;
  b uuid := 'USER_B'::uuid;
  card uuid; card_b uuid; cat uuid; r jsonb; n integer; inv uuid; total numeric;
  inv_json jsonb := '{"period_start":"2026-08-06","closing_date":"2026-09-05","due_date":"2026-09-14"}';
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  insert into "controle-financeiro".credit_cards (name, credit_limit, closing_day, due_day)
    values ('zz_cartao', 5000, 5, 14) returning id into card;
  insert into "controle-financeiro".categories (name, kind) values ('zz_cat', 'expense') returning id into cat;

  -- 1) importa 3 compras (uma com categoria) numa fatura nova
  r := "controle-financeiro".import_card_lines(card, inv_json, jsonb_build_array(
    jsonb_build_object('date', '2026-08-20', 'description', 'Loja A (2/5)', 'amount', 100.10, 'category_id', cat, 'external_id', 'imp-t-1'),
    jsonb_build_object('date', '2026-08-21', 'description', 'Loja B', 'amount', 50, 'external_id', 'imp-t-2'),
    jsonb_build_object('date', '2026-09-05', 'description', 'Loja C', 'amount', 0.01, 'external_id', 'imp-t-3')));
  if (r->>'imported')::int <> 3 or (r->>'skipped')::int <> 0 then raise exception 'FALHA 1: %', r; end if;
  inv := (r->>'invoice_id')::uuid;

  select total_amount into total from "controle-financeiro".v_invoices where id = inv;
  if total <> 150.11 then raise exception 'FALHA 2: total da fatura %', total; end if;

  -- 2) importar de novo não duplica
  r := "controle-financeiro".import_card_lines(card, inv_json, jsonb_build_array(
    jsonb_build_object('date', '2026-08-20', 'description', 'Loja A (2/5)', 'amount', 100.10, 'external_id', 'imp-t-1'),
    jsonb_build_object('date', '2026-08-25', 'description', 'Loja D', 'amount', 10, 'external_id', 'imp-t-4')));
  if (r->>'imported')::int <> 1 or (r->>'skipped')::int <> 1 then raise exception 'FALHA 3: %', r; end if;
  select count(*) into n from "controle-financeiro".transactions where invoice_id = inv and source = 'import';
  if n <> 4 then raise exception 'FALHA 4: esperava 4 compras, veio %', n; end if;

  -- 3) fatura paga é imutável (trigger)
  update "controle-financeiro".credit_card_invoices set paid_at = now() where id = inv;
  begin
    perform "controle-financeiro".import_card_lines(card, inv_json, jsonb_build_array(
      jsonb_build_object('date', '2026-08-26', 'description', 'Loja E', 'amount', 5, 'external_id', 'imp-t-5')));
    raise exception 'FALHA 5: importou em fatura paga';
  exception when sqlstate 'CF001' then null; end;

  -- 4) linha inválida desfaz o lote inteiro (tudo ou nada)
  begin
    perform "controle-financeiro".import_card_lines(card, '{"period_start":"2026-09-06","closing_date":"2026-10-05","due_date":"2026-10-14"}',
      jsonb_build_array(
        jsonb_build_object('date', '2026-09-10', 'description', 'Boa', 'amount', 5, 'external_id', 'imp-t-6'),
        jsonb_build_object('date', '2026-09-11', 'description', 'Ruim', 'amount', -1, 'external_id', 'imp-t-7')));
    raise exception 'FALHA 6: aceitou valor negativo';
  exception when check_violation then null; end;
  select count(*) into n from "controle-financeiro".transactions where external_id = 'imp-t-6';
  if n <> 0 then raise exception 'FALHA 7: lote parcial gravado'; end if;

  -- 5) outro usuário: não enxerga o cartão nem importa nele
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform "controle-financeiro".import_card_lines(card, inv_json, jsonb_build_array(
      jsonb_build_object('date', '2026-08-20', 'description', 'Invasor', 'amount', 1, 'external_id', 'imp-t-8')));
    raise exception 'FALHA 8: B importou no cartão de A';
  exception when sqlstate 'CF002' then null; end;

  -- 6) visitante sem login não executa
  perform set_config('role', 'anon', true);
  begin
    perform "controle-financeiro".import_card_lines(card, inv_json, '[]'::jsonb);
    raise exception 'FALHA 9: anon executou a função';
  exception when insufficient_privilege then null; end;

  raise exception 'IMPORT OK: fatura criada, total correto, sem duplicar, fatura paga protegida, tudo-ou-nada e isolamento';
end;
$$;
