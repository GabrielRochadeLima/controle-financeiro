// Movimentações: lista por mês, agrupada por dia, com busca, filtro por tipo e
// paginação ("carregar mais"). Tocar em uma linha abre a edição.
import { html, mount, $, $$, debounce } from '../core/dom.js';
import { formatMonth, formatRelativeDate, toISODate } from '../core/format.js';
import { TYPES } from '../core/finance.js';
import { friendlyError } from '../core/supabase.js';
import { getAccounts, getCategories } from '../services/reference.js';
import { getCards } from '../services/cards.js';
import { listTransactions } from '../services/transactions.js';
import { openPlanDetail } from '../ui/installment-plan.js';
import { openTransactionForm } from '../ui/quick-add.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { transactionItem } from '../ui/transaction-item.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const FILTERS = [
  ['', 'Todas'],
  [TYPES.EXPENSE, 'Despesas'],
  [TYPES.INCOME, 'Receitas'],
  [TYPES.TRANSFER, 'Transferências'],
  [TYPES.INVESTMENT, 'Investimentos'],
  [TYPES.INVOICE_PAYMENT, 'Faturas'],
];

// Filtros vivem no módulo: ao editar uma linha a tela recarrega e o usuário
// continua no mesmo mês/filtro em vez de voltar ao início.
const view = { month: firstOfMonth(new Date()), type: '', search: '' };

function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
const shiftMonth = (date, delta) => new Date(date.getFullYear(), date.getMonth() + delta, 1);

function shell() {
  return html`
    <div class="page">
      <header class="page-header">
        <h1>Movimentações</h1>
        <button type="button" class="btn btn-primary btn-sm" data-action="new-transaction">
          ${icon('plus')}<span>Nova</span>
        </button>
      </header>

      <input class="input" id="search" type="search" placeholder="Buscar por descrição" aria-label="Buscar"
             autocomplete="off" enterkeyhint="search">

      <div class="month-nav">
        <button type="button" class="btn btn-icon" id="prev-month" aria-label="Mês anterior">
          <span style="display:inline-flex;transform:rotate(180deg)">${icon('chevron')}</span>
        </button>
        <strong id="month-label"></strong>
        <button type="button" class="btn btn-icon" id="next-month" aria-label="Próximo mês">${icon('chevron')}</button>
      </div>

      <div class="filter-chips" id="filters" role="group" aria-label="Filtrar por tipo"></div>

      <div id="list" aria-live="polite"></div>
      <button type="button" class="btn btn-ghost btn-block" id="load-more" hidden>Carregar mais</button>
    </div>`;
}

function groupByDay(rows) {
  const groups = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === row.date) last.rows.push(row);
    else groups.push({ date: row.date, rows: [row] });
  }
  return groups;
}

export async function mountPage(outlet) {
  mount(outlet, loadingState(3));

  let accounts; let categories; let cards;
  try {
    [accounts, categories, cards] = await Promise.all([getAccounts(), getCategories(), getCards()]);
  } catch (err) {
    console.error('[movimentacoes]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet));
    return;
  }

  mount(outlet, shell());
  const page = outlet.firstElementChild;
  const list = $('#list', page);
  const loadMore = $('#load-more', page);
  const search = $('#search', page);
  search.value = view.search;

  let rows = [];
  let pageIndex = 0;
  let request = 0; // ignora respostas de consultas antigas (usuário digitando/trocando de mês rápido)

  function renderChrome() {
    $('#month-label', page).textContent = formatMonth(view.month);
    mount($('#filters', page), html`${FILTERS.map(([value, label]) => html`
      <button type="button" class="chip" data-filter="${value}" aria-pressed="${String(view.type === value)}">${label}</button>`)}`);
  }

  function renderList(hasMore) {
    loadMore.hidden = !hasMore;
    if (!rows.length) {
      const filtering = view.search || view.type;
      mount(list, html`<div class="card">${emptyState({
        iconName: filtering ? 'list' : 'receipt',
        title: filtering ? 'Nada encontrado' : 'Nenhuma movimentação neste mês',
        text: filtering ? 'Tente outro termo ou remova os filtros.' : 'Toque em "Nova" para registrar.',
      })}</div>`);
      return;
    }
    mount(list, html`<div class="section">${groupByDay(rows).map((g) => html`
      <div class="day-group">
        <div class="day-head"><span>${formatRelativeDate(g.date)}</span></div>
        <div class="card card-flat"><ul class="list">
          ${g.rows.map((t) => transactionItem(t, { categories, accounts, cards }, { interactive: true, showDate: false }))}
        </ul></div>
      </div>`)}</div>`);
  }

  async function load({ append = false } = {}) {
    const mine = ++request;
    if (!append) { pageIndex = 0; rows = []; mount(list, loadingState(2)); loadMore.hidden = true; }
    try {
      const result = await listTransactions({
        from: toISODate(view.month),
        to: toISODate(shiftMonth(view.month, 1)),
        type: view.type || undefined,
        search: view.search,
        page: pageIndex,
      });
      if (mine !== request) return;
      rows = append ? [...rows, ...result.rows] : result.rows;
      renderList(result.hasMore);
    } catch (err) {
      if (mine !== request) return;
      toast.error(friendlyError(err, 'Não foi possível carregar as movimentações.'));
      mount(list, errorState());
      $('#retry', list)?.addEventListener('click', () => load());
    }
  }

  // ---------- eventos (todos em elementos dentro da página, nunca no outlet) ----------
  $('#prev-month', page).addEventListener('click', () => { view.month = shiftMonth(view.month, -1); renderChrome(); load(); });
  $('#next-month', page).addEventListener('click', () => { view.month = shiftMonth(view.month, 1); renderChrome(); load(); });

  $('#filters', page).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    view.type = btn.dataset.filter;
    renderChrome();
    load();
  });

  search.addEventListener('input', debounce(() => { view.search = search.value; load(); }, 300));
  loadMore.addEventListener('click', () => { pageIndex += 1; load({ append: true }); });

  const openRow = (li) => {
    const transaction = rows.find((r) => r.id === li?.dataset.id);
    if (!transaction) return;
    // Pagamento de fatura: leva para a fatura (para desfazer o pagamento, se preciso).
    if (transaction.type === TYPES.INVOICE_PAYMENT) {
      location.hash = `#/cartao?id=${transaction.credit_card_id}&inv=${transaction.invoice_id}`;
      return;
    }
    // Compra parcelada: detalhe do plano (parcelas, editar, excluir com escolha de impacto).
    if (transaction.installment_plan_id) {
      openPlanDetail({ planId: transaction.installment_plan_id, number: transaction.installment_number });
      return;
    }
    openTransactionForm({ transaction });
  };
  list.addEventListener('click', (e) => openRow(e.target.closest('li[data-id]')));
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const li = e.target.closest('li[data-id]');
      if (li) { e.preventDefault(); openRow(li); }
    }
  });

  renderChrome();
  await load();
}

export { mountPage as mount };
