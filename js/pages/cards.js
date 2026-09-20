// Cartões: limite usado/disponível e fatura atual de cada cartão.
import { html, mount, $ } from '../core/dom.js';
import { formatDate, formatMoney, formatPercent, todayISO } from '../core/format.js';
import { STATUS_LABELS, cardLimit, currentInvoice, invoiceStatus } from '../core/cards.js';
import { getAccounts } from '../services/reference.js';
import { getCards, loadUnpaidInvoices } from '../services/cards.js';
import { openCardForm } from '../ui/card-form.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { icon } from '../ui/icons.js';

export const STATUS_BADGE = { paid: 'badge-success', overdue: 'badge-danger', closed: 'badge-warning', open: '' };

/** Cor da barra de limite: alerta a partir de 80%, perigo em 100%. */
export const limitColor = (percent) => (percent >= 100 ? 'var(--danger)' : percent >= 80 ? 'var(--warning)' : 'var(--primary)');

function cardTile(card, unpaid, today) {
  const mine = unpaid.filter((i) => i.credit_card_id === card.id);
  const limit = cardLimit(card, mine);
  const current = currentInvoice(card, mine, today);
  // Fatura já fechada e não paga = a próxima a pagar (destaque)
  const toPay = mine
    .filter((i) => Number(i.total_amount) > 0 && ['closed', 'overdue'].includes(invoiceStatus(i, today)))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const toPayStatus = toPay && invoiceStatus(toPay, today);

  return html`
    <a class="card card-tile" href="#/cartao?id=${card.id}">
      <div class="tile-head">
        <span class="avatar">${icon('card')}</span>
        <span class="list-item-main">
          <span class="list-item-title">${card.name}</span>
          <span class="list-item-sub">${[card.institution, `fecha dia ${card.closing_day} · vence dia ${card.due_day}`].filter(Boolean).join(' · ')}</span>
        </span>
        ${card.status === 'archived' && html`<span class="badge">Arquivado</span>`}
      </div>

      ${toPay && html`
        <div class="tile-alert tile-alert-${toPayStatus}">
          <span>Fatura ${STATUS_LABELS[toPayStatus].toLowerCase()} · vence ${formatDate(toPay.due_date)}</span>
          <strong class="money">${formatMoney(toPay.total_amount)}</strong>
        </div>`}

      <div class="tile-row">
        <span class="text-secondary">Fatura atual <span class="badge">fecha ${formatDate(current.closing_date)}</span></span>
        <strong class="money">${formatMoney(current.total_amount)}</strong>
      </div>

      <div class="limit">
        <div class="bar" role="img" aria-label="Limite usado: ${formatPercent(limit.percent)}">
          <span style="--value:${limit.percent.toFixed(1)}%; --bar-color:${limitColor(limit.percent)}"></span>
        </div>
        <div class="limit-labels">
          <span class="text-secondary">Usado ${formatMoney(limit.used)} de ${formatMoney(limit.limit)}</span>
          <strong class="money ${limit.available < 0 ? 'text-danger' : ''}">Disponível ${formatMoney(limit.available)}</strong>
        </div>
      </div>
    </a>`;
}

function cardsView(cards, unpaid, today) {
  const active = cards.filter((c) => c.status === 'active');
  const archived = cards.filter((c) => c.status === 'archived');
  return html`
    <div class="page">
      <header class="page-header">
        <h1>Cartões</h1>
        <button type="button" class="btn btn-primary btn-sm" id="new-card">${icon('plus')}<span>Novo cartão</span></button>
      </header>

      ${active.length
        ? html`<div class="section">${active.map((c) => cardTile(c, unpaid, today))}</div>`
        : html`<div class="card">${emptyState({
          iconName: 'card', title: 'Nenhum cartão ainda',
          text: 'Cadastre seus cartões para acompanhar limite, faturas e compras parceladas.',
          actionLabel: 'Cadastrar cartão', actionId: 'empty-new-card',
        })}</div>`}

      ${archived.length > 0 && html`
        <details class="section">
          <summary class="text-secondary">Arquivados (${archived.length})</summary>
          <div class="section" style="margin-top:var(--space-3)">${archived.map((c) => cardTile(c, unpaid, today))}</div>
        </details>`}
    </div>`;
}

export async function mountPage(outlet) {
  mount(outlet, loadingState(2));
  try {
    const [cards, accounts, unpaid] = await Promise.all([getCards(), getAccounts(), loadUnpaidInvoices()]);
    mount(outlet, cardsView(cards, unpaid, todayISO()));
    const page = outlet.firstElementChild;
    const create = () => openCardForm(null, { cards, accounts });
    $('#new-card', page).addEventListener('click', create);
    $('#empty-new-card', page)?.addEventListener('click', create);
  } catch (err) {
    console.error('[cartoes]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet));
  }
}

export { mountPage as mount };
