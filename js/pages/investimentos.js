// Investimentos: o que você investiu em cada ativo (aportes − resgates) e saldo atual / rendimento opcional.
import { html, mount, $ } from '../core/dom.js';
import { formatDate, formatMoney, formatPercent } from '../core/format.js';
import { INVESTMENT_KINDS, summarizeInvestments } from '../core/goals.js';
import { getInvestments, loadAportes } from '../services/investments.js';
import { openInvestmentForm } from '../ui/investment-form.js';
import { openTransactionForm } from '../ui/quick-add.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { icon } from '../ui/icons.js';

function formatYield(yieldAmount, yieldPercent) {
  if (yieldAmount == null) return null;
  const sign = yieldAmount > 0 ? '+' : yieldAmount < 0 ? '−' : '';
  const abs = formatMoney(Math.abs(yieldAmount));
  const pct = yieldPercent != null ? ` (${sign}${formatPercent(Math.abs(yieldPercent))})` : '';
  return `${sign}${abs}${pct}`;
}

function row({ investment, total, redeemed, currentAmount, yieldAmount, yieldPercent, count, last }) {
  const sub = [
    INVESTMENT_KINDS[investment.kind],
    investment.institution,
    count ? `${count} ${count === 1 ? 'aporte' : 'aportes'}${last ? ` · último em ${formatDate(last)}` : ''}` : 'Sem aportes',
    redeemed > 0 ? `resgatado ${formatMoney(redeemed)}` : null,
  ].filter(Boolean).join(' · ');

  const yieldText = formatYield(yieldAmount, yieldPercent);
  const yieldTone = yieldAmount > 0 ? 'text-success' : yieldAmount < 0 ? 'text-danger' : 'text-secondary';

  return html`
    <li class="list-item">
      <button type="button" class="row-main-btn list-item-main" data-edit="${investment.id}">
        <span class="list-item-title">${investment.name}</span>
        <span class="list-item-sub">${sub}</span>
        ${currentAmount != null && html`
          <span class="list-item-sub">
            Aportado líquido: ${formatMoney(total)} · Rendimento: <strong class="${yieldTone}">${yieldText}</strong>
          </span>`}
      </button>
      <span class="list-item-end">
        <span class="money">${formatMoney(currentAmount != null ? currentAmount : total)}</span>
        ${currentAmount != null && html`<span class="badge ${yieldAmount >= 0 ? 'badge-success' : 'badge-danger'}">Saldo atual</span>`}
      </span>
      ${investment.status === 'active' && html`
        <div style="display:flex;gap:var(--space-1);flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" data-aport="${investment.id}">Aportar</button>
          ${total > 0 && html`<button type="button" class="btn btn-ghost btn-sm" data-redeem="${investment.id}">Resgatar</button>`}
        </div>`}
    </li>`;
}

function view(summary) {
  const active = summary.items.filter((i) => i.investment.status === 'active');
  const closed = summary.items.filter((i) => i.investment.status === 'closed');
  const totalYieldText = summary.hasCurrent ? formatYield(summary.totalYield, summary.totalYieldPercent) : null;
  const totalYieldTone = summary.totalYield > 0 ? 'text-success' : summary.totalYield < 0 ? 'text-danger' : '';

  return html`
    <div class="page">
      <header class="page-header">
        <h1>Investimentos</h1>
        <button type="button" class="btn btn-primary btn-sm" id="new-investment">${icon('plus')}<span>Novo</span></button>
      </header>

      <section class="card" aria-label="Resumo dos investimentos">
        <div class="${summary.hasCurrent ? 'stat-grid' : ''}">
          <div class="stat">
            <span class="stat-label">Total aportado (líquido)</span>
            <span class="stat-value money">${formatMoney(summary.total)}</span>
          </div>
          ${summary.hasCurrent && html`
            <div class="stat">
              <span class="stat-label">Saldo atual</span>
              <span class="stat-value money">${formatMoney(summary.currentTotal)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Rendimento</span>
              <span class="stat-value money ${totalYieldTone}">${totalYieldText}</span>
            </div>`}
        </div>
        ${summary.unlinked.count > 0 && html`
          <p class="field-hint">${formatMoney(summary.unlinked.total)} em ${summary.unlinked.count}
            ${summary.unlinked.count === 1 ? 'aporte' : 'aportes'} sem investimento vinculado. Edite o aporte em Movimentações para escolher um.</p>`}
      </section>

      ${active.length
        ? html`<div class="card card-flat"><ul class="list">${active.map(row)}</ul></div>`
        : html`<div class="card">${emptyState({
            iconName: 'trend',
            title: closed.length ? 'Nenhum investimento ativo' : 'Nenhum investimento cadastrado',
            text: 'Cadastre seus ativos (Tesouro, ações, fundos...) para ver quanto aportou e acompanhar o saldo atual.',
            actionLabel: 'Cadastrar investimento', actionId: 'empty-new-investment',
          })}</div>`}

      ${closed.length > 0 && html`
        <details class="section">
          <summary class="text-secondary">Encerrados (${closed.length})</summary>
          <div class="card card-flat" style="margin-top:var(--space-3)"><ul class="list">${closed.map(row)}</ul></div>
        </details>`}
    </div>`;
}

export async function mountPage(outlet) {
  mount(outlet, loadingState(2));
  try {
    const [investments, aportes] = await Promise.all([getInvestments(), loadAportes()]);
    mount(outlet, view(summarizeInvestments(investments, aportes)));
    const page = outlet.firstElementChild;
    const create = () => openInvestmentForm(null, { investments });
    $('#new-investment', page).addEventListener('click', create);
    $('#empty-new-investment', page)?.addEventListener('click', create);
    page.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) {
        openInvestmentForm(investments.find((i) => i.id === edit.dataset.edit), { investments });
        return;
      }
      const aport = e.target.closest('[data-aport]');
      if (aport) {
        openTransactionForm({ presetInvestmentId: aport.dataset.aport });
        return;
      }
      const redeem = e.target.closest('[data-redeem]');
      if (redeem) {
        openTransactionForm({ presetRedeemInvestmentId: redeem.dataset.redeem });
      }
    });
  } catch (err) {
    console.error('[investimentos]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet));
  }
}

export { mountPage as mount };
