// Cartões, faturas e compras no cartão. As REGRAS (datas de fatura, divisão das
// parcelas) vêm de core/cards.js; as escritas compostas passam por funções do banco
// (supabase/migrations/003_cards_invoices.sql) para serem atômicas.
import { supabase } from '../core/supabase.js';
import { invalidate, cached } from '../core/store.js';
import { unwrap } from './db.js';

const CARD_COLUMNS = 'id, name, institution, credit_limit, closing_day, due_day, default_payment_account_id, status';

export const getCards = () => cached('cards', () =>
  unwrap(supabase.from('credit_cards').select(CARD_COLUMNS).order('name')));

export async function createCard(value) {
  await unwrap(supabase.from('credit_cards').insert(value));
  invalidate('cards');
}

export async function updateCard(id, value) {
  await unwrap(supabase.from('credit_cards').update(value).eq('id', id));
  invalidate('cards');
}

export const setCardStatus = (id, status) => updateCard(id, { status });

/** O banco recusa se houver compras (FK RESTRICT): a UI sugere arquivar. */
export async function deleteCard(id) {
  await unwrap(supabase.from('credit_cards').delete().eq('id', id));
  invalidate('cards');
}

// ---------- faturas ----------

/** Faturas não pagas de todos os cartões, com total (base do limite usado e do dashboard). */
export const loadUnpaidInvoices = () => unwrap(supabase.from('v_invoices')
  .select('*').is('paid_at', null).order('due_date'));

/** Todas as faturas de um cartão (poucas por ano), da mais antiga para a mais nova. */
export const loadCardInvoices = (cardId) => unwrap(supabase.from('v_invoices')
  .select('*').eq('credit_card_id', cardId).order('closing_date'));

/** Compras de uma fatura (inclui o rótulo da parcela via plano). */
export const loadInvoicePurchases = (invoiceId) => unwrap(supabase.from('transactions')
  .select('id, type, amount, date, description, notes, credit_card_id, invoice_id, category_id, ' +
    'subcategory_id, installment_plan_id, installment_number, plan:installment_plans(installments_count)')
  .eq('invoice_id', invoiceId).eq('type', 'expense')
  .order('date', { ascending: false }).order('created_at', { ascending: false }));

// ---------- compras (funções atômicas do banco) ----------

/**
 * @param {object} purchase  { credit_card_id, description, notes, category_id, subcategory_id,
 *                             total_amount, installments_count, parcels } (parcels de planPurchase)
 */
export const createCardPurchase = (purchase) =>
  unwrap(supabase.rpc('create_card_purchase', { p_purchase: purchase }));

export async function updateCardPurchase(id, values, invoice = null) {
  await unwrap(supabase.rpc('update_card_purchase', { p_transaction_id: id, p_values: values, p_invoice: invoice }));
}

export async function updateInstallmentPlan(planId, { description, category_id, subcategory_id }) {
  await unwrap(supabase.rpc('update_installment_plan', {
    p_plan_id: planId, p_description: description, p_category_id: category_id, p_subcategory_id: subcategory_id,
  }));
}

/** @returns {{deleted: number, locked: number, remaining: number}} */
export const deleteInstallments = (planId, fromNumber, onlyThis = false) =>
  unwrap(supabase.rpc('delete_installments', { p_plan_id: planId, p_from_number: fromNumber, p_only_this: onlyThis }));

/** Plano + parcelas com a situação da fatura de cada uma. */
export async function loadPlan(planId) {
  const [plan, parcels] = await Promise.all([
    unwrap(supabase.from('installment_plans')
      .select('id, credit_card_id, description, total_amount, installments_count, first_date, category_id, subcategory_id, status')
      .eq('id', planId).single()),
    unwrap(supabase.from('transactions')
      .select('id, amount, date, installment_number, invoice:credit_card_invoices(id, closing_date, due_date, paid_at)')
      .eq('installment_plan_id', planId).order('installment_number')),
  ]);
  return { plan, parcels };
}

// ---------- pagamento ----------

export const payInvoice = (invoiceId, accountId, date) =>
  unwrap(supabase.rpc('pay_invoice', { p_invoice_id: invoiceId, p_account_id: accountId, p_date: date }));

export async function unpayInvoice(invoiceId) {
  await unwrap(supabase.rpc('unpay_invoice', { p_invoice_id: invoiceId }));
}
