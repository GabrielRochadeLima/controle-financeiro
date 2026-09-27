// Orçamentos: limite mensal por categoria de despesa. O consumido é calculado no
// cliente a partir das movimentações do mês (mesma fonte de Movimentações e do
// dashboard); nenhuma soma de gasto mora no banco.
import { supabase } from '../core/supabase.js';
import { cached, invalidate } from '../core/store.js';
import { toISODate, todayISO } from '../core/format.js';
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

/** Gasto do mês corrente (dia 1 até hoje) por categoria: Map categoryId -> total. */
export async function spentThisMonth() {
  const now = new Date();
  const from = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const rows = await unwrap(supabase.from('transactions')
    .select('category_id, amount')
    .eq('type', 'expense').not('category_id', 'is', null)
    .gte('date', from).lte('date', todayISO()));
  const totals = new Map();
  for (const r of rows) totals.set(r.category_id, (totals.get(r.category_id) || 0) + Number(r.amount));
  return totals;
}
