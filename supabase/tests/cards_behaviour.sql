-- =====================================================================
-- Teste de comportamento da migration 003 (cartões, faturas, parcelas).
--
-- Como usar (depois de aplicar 001, 002 e 003):
--   1. Supabase > Authentication > Users: copie o UUID de DOIS usuários diferentes.
--   2. Substitua USER_A e USER_B abaixo (ocorrem 2 vezes cada).
--   3. SQL Editor > Run.
--
-- Resultado esperado: termina com um "erro" que começa com "TESTES 003 OK".
-- É proposital: a exceção final desfaz TUDO (rollback); nada fica gravado.
-- Qualquer mensagem "FALHA n" indica um problema na migration.
--
-- Cobre: compra à vista e parcelada (atômica), validação de soma das parcelas,
-- edição movendo de fatura, pagamento (o valor vem do banco, não entra no total
-- da fatura, baixa a conta), fatura paga imutável, isolamento entre usuários,
-- exclusão de parcelas (uma / a partir de / toda) preservando as pagas, desfazer
-- pagamento e cartão com compras não excluível.
-- =====================================================================
do $$
declare
  a uuid := 'USER_A'::uuid;
  b uuid := 'USER_B'::uuid;
  acc uuid; card uuid; tx1 uuid; p1 uuid; p2 uuid; inv_oct uuid; res jsonb; n int; tot numeric; pay uuid; st text;
  ok_sep jsonb := '{"period_start":"2026-08-04","closing_date":"2026-09-03","due_date":"2026-09-10"}';
  ok_oct jsonb := '{"period_start":"2026-09-04","closing_date":"2026-10-03","due_date":"2026-10-10"}';
  ok_nov jsonb := '{"period_start":"2026-10-04","closing_date":"2026-11-03","due_date":"2026-11-10"}';
  ok_dec jsonb := '{"period_start":"2026-11-04","closing_date":"2026-12-03","due_date":"2026-12-10"}';
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  insert into "controle-financeiro".accounts (name, initial_balance) values ('Conta A', 1000) returning id into acc;
  insert into "controle-financeiro".credit_cards (name, credit_limit, closing_day, due_day) values ('Nubank', 5000, 3, 10) returning id into card;

  -- 1) a vista
  tx1 := "controle-financeiro".create_card_purchase(jsonb_build_object('credit_card_id', card, 'description', 'Almoco',
    'total_amount', 45.90, 'installments_count', 1, 'category_id', null,
    'parcels', jsonb_build_array(jsonb_build_object('number', 1, 'amount', 45.90, 'date', '2026-09-02', 'invoice', ok_sep))));
  select count(*) into n from "controle-financeiro".transactions where id = tx1 and type = 'expense' and account_id is null and credit_card_id = card and installment_plan_id is null;
  if n <> 1 then raise exception 'FALHA 1: compra a vista mal gravada'; end if;
  select total_amount into tot from "controle-financeiro".v_invoices where credit_card_id = card and closing_date = '2026-09-03';
  if tot <> 45.90 then raise exception 'FALHA 1b: total da fatura de setembro = %', tot; end if;

  -- 2) parcelada 3x de 300
  p1 := "controle-financeiro".create_card_purchase(jsonb_build_object('credit_card_id', card, 'description', 'Notebook',
    'total_amount', 300, 'installments_count', 3, 'category_id', null,
    'parcels', jsonb_build_array(
      jsonb_build_object('number', 1, 'amount', 100, 'date', '2026-09-05', 'invoice', ok_oct),
      jsonb_build_object('number', 2, 'amount', 100, 'date', '2026-10-05', 'invoice', ok_nov),
      jsonb_build_object('number', 3, 'amount', 100, 'date', '2026-11-05', 'invoice', ok_dec))));
  select count(*) into n from "controle-financeiro".transactions where installment_plan_id = p1 and source = 'installment';
  if n <> 3 then raise exception 'FALHA 2: esperava 3 parcelas, veio %', n; end if;
  select count(*) into n from "controle-financeiro".credit_card_invoices where credit_card_id = card;
  if n <> 4 then raise exception 'FALHA 2b: esperava 4 faturas, veio %', n; end if;

  -- 3) validacoes
  begin
    perform "controle-financeiro".create_card_purchase(jsonb_build_object('credit_card_id', card, 'total_amount', 100, 'installments_count', 2,
      'parcels', jsonb_build_array(jsonb_build_object('number',1,'amount',40,'date','2026-09-05','invoice',ok_oct), jsonb_build_object('number',2,'amount',40,'date','2026-10-05','invoice',ok_nov))));
    raise exception 'FALHA 3: aceitou soma de parcelas errada';
  exception when sqlstate 'CF003' then null; end;
  select count(*) into n from "controle-financeiro".installment_plans where total_amount = 100;
  if n <> 0 then raise exception 'FALHA 3b: plano inconsistente ficou gravado'; end if;

  -- 4) editar a vista: muda valor, data e fatura (setembro -> outubro)
  perform "controle-financeiro".update_card_purchase(tx1, '{"amount":50,"date":"2026-09-05","description":"Almoco","category_id":null,"subcategory_id":null}'::jsonb, ok_oct);
  select total_amount into tot from "controle-financeiro".v_invoices where credit_card_id = card and closing_date = '2026-09-03';
  if tot <> 0 then raise exception 'FALHA 4: fatura de setembro deveria zerar, tem %', tot; end if;
  select total_amount into tot from "controle-financeiro".v_invoices where credit_card_id = card and closing_date = '2026-10-03';
  if tot <> 150 then raise exception 'FALHA 4b: fatura de outubro deveria ter 150, tem %', tot; end if;
  select id into inv_oct from "controle-financeiro".credit_card_invoices where credit_card_id = card and closing_date = '2026-10-03';

  -- 5) editar plano: descricao vale para todas as parcelas
  perform "controle-financeiro".update_installment_plan(p1, 'Notebook Dell', null, null);
  select count(*) into n from "controle-financeiro".transactions where installment_plan_id = p1 and description = 'Notebook Dell';
  if n <> 3 then raise exception 'FALHA 5: descricao nao propagou (%)', n; end if;

  -- 6) pagar outubro (150)
  pay := "controle-financeiro".pay_invoice(inv_oct, acc, '2026-10-11');
  select count(*) into n from "controle-financeiro".transactions where id = pay and type = 'invoice_payment' and amount = 150 and account_id = acc and credit_card_id = card and invoice_id = inv_oct;
  if n <> 1 then raise exception 'FALHA 6: pagamento mal gravado'; end if;
  select total_amount into tot from "controle-financeiro".v_invoices where id = inv_oct;
  if tot <> 150 then raise exception 'FALHA 6b: pagamento nao pode entrar no total da fatura (%)', tot; end if;
  select invoice_payment into tot from "controle-financeiro".account_flows('2026-12-31') where account_id = acc;
  if tot <> 150 then raise exception 'FALHA 6c: account_flows.invoice_payment = %', tot; end if;
  begin perform "controle-financeiro".pay_invoice(inv_oct, acc, '2026-10-12'); raise exception 'FALHA 6d: pagou duas vezes';
  exception when sqlstate 'CF004' then null; end;

  -- 7) fatura paga e imutavel (mas notas/descricao seguem editaveis)
  begin delete from "controle-financeiro".transactions where id = tx1; raise exception 'FALHA 7a: apagou compra de fatura paga';
  exception when sqlstate 'CF001' then null; end;
  begin update "controle-financeiro".transactions set amount = 1 where id = tx1; raise exception 'FALHA 7b: alterou valor em fatura paga';
  exception when sqlstate 'CF001' then null; end;
  begin update "controle-financeiro".transactions set date = '2026-09-20' where id = tx1; raise exception 'FALHA 7c: alterou data em fatura paga';
  exception when sqlstate 'CF001' then null; end;
  update "controle-financeiro".transactions set notes = 'ok' where id = tx1;
  get diagnostics n = row_count; if n <> 1 then raise exception 'FALHA 7d: notas deveriam ser editaveis'; end if;
  begin perform "controle-financeiro".create_card_purchase(jsonb_build_object('credit_card_id', card, 'total_amount', 10, 'installments_count', 1,
      'parcels', jsonb_build_array(jsonb_build_object('number',1,'amount',10,'date','2026-09-06','invoice',ok_oct))));
    raise exception 'FALHA 7e: inseriu compra em fatura paga';
  exception when sqlstate 'CF001' then null; end;
  begin perform "controle-financeiro".update_card_purchase(tx1, '{"amount":50,"date":"2026-09-05"}'::jsonb, ok_sep); raise exception 'FALHA 7f: moveu compra de fatura paga';
  exception when sqlstate 'CF001' then null; end;

  -- 8) outro usuario nao enxerga nem mexe em nada disso
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from "controle-financeiro".v_invoices; if n <> 0 then raise exception 'FALHA 8a: B ve faturas de A'; end if;
  begin perform "controle-financeiro".pay_invoice(inv_oct, acc, '2026-10-12'); raise exception 'FALHA 8b: B pagou fatura de A';
  exception when sqlstate 'CF002' then null; end;
  begin perform "controle-financeiro".unpay_invoice(inv_oct); raise exception 'FALHA 8c: B desfez pagamento de A';
  exception when sqlstate 'CF002' then null; end;
  begin perform "controle-financeiro".delete_installments(p1, 1, false); raise exception 'FALHA 8d: B apagou parcelas de A';
  exception when sqlstate 'CF002' then null; end;
  begin perform "controle-financeiro".update_installment_plan(p1, 'x', null, null); raise exception 'FALHA 8e: B editou plano de A';
  exception when sqlstate 'CF002' then null; end;
  begin perform "controle-financeiro".create_card_purchase(jsonb_build_object('credit_card_id', card, 'total_amount', 10, 'installments_count', 1,
      'parcels', jsonb_build_array(jsonb_build_object('number',1,'amount',10,'date','2026-09-06','invoice',ok_sep))));
    raise exception 'FALHA 8f: B comprou no cartao de A';
  exception when sqlstate 'CF002' then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- 9) cancelar plano inteiro com parcela em fatura paga: mantem a paga, remove o resto
  res := "controle-financeiro".delete_installments(p1, 1, false);
  if (res->>'deleted')::int <> 2 or (res->>'locked')::int <> 1 or (res->>'remaining')::int <> 1 then raise exception 'FALHA 9: resultado %', res; end if;
  select status into st from "controle-financeiro".installment_plans where id = p1;
  if st <> 'canceled' then raise exception 'FALHA 9b: plano deveria estar canceled, esta %', st; end if;

  -- 10) desfazer o pagamento reabre a fatura e remove a saida da conta
  perform "controle-financeiro".unpay_invoice(inv_oct);
  select count(*) into n from "controle-financeiro".credit_card_invoices where id = inv_oct and paid_at is null; if n <> 1 then raise exception 'FALHA 10: fatura nao reabriu'; end if;
  select count(*) into n from "controle-financeiro".transactions where type = 'invoice_payment'; if n <> 0 then raise exception 'FALHA 10b: pagamento nao foi removido'; end if;
  select invoice_payment into tot from "controle-financeiro".account_flows('2026-12-31') where account_id = acc;
  if tot <> 0 then raise exception 'FALHA 10c: saldo ainda considera pagamento (%)', tot; end if;
  res := "controle-financeiro".delete_installments(p1, 1, false);
  if (res->>'remaining')::int <> 0 then raise exception 'FALHA 10d: %', res; end if;
  select count(*) into n from "controle-financeiro".installment_plans where id = p1; if n <> 0 then raise exception 'FALHA 10e: plano vazio deveria sumir'; end if;

  -- 11) excluir so uma parcela mantem o plano ativo
  p2 := "controle-financeiro".create_card_purchase(jsonb_build_object('credit_card_id', card, 'description', 'Sofa', 'total_amount', 300, 'installments_count', 3,
    'parcels', jsonb_build_array(
      jsonb_build_object('number', 1, 'amount', 100, 'date', '2026-09-05', 'invoice', ok_oct),
      jsonb_build_object('number', 2, 'amount', 100, 'date', '2026-10-05', 'invoice', ok_nov),
      jsonb_build_object('number', 3, 'amount', 100, 'date', '2026-11-05', 'invoice', ok_dec))));
  res := "controle-financeiro".delete_installments(p2, 2, true);
  select status into st from "controle-financeiro".installment_plans where id = p2;
  if (res->>'deleted')::int <> 1 or (res->>'remaining')::int <> 2 or st <> 'active' then raise exception 'FALHA 11: % / %', res, st; end if;
  select count(*) into n from "controle-financeiro".transactions where installment_plan_id = p2 and installment_number = 2; if n <> 0 then raise exception 'FALHA 11b'; end if;
  res := "controle-financeiro".delete_installments(p2, 3, false);
  select status into st from "controle-financeiro".installment_plans where id = p2;
  if (res->>'deleted')::int <> 1 or st <> 'canceled' then raise exception 'FALHA 11c: % / %', res, st; end if;

  -- 12) cartao com compras nao pode ser apagado
  begin delete from "controle-financeiro".credit_cards where id = card; raise exception 'FALHA 12: apagou cartao com compras';
  exception when restrict_violation or foreign_key_violation then null; end;

  raise exception 'TESTES 003 OK: compra, parcelamento, pagamento, imutabilidade, isolamento e cancelamento';
end;
$$;
