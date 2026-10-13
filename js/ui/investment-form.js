// Formulário de investimento (o ativo): criar, editar, encerrar/reativar e excluir.
// Os aportes são movimentações; excluir o investimento não apaga nenhum aporte.
import { html, $ } from '../core/dom.js';
import { INVESTMENT_KINDS } from '../core/goals.js';
import { validateInvestment } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { createInvestment, deleteInvestment, updateInvestment } from '../services/investments.js';
import { confirmDialog, openModal } from './modal.js';
import { toast } from './toast.js';

/**
 * @param {object|null} investment  investimento a editar (null = novo)
 * @param {{ investments: object[] }} ref  todos os investimentos (checa nome repetido)
 */
export function openInvestmentForm(investment, { investments }) {
  const isEdit = Boolean(investment);

  const { el, close } = openModal({
    title: isEdit ? 'Editar investimento' : 'Novo investimento',
    body: html`
      <form class="form" id="inv-form" novalidate>
        <div class="field">
          <label for="inv-name">Nome</label>
          <input class="input" id="inv-name" maxlength="80" placeholder="Ex.: Tesouro Selic 2029" autocomplete="off">
        </div>
        <div class="field">
          <label for="inv-kind">Tipo</label>
          <select class="select" id="inv-kind">
            ${Object.entries(INVESTMENT_KINDS).map(([value, label]) => html`<option value="${value}">${label}</option>`)}
          </select>
        </div>
        <div class="field">
          <label for="inv-inst">Instituição (opcional)</label>
          <input class="input" id="inv-inst" maxlength="60" placeholder="Ex.: Corretora XP" autocomplete="off">
        </div>
        <div class="field">
          <label for="inv-notes">Observações (opcional)</label>
          <textarea class="textarea" id="inv-notes" rows="2" maxlength="500"></textarea>
        </div>
        <div class="form-error" id="inv-error" role="alert" hidden></div>
        <div class="modal-actions">
          ${isEdit && html`<button type="button" class="btn btn-ghost" id="inv-status">
            ${investment.status === 'active' ? 'Encerrar' : 'Reativar'}</button>`}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
        ${isEdit && html`<button type="button" class="btn btn-link text-danger" id="inv-delete">Excluir investimento</button>`}
      </form>`,
  });

  const $q = (sel) => $(sel, el);
  const error = $q('#inv-error');
  const showError = (m) => { error.textContent = m; error.hidden = false; };

  if (isEdit) {
    $q('#inv-name').value = investment.name;
    $q('#inv-kind').value = investment.kind;
    $q('#inv-inst').value = investment.institution ?? '';
    $q('#inv-notes').value = investment.notes ?? '';
  } else {
    $q('#inv-name').focus();
  }

  $q('#inv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = validateInvestment({
      name: $q('#inv-name').value,
      kind: $q('#inv-kind').value,
      institution: $q('#inv-inst').value,
      notes: $q('#inv-notes').value,
    }, investments, investment?.id);
    if (!result.ok) { showError(Object.values(result.errors)[0]); return; }

    const button = $q('button[type="submit"]');
    button.classList.add('is-loading'); button.disabled = true;
    try {
      if (isEdit) await updateInvestment(investment.id, result.value);
      else await createInvestment(result.value);
      toast.success(isEdit ? 'Investimento atualizado' : 'Investimento criado');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível salvar o investimento.'));
      button.classList.remove('is-loading'); button.disabled = false;
    }
  });

  $q('#inv-status')?.addEventListener('click', async () => {
    const closing = investment.status === 'active';
    try {
      await updateInvestment(investment.id, { status: closing ? 'closed' : 'active' });
      toast.success(closing ? 'Investimento encerrado' : 'Investimento reativado');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível alterar o investimento.'));
    }
  });

  $q('#inv-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Excluir "${investment.name}"?`,
      message: 'Os aportes já registrados continuam nas suas movimentações, só deixam de apontar para este investimento.',
      confirmLabel: 'Excluir', danger: true,
    });
    if (!ok) return;
    try {
      await deleteInvestment(investment.id);
      toast.success('Investimento excluído');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível excluir o investimento.'));
    }
  });
}
