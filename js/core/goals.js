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
 * Totais por investimento a partir dos aportes (transações type='investment').
 * @returns {{ items: {investment, total, count, last}[], unlinked: {total, count}, total }}
 */
export function summarizeInvestments(investments, aportes) {
  const byId = new Map(investments.map((i) => [i.id, { investment: i, total: 0, count: 0, last: null }]));
  let unlinkedTotal = 0;
  let unlinkedCount = 0;
  let total = 0;
  for (const a of aportes) {
    const c = cents(a.amount);
    total += c;
    const entry = a.investment_id ? byId.get(a.investment_id) : null;
    if (!entry) { unlinkedTotal += c; unlinkedCount += 1; continue; }
    entry.total += c;
    entry.count += 1;
    if (!entry.last || a.date > entry.last) entry.last = a.date;
  }
  return {
    items: [...byId.values()].map((e) => ({ ...e, total: e.total / 100 })),
    unlinked: { total: unlinkedTotal / 100, count: unlinkedCount },
    total: total / 100,
  };
}
