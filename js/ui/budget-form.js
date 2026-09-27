// Formulário de orçamento (criar/editar/remover) para uma categoria de despesa.
import { html, $ } from '../core/dom.js';
import { parseMoney } from '../core/format.js';
import { validateBudget } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { deleteBudget, upsertBudget } from '../services/budgets.js';
import { confirmDialog, openModal } from './modal.js';
import { toast } from './toast.js';

/**
 * @param {{ id: string, name: string }} category
 * @param {{ id: string, amount: number, alert_threshold: number }|null} budget
 */
export function openBudgetForm(category, budget) {
  const { el, close } = openModal({
    title: `Orçamento — ${category.name}`,
    body: html`
      <form class="form" id="budget-form" novalidate>
        <div class="field">
          <label for="budget-amount">Limite mensal</label>
          <input class="input" id="budget-amount" inputmode="decimal" placeholder="0,00" autocomplete="off">
        </div>
        <div class="field">
          <label for="budget-threshold">Avisar a partir de quantos % do limite</label>
          <input class="input" type="number" id="budget-threshold" min="1" max="100" placeholder="80">
        </div>
        <div class="form-error" id="budget-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
        ${budget && html`<button type="button" class="btn btn-link text-danger" id="budget-delete">Remover orçamento</button>`}
      </form>`,
  });

  const $q = (sel) => $(sel, el);
  const error = $q('#budget-error');
  const showError = (m) => { error.textContent = m; error.hidden = false; };

  if (budget) {
    $q('#budget-amount').value = String(budget.amount).replace('.', ',');
    $q('#budget-threshold').value = budget.alert_threshold;
  } else {
    $q('#budget-threshold').value = 80;
    $q('#budget-amount').focus();
  }

  $q('#budget-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amountText = $q('#budget-amount').value.trim();
    const result = validateBudget({
      amount: amountText === '' ? NaN : parseMoney(amountText),
      alert_threshold: $q('#budget-threshold').value,
    });
    if (!result.ok) { showError(Object.values(result.errors)[0]); return; }

    const button = $q('button[type="submit"]');
    button.classList.add('is-loading'); button.disabled = true;
    try {
      await upsertBudget(category.id, result.value);
      toast.success('Orçamento salvo');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível salvar o orçamento.'));
      button.classList.remove('is-loading'); button.disabled = false;
    }
  });

  $q('#budget-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Remover orçamento de "${category.name}"?`,
      message: 'Você pode definir um novo orçamento para esta categoria quando quiser.',
      confirmLabel: 'Remover', danger: true,
    });
    if (!ok) return;
    try {
      await deleteBudget(budget.id);
      toast.success('Orçamento removido');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível remover o orçamento.'));
    }
  });
}
