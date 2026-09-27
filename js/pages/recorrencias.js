// Recorrências: regras de lançamentos que se repetem (aluguel, assinaturas, salário...).
// As ocorrências (linhas em Movimentações) são geradas automaticamente ao abrir o app
// (uma vez por dia, ver js/app.js) e de novo ao entrar aqui, com as datas calculadas
// em core/recurring.js.
import { html, mount, $ } from '../core/dom.js';
import { formatDate, formatMoney } from '../core/format.js';
import { FREQUENCY_LABELS } from '../core/recurring.js';
import { getAccounts, getCategories, getSubcategories } from '../services/reference.js';
import { getCards } from '../services/cards.js';
import { generatePendingOccurrences, getRecurring } from '../services/recurring.js';
import { openRecurringForm } from '../ui/recurring-form.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { icon } from '../ui/icons.js';

const STATUS_LABELS = { active: 'Ativa', paused: 'Pausada', ended: 'Encerrada' };
const STATUS_BADGE = { active: 'badge-success', paused: 'badge-warning', ended: '' };

function ruleRow(rule, ref) {
  const source = rule.credit_card_id
    ? ref.cards.find((c) => c.id === rule.credit_card_id)
    : ref.accounts.find((a) => a.id === rule.account_id);
  const sub = [
    FREQUENCY_LABELS[rule.frequency],
    source?.name ?? '—',
    rule.generated_until ? `última em ${formatDate(rule.generated_until)}` : null,
  ].filter(Boolean).join(' · ');
  return html`
    <button type="button" class="list-item" data-id="${rule.id}">
      <span class="avatar">${icon(rule.type === 'income' ? 'trend' : 'clock')}</span>
      <span class="list-item-main">
        <span class="list-item-title">${rule.description}</span>
        <span class="list-item-sub">${sub}</span>
      </span>
      <span class="list-item-end">
        <span class="money ${rule.type === 'income' ? 'text-success' : 'text-danger'}">${formatMoney(rule.amount)}</span>
        <span class="badge ${STATUS_BADGE[rule.status]}">${STATUS_LABELS[rule.status]}</span>
      </span>
    </button>`;
}

function view(rules, ref) {
  const active = rules.filter((r) => r.status !== 'ended');
  const ended = rules.filter((r) => r.status === 'ended');
  return html`
    <div class="page">
      <header class="page-header">
        <h1>Recorrências</h1>
        <button type="button" class="btn btn-primary btn-sm" id="new-recurring">${icon('plus')}<span>Nova</span></button>
      </header>

      ${active.length
        ? html`<div class="card card-flat"><div class="list">${active.map((r) => ruleRow(r, ref))}</div></div>`
        : html`<div class="card">${emptyState({
            iconName: 'clock',
            title: 'Nenhuma recorrência ainda',
            text: 'Cadastre contas fixas, assinaturas ou seu salário para gerar as movimentações automaticamente.',
            actionLabel: 'Nova recorrência', actionId: 'empty-new-recurring',
          })}</div>`}

      ${ended.length > 0 && html`
        <details class="section">
          <summary class="text-secondary">Encerradas (${ended.length})</summary>
          <div class="card card-flat" style="margin-top:var(--space-3)">
            <div class="list">${ended.map((r) => ruleRow(r, ref))}</div>
          </div>
        </details>`}
    </div>`;
}

export async function mountPage(outlet) {
  mount(outlet, loadingState(2));
  try {
    await generatePendingOccurrences().catch((err) => console.error('[recorrencias] geração', err));
    const [rules, accounts, cards, categories, subcategories] = await Promise.all([
      getRecurring(), getAccounts(), getCards(), getCategories(), getSubcategories(),
    ]);
    const ref = { accounts, cards, categories, subcategories };

    mount(outlet, view(rules, ref));
    const page = outlet.firstElementChild;
    const create = () => openRecurringForm(null, ref);
    $('#new-recurring', page).addEventListener('click', create);
    $('#empty-new-recurring', page)?.addEventListener('click', create);
    page.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const rule = rules.find((r) => r.id === row.dataset.id);
      if (rule) openRecurringForm(rule, ref);
    });
  } catch (err) {
    console.error('[recorrencias]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet));
  }
}

export { mountPage as mount };
