// Dashboard: saldo, resumo do mês, faturas próximas, orçamentos em alerta, previsão
// do mês, gastos por categoria e últimas movimentações. Widgets de metas entram na fase 5.
import { html, mount } from '../core/dom.js';
import { formatDate, formatMoney, formatMonth, formatPercent, greeting } from '../core/format.js';
import { STATUS_LABELS } from '../core/cards.js';
import { loadDashboard } from '../services/dashboard.js';
import { getProfile } from '../services/reference.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { icon } from '../ui/icons.js';
import { bindDonut, bindMonthly, categoryDonut, monthlyChart } from '../ui/charts.js';
import { transactionItem } from '../ui/transaction-item.js';
import { STATUS_BADGE } from './cards.js';

/** View pura: dados -> HTML. Não toca em rede nem no DOM (fácil de testar). */
export function dashboardView(data, name = '') {
  const {
    now, summary, balance, byCategory, recent, hasAccounts, categories, accounts, cards = [],
    invoices = [], trend = null, budgetAlerts = [], forecast = null,
  } = data;
  const first = name.trim().split(/\s+/)[0];

  const donut = categoryDonut(byCategory);
  const spending = donut
    ? html`<div class="card">${donut}</div>`
    : html`<div class="card">${emptyState({
        iconName: 'pie',
        title: 'Sem gastos neste mês',
        text: 'Quando você registrar despesas, elas aparecem aqui agrupadas por categoria.',
      })}</div>`;

  const latest = recent.length
    ? html`<div class="card card-flat"><ul class="list">
        ${recent.map((t) => transactionItem(t, { categories, accounts, cards }))}</ul></div>`
    : html`<div class="card">${emptyState({
        iconName: 'receipt',
        title: 'Nenhuma movimentação ainda',
        text: 'Registre sua primeira despesa ou receita para começar.',
      })}</div>`;

  return html`
    <div class="page">
      <header class="greeting">
        <h1>${greeting(now)}${first ? `, ${first}` : ''}</h1>
        <p>${formatMonth(now)}</p>
      </header>

      <section class="card balance-card" aria-label="Saldo total">
        <div>
          <div class="balance-label">Saldo total</div>
          <div class="balance-value money">${formatMoney(balance)}</div>
        </div>
        <button type="button" class="btn" data-action="new-transaction">
          ${icon('plus')}<span>Nova movimentação</span>
        </button>
      </section>

      <section class="summary" aria-label="Resumo do mês">
        <div class="card stat">
          <span class="stat-label">Receitas</span>
          <span class="stat-value money text-success">${formatMoney(summary.income)}</span>
        </div>
        <div class="card stat">
          <span class="stat-label">Despesas</span>
          <span class="stat-value money text-danger">${formatMoney(summary.expense)}</span>
        </div>
        <div class="card stat">
          <span class="stat-label">Sobrou</span>
          <span class="stat-value money ${summary.left < 0 ? 'text-danger' : ''}">${formatMoney(summary.left)}</span>
        </div>
      </section>

      ${forecast && (forecast.pendingIncome > 0 || forecast.pendingExpense > 0) && html`
        <section class="card forecast-card" aria-label="Previsão do mês">
          <div class="forecast-head">${icon('trend')}<strong>Previsão até o fim do mês</strong></div>
          <p class="text-secondary">Somando o que já aconteceu com as recorrências que ainda faltam.</p>
          <div class="stat-grid">
            <div class="stat">
              <span class="stat-label">Receitas</span>
              <span class="stat-value money text-success">${formatMoney(forecast.income)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Despesas</span>
              <span class="stat-value money text-danger">${formatMoney(forecast.expense)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Sobra prevista</span>
              <span class="stat-value money ${forecast.left < 0 ? 'text-danger' : ''}">${formatMoney(forecast.left)}</span>
            </div>
          </div>
        </section>`}

      ${budgetAlerts.length > 0 && html`
        <section class="section">
          <div class="section-head"><h2>Orçamentos</h2><a href="#/orcamentos">Ver todos</a></div>
          <div class="card card-flat"><ul class="list">
            ${budgetAlerts.map((a) => html`
              <li class="list-item">
                <span class="avatar">${icon('alert')}</span>
                <span class="list-item-main">
                  <span class="list-item-title">${a.category.name}</span>
                  <span class="list-item-sub ${a.ratio >= 100 ? 'text-danger' : ''}">
                    ${formatMoney(a.spent)} de ${formatMoney(a.amount)} (${formatPercent(a.ratio)})
                  </span>
                </span>
              </li>`)}
          </ul></div>
        </section>`}

      ${invoices.length > 0 && html`
        <section class="section">
          <div class="section-head"><h2>Faturas</h2><a href="#/cartoes">Ver cartões</a></div>
          <div class="card card-flat"><ul class="list">
            ${invoices.map((i) => html`
              <li>
                <a class="list-item dash-invoice" href="#/cartao?id=${i.credit_card_id}&amp;inv=${i.id}">
                  <span class="avatar">${icon('card')}</span>
                  <span class="list-item-main">
                    <span class="list-item-title">${i.card.name}</span>
                    <span class="list-item-sub">Vence ${formatDate(i.due_date)} · fecha ${formatDate(i.closing_date)}</span>
                  </span>
                  <span class="list-item-end">
                    <span class="money">${formatMoney(i.total_amount)}</span>
                    <span class="badge ${STATUS_BADGE[i.status]}">${STATUS_LABELS[i.status]}</span>
                  </span>
                </a>
              </li>`)}
          </ul></div>
        </section>`}

      ${trend && html`
        <section class="section">
          <div class="section-head"><h2>Receitas × despesas</h2><span class="text-secondary">últimos 6 meses</span></div>
          <div class="card">${monthlyChart(trend)}</div>
        </section>`}

      ${!hasAccounts && html`
        <section class="card">${emptyState({
          iconName: 'wallet',
          title: 'Comece criando uma conta',
          text: 'Cadastre onde seu dinheiro está (banco, carteira, poupança) para acompanhar seu saldo.',
          actionLabel: 'Criar conta',
          actionHref: '#/contas',
        })}</section>`}

      <div class="dash-cols">
        <section class="section">
          <div class="section-head"><h2>Gastos por categoria</h2></div>
          ${spending}
        </section>
        <section class="section">
          <div class="section-head">
            <h2>Últimas movimentações</h2>
            <a href="#/movimentacoes">Ver todas</a>
          </div>
          ${latest}
        </section>
      </div>
    </div>`;
}

export async function mountPage(outlet) {
  mount(outlet, loadingState());
  try {
    const [data, profile] = await Promise.all([loadDashboard(), getProfile()]);
    mount(outlet, dashboardView(data, profile.displayName));
    bindDonut(outlet);
    if (data.trend) bindMonthly(outlet, data.trend);
  } catch (err) {
    console.error('[dashboard]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    outlet.querySelector('#retry')?.addEventListener('click', () => mountPage(outlet));
  }
}

export { mountPage as mount };
