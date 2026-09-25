// Movimentações: lista por mês (ou período personalizado), agrupada por dia, com busca,
// filtros (tipo, conta/cartão, categoria, valor, período) e paginação ("carregar mais").
// Tocar em uma linha abre a edição. Quando há filtro/busca, mostra o total do que casou.
import { html, mount, $, debounce } from '../core/dom.js';
import { formatMoney, formatMonth, formatRelativeDate } from '../core/format.js';
import { TYPES } from '../core/finance.js';
import {
  activeChips, activeGroups, clearGroup, emptyFilters, hasCustomPeriod, parseSource, resolvePeriod,
} from '../core/filters.js';
import { friendlyError } from '../core/supabase.js';
import { getAccounts, getCategories, getSubcategories } from '../services/reference.js';
import { getCards } from '../services/cards.js';
import { listTransactions, sumTransactions } from '../services/transactions.js';
import { openFiltersSheet } from '../ui/filters-sheet.js';
import { openPlanDetail } from '../ui/installment-plan.js';
import { openTransactionForm } from '../ui/quick-add.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { transactionItem } from '../ui/transaction-item.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const TYPE_FILTERS = [
  ['', 'Todas'],
  [TYPES.EXPENSE, 'Despesas'],
  [TYPES.INCOME, 'Receitas'],
  [TYPES.TRANSFER, 'Transferências'],
  [TYPES.INVESTMENT, 'Investimentos'],
  [TYPES.INVOICE_PAYMENT, 'Faturas'],
];

// Filtros vivem no módulo: ao editar uma linha a tela recarrega e o usuário
// continua no mesmo mês/filtro em vez de voltar ao início.
const view = { month: firstOfMonth(new Date()), type: '', search: '', filters: emptyFilters() };

function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
const shiftMonth = (date, delta) => new Date(date.getFullYear(), date.getMonth() + delta, 1);

/** Critérios da consulta a partir do estado da tela (mesma fonte para lista e total). */
function criteria() {
  const f = view.filters;
  const { from, to } = resolvePeriod(f, view.month);
  const { accountId, cardId } = parseSource(f.source);
  return {
    from, to, type: view.type || undefined, search: view.search,
    accountId, cardId, categoryId: f.categoryId, subcategoryId: f.subcategoryId, min: f.min, max: f.max,
  };
}
const isFiltering = () => Boolean(view.search || view.type || activeGroups(view.filters).length);

function shell() {
  return html`
    <div class="page">
      <header class="page-header">
        <h1>Movimentações</h1>
        <button type="button" class="btn btn-primary btn-sm" data-action="new-transaction">
          ${icon('plus')}<span>Nova</span>
        </button>
      </header>

      <div class="toolbar">
        <input class="input" id="search" type="search" placeholder="Buscar por descrição" aria-label="Buscar"
               autocomplete="off" enterkeyhint="search">
        <button type="button" class="btn btn-ghost filters-btn" id="open-filters" aria-label="Filtros">
          ${icon('sliders')}<span>Filtros</span><span class="filters-count" id="filters-count" hidden></span>
        </button>
      </div>

      <div class="active-filters" id="active-filters" hidden></div>

      <div class="month-nav" id="month-nav">
        <button type="button" class="btn btn-icon" id="prev-month" aria-label="Mês anterior">
          <span style="display:inline-flex;transform:rotate(180deg)">${icon('chevron')}</span>
        </button>
        <strong id="month-label"></strong>
        <button type="button" class="btn btn-icon" id="next-month" aria-label="Próximo mês">${icon('chevron')}</button>
      </div>

      <div class="filter-chips" id="filters" role="group" aria-label="Filtrar por tipo"></div>

      <div class="filter-summary" id="summary" aria-live="polite" hidden></div>

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

  let accounts; let categories; let cards; let subcategories;
  try {
    [accounts, categories, cards, subcategories] = await Promise.all([
      getAccounts(), getCategories(), getCards(), getSubcategories(),
    ]);
  } catch (err) {
    console.error('[movimentacoes]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet));
    return;
  }
  const ref = { accounts, cards, categories, subcategories };

  mount(outlet, shell());
  const page = outlet.firstElementChild;
  const list = $('#list', page);
  const loadMore = $('#load-more', page);
  const search = $('#search', page);
  search.value = view.search;

  let rows = [];
  let pageIndex = 0;
  let request = 0;    // ignora respostas de consultas antigas (usuário digitando/trocando de mês rápido)
  let sumRequest = 0;

  function renderChrome() {
    const custom = hasCustomPeriod(view.filters);
    $('#month-nav', page).hidden = custom;
    $('#month-label', page).textContent = formatMonth(view.month);
    mount($('#filters', page), html`${TYPE_FILTERS.map(([value, label]) => html`
      <button type="button" class="chip" data-filter="${value}" aria-pressed="${String(view.type === value)}">${label}</button>`)}`);

    const groups = activeGroups(view.filters);
    const badge = $('#filters-count', page);
    badge.hidden = groups.length === 0;
    badge.textContent = String(groups.length);

    const chips = activeChips(view.filters, ref);
    const bar = $('#active-filters', page);
    bar.hidden = chips.length === 0;
    mount(bar, html`
      ${chips.map((c) => html`<button type="button" class="chip chip-removable" data-clear="${c.key}"
        aria-label="Remover filtro: ${c.label}"><span>${c.label}</span><span aria-hidden="true">×</span></button>`)}
      ${chips.length > 1 && html`<button type="button" class="btn-link" data-clear="all">Limpar tudo</button>`}`);
  }

  function renderList(hasMore) {
    loadMore.hidden = !hasMore;
    if (!rows.length) {
      const filtering = isFiltering();
      mount(list, html`<div class="card">${emptyState({
        iconName: filtering ? 'list' : 'receipt',
        title: filtering ? 'Nada encontrado' : 'Nenhuma movimentação neste mês',
        text: filtering ? 'Tente outro termo ou remova os filtros.' : 'Toque em "Nova" para registrar.',
        actionLabel: filtering ? 'Limpar filtros' : undefined,
        actionId: filtering ? 'clear-all' : undefined,
      })}</div>`);
      $('#clear-all', list)?.addEventListener('click', clearEverything);
      return;
    }
    mount(list, html`<div class="section">${groupByDay(rows).map((g) => html`
      <div class="day-group">
        <div class="day-head"><span>${formatRelativeDate(g.date)}</span></div>
        <div class="card card-flat"><ul class="list">
          ${g.rows.map((t) => transactionItem(t, ref, { interactive: true, showDate: false }))}
        </ul></div>
      </div>`)}</div>`);
  }

  /** Total de tudo que casa com o filtro (não só da página visível). */
  async function loadSummary() {
    const box = $('#summary', page);
    box.hidden = !isFiltering();
    if (box.hidden) return;
    const mine = ++sumRequest;
    box.textContent = 'Calculando…';
    try {
      const s = await sumTransactions(criteria());
      if (mine !== sumRequest) return;
      const parts = [
        `${s.count}${s.truncated ? '+' : ''} ${s.count === 1 ? 'movimentação' : 'movimentações'}`,
        s.income > 0 && `Receitas ${formatMoney(s.income)}`,
        s.expense > 0 && `Despesas ${formatMoney(s.expense)}`,
        s.invested > 0 && `Investido ${formatMoney(s.invested)}`,
      ].filter(Boolean);
      box.textContent = parts.join(' · ') + (s.truncated ? ' (total parcial)' : '');
    } catch (err) {
      if (mine !== sumRequest) return;
      console.error('[movimentacoes] total', err);
      box.hidden = true; // o total é um extra: a lista continua funcionando
    }
  }

  async function load({ append = false } = {}) {
    const mine = ++request;
    if (!append) { pageIndex = 0; rows = []; mount(list, loadingState(2)); loadMore.hidden = true; loadSummary(); }
    try {
      const result = await listTransactions({ ...criteria(), page: pageIndex });
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

  const reload = () => { renderChrome(); load(); };
  function clearEverything() {
    view.type = ''; view.search = ''; view.filters = emptyFilters(); search.value = '';
    reload();
  }

  // ---------- eventos (todos em elementos dentro da página, nunca no outlet) ----------
  $('#prev-month', page).addEventListener('click', () => { view.month = shiftMonth(view.month, -1); reload(); });
  $('#next-month', page).addEventListener('click', () => { view.month = shiftMonth(view.month, 1); reload(); });

  $('#filters', page).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    view.type = btn.dataset.filter;
    reload();
  });

  $('#open-filters', page).addEventListener('click', () => openFiltersSheet({
    filters: view.filters, ref, onApply: (next) => { view.filters = next; reload(); },
  }));

  $('#active-filters', page).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-clear]');
    if (!btn) return;
    view.filters = btn.dataset.clear === 'all' ? emptyFilters() : clearGroup(view.filters, btn.dataset.clear);
    reload();
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
