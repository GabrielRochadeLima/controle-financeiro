/*
 * REGRAS DE METAS E INVESTIMENTOS. Funções puras (sem DOM/Supabase).
 *
 *  - O "valor atual" de uma meta é SEMPRE a soma das contribuições (nunca uma coluna),
 *    então nunca diverge do que foi registrado.
 *  - O investido em cada investimento é a soma das movimentações do tipo investimento
 *    vinculadas a ele; aportes sem vínculo aparecem à parte.
 *  - Contas em centavos inteiros, como no resto do app.
 */
import { parseISODate } from './format.js';

const cents = (v) => Math.round((Number(v) || 0) * 100);

export const INVESTMENT_KINDS = Object.freeze({
  fixed_income: 'Renda fixa',
  stocks: 'Ações',
  funds: 'Fundos',
  crypto: 'Cripto',
  other: 'Outro',
});

const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 30.4375;

/** Dias (inteiros) de `today` até `iso`; negativo se já passou. */
export const daysUntil = (today, iso) => Math.round((parseISODate(iso) - parseISODate(today)) / DAY_MS);

/**
 * Situação de uma meta.
 * @param goal           { target_amount, target_date }
 * @param contributions  contribuições DESTA meta ({ amount })
 * @returns {{ saved, target, remaining, percent, reached, overdue, monthsLeft, perMonth }}
 *   percent limitado a 100. `perMonth` = quanto guardar por mês para chegar na data (null sem prazo
 *   ou com prazo vencido); a data de hoje conta como 1 mês restante.
 */
export function goalProgress(goal, contributions, today) {
  const target = cents(goal.target_amount);
  const saved = contributions.reduce((sum, c) => sum + cents(c.amount), 0);
  const remaining = Math.max(0, target - saved);
  const reached = target > 0 && saved >= target;

  let overdue = false;
  let monthsLeft = null;
  let perMonth = null;
  if (goal.target_date && !reached) {
    const days = daysUntil(today, goal.target_date);
    if (days < 0) overdue = true;
    else {
      monthsLeft = Math.max(1, Math.ceil(days / AVG_MONTH_DAYS));
      perMonth = Math.ceil(remaining / monthsLeft) / 100;
    }
  }
  return {
    saved: saved / 100,
    target: target / 100,
    remaining: remaining / 100,
    percent: target > 0 ? Math.min(100, (saved / target) * 100) : 0,
    reached,
    overdue,
    monthsLeft,
    perMonth,
  };
}

/**
 * Totais por investimento a partir dos aportes (type='investment') e resgates (type='investment_redemption').
 * Também calcula o rendimento quando o ativo tem `current_amount` informado.
 * @returns {{
 *   items: {investment, total, invested, redeemed, currentAmount, yieldAmount, yieldPercent, count, redeemCount, last}[],
 *   unlinked: {total, count},
 *   total: number,
 *   currentTotal: number,
 *   hasCurrent: boolean,
 *   totalYield: number,
 *   totalYieldPercent: number|null
 * }}
 */
export function summarizeInvestments(investments, movements) {
  const byId = new Map(investments.map((i) => [
    i.id,
    { investment: i, invested: 0, redeemed: 0, count: 0, redeemCount: 0, last: null },
  ]));
  let unlinkedTotal = 0;
  let unlinkedCount = 0;
  let netTotal = 0;

  for (const m of movements) {
    const c = cents(m.amount);
    const isRedeem = m.type === 'investment_redemption';
    const delta = isRedeem ? -c : c;
    netTotal += delta;

    const entry = m.investment_id ? byId.get(m.investment_id) : null;
    if (!entry) {
      unlinkedTotal += delta;
      if (!isRedeem) unlinkedCount += 1;
      continue;
    }
    if (isRedeem) {
      entry.redeemed += c;
      entry.redeemCount += 1;
    } else {
      entry.invested += c;
      entry.count += 1;
      if (!entry.last || m.date > entry.last) entry.last = m.date;
    }
  }

  let currentTotal = Math.max(0, unlinkedTotal);
  let hasCurrent = false;

  const items = [...byId.values()].map((e) => {
    const netCents = Math.max(0, e.invested - e.redeemed);
    const hasCur = e.investment.current_amount != null && e.investment.current_amount !== '';
    const curCents = hasCur ? cents(e.investment.current_amount) : null;
    if (hasCur) {
      hasCurrent = true;
      currentTotal += curCents;
    } else {
      currentTotal += netCents;
    }
    const yieldCents = curCents != null ? curCents - netCents : null;
    const yieldPercent = curCents != null && netCents > 0 ? (yieldCents / netCents) * 100 : null;
    return {
      investment: e.investment,
      total: netCents / 100,
      invested: e.invested / 100,
      redeemed: e.redeemed / 100,
      currentAmount: curCents != null ? curCents / 100 : null,
      yieldAmount: yieldCents != null ? yieldCents / 100 : null,
      yieldPercent,
      count: e.count,
      redeemCount: e.redeemCount,
      last: e.last,
    };
  });

  const safeNet = Math.max(0, netTotal);
  const totalYieldCents = hasCurrent ? currentTotal - safeNet : 0;
  return {
    items,
    unlinked: { total: Math.max(0, unlinkedTotal) / 100, count: unlinkedCount },
    total: safeNet / 100,
    currentTotal: currentTotal / 100,
    hasCurrent,
    totalYield: totalYieldCents / 100,
    totalYieldPercent: hasCurrent && safeNet > 0 ? (totalYieldCents / safeNet) * 100 : null,
  };
}
