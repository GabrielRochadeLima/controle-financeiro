/*
 * REGRAS DE CARTÃO, FATURA E PARCELAMENTO. Funções puras (sem DOM/Supabase).
 * O banco só persiste o que estas funções calculam; nenhuma regra de datas mora no SQL.
 *
 * CONVENÇÕES (documentadas porque variam entre bancos):
 *  - A compra feita até o DIA do fechamento (inclusive) entra na fatura que fecha
 *    naquele mês; depois disso, na do mês seguinte.
 *  - O vencimento cai no mesmo mês do fechamento se o dia de vencimento for maior
 *    que o de fechamento (fecha 3, vence 10); senão, no mês seguinte (fecha 25, vence 5).
 *  - Dia inexistente no mês (31 em fevereiro) vira o último dia do mês.
 *  - Cada parcela vai para a fatura seguinte à da parcela anterior (por índice de
 *    mês, não pela data da parcela — evita duas parcelas na mesma fatura em meses curtos).
 *  - O limite usado é a soma de TODAS as compras em faturas não pagas, inclusive
 *    parcelas futuras: a compra parcelada bloqueia o valor total do limite.
 */
import { parseISODate, toISODate } from './format.js';

const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate(); // month: 0-11 (aceita overflow)
const clampDate = (year, month, day) => new Date(year, month, Math.min(day, daysInMonth(year, month)));

/** Soma `n` meses a uma data ISO, mantendo o dia (ou o último dia do mês, se não existir). */
export function addMonths(iso, n) {
  const d = parseISODate(iso);
  return toISODate(clampDate(d.getFullYear(), d.getMonth() + n, d.getDate()));
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Mês de fechamento ({year, month0}) da fatura que recebe uma compra feita em `iso`. */
export function invoiceKeyFor(card, iso) {
  const d = parseISODate(iso);
  const closingThisMonth = toISODate(clampDate(d.getFullYear(), d.getMonth(), card.closing_day));
  const shift = iso <= closingThisMonth ? 0 : 1;
  const base = new Date(d.getFullYear(), d.getMonth() + shift, 1);
  return { year: base.getFullYear(), month0: base.getMonth() };
}

/** Datas da fatura que fecha no mês {year, month0}. */
export function invoiceWindow(card, { year, month0 }) {
  const closing = clampDate(year, month0, card.closing_day);
  const previousClosing = clampDate(year, month0 - 1, card.closing_day);
  const dueMonth = card.due_day > card.closing_day ? month0 : month0 + 1;
  return {
    period_start: addDays(toISODate(previousClosing), 1),
    closing_date: toISODate(closing),
    due_date: toISODate(clampDate(year, dueMonth, card.due_day)),
  };
}

/** Fatura que recebe uma compra feita em `iso`. */
export const invoiceFor = (card, iso) => invoiceWindow(card, invoiceKeyFor(card, iso));

/** Desloca um mês de fechamento em `n` meses. */
export function shiftKey({ year, month0 }, n) {
  const d = new Date(year, month0 + n, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

export const keyOf = (invoice) => {
  const [y, m] = invoice.closing_date.split('-').map(Number);
  return { year: y, month0: m - 1 };
};

export const STATUS_LABELS = Object.freeze({
  open: 'Aberta', closed: 'Fechada', paid: 'Paga', overdue: 'Atrasada',
});

/**
 * Status derivado (nada disso é gravado, exceto paid_at):
 *  paga -> atrasada (vencida e não paga) -> fechada (fechamento passou) -> aberta.
 */
export function invoiceStatus(invoice, today) {
  if (invoice.paid_at) return 'paid';
  if (today > invoice.due_date) return 'overdue';
  if (today > invoice.closing_date) return 'closed';
  return 'open';
}

/**
 * Divide o total em parcelas em centavos exatos: 100,00 / 3 => 33,34 + 33,33 + 33,33.
 * A sobra de centavos fica nas primeiras parcelas (como fazem os bancos).
 */
export function splitInstallments(total, count) {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  const extra = cents - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

/**
 * Planeja uma compra no cartão (à vista = 1 parcela).
 * @returns {{ parcels: {number, amount, date, invoice}[] }}
 *   `invoice` = janela da fatura (períodos/vencimento) que o banco cria se ainda não existir.
 */
export function planPurchase(card, { date, total, count = 1 }) {
  const amounts = splitInstallments(total, count);
  const first = invoiceKeyFor(card, date);
  return {
    parcels: amounts.map((amount, i) => ({
      number: i + 1,
      amount,
      date: addMonths(date, i),
      invoice: invoiceWindow(card, shiftKey(first, i)),
    })),
  };
}

/** Limite: usado = compras em faturas não pagas (inclui parcelas futuras). */
export function cardLimit(card, unpaidInvoices) {
  const used = unpaidInvoices.reduce((s, i) => s + Math.round(Number(i.total_amount) * 100), 0) / 100;
  const limit = Number(card.credit_limit) || 0;
  return {
    limit,
    used,
    available: Math.round((limit - used) * 100) / 100,
    percent: limit > 0 ? Math.min(100, (used / limit) * 100) : used > 0 ? 100 : 0,
  };
}

/**
 * Fatura "atual" do cartão para exibição: a que recebe compras de hoje. Se já existir
 * uma linha no banco para esse fechamento, usa-a (datas gravadas + total); senão devolve
 * uma fatura virtual zerada (ainda sem compras, logo sem linha no banco).
 */
export function currentInvoice(card, invoices, today) {
  const window = invoiceFor(card, today);
  const stored = invoices.find((i) => i.credit_card_id === card.id && i.closing_date === window.closing_date);
  return stored ?? { ...window, id: null, credit_card_id: card.id, paid_at: null, total_amount: 0, purchases_count: 0 };
}
