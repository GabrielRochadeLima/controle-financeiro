// Lançamento rápido: cria (ou edita) uma movimentação com o mínimo de toques.
// Fluxo ideal: valor -> categoria -> conta -> Salvar. Tudo o mais é opcional.
//
// Velocidade: o campo de valor já abre focado (teclado numérico), a última conta
// usada vem marcada, e as categorias mais usadas aparecem primeiro (core/memory.js).
import { html, mount } from '../core/dom.js';
import { formatDate, todayISO, toISODate } from '../core/format.js';
import { TYPES } from '../core/finance.js';
import { validateTransaction } from '../core/validation.js';
import { getMemory, remember } from '../core/memory.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { getAccounts, getCategories, getSubcategories } from '../services/reference.js';
import { createTransaction, deleteTransaction, updateTransaction } from '../services/transactions.js';
import { confirmDialog, openModal } from './modal.js';
import { attachMoneyInput } from './money-input.js';
import { emptyState } from './states.js';
import { toast } from './toast.js';

const TABS = [
  [TYPES.EXPENSE, 'Despesa'],
  [TYPES.INCOME, 'Receita'],
  [TYPES.TRANSFER, 'Transf.'],
  [TYPES.INVESTMENT, 'Invest.'],
];
const SAVED = {
  expense: 'Despesa adicionada', income: 'Receita adicionada',
  transfer: 'Transferência registrada', investment: 'Investimento registrado',
};
const SAVE_LABEL = {
  expense: 'Salvar despesa', income: 'Salvar receita',
  transfer: 'Salvar transferência', investment: 'Salvar investimento',
};
const EDIT_TITLE = {
  expense: 'Editar despesa', income: 'Editar receita',
  transfer: 'Editar transferência', investment: 'Editar investimento',
};
const DELETE_TITLE = {
  expense: 'Excluir esta despesa?', income: 'Excluir esta receita?',
  transfer: 'Excluir esta transferência?', investment: 'Excluir este investimento?',
};
// Ordem em que mostramos o erro (o primeiro campo problemático).
const ERROR_ORDER = ['type', 'amount', 'category_id', 'subcategory_id', 'account_id', 'to_account_id', 'date', 'description'];

const chip = (kind, value, label, { icon = '', selected = false, cls = '' } = {}) => html`
  <button type="button" class="chip ${cls}" data-chip="${kind}" data-value="${value}"
          aria-pressed="${String(selected)}">
    ${icon && html`<span aria-hidden="true">${icon}</span>`}<span>${label}</span>
  </button>`;

const shiftDay = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + days));
};

export async function openTransactionForm({ transaction = null } = {}) {
  let accounts; let categories; let subcategories;
  try {
    [accounts, categories, subcategories] = await Promise.all([
      getAccounts(), getCategories(), getSubcategories(),
    ]);
  } catch (err) {
    toast.error(friendlyError(err, 'Não foi possível abrir o formulário.'));
    return;
  }

  const isEdit = Boolean(transaction);
  const keep = [transaction?.account_id, transaction?.to_account_id].filter(Boolean);
  // Contas arquivadas só aparecem se a movimentação editada já usa uma delas.
  const usable = accounts.filter((a) => a.status === 'active' || keep.includes(a.id));

  if (!usable.length) {
    const { el, close } = openModal({
      title: 'Nova movimentação',
      body: emptyState({
        iconName: 'wallet', title: 'Crie uma conta primeiro',
        text: 'Toda movimentação acontece em uma conta (banco, carteira, dinheiro...).',
        actionLabel: 'Criar conta', actionHref: '#/contas',
      }),
    });
    el.querySelector('a')?.addEventListener('click', close);
    return;
  }

  const today = todayISO();
  const memory = getMemory();
  const pickAccount = (id, exceptId = null) => {
    const found = usable.find((a) => a.id === id && a.id !== exceptId && a.status === 'active');
    if (found) return found.id;
    const choices = usable.filter((a) => a.status === 'active' && a.id !== exceptId);
    return choices.length === 1 && !exceptId ? choices[0].id : null; // só uma conta: já marca
  };

  const state = isEdit
    ? {
      type: transaction.type, category_id: transaction.category_id,
      subcategory_id: transaction.subcategory_id, account_id: transaction.account_id,
      to_account_id: transaction.to_account_id, date: transaction.date,
    }
    : {
      type: TABS.some(([v]) => v === memory.type) ? memory.type : TYPES.EXPENSE,
      category_id: null, subcategory_id: null,
      account_id: pickAccount(memory.account_id), to_account_id: null, date: today,
    };
  if (!isEdit) state.to_account_id = pickAccount(memory.to_account_id, state.account_id);
  let whenMode = state.date === today ? 'today' : state.date === shiftDay(today, -1) ? 'yesterday' : 'other';

  const { el: root, close } = openModal({
    title: isEdit ? EDIT_TITLE[state.type] : 'Nova movimentação',
    body: html`
      <form class="qa" id="qa-form" novalidate>
        <div class="segmented" id="qa-type" role="group" aria-label="Tipo" ${isEdit ? 'hidden' : ''}></div>

        <div class="qa-amount">
          <span class="qa-currency">R$</span>
          <input id="qa-amount" inputmode="numeric" autocomplete="off" placeholder="0,00" aria-label="Valor">
        </div>

        <section class="qa-section" id="qa-cat-wrap">
          <h3 class="qa-label">Categoria</h3>
          <div class="chips" id="qa-cats"></div>
          <div class="chips" id="qa-subs"></div>
        </section>

        <section class="qa-section">
          <h3 class="qa-label" id="qa-acc-label">Conta</h3>
          <div class="chips" id="qa-accounts"></div>
        </section>

        <section class="qa-section" id="qa-to-wrap" hidden>
          <h3 class="qa-label">Para</h3>
          <div class="chips" id="qa-to"></div>
        </section>

        <section class="qa-section">
          <h3 class="qa-label">Quando</h3>
          <div class="chips" id="qa-when"></div>
          <input class="input" type="date" id="qa-date" aria-label="Data" hidden>
        </section>

        <details class="qa-more" ${transaction?.description || transaction?.notes ? 'open' : ''}>
          <summary>Mais detalhes</summary>
          <div class="form">
            <div class="field">
              <label for="qa-desc">Descrição</label>
              <input class="input" id="qa-desc" maxlength="120" placeholder="Ex.: Almoço com a equipe" autocomplete="off">
            </div>
            <div class="field">
              <label for="qa-notes">Observações</label>
              <textarea class="textarea" id="qa-notes" rows="2"></textarea>
            </div>
          </div>
        </details>

        <div class="form-error" id="qa-error" role="alert" hidden></div>

        <div class="qa-actions">
          ${isEdit && html`<button type="button" class="btn btn-ghost text-danger" id="qa-delete">Excluir</button>`}
          <button type="submit" class="btn btn-primary btn-save" id="qa-save"></button>
        </div>
      </form>`,
  });

  const $q = (sel) => root.querySelector(sel);
  const errorBox = $q('#qa-error');
  const clearError = () => { errorBox.hidden = true; };
  const showError = (message) => { errorBox.textContent = message; errorBox.hidden = false; };
  const money = attachMoneyInput($q('#qa-amount'), clearError);
  const usage = memory.usage; // congelado na abertura: a ordem dos chips não "pula" enquanto o usuário escolhe

  // ---------- renderização por seção (o campo de valor nunca é recriado: mantém foco) ----------
  function renderType() {
    mount($q('#qa-type'), html`${TABS.map(([value, label]) => html`
      <button type="button" data-chip="type" data-value="${value}"
              aria-pressed="${String(state.type === value)}">${label}</button>`)}`);
  }

  function renderCategories() {
    const list = [...categories.values()]
      .filter((c) => c.kind === state.type)
      .sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.sort_order - b.sort_order);
    mount($q('#qa-cats'), list.length
      ? html`${list.map((c) => chip('cat', c.id, c.name, { icon: c.icon, selected: c.id === state.category_id }))}`
      : html`<span class="text-secondary field-hint">Nenhuma categoria deste tipo. Crie em Mais → Categorias.</span>`);

    const subs = subcategories.filter((s) => s.category_id === state.category_id);
    mount($q('#qa-subs'), subs.length ? html`
      <span class="qa-label qa-sublabel">Subcategoria (opcional)</span>
      ${subs.map((s) => chip('sub', s.id, s.name, { selected: s.id === state.subcategory_id, cls: 'chip-sub' }))}` : html``);
  }

  function renderAccounts() {
    const asChips = (kind, selectedId, exceptId) => html`${usable
      .filter((a) => a.id !== exceptId)
      .map((a) => chip(kind, a.id, a.name, { selected: a.id === selectedId }))}`;
    mount($q('#qa-accounts'), asChips('acc', state.account_id, null));
    if (state.type === TYPES.TRANSFER) mount($q('#qa-to'), asChips('to', state.to_account_id, state.account_id));
  }

  function renderWhen() {
    const otherLabel = whenMode === 'other' ? formatDate(state.date) : 'Outra data';
    mount($q('#qa-when'), html`
      ${chip('when', 'today', 'Hoje', { selected: whenMode === 'today' })}
      ${chip('when', 'yesterday', 'Ontem', { selected: whenMode === 'yesterday' })}
      ${chip('when', 'other', otherLabel, { selected: whenMode === 'other' })}`);
    const dateInput = $q('#qa-date');
    dateInput.hidden = whenMode !== 'other';
    dateInput.value = state.date;
  }

  function applyType() {
    const isTransfer = state.type === TYPES.TRANSFER;
    const hasCategory = state.type === TYPES.EXPENSE || state.type === TYPES.INCOME;
    $q('.qa-amount').dataset.type = state.type;
    $q('#qa-cat-wrap').hidden = !hasCategory;
    $q('#qa-to-wrap').hidden = !isTransfer;
    $q('#qa-acc-label').textContent = isTransfer ? 'De' : state.type === TYPES.INCOME ? 'Entrou em' : 'Conta';
    $q('#qa-save').textContent = isEdit ? 'Salvar alterações' : SAVE_LABEL[state.type];
    if (isTransfer && !state.to_account_id) state.to_account_id = pickAccount(memory.to_account_id, state.account_id);
    renderType(); renderCategories(); renderAccounts();
  }

  // ---------- interação ----------
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chip]');
    if (!btn) return;
    const { chip: kind, value } = btn.dataset;
    clearError();

    if (kind === 'type') {
      if (value === state.type) return;
      state.type = value;
      state.category_id = null; state.subcategory_id = null; // categorias são por tipo
      applyType();
    } else if (kind === 'cat') {
      state.category_id = value; state.subcategory_id = null;
      renderCategories();
    } else if (kind === 'sub') {
      state.subcategory_id = state.subcategory_id === value ? null : value; // toque de novo desmarca
      renderCategories();
    } else if (kind === 'acc') {
      state.account_id = value;
      if (state.to_account_id === value) state.to_account_id = null; // origem e destino não podem coincidir
      renderAccounts();
    } else if (kind === 'to') {
      state.to_account_id = value;
      renderAccounts();
    } else if (kind === 'when') {
      whenMode = value;
      if (value === 'today') state.date = today;
      if (value === 'yesterday') state.date = shiftDay(today, -1);
      renderWhen();
      if (value === 'other') { const d = $q('#qa-date'); d.focus(); d.showPicker?.(); }
    }
  });

  $q('#qa-date').addEventListener('change', (e) => {
    if (e.target.value) { state.date = e.target.value; renderWhen(); }
  });

  const form = $q('#qa-form');
  const saveButton = $q('#qa-save');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = validateTransaction(
      { ...state, amount: money.getAmount(), description: $q('#qa-desc').value, notes: $q('#qa-notes').value },
      { accounts, categories, subcategories },
      { allowAccountIds: keep },
    );
    if (!result.ok) {
      const first = ERROR_ORDER.find((k) => result.errors[k]);
      showError(result.errors[first]);
      if (first === 'amount') $q('#qa-amount').focus();
      return;
    }

    saveButton.classList.add('is-loading');
    saveButton.disabled = true;
    try {
      if (isEdit) await updateTransaction(transaction.id, result.value);
      else await createTransaction(result.value);
      remember({
        type: result.value.type, account_id: result.value.account_id,
        to_account_id: result.value.to_account_id, category_id: result.value.category_id,
      });
      toast.success(isEdit ? 'Movimentação atualizada' : SAVED[result.value.type]);
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível salvar. Tente novamente.'));
      saveButton.classList.remove('is-loading');
      saveButton.disabled = false;
    }
  });

  $q('#qa-delete')?.addEventListener('click', async () => {
    if (!await confirmDialog({
      title: DELETE_TITLE[state.type], message: 'Essa ação não pode ser desfeita.',
      confirmLabel: 'Excluir', danger: true,
    })) return;
    try {
      await deleteTransaction(transaction.id);
      toast.success('Movimentação excluída');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível excluir. Tente novamente.'));
    }
  });

  // ---------- estado inicial ----------
  if (isEdit) {
    money.setAmount(transaction.amount);
    $q('#qa-desc').value = transaction.description ?? '';
    $q('#qa-notes').value = transaction.notes ?? '';
  }
  applyType();
  renderWhen();
  // Só abre o teclado ao criar: na edição ele cobriria os campos que o usuário quer ver.
  if (!isEdit) $q('#qa-amount').focus();
}
