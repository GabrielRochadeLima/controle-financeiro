// Metas: objetivos com valor alvo e prazo opcional. O valor guardado é a soma das
// contribuições (core/goals.js); tocar numa meta abre o detalhe para contribuir.
import { html, mount, $ } from '../core/dom.js';
import { formatMoney, formatPercent, todayISO } from '../core/format.js';
import { goalProgress } from '../core/goals.js';
import { getContributions, getGoals } from '../services/goals.js';
import { deadlineNote, openGoalDetail } from '../ui/goal-detail.js';
import { openGoalForm } from '../ui/goal-form.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { icon } from '../ui/icons.js';

function goalRow(goal, p) {
  const note = deadlineNote(goal, p);
  return html`
    <button type="button" class="list-item budget-row" data-goal="${goal.id}">
      <span class="avatar">${goal.icon || '🎯'}</span>
      <span class="list-item-main">
        <span class="list-item-title">${goal.name}</span>
        <div class="bar" role="img" aria-label="Progresso: ${formatPercent(p.percent)}">
          <span style="--value:${p.percent.toFixed(1)}%; --bar-color:${p.reached ? 'var(--success)' : 'var(--primary)'}"></span>
        </div>
        <span class="list-item-sub">${formatMoney(p.saved)} de ${formatMoney(p.target)} (${formatPercent(p.percent)})</span>
        ${note && html`<span class="list-item-sub ${p.overdue ? 'text-danger' : ''}">${note}</span>`}
      </span>
      ${icon('chevron')}
    </button>`;
}

function view(rows) {
  const open = rows.filter(([g]) => g.status === 'active');
  const done = rows.filter(([g]) => g.status === 'completed');
  return html`
    <div class="page">
      <header class="page-header">
        <h1>Metas</h1>
        <button type="button" class="btn btn-primary btn-sm" id="new-goal">${icon('plus')}<span>Nova</span></button>
      </header>

      ${open.length
        ? html`<div class="card card-flat"><div class="list">${open.map(([g, p]) => goalRow(g, p))}</div></div>`
        : html`<div class="card">${emptyState({
            iconName: 'target',
            title: done.length ? 'Nenhuma meta em andamento' : 'Nenhuma meta ainda',
            text: 'Defina um objetivo (viagem, reserva, carro...) e registre contribuições para acompanhar o progresso.',
            actionLabel: 'Criar meta', actionId: 'empty-new-goal',
          })}</div>`}

      ${done.length > 0 && html`
        <details class="section">
          <summary class="text-secondary">Concluídas (${done.length})</summary>
          <div class="card card-flat" style="margin-top:var(--space-3)">
            <div class="list">${done.map(([g, p]) => goalRow(g, p))}</div>
          </div>
        </details>`}
    </div>`;
}

export async function mountPage(outlet) {
  mount(outlet, loadingState(2));
  try {
    const [goals, contributions] = await Promise.all([getGoals(), getContributions()]);
    const today = todayISO();
    const rows = goals
      .filter((g) => g.status !== 'canceled')
      .map((g) => [g, goalProgress(g, contributions.filter((c) => c.goal_id === g.id), today)]);

    mount(outlet, view(rows));
    const page = outlet.firstElementChild;
    const create = () => openGoalForm(null);
    $('#new-goal', page).addEventListener('click', create);
    $('#empty-new-goal', page)?.addEventListener('click', create);
    page.addEventListener('click', (e) => {
      const row = e.target.closest('[data-goal]');
      if (row) openGoalDetail(row.dataset.goal);
    });
  } catch (err) {
    console.error('[metas]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet));
  }
}

export { mountPage as mount };
