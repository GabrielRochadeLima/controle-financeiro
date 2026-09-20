// Formulário de cartão de crédito (criar/editar/arquivar/excluir).
import { html, $ } from '../core/dom.js';
import { parseMoney } from '../core/format.js';
import { validateCard } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError, isInUseError } from '../core/supabase.js';
import { createCard, deleteCard, setCardStatus, updateCard } from '../services/cards.js';
import { confirmDialog, openModal } from './modal.js';
import { toast } from './toast.js';

/**
 * @param {object|null} card       cartão a editar (null = novo)
 * @param {{ cards: object[], accounts: object[] }} ref
 */
export function openCardForm(card, { cards, accounts }) {
  const isEdit = Boolean(card);
  const activeAccounts = accounts.filter((a) => a.status === 'active' || a.id === card?.default_payment_account_id);

  const { el, close } = openModal({
    title: isEdit ? 'Editar cartão' : 'Novo cartão',
    body: html`
      <form class="form" id="card-form" novalidate>
        <div class="field">
          <label for="card-name">Nome</label>
          <input class="input" id="card-name" maxlength="60" placeholder="Ex.: Nubank" autocomplete="off">
        </div>
        <div class="field">
          <label for="card-inst">Instituição (opcional)</label>
          <input class="input" id="card-inst" maxlength="60" placeholder="Ex.: Nu Pagamentos" autocomplete="off">
        </div>
        <div class="field">
          <label for="card-limit">Limite</label>
          <input class="input" id="card-limit" inputmode="decimal" placeholder="0,00" autocomplete="off">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="card-closing">Dia de fechamento</label>
            <input class="input" id="card-closing" type="number" inputmode="numeric" min="1" max="31" placeholder="Ex.: 3">
          </div>
          <div class="field">
            <label for="card-due">Dia de vencimento</label>
            <input class="input" id="card-due" type="number" inputmode="numeric" min="1" max="31" placeholder="Ex.: 10">
          </div>
        </div>
        <span class="field-hint">Compras feitas até o dia do fechamento entram na fatura que fecha naquele mês.
          ${isEdit && 'Mudar os dias vale para compras novas: faturas já criadas mantêm as datas.'}</span>
        <div class="field">
          <label for="card-pay">Conta para pagar a fatura (opcional)</label>
          <select class="select" id="card-pay">
            <option value="">Escolher na hora do pagamento</option>
            ${activeAccounts.map((a) => html`<option value="${a.id}">${a.name}</option>`)}
          </select>
        </div>
        <div class="form-error" id="card-error" role="alert" hidden></div>
        <div class="modal-actions">
          ${isEdit && html`<button type="button" class="btn btn-ghost" id="card-archive">
            ${card.status === 'active' ? 'Arquivar' : 'Reativar'}</button>`}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
        ${isEdit && html`<button type="button" class="btn btn-link text-danger" id="card-delete">Excluir cartão</button>`}
      </form>`,
  });

  const error = $('#card-error', el);
  const showError = (message) => { error.textContent = message; error.hidden = false; };
  if (isEdit) {
    $('#card-name', el).value = card.name;
    $('#card-inst', el).value = card.institution ?? '';
    $('#card-limit', el).value = String(card.credit_limit).replace('.', ',');
    $('#card-closing', el).value = card.closing_day;
    $('#card-due', el).value = card.due_day;
    $('#card-pay', el).value = card.default_payment_account_id ?? '';
  } else {
    $('#card-name', el).focus();
  }

  $('#card-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const limitText = $('#card-limit', el).value.trim();
    const result = validateCard({
      name: $('#card-name', el).value,
      institution: $('#card-inst', el).value,
      credit_limit: limitText === '' ? 0 : parseMoney(limitText),
      closing_day: $('#card-closing', el).value,
      due_day: $('#card-due', el).value,
      default_payment_account_id: $('#card-pay', el).value,
    }, cards, accounts, card?.id);
    if (!result.ok) { showError(Object.values(result.errors)[0]); return; }

    const button = $('button[type="submit"]', el);
    button.classList.add('is-loading'); button.disabled = true;
    try {
      if (isEdit) await updateCard(card.id, result.value);
      else await createCard(result.value);
      toast.success(isEdit ? 'Cartão atualizado' : 'Cartão criado');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível salvar o cartão.'));
      button.classList.remove('is-loading'); button.disabled = false;
    }
  });

  $('#card-archive', el)?.addEventListener('click', async () => {
    const archiving = card.status === 'active';
    try {
      await setCardStatus(card.id, archiving ? 'archived' : 'active');
      toast.success(archiving ? 'Cartão arquivado' : 'Cartão reativado');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível alterar o cartão.'));
    }
  });

  $('#card-delete', el)?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: `Excluir "${card.name}"?`,
      message: 'Só é possível excluir cartões sem compras. Se ele tiver histórico, arquive-o em vez de excluir.',
      confirmLabel: 'Excluir', danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteCard(card.id);
      toast.success('Cartão excluído');
      close();
      location.hash = '#/cartoes';
      emitDataChanged();
    } catch (err) {
      showError(isInUseError(err)
        ? 'Este cartão tem compras. Arquive-o em vez de excluir.'
        : friendlyError(err, 'Não foi possível excluir o cartão.'));
    }
  });
}
