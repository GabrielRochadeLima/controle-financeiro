// Linha de movimentação (reutilizada no dashboard e na lista de movimentações).
import { html } from '../core/dom.js';
import { formatMoney, formatRelativeDate, todayISO } from '../core/format.js';
import { TYPES, TYPE_LABELS, transactionSign } from '../core/finance.js';
import { icon } from './icons.js';

const FALLBACK_EMOJI = {
  [TYPES.EXPENSE]: '📦',
  [TYPES.INCOME]: '💰',
  [TYPES.INVESTMENT]: '📈',
  [TYPES.INVOICE_PAYMENT]: '💳',
};

/**
 * @param {object} t          linha de transactions
 * @param {{ categories: Map, accounts: Array }} ref  dados de referência já carregados
 * @param {{ interactive?: boolean, showDate?: boolean }} opts
 *   interactive: linha clicável/focável (abre edição). showDate: mostra a data no subtítulo
 *   (desnecessário quando a lista já está agrupada por dia).
 */
export function transactionItem(t, { categories, accounts }, { interactive = false, showDate = true } = {}) {
  const category = t.category_id ? categories.get(t.category_id) : null;
  const accountName = (id) => accounts.find((a) => a.id === id)?.name;

  const where = t.type === TYPES.TRANSFER
    ? `${accountName(t.account_id) ?? '—'} → ${accountName(t.to_account_id) ?? '—'}`
    : accountName(t.account_id) ?? (t.credit_card_id ? 'Cartão' : '');

  const title = t.description || category?.name || TYPE_LABELS[t.type];
  const scheduled = t.date > todayISO();
  const sub = [
    category?.name && t.description ? category.name : null,
    where,
    showDate ? formatRelativeDate(t.date) : null,
    scheduled ? 'Agendada' : null,
  ].filter(Boolean).join(' · ');

  const sign = transactionSign(t.type);
  const tone = sign > 0 ? 'text-success' : '';
  const prefix = sign > 0 ? '+ ' : sign < 0 ? '− ' : '';

  return html`
    <li class="list-item" data-id="${t.id}" ${interactive ? html`tabindex="0" role="button"` : ''}>
      <span class="avatar">
        ${t.type === TYPES.TRANSFER ? icon('swap') : category?.icon || FALLBACK_EMOJI[t.type]}
      </span>
      <span class="list-item-main">
        <span class="list-item-title">${title}</span>
        <span class="list-item-sub">${sub}</span>
      </span>
      <span class="list-item-end money ${tone}">${prefix}${formatMoney(t.amount)}</span>
    </li>`;
}
