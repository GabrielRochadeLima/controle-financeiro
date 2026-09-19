// Carrega e calcula os dados do dashboard. Só busca o necessário, em paralelo,
// e reaproveita contas/categorias do cache.
import { supabase } from '../core/supabase.js';
import { toISODate, todayISO } from '../core/format.js';
import { accountBalance, totalBalance, periodSummary, spendingByCategory } from '../core/finance.js';
import { getAccounts, getCategories } from './reference.js';
import { unwrap } from './db.js';

export async function loadDashboard() {
  const now = new Date();
  const today = todayISO();
  const monthStart = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));

  const [accounts, categories, flows, monthTx, recent] = await Promise.all([
    getAccounts(),
    getCategories(),
    unwrap(supabase.rpc('account_flows', { p_until: today })),
    // "Do mês" = do dia 1 até hoje: lançamentos futuros (parcelas, recorrências)
    // ainda não aconteceram e pertencem à previsão, não ao gasto realizado.
    unwrap(supabase.from('transactions')
      .select('type, amount, category_id')
      .gte('date', monthStart).lte('date', today)),
    unwrap(supabase.from('transactions')
      .select('id, type, amount, date, description, category_id, account_id, to_account_id, credit_card_id')
      .lte('date', today)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5)),
  ]);

  const flowsByAccount = Object.fromEntries(flows.map((f) => [f.account_id, f]));
  const active = accounts.filter((a) => a.status === 'active');

  return {
    now,
    accounts,
    categories,
    hasAccounts: active.length > 0,
    balance: totalBalance(accounts, flowsByAccount),
    accountBalances: Object.fromEntries(active.map((a) => [a.id, accountBalance(a, flowsByAccount[a.id])])),
    summary: periodSummary(monthTx),
    byCategory: spendingByCategory(monthTx, categories),
    recent,
  };
}
