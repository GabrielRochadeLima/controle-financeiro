// Orçamentos: limite mensal por categoria de despesa, com o quanto já foi gasto no
// mês corrente. O consumo vem das próprias movimentações (services/budgets.js);
// nenhuma soma fica guardada no banco, para nunca divergir da tela de Movimentações.
import { html, mount, $ } from '../core/dom.js';
import { formatMoney, formatPercent } from '../core/format.js';
import { getCategories } from '../services/reference.js';
import { getBudgets, spentThisMonth } from '../services/budgets.js';
import { openBudgetForm } from '../ui/budget-form.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { icon } from '../ui/icons.js';

/** Cor da barra: alerta a partir do limiar da própria regra, perigo ao estourar. */
const budgetColor = (ratio, threshold) => (ratio >= 100 ? 'var(--danger)' : ratio >= threshold ? 'var(--warning)' : 'var(--primary)');

function budgetRow(cat, budget, spent) {
  const amount = budget ? Number(budget.amount) : null;
  const ratio = amount ? (spent / amount) * 100 : 0;
  const over = amount != null && spent > amount;
  return html`
    <button type="button" class="list-item budget-row" data-cat="${cat.id}">
      <span class="avatar">${cat.icon ?? '📦'}</span>
      <span class="list-item-main">
        <span class="list-item-title">${cat.name}</span>
        ${amount != null
          ? html`
            <div class="bar" role="img" aria-label="Consumido: ${formatPercent(ratio)}">
              <span style="--value:${Math.min(100, ratio).toFixed(1)}%; --bar-color:${budgetColor(ratio, budget.alert_threshold)}"></span>
            </div>
            <span class="list-item-sub ${over ? 'text-danger' : ''}">
              ${formatMoney(spent)} de ${formatMoney(amount)}${over ? ' · estourou' : ''}
            </span>`
          : html`<span class="list-item-sub">${spent > 0 ? `${formatMoney(spent)} gastos · sem orçamento` : 'Sem orçamento definido'}</span>`}
      </span>
      ${icon('chevron')}
    </button>`;
}

function view(rows) {
  return html`
    <div class="page">
      <header class="page-header"><h1>Orçamentos</h1></header>
      <p class="text-secondary">Toque em uma categoria para definir ou ajustar o limite mensal.</p>
      ${rows.length
        ? html`<div class="card card-flat"><div class="list">${rows.map(([cat, budget, spent]) => budgetRow(cat, budget, spent))}</div></div>`
        : html`<div class="card">${emptyState({
            iconName: 'pie',
            title: 'Nenhuma categoria de despesa',
            text: 'Crie categorias de despesa em Mais → Categorias para definir orçamentos.',
            actionLabel: 'Criar categoria', actionHref: '#/categorias',
          })}</div>`}
    </div>`;
}

export async function mountPage(outlet) {
  mount(outlet, loadingState(3));
  try {
    const [categories, budgets, spent] = await Promise.all([getCategories(), getBudgets(), spentThisMonth()]);
    const expenseCats = [...categories.values()]
      .filter((c) => c.kind === 'expense')
      .sort((a, b) => a.sort_order - b.sort_order);
    const byCategory = new Map(budgets.map((b) => [b.category_id, b]));
    const rows = expenseCats.map((c) => [c, byCategory.get(c.id) ?? null, spent.get(c.id) || 0]);

    mount(outlet, view(rows));
    const page = outlet.firstElementChild;
    page.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      const cat = expenseCats.find((c) => c.id === btn.dataset.cat);
      if (cat) openBudgetForm(cat, byCategory.get(cat.id) ?? null);
    });
  } catch (err) {
    console.error('[orcamentos]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet));
  }
}

export { mountPage as mount };
