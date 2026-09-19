// Dashboard (Fase 1): saldo, resumo do mês, gastos por categoria e últimas
// movimentações. Widgets de fatura, vencimentos, orçamento e metas entram nas
// fases 3–5, quando os dados correspondentes existirem.
import { html, mount } from '../core/dom.js';
import { formatMoney, formatMonth, formatPercent, greeting } from '../core/format.js';
import { loadDashboard } from '../services/dashboard.js';
import { getProfile } from '../services/reference.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { icon } from '../ui/icons.js';
import { transactionItem } from '../ui/transaction-item.js';

const TOP_CATEGORIES = 5;

// A cor vem do banco (validada lá), mas nunca vai para um atributo style sem checagem.
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : 'var(--primary)');

function categoryRow(cat) {
  return html`
    <li class="cat-row">
      <div class="cat-row-head">
        <span class="cat-row-name"><span>${cat.icon}</span><span>${cat.name}</span></span>
        <span class="cat-row-value money">
          ${formatMoney(cat.total)} <span class="cat-row-pct">${formatPercent(cat.percent)}</span>
        </span>
      </div>
      <div class="bar" role="img" aria-label="${cat.name}: ${formatPercent(cat.percent)} dos gastos">
        <span style="--value:${cat.percent.toFixed(1)}%; --bar-color:${safeColor(cat.color)}"></span>
      </div>
    </li>`;
}

/** View pura: dados -> HTML. Não toca em rede nem no DOM (fácil de testar). */
export function dashboardView(data, name = '') {
  const { now, summary, balance, byCategory, recent, hasAccounts, categories, accounts } = data;
  const first = name.trim().split(/\s+/)[0];

  const spending = byCategory.length
    ? html`<div class="card card-flat"><ul class="list">
        ${byCategory.slice(0, TOP_CATEGORIES).map(categoryRow)}</ul></div>`
    : html`<div class="card">${emptyState({
        iconName: 'pie',
        title: 'Sem gastos neste mês',
        text: 'Quando você registrar despesas, elas aparecem aqui agrupadas por categoria.',
      })}</div>`;

  const latest = recent.length
    ? html`<div class="card card-flat"><ul class="list">
        ${recent.map((t) => transactionItem(t, { categories, accounts }))}</ul></div>`
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
  } catch (err) {
    console.error('[dashboard]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    outlet.querySelector('#retry')?.addEventListener('click', () => mountPage(outlet));
  }
}

export { mountPage as mount };
