// Formulário de meta: criar, editar e excluir (a conclusão fica no detalhe da meta).
import { html, $ } from '../core/dom.js';
import { parseMoney } from '../core/format.js';
import { validateGoal } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { createGoal, deleteGoal, updateGoal } from '../services/goals.js';
import { confirmDialog, openModal } from './modal.js';
import { toast } from './toast.js';

/**
 * @param {object|null} goal  meta a editar (null = nova)
 * @param {{ onDeleted?: () => void }} options
 */
export function openGoalForm(goal, { onDeleted } = {}) {
  const isEdit = Boolean(goal);

  const { el, close } = openModal({
    title: isEdit ? 'Editar meta' : 'Nova meta',
    body: html`
      <form class="form" id="goal-form" novalidate>
        <div class="field">
          <label for="goal-name">Nome</label>
          <input class="input" id="goal-name" maxlength="80" placeholder="Ex.: Reserva de emergência" autocomplete="off">
        </div>
        <div class="field">
          <label for="goal-target">Valor alvo</label>
          <input class="input" id="goal-target" inputmode="decimal" placeholder="0,00" autocomplete="off">
        </div>
        <div class="field">
          <label for="goal-date">Prazo (opcional)</label>
          <input class="input" type="date" id="goal-date">
          <span class="field-hint">Com prazo, o app mostra quanto guardar por mês para chegar a tempo.</span>
        </div>
        <div class="field">
          <label for="goal-icon">Ícone (emoji, opcional)</label>
          <input class="input" id="goal-icon" maxlength="8" placeholder="🎯" autocomplete="off">
        </div>
        <div class="field">
          <label for="goal-notes">Observações (opcional)</label>
          <textarea class="textarea" id="goal-notes" rows="2" maxlength="500"></textarea>
        </div>
        <div class="form-error" id="goal-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
        ${isEdit && html`<button type="button" class="btn btn-link text-danger" id="goal-delete">Excluir meta</button>`}
      </form>`,
  });

  const $q = (sel) => $(sel, el);
  const error = $q('#goal-error');
  const showError = (m) => { error.textContent = m; error.hidden = false; };

  if (isEdit) {
    $q('#goal-name').value = goal.name;
    $q('#goal-target').value = String(goal.target_amount).replace('.', ',');
    $q('#goal-date').value = goal.target_date ?? '';
    $q('#goal-icon').value = goal.icon ?? '';
    $q('#goal-notes').value = goal.notes ?? '';
  } else {
    $q('#goal-name').focus();
  }

  $q('#goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const targetText = $q('#goal-target').value.trim();
    const result = validateGoal({
      name: $q('#goal-name').value,
      target_amount: targetText === '' ? NaN : parseMoney(targetText),
      target_date: $q('#goal-date').value,
      icon: $q('#goal-icon').value,
      notes: $q('#goal-notes').value,
    });
    if (!result.ok) { showError(Object.values(result.errors)[0]); return; }

    const button = $q('button[type="submit"]');
    button.classList.add('is-loading'); button.disabled = true;
    try {
      if (isEdit) await updateGoal(goal.id, result.value);
      else await createGoal(result.value);
      toast.success(isEdit ? 'Meta atualizada' : 'Meta criada');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível salvar a meta.'));
      button.classList.remove('is-loading'); button.disabled = false;
    }
  });

  $q('#goal-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Excluir "${goal.name}"?`,
      message: 'As contribuições registradas nesta meta também serão excluídas. Essa ação não pode ser desfeita.',
      confirmLabel: 'Excluir', danger: true,
    });
    if (!ok) return;
    try {
      await deleteGoal(goal.id);
      toast.success('Meta excluída');
      close();
      onDeleted?.();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível excluir a meta.'));
    }
  });
}
