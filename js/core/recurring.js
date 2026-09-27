/*
 * REGRAS DE RECORRÊNCIA. Funções puras (sem DOM/Supabase): a partir de uma regra
 * (recurring_transactions) e da data de hoje, calculam quais ocorrências já deveriam
 * existir (para gerar) e quais ainda vêm este mês (para a previsão do dashboard).
 *
 * A ocorrência em si é só uma linha em transactions (source='recurring'); nenhuma
 * data é calculada no banco, igual às faturas de cartão (core/cards.js).
 */
import { addDays, addMonths } from './cards.js';
import { parseISODate, toISODate } from './format.js';

export const FREQUENCY_LABELS = Object.freeze({
  weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual',
});

export function nextDate(iso, frequency) {
  if (frequency === 'weekly') return addDays(iso, 7);
  if (frequency === 'yearly') return addMonths(iso, 12);
  return addMonths(iso, 1);
}

export function monthEnd(iso) {
  const d = parseISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Primeira data ainda não gerada: a seguinte a `generated_until`, ou o início da regra. */
function firstPending(rule) {
  return rule.generated_until ? nextDate(rule.generated_until, rule.frequency) : rule.start_date;
}

/**
 * Datas que já deveriam ter sido geradas (entre o que falta e hoje, inclusive).
 * `limit` é uma trava de segurança: uma regra muito antiga nunca gera milhares de
 * linhas de uma vez (o usuário só nota o atraso e as próximas aberturas completam).
 */
export function pendingDates(rule, today, limit = 60) {
  if (rule.status !== 'active') return [];
  const dates = [];
  let date = firstPending(rule);
  while (date <= today && (!rule.end_date || date <= rule.end_date) && dates.length < limit) {
    dates.push(date);
    date = nextDate(date, rule.frequency);
  }
  return dates;
}

/**
 * Ocorrências que ainda faltam este mês, a partir de amanhã: o que já aconteceu até
 * hoje é gasto/receita realizado, não previsão.
 */
export function upcomingThisMonth(rule, today, limit = 40) {
  if (rule.status !== 'active') return [];
  const end = monthEnd(today);
  let date = firstPending(rule);
  while (date <= today) date = nextDate(date, rule.frequency);
  const dates = [];
  while (date <= end && (!rule.end_date || date <= rule.end_date) && dates.length < limit) {
    dates.push(date);
    date = nextDate(date, rule.frequency);
  }
  return dates;
}

/**
 * Projeção simples do mês corrente: o que já foi realizado (`realized`) somado ao que
 * as recorrências ativas ainda vão lançar até o fim do mês.
 * @param {object[]} rules  recurring_transactions
 * @param {string} today
 * @param {{ income: number, expense: number }} realized
 */
export function forecastMonth(rules, today, realized) {
  let pendingIncome = 0;
  let pendingExpense = 0;
  for (const rule of rules) {
    const count = upcomingThisMonth(rule, today).length;
    if (!count) continue;
    if (rule.type === 'income') pendingIncome += rule.amount * count;
    else pendingExpense += rule.amount * count;
  }
  const income = realized.income + pendingIncome;
  const expense = realized.expense + pendingExpense;
  return { income, expense, left: income - expense, pendingIncome, pendingExpense };
}
