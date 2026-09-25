// Carrega e calcula os dados do dashboard. Só busca o necessário, em paralelo,
// e reaproveita contas/categorias do cache.
import { supabase } from '../core/supabase.js';
import { toISODate, todayISO } from '../core/format.js';
import { accountBalance, totalBalance, periodSummary, spendingByCategory } from '../core/finance.js';
import { addDays, invoiceStatus } from '../core/cards.js';
import { chartRange, monthSeries } from '../core/charts.js';
import { getAccounts, getCategories } from './reference.js';
import { getCards, loadUnpaidInvoices } from './cards.js';
import { unwrap } from './db.js';

export async function loadDashboard() {
  const now = new Date();
  const today = todayISO();
  const monthStart = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));

  const range = chartRange(today, 6);

  const [accounts, categories, cards, unpaid, flows, trendRows, monthTx, recent] = await Promise.all([
    getAccounts(),
    getCategories(),
    getCards(),
    // As faturas são um widget extra: se falharem (ex.: migration de cartões ainda não aplicada),
    // o resto da tela inicial continua funcionando.
    loadUnpaidInvoices().catch((err) => { console.error('[dashboard] faturas indisponíveis', err); return []; }),
    unwrap(supabase.rpc('account_flows', { p_until: today })),
    // Série mensal do gráfico (migration 004). Também é opcional: sem ela só o gráfico some.
    unwrap(supabase.rpc('monthly_flows', { p_from: range.from, p_until: today }))
      .catch((err) => { console.error('[dashboard] gráfico mensal indisponível', err); return null; }),
    // "Do mês" = do dia 1 até hoje: lançamentos futuros (parcelas, recorrências)
    // ainda não aconteceram e pertencem à previsão, não ao gasto realizado.
    unwrap(supabase.from('transactions')
      .select('type, amount, category_id')
      .gte('date', monthStart).lte('date', today)),
    unwrap(supabase.from('transactions')
      .select('id, type, amount, date, description, category_id, account_id, to_account_id, credit_card_id, ' +
        'installment_number, plan:installment_plans(installments_count)')
      .lte('date', today)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5)),
  ]);

  const flowsByAccount = Object.fromEntries(flows.map((f) => [f.account_id, f]));
  const active = accounts.filter((a) => a.status === 'active');

  // Faturas a acompanhar: não pagas, com valor e que fecham em até ~1 mês (a aberta, as fechadas
  // e as atrasadas). Parcelas de meses distantes ficam de fora para não poluir a tela inicial.
  const horizon = addDays(today, 31);
  const invoices = unpaid
    .filter((i) => Number(i.total_amount) > 0 && i.closing_date <= horizon)
    .map((i) => ({ ...i, card: cards.find((c) => c.id === i.credit_card_id), status: invoiceStatus(i, today) }))
    .filter((i) => i.card)
    .slice(0, 3); // já vêm ordenadas por vencimento

  return {
    now,
    accounts,
    cards,
    invoices,
    trend: trendRows ? monthSeries(trendRows, today, 6) : null,
    categories,
    hasAccounts: active.length > 0,
    balance: totalBalance(accounts, flowsByAccount),
    accountBalances: Object.fromEntries(active.map((a) => [a.id, accountBalance(a, flowsByAccount[a.id])])),
    summary: periodSummary(monthTx),
    byCategory: spendingByCategory(monthTx, categories),
    recent,
  };
}
