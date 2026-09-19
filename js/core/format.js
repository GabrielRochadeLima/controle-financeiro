// Formatação e conversão de valores/datas (pt-BR). Sem regra de negócio aqui.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
});
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export const formatMoney = (value) => brl.format(Number(value) || 0);
export const formatMoneyCompact = (value) => brlCompact.format(Number(value) || 0);
export const formatPercent = (value) => `${percent.format(Number(value) || 0)}%`;

/**
 * Interpreta o que o usuário digitou ("1.234,56", "45,9", "45.90") em número.
 * Retorna NaN se inválido — quem chama valida.
 */
export function parseMoney(input) {
  let s = String(input ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.'); // vírgula é o decimal; pontos são milhar
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.234" / "1.234.567" => milhar
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// ---------- Datas ----------
// Datas de negócio são strings "YYYY-MM-DD" no fuso LOCAL do usuário
// (Date#toISOString usa UTC e erraria o dia à noite no Brasil).

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISODate(new Date());

const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const fullDate = new Intl.DateTimeFormat('pt-BR');
const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

export function formatDate(iso) {
  return fullDate.format(parseISODate(iso));
}

/** "Hoje", "Ontem" ou "18 de set." — para listas. */
export function formatRelativeDate(iso) {
  const today = todayISO();
  if (iso === today) return 'Hoje';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === toISODate(yesterday)) return 'Ontem';
  return shortDate.format(parseISODate(iso)).replace('.', '');
}

export const formatMonth = (date) => {
  const label = monthLabel.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
