// Detalhe da meta: progresso, contribuições (adicionar/excluir), concluir/reativar e editar.
// O modal se repinta sozinho depois de cada gravação (o valor guardado é a soma das contribuições).
import { html, mount, $ } from '../core/dom.js';
import { formatDate, formatMoney, formatPercent, parseMoney, todayISO } from '../core/format.js';
import { goalProgress } from '../core/goals.js';
import { validateContribution } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import {
  addContribution, completeGoal, deleteContribution, getContributions, getGoals, reopenGoal,
} from '../services/goals.js';
import { openGoalForm } from './goal-form.js';
import { confirmDialog, openModal } from './modal.js';
import { toast } from './toast.js';

/** Frase do prazo: quanto guardar por mês, prazo vencido ou meta atingida. */
export function deadlineNote(goal, p) {
  if (p.reached) return 'Meta atingida.';
  if (!goal.target_date) return null;
  if (p.overdue) return `Prazo vencido em ${formatDate(goal.target_date)}.`;
  const months = p.monthsLeft === 1 ? '1 mês' : `${p.monthsLeft} meses`;
  return `Até ${formatDate(goal.target_date)} (${months}): guarde cerca de ${formatMoney(p.perMonth)} por mês.`;
}

export function openGoalDetail(goalId) {
  const { el, close } = openModal({
    title: 'Meta',
    body: html`<div id="gd"><p class="text-secondary">Carregando…</p></div>`,
  });
  const box = $('#gd', el);

  async function paint() {
    let goal; let mine;
    try {
      const [goals, all] = await Promise.all([getGoals(), getContributions()]);
      goal = goals.find((g) => g.id === goalId);
      mine = all.filter((c) => c.goal_id === goalId);
    } catch (err) {
      mount(box, html`<div class="form-error">${friendlyError(err, 'Não foi possível carregar a meta.')}</div>`);
      return;
    }
    if (!goal) { close(); return; }

    const p = goalProgress(goal, mine, todayISO());
    const completed = goal.status === 'completed';
    const note = deadlineNote(goal, p);
    $('h2', el).textContent = goal.name;

    mount(box, html`
      <div class="goal-detail">
        <div class="goal-saved">
          <strong class="money">${formatMoney(p.saved)}</strong>
          <span class="text-secondary"> de ${formatMoney(p.target)} (${formatPercent(p.percent)})</span>
        </div>
        <div class="bar" role="img" aria-label="Progresso: ${formatPercent(p.percent)}">
          <span style="--value:${p.percent.toFixed(1)}%; --bar-color:${p.reached ? 'var(--success)' : 'var(--primary)'}"></span>
        </div>
        ${!p.reached && html`<p class="text-secondary">Faltam ${formatMoney(p.remaining)}.</p>`}
        ${note && html`<p class="${p.overdue ? 'text-danger' : 'text-secondary'}">${note}</p>`}
        ${goal.notes && html`<p class="text-secondary">${goal.notes}</p>`}

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="gd-edit">Editar</button>
          <button type="button" class="btn btn-ghost" id="gd-toggle">${completed ? 'Reativar' : 'Marcar como concluída'}</button>
        </div>

        ${completed
          ? html`<p class="text-secondary">Meta concluída. Reative para registrar novas contribuições.</p>`
          : html`
            <form class="form" id="gd-form" novalidate>
              <h3 class="qa-label">Nova contribuição</h3>
              <div class="field-row">
                <input class="input" id="gd-amount" inputmode="decimal" placeholder="Valor" aria-label="Valor" autocomplete="off">
                <input class="input" type="date" id="gd-date" aria-label="Data" value="${todayISO()}">
              </div>
              <input class="input" id="gd-note" maxlength="200" placeholder="Observação (opcional)" aria-label="Observação" autocomplete="off">
              <div class="form-error" id="gd-error" role="alert" hidden></div>
              <button type="submit" class="btn btn-primary" id="gd-save">Adicionar contribuição</button>
            </form>`}

        <h3 class="qa-label">Contribuições (${mine.length})</h3>
        ${mine.length
          ? html`<ul class="list">${mine.map((c) => html`
              <li class="list-item">
                <span class="list-item-main">
                  <span class="list-item-title money">${formatMoney(c.amount)}</span>
                  <span class="list-item-sub">${formatDate(c.date)}${c.note ? ` · ${c.note}` : ''}</span>
                </span>
                <button type="button" class="btn btn-ghost btn-sm" data-delete="${c.id}" aria-label="Excluir contribuição">Excluir</button>
              </li>`)}</ul>`
          : html`<p class="text-secondary">Nenhuma contribuição ainda.</p>`}
      </div>`);

    $('#gd-edit', box).addEventListener('click', () => { close(); openGoalForm(goal); });

    $('#gd-toggle', box).addEventListener('click', async () => {
      try {
        if (completed) await reopenGoal(goal.id); else await completeGoal(goal.id);
        emitDataChanged();
        await paint();
      } catch (err) { toast.error(friendlyError(err, 'Não foi possível alterar a meta.')); }
    });

    $('#gd-form', box)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const error = $('#gd-error', box);
      const amountText = $('#gd-amount', box).value.trim();
      const result = validateContribution({
        amount: amountText === '' ? NaN : parseMoney(amountText),
        date: $('#gd-date', box).value,
        note: $('#gd-note', box).value,
      });
      if (!result.ok) { error.textContent = Object.values(result.errors)[0]; error.hidden = false; return; }

      const button = $('#gd-save', box);
      button.classList.add('is-loading'); button.disabled = true;
      try {
        await addContribution(goal.id, result.value);
        const reached = p.saved + result.value.amount >= p.target;
        if (reached) await completeGoal(goal.id);
        toast.success(reached ? 'Meta concluída! 🎉' : 'Contribuição adicionada');
        emitDataChanged();
        await paint();
      } catch (err) {
        error.textContent = friendlyError(err, 'Não foi possível salvar a contribuição.');
        error.hidden = false;
        button.classList.remove('is-loading'); button.disabled = false;
      }
    });

    box.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Excluir esta contribuição?', message: 'O valor guardado da meta diminui.',
        confirmLabel: 'Excluir', danger: true,
      });
      if (!ok) return;
      try {
        await deleteContribution(btn.dataset.delete);
        emitDataChanged();
        await paint();
      } catch (err) { toast.error(friendlyError(err, 'Não foi possível excluir a contribuição.')); }
    }));
  }

  paint();
}
