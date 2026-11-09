// Orçamentos: limite mensal por categoria de despesa. O consumido é calculado no
// cliente a partir das movimentações do mês (mesma fonte de Movimentações e do
// dashboard); nenhuma soma de gasto mora no banco.
import { supabase } from '../core/supabase.js';
import { cached, invalidate } from '../core/store.js';
import { toISODate, todayISO } from '../core/format.js';
import { activeMonthInvoiceIds } from '../core/cards.js';
import { getCards, loadAllInvoices } from './cards.js';
import { unwrap } from './db.js';

export const getBudgets = () => cached('budgets', () =>
  unwrap(supabase.from('budgets').select('id, category_id, amount, alert_threshold')));

/** @param {{ amount: number, alert_threshold: number }} value */
export async function upsertBudget(categoryId, value) {
  const { data: { user } } = await supabase.auth.getUser();
  await unwrap(supabase.from('budgets')
    .upsert({ user_id: user.id, category_id: categoryId, ...value }, { onConflict: 'user_id,category_id' }));
  invalidate('budgets');
}

export async function deleteBudget(id) {
  await unwrap(supabase.from('budgets').delete().eq('id', id));
  invalidate('budgets');
}

/** Gasto do mês corrente (em conta: dia 1 até hoje; no cartão: fatura do mês) por categoria. */
export async function spentThisMonth() {
  const now = new Date();
  const today = todayISO();
  const from = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const [accountRows, cards, allInvoices] = await Promise.all([
    unwrap(supabase.from('transactions')
      .select('category_id, amount')
      .eq('type', 'expense').not('category_id', 'is', null)
      .is('credit_card_id', null)
      .gte('date', from).lte('date', today)),
    getCards().catch(() => []),
    loadAllInvoices().catch(() => null),
  ]);
  let cardRows = [];
  if (allInvoices) {
    const invoiceIds = activeMonthInvoiceIds(cards, allInvoices, today);
    if (invoiceIds.length > 0) {
      cardRows = await unwrap(supabase.from('transactions')
        .select('category_id, amount')
        .eq('type', 'expense').not('category_id', 'is', null)
        .in('invoice_id', invoiceIds));
    }
  } else {
    cardRows = await unwrap(supabase.from('transactions')
      .select('category_id, amount')
      .eq('type', 'expense').not('category_id', 'is', null)
      .not('credit_card_id', 'is', null)
      .gte('date', from).lte('date', today));
  }
  const totals = new Map();
  for (const r of [...accountRows, ...cardRows]) {
    totals.set(r.category_id, Math.round(((totals.get(r.category_id) || 0) + Number(r.amount)) * 100) / 100);
  }
  return totals;
}
