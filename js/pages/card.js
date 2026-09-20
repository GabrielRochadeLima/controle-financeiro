// Detalhe do cartão: limite, fatura por mês (navegável), compras da fatura e pagamento.
import { html, mount, $ } from '../core/dom.js';
import { formatDate, formatMoney, formatMonth, formatPercent, todayISO } from '../core/format.js';
import {
  STATUS_LABELS, cardLimit, invoiceKeyFor, invoiceStatus, invoiceWindow, keyOf, shiftKey,
} from '../core/cards.js';
import { isValidISODate } from '../core/validation.js';
import { getMemory } from '../core/memory.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { getAccounts, getCategories } from '../services/reference.js';
import { getCards, loadCardInvoices, loadInvoicePurchases, payInvoice, unpayInvoice } from '../services/cards.js';
import { openCardForm } from '../ui/card-form.js';
import { chip } from '../ui/chips.js';
import { openPlanDetail } from '../ui/installment-plan.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { openTransactionForm } from '../ui/quick-add.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { toast } from '../ui/toast.js';
import { transactionItem } from '../ui/transaction-item.js';
import { icon } from '../ui/icons.js';
import { STATUS_BADGE, limitColor } from './cards.js';

// Fatura selecionada persiste enquanto o app está aberto (a tela recarrega após cada gravação).
const sel = { cardId: null, key: null };
const monthIndex = (k) => k.year * 12 + k.month0;

export async function mountPage(outlet, params = {}) {
  const cardId = params.id;
  mount(outlet, loadingState(3));

  let cards; let accounts; let categories; let invoices;
  try {
    [cards, accounts, categories, invoices] = await Promise.all([
      getCards(), getAccounts(), getCategories(), loadCardInvoices(cardId),
    ]);
  } catch (err) {
    console.error('[cartao]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet, params));
    return;
  }

  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    mount(outlet, html`<div class="page"><div class="card">${emptyState({
      iconName: 'card', title: 'Cartão não encontrado', text: 'Ele pode ter sido excluído.',
      actionLabel: 'Ver cartões', actionHref: '#/cartoes',
    })}</div></div>`);
    return;
  }

  const today = todayISO();
  const currentKey = invoiceKeyFor(card, today);
  const indexes = invoices.map((i) => monthIndex(keyOf(i)));
  const minIndex = Math.min(monthIndex(currentKey), ...indexes);
  const maxIndex = Math.max(monthIndex(shiftKey(currentKey, 1)), ...indexes); // sempre dá para ver a próxima fatura

  if (sel.cardId !== cardId) { sel.cardId = cardId; sel.key = currentKey; }
  if (params.inv) {
    const target = invoices.find((i) => i.id === params.inv);
    if (target) sel.key = keyOf(target);
    // limpa o parâmetro para as próximas recargas não "puxarem" de volta a esta fatura
    history.replaceState(null, '', `#/cartao?id=${cardId}`);
  }

  const limit = cardLimit(card, invoices.filter((i) => !i.paid_at));
  const ref = { categories, accounts, cards };

  mount(outlet, html`
    <div class="page">
      <header class="page-header">
        <div class="header-title">
          <a class="btn btn-icon back-link" href="#/cartoes" aria-label="Voltar para cartões">
            <span style="display:inline-flex;transform:rotate(180deg)">${icon('chevron')}</span></a>
          <div>
            <h1>${card.name}</h1>
            <p>${[card.institution, `fecha dia ${card.closing_day} · vence dia ${card.due_day}`].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="edit-card">Editar</button>
      </header>

      <section class="card limit" aria-label="Limite">
        <div class="tile-row">
          <span class="text-secondary">Limite disponível</span>
          <strong class="money ${limit.available < 0 ? 'text-danger' : ''}">${formatMoney(limit.available)}</strong>
        </div>
        <div class="bar" role="img" aria-label="Limite usado: ${formatPercent(limit.percent)}">
          <span style="--value:${limit.percent.toFixed(1)}%; --bar-color:${limitColor(limit.percent)}"></span>
        </div>
        <div class="limit-labels">
          <span class="text-secondary">Usado ${formatMoney(limit.used)}</span>
          <span class="text-secondary">Limite ${formatMoney(limit.limit)}</span>
        </div>
      </section>

      <div id="invoice-area"></div>
    </div>`);

  const page = outlet.firstElementChild;
  $('#edit-card', page).addEventListener('click', () => openCardForm(card, { cards, accounts }));

  let request = 0; // descarta respostas de faturas trocadas rapidamente

  function renderInvoice() {
    const invoice = invoices.find((i) => monthIndex(keyOf(i)) === monthIndex(sel.key))
      ?? { ...invoiceWindow(card, sel.key), id: null, credit_card_id: card.id, paid_at: null, total_amount: 0, purchases_count: 0 };
    const status = invoiceStatus(invoice, today);
    const total = Number(invoice.total_amount);
    const canPay = invoice.id && !invoice.paid_at && total > 0 && ['closed', 'overdue'].includes(status);
    const atMin = monthIndex(sel.key) <= minIndex;
    const atMax = monthIndex(sel.key) >= maxIndex;

    mount($('#invoice-area', page), html`
      <div class="month-nav">
        <button type="button" class="btn btn-icon" id="prev-inv" aria-label="Fatura anterior" ${atMin && html`disabled`}>
          <span style="display:inline-flex;transform:rotate(180deg)">${icon('chevron')}</span></button>
        <strong>Fatura de ${formatMonth(new Date(sel.key.year, sel.key.month0, 1))}</strong>
        <button type="button" class="btn btn-icon" id="next-inv" aria-label="Próxima fatura" ${atMax && html`disabled`}>${icon('chevron')}</button>
      </div>

      <section class="card invoice-card">
        <div class="tile-row">
          <span class="badge ${STATUS_BADGE[status]}">${STATUS_LABELS[status]}</span>
          <span class="text-secondary">${formatDate(invoice.period_start)} a ${formatDate(invoice.closing_date)}</span>
        </div>
        <div class="invoice-total money">${formatMoney(total)}</div>
        <div class="tile-row">
          <span class="text-secondary">Fecha em ${formatDate(invoice.closing_date)}</span>
          <span class="text-secondary">Vence em ${formatDate(invoice.due_date)}</span>
        </div>
        ${invoice.paid_at && html`<p class="text-success">✓ Paga em ${formatDate(invoice.paid_at.slice(0, 10))}</p>`}
        ${status === 'open' && total > 0 && html`<p class="field-hint">Você poderá pagar depois do fechamento (${formatDate(invoice.closing_date)}).</p>`}
        ${canPay && html`<button type="button" class="btn btn-primary btn-block" id="pay-invoice">Pagar fatura · ${formatMoney(total)}</button>`}
        ${invoice.paid_at && html`<button type="button" class="btn btn-ghost btn-block" id="unpay-invoice">Desfazer pagamento</button>`}
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Compras</h2>
          <button type="button" class="btn btn-primary btn-sm" id="new-purchase">${icon('plus')}<span>Nova compra</span></button>
        </div>
        <div id="purchases"></div>
      </section>`);

    $('#prev-inv', page).addEventListener('click', () => { sel.key = shiftKey(sel.key, -1); renderInvoice(); });
    $('#next-inv', page).addEventListener('click', () => { sel.key = shiftKey(sel.key, 1); renderInvoice(); });
    $('#new-purchase', page).addEventListener('click', () => openTransactionForm({ presetCardId: card.id }));
    $('#pay-invoice', page)?.addEventListener('click', () => openPayModal(invoice, total));
    $('#unpay-invoice', page)?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Desfazer o pagamento?',
        message: 'A fatura volta a ficar em aberto e o valor pago volta para a conta.',
        confirmLabel: 'Desfazer',
      });
      if (!confirmed) return;
      try {
        await unpayInvoice(invoice.id);
        toast.success('Pagamento desfeito');
        emitDataChanged();
      } catch (err) {
        toast.error(friendlyError(err, 'Não foi possível desfazer o pagamento.'));
      }
    });
    loadPurchases(invoice);
  }

  async function loadPurchases(invoice) {
    const area = $('#purchases', page);
    if (!invoice.id) {
      mount(area, html`<div class="card">${emptyState({
        iconName: 'receipt', title: 'Sem compras nesta fatura', text: 'As compras no cartão aparecem aqui.' })}</div>`);
      return;
    }
    const mine = ++request;
    mount(area, html`<div class="skeleton skeleton-block"></div>`);
    try {
      const rows = await loadInvoicePurchases(invoice.id);
      if (mine !== request) return;
      if (!rows.length) {
        mount(area, html`<div class="card">${emptyState({ iconName: 'receipt', title: 'Sem compras nesta fatura' })}</div>`);
        return;
      }
      mount(area, html`<div class="card card-flat"><ul class="list">
        ${rows.map((t) => transactionItem(t, ref, { interactive: true, showWhere: false }))}</ul></div>`);

      const open = (li) => {
        const row = rows.find((r) => r.id === li?.dataset.id);
        if (!row) return;
        if (row.installment_plan_id) openPlanDetail({ planId: row.installment_plan_id, number: row.installment_number });
        else if (invoice.paid_at) toast.info('Fatura paga: desfaça o pagamento para alterar esta compra.');
        else openTransactionForm({ transaction: row });
      };
      area.addEventListener('click', (e) => open(e.target.closest('li[data-id]')));
      area.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const li = e.target.closest('li[data-id]');
        if (li) { e.preventDefault(); open(li); }
      });
    } catch (err) {
      if (mine !== request) return;
      toast.error(friendlyError(err, 'Não foi possível carregar as compras.'));
      mount(area, errorState());
      $('#retry', area)?.addEventListener('click', () => loadPurchases(invoice));
    }
  }

  function openPayModal(invoice, total) {
    const active = accounts.filter((a) => a.status === 'active');
    const memory = getMemory();
    let accountId = [card.default_payment_account_id, memory.account_id]
      .find((id) => id && active.some((a) => a.id === id)) ?? (active.length === 1 ? active[0].id : null);
    let date = today;

    if (!active.length) {
      openModal({ title: 'Pagar fatura', body: emptyState({
        iconName: 'wallet', title: 'Crie uma conta primeiro', text: 'O pagamento sai de uma conta.',
        actionLabel: 'Criar conta', actionHref: '#/contas' }) });
      return;
    }

    const { el, close } = openModal({
      title: 'Pagar fatura',
      body: html`
        <form class="form" id="pay-form" novalidate>
          <p>Fatura ${card.name} · <strong class="money">${formatMoney(total)}</strong></p>
          <div class="qa-section">
            <h3 class="qa-label">Pagar com</h3>
            <div class="chips" id="pay-accounts"></div>
          </div>
          <div class="field">
            <label for="pay-date">Data do pagamento</label>
            <input class="input" type="date" id="pay-date">
          </div>
          <div class="form-error" id="pay-error" role="alert" hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button type="submit" class="btn btn-primary">Pagar ${formatMoney(total)}</button>
          </div>
        </form>`,
    });
    const showError = (m) => { const b = $('#pay-error', el); b.textContent = m; b.hidden = false; };
    const paint = () => mount($('#pay-accounts', el), html`${active.map((a) =>
      chip('acc', a.id, a.name, { selected: a.id === accountId }))}`);
    paint();
    $('#pay-date', el).value = date;
    $('#pay-date', el).addEventListener('change', (e) => { date = e.target.value; });
    $('#pay-accounts', el).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-chip="acc"]');
      if (btn) { accountId = btn.dataset.value; paint(); }
    });

    $('#pay-form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!accountId) return showError('Escolha a conta de pagamento.');
      if (!isValidISODate(date)) return showError('Informe uma data válida.');
      const button = $('button[type="submit"]', el);
      button.classList.add('is-loading'); button.disabled = true;
      try {
        await payInvoice(invoice.id, accountId, date);
        toast.success('Fatura paga');
        close();
        emitDataChanged();
      } catch (err) {
        showError(friendlyError(err, 'Não foi possível pagar a fatura.'));
        button.classList.remove('is-loading'); button.disabled = false;
      }
    });
  }

  renderInvoice();
}

export { mountPage as mount };
