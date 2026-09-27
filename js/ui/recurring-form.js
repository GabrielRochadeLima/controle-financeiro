// Formulário de recorrência: criar, editar, pausar/reativar e excluir a regra.
import { html, mount, $ } from '../core/dom.js';
import { parseMoney, todayISO } from '../core/format.js';
import { validateRecurring } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { createRecurring, deleteRecurring, updateRecurring } from '../services/recurring.js';
import { confirmDialog, openModal } from './modal.js';
import { toast } from './toast.js';

const FREQ_OPTIONS = [['weekly', 'Semanal'], ['monthly', 'Mensal'], ['yearly', 'Anual']];

/**
 * @param {object|null} rule  regra a editar (null = nova)
 * @param {{ accounts: object[], cards: object[], categories: Map, subcategories: object[] }} ref
 */
export function openRecurringForm(rule, ref) {
  const { accounts, cards, categories, subcategories } = ref;
  const isEdit = Boolean(rule);
  const activeAccounts = accounts.filter((a) => a.status === 'active' || a.id === rule?.account_id);
  const activeCards = cards.filter((c) => c.status === 'active' || c.id === rule?.credit_card_id);

  const { el, close } = openModal({
    title: isEdit ? 'Editar recorrência' : 'Nova recorrência',
    body: html`
      <form class="form" id="rec-form" novalidate>
        <div class="field">
          <span class="field-label">Tipo</span>
          <div class="segmented" id="rec-type" role="group" aria-label="Tipo">
            <button type="button" data-type="expense" aria-pressed="false">Despesa</button>
            <button type="button" data-type="income" aria-pressed="false">Receita</button>
          </div>
        </div>
        <div class="field">
          <label for="rec-desc">Descrição</label>
          <input class="input" id="rec-desc" maxlength="120" placeholder="Ex.: Aluguel" autocomplete="off">
        </div>
        <div class="field">
          <label for="rec-amount">Valor</label>
          <input class="input" id="rec-amount" inputmode="decimal" placeholder="0,00" autocomplete="off">
        </div>
        <div class="field">
          <label for="rec-source">Conta ou cartão</label>
          <select class="select" id="rec-source"></select>
        </div>
        <div class="field">
          <label for="rec-cat">Categoria</label>
          <select class="select" id="rec-cat"></select>
        </div>
        <div class="field" id="rec-sub-wrap" hidden>
          <label for="rec-sub">Subcategoria</label>
          <select class="select" id="rec-sub"></select>
        </div>
        <div class="field">
          <label for="rec-freq">Frequência</label>
          <select class="select" id="rec-freq">
            ${FREQ_OPTIONS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}
          </select>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="rec-start">Início</label>
            <input class="input" type="date" id="rec-start">
          </div>
          <div class="field">
            <label for="rec-end">Fim (opcional)</label>
            <input class="input" type="date" id="rec-end">
          </div>
        </div>
        ${isEdit && html`
          <div class="field">
            <label for="rec-status">Situação</label>
            <select class="select" id="rec-status">
              <option value="active">Ativa</option>
              <option value="paused">Pausada</option>
            </select>
          </div>`}
        <div class="form-error" id="rec-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
        ${isEdit && html`<button type="button" class="btn btn-link text-danger" id="rec-delete">Excluir recorrência</button>`}
      </form>`,
  });

  const $q = (sel) => $(sel, el);
  const error = $q('#rec-error');
  const showError = (m) => { error.textContent = m; error.hidden = false; };
  const clearError = () => { error.hidden = true; };

  let type = rule?.type ?? 'expense';

  function paintSource() {
    const showCards = type === 'expense';
    mount($q('#rec-source'), html`
      ${activeAccounts.map((a) => html`<option value="a:${a.id}">${a.name}</option>`)}
      ${showCards ? activeCards.map((c) => html`<option value="c:${c.id}">${c.name}</option>`) : ''}`);
    const current = rule?.credit_card_id ? `c:${rule.credit_card_id}` : rule?.account_id ? `a:${rule.account_id}` : '';
    if (current && $q('#rec-source').querySelector(`option[value="${current}"]`)) $q('#rec-source').value = current;
  }

  function paintSubs() {
    const catId = $q('#rec-cat').value;
    const subs = subcategories.filter((s) => s.category_id === catId);
    $q('#rec-sub-wrap').hidden = subs.length === 0;
    mount($q('#rec-sub'), html`
      <option value="">Nenhuma</option>
      ${subs.map((s) => html`<option value="${s.id}">${s.name}</option>`)}`);
    if (rule?.subcategory_id) $q('#rec-sub').value = rule.subcategory_id;
  }

  function paintCategories() {
    const list = [...categories.values()].filter((c) => c.kind === type);
    mount($q('#rec-cat'), html`
      <option value="">Sem categoria</option>
      ${list.map((c) => html`<option value="${c.id}">${c.icon ?? ''} ${c.name}</option>`)}`);
    if (rule?.category_id) $q('#rec-cat').value = rule.category_id;
    paintSubs();
  }

  function setType(next) {
    type = next;
    [...$q('#rec-type').children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
    paintSource();
    paintCategories();
  }

  $q('#rec-type').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-type]');
    if (btn) { clearError(); setType(btn.dataset.type); }
  });
  $q('#rec-cat').addEventListener('change', paintSubs);

  setType(type);
  if (isEdit) {
    $q('#rec-desc').value = rule.description;
    $q('#rec-amount').value = String(rule.amount).replace('.', ',');
    $q('#rec-freq').value = rule.frequency;
    $q('#rec-start').value = rule.start_date;
    $q('#rec-end').value = rule.end_date ?? '';
    $q('#rec-status').value = rule.status === 'ended' ? 'active' : rule.status;
  } else {
    $q('#rec-freq').value = 'monthly'; // a maioria das recorrências (aluguel, assinaturas) é mensal
    $q('#rec-start').value = todayISO();
    $q('#rec-desc').focus();
  }

  $q('#rec-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const [kind, id] = $q('#rec-source').value.split(':');
    const amountText = $q('#rec-amount').value.trim();
    const result = validateRecurring({
      type,
      description: $q('#rec-desc').value,
      amount: amountText === '' ? NaN : parseMoney(amountText),
      account_id: kind === 'a' ? id : null,
      credit_card_id: kind === 'c' ? id : null,
      currentAccountId: rule?.account_id,
      currentCardId: rule?.credit_card_id,
      category_id: $q('#rec-cat').value,
      subcategory_id: $q('#rec-sub-wrap').hidden ? '' : $q('#rec-sub').value,
      frequency: $q('#rec-freq').value,
      start_date: $q('#rec-start').value,
      end_date: $q('#rec-end').value,
    }, { accounts, cards, categories, subcategories });

    if (!result.ok) { showError(Object.values(result.errors)[0]); return; }

    const button = $q('button[type="submit"]');
    button.classList.add('is-loading'); button.disabled = true;
    try {
      if (isEdit) {
        await updateRecurring(rule.id, { ...result.value, status: $q('#rec-status').value });
        toast.success('Recorrência atualizada');
      } else {
        await createRecurring(result.value);
        toast.success('Recorrência criada');
      }
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível salvar a recorrência.'));
      button.classList.remove('is-loading'); button.disabled = false;
    }
  });

  $q('#rec-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Excluir "${rule.description}"?`,
      message: 'As movimentações já geradas continuam na sua lista; só a regra de repetição é excluída.',
      confirmLabel: 'Excluir', danger: true,
    });
    if (!ok) return;
    try {
      await deleteRecurring(rule.id);
      toast.success('Recorrência excluída');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível excluir a recorrência.'));
    }
  });
}
