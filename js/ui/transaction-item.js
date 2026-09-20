// Linha de movimentação (reutilizada no dashboard, na lista e na tela do cartão).
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
 * @param {object} t          linha de transactions (opcional: `plan.installments_count` embutido)
 * @param {{ categories: Map, accounts: Array, cards?: Array }} ref  dados de referência já carregados
 * @param {{ interactive?: boolean, showDate?: boolean, showWhere?: boolean }} opts
 *   interactive: linha clicável/focável (abre edição). showDate: mostra a data no subtítulo
 *   (desnecessário quando a lista já está agrupada por dia). showWhere: mostra conta/cartão.
 */
export function transactionItem(t, { categories, accounts, cards = [] }, { interactive = false, showDate = true, showWhere = true } = {}) {
  const category = t.category_id ? categories.get(t.category_id) : null;
  const accountName = (id) => accounts.find((a) => a.id === id)?.name;
  const cardName = (id) => cards.find((c) => c.id === id)?.name;

  let where;
  if (t.type === TYPES.TRANSFER) where = `${accountName(t.account_id) ?? '—'} → ${accountName(t.to_account_id) ?? '—'}`;
  else if (t.type === TYPES.INVOICE_PAYMENT) where = accountName(t.account_id);
  else if (t.credit_card_id) where = cardName(t.credit_card_id) ?? 'Cartão';
  else where = accountName(t.account_id);

  // "2/12" nas compras parceladas
  const parcel = t.installment_number && t.plan?.installments_count
    ? `${t.installment_number}/${t.plan.installments_count}` : null;

  const title = t.description || category?.name || TYPE_LABELS[t.type];
  const scheduled = t.date > todayISO();
  const sub = [
    category?.name && t.description ? category.name : null,
    parcel ? `Parcela ${parcel}` : null,
    showWhere ? where : null,
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
