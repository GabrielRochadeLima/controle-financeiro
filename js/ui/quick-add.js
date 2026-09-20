// Lançamento rápido: cria (ou edita) uma movimentação com o mínimo de toques.
// Fluxo ideal: valor -> categoria -> conta/cartão -> Salvar. Tudo o mais é opcional.
//
// Velocidade: o campo de valor já abre focado (teclado numérico), a última conta ou
// cartão usado vem marcado, e as categorias mais usadas aparecem primeiro (core/memory.js).
//
// Cartão: escolher um cartão no lugar da conta registra uma compra na fatura (não mexe
// no saldo da conta). Aparece a escolha de parcelas e uma nota mostrando em qual fatura
// a compra cai. As regras de fatura/parcela vêm de core/cards.js.
import { html, mount } from '../core/dom.js';
import { formatDate, formatMoney, todayISO, toISODate } from '../core/format.js';
import { TYPES } from '../core/finance.js';
import { invoiceFor, planPurchase } from '../core/cards.js';
import { MAX_INSTALLMENTS, validateTransaction } from '../core/validation.js';
import { getMemory, remember } from '../core/memory.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { getAccounts, getCategories, getSubcategories } from '../services/reference.js';
import { createCardPurchase, getCards, updateCardPurchase } from '../services/cards.js';
import { createTransaction, deleteTransaction, updateTransaction } from '../services/transactions.js';
import { chip } from './chips.js';
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
const ERROR_ORDER = ['type', 'amount', 'category_id', 'subcategory_id', 'account_id', 'installments', 'to_account_id', 'date', 'description'];
const INSTALLMENT_CHOICES = [1, 2, 3, 4, 5, 6, 10, 12];

const shiftDay = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + days));
};

/**
 * @param {{ transaction?: object|null, presetCardId?: string|null }} options
 *   transaction: edita uma movimentação (conta ou compra à vista no cartão).
 *   presetCardId: abre já como compra nesse cartão (atalho da tela do cartão).
 */
export async function openTransactionForm({ transaction = null, presetCardId = null } = {}) {
  let accounts; let cards; let categories; let subcategories;
  try {
    [accounts, cards, categories, subcategories] = await Promise.all([
      getAccounts(), getCards(), getCategories(), getSubcategories(),
    ]);
  } catch (err) {
    toast.error(friendlyError(err, 'Não foi possível abrir o formulário.'));
    return;
  }

  const isEdit = Boolean(transaction);
  const isCardEdit = isEdit && Boolean(transaction.credit_card_id);
  const keep = [transaction?.account_id, transaction?.to_account_id].filter(Boolean);
  // Arquivados só aparecem se a movimentação editada já usa um deles.
  const usable = accounts.filter((a) => a.status === 'active' || keep.includes(a.id));
  const usableCards = cards.filter((c) => c.status === 'active' || c.id === transaction?.credit_card_id);

  if (!usable.length && !isCardEdit) {
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
  const pickCard = (id) => usableCards.find((c) => c.id === id && c.status === 'active')?.id ?? null;

  const state = isEdit
    ? {
      type: transaction.type, category_id: transaction.category_id,
      subcategory_id: transaction.subcategory_id, account_id: transaction.account_id,
      credit_card_id: transaction.credit_card_id, to_account_id: transaction.to_account_id,
      date: transaction.date, installments: 1,
    }
    : {
      type: TABS.some(([v]) => v === memory.type) ? memory.type : TYPES.EXPENSE,
      category_id: null, subcategory_id: null, account_id: null, credit_card_id: null,
      to_account_id: null, date: today, installments: 1,
    };

  /** Fonte padrão do tipo atual: despesa lembra conta OU cartão; os demais tipos, a conta. */
  function applyDefaultSource() {
    state.account_id = null;
    state.credit_card_id = null;
    const wantCard = state.type === TYPES.EXPENSE && (presetCardId || memory.credit_card_id);
    const card = wantCard ? pickCard(presetCardId || memory.credit_card_id) : null;
    if (card) state.credit_card_id = card;
    else state.account_id = pickAccount(memory.account_id);
  }
  if (!isEdit) {
    if (presetCardId && pickCard(presetCardId)) state.type = TYPES.EXPENSE;
    applyDefaultSource();
    state.to_account_id = pickAccount(memory.to_account_id, state.account_id);
  }
  let whenMode = state.date === today ? 'today' : state.date === shiftDay(today, -1) ? 'yesterday' : 'other';
  let customInstallments = false; // "Outro" número de parcelas

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

        <section class="qa-section" id="qa-inst-wrap" hidden>
          <h3 class="qa-label">Parcelas</h3>
          <div class="chips" id="qa-inst"></div>
          <input class="input" type="number" id="qa-inst-custom" inputmode="numeric" min="2" max="${MAX_INSTALLMENTS}"
                 placeholder="Nº de parcelas" aria-label="Número de parcelas" hidden>
          <p class="field-hint" id="qa-inst-note"></p>
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
  const money = attachMoneyInput($q('#qa-amount'), () => { clearError(); renderInstallmentNote(); });
  const usage = memory.usage; // congelado na abertura: a ordem dos chips não "pula" enquanto o usuário escolhe
  const selectedCard = () => cards.find((c) => c.id === state.credit_card_id) ?? null;

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

  /** Despesa oferece contas e cartões; ao editar, só a fonte original (trocar de fonte mudaria a fatura). */
  function renderSources() {
    const showCards = state.type === TYPES.EXPENSE && (isEdit ? isCardEdit : true);
    const showAccounts = !isCardEdit;
    const accountChips = showAccounts
      ? usable.map((a) => chip('acc', a.id, a.name, { selected: a.id === state.account_id })) : [];
    const cardChips = showCards
      ? usableCards
        .filter((c) => !isEdit || c.id === transaction.credit_card_id)
        .map((c) => chip('card', c.id, c.name, { icon: '💳', selected: c.id === state.credit_card_id }))
      : [];
    mount($q('#qa-accounts'), html`${accountChips}${cardChips}`);

    const toChips = (kind, selectedId, exceptId) => html`${usable
      .filter((a) => a.id !== exceptId)
      .map((a) => chip(kind, a.id, a.name, { selected: a.id === selectedId }))}`;
    if (state.type === TYPES.TRANSFER) mount($q('#qa-to'), toChips('to', state.to_account_id, state.account_id));
  }

  function renderInstallments() {
    const show = state.type === TYPES.EXPENSE && Boolean(state.credit_card_id) && !isEdit;
    $q('#qa-inst-wrap').hidden = !show;
    if (!show) return;
    const isPreset = INSTALLMENT_CHOICES.includes(state.installments) && !customInstallments;
    mount($q('#qa-inst'), html`
      ${INSTALLMENT_CHOICES.map((n) => chip('inst', n, n === 1 ? 'À vista' : `${n}x`,
        { selected: isPreset && state.installments === n }))}
      ${chip('inst', 'other', 'Outro', { selected: !isPreset })}`);
    const custom = $q('#qa-inst-custom');
    custom.hidden = isPreset;
    renderInstallmentNote();
  }

  /** Mostra em qual fatura a compra cai e o valor de cada parcela (regras de core/cards.js). */
  function renderInstallmentNote() {
    const note = $q('#qa-inst-note');
    const card = selectedCard();
    if (!card || $q('#qa-inst-wrap').hidden) { note.textContent = ''; return; }
    const count = state.installments;
    const total = money.getAmount();
    const invoice = invoiceFor(card, state.date);
    const where = `Entra na fatura que fecha em ${formatDate(invoice.closing_date)} (vence ${formatDate(invoice.due_date)}).`;
    if (!(total > 0) || !Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) { note.textContent = where; return; }
    const { parcels } = planPurchase(card, { date: state.date, total, count });
    if (count === 1) { note.textContent = where; return; }
    const first = parcels[0].amount;
    const last = parcels[parcels.length - 1].amount;
    const each = first === last ? `${count}x de ${formatMoney(last)}` : `${count}x de ${formatMoney(last)} (1ª de ${formatMoney(first)})`;
    note.textContent = `${each}. 1ª parcela na fatura que fecha em ${formatDate(parcels[0].invoice.closing_date)}.`;
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
    renderInstallmentNote();
  }

  function applyType() {
    const isTransfer = state.type === TYPES.TRANSFER;
    const hasCategory = state.type === TYPES.EXPENSE || state.type === TYPES.INCOME;
    $q('.qa-amount').dataset.type = state.type;
    $q('#qa-cat-wrap').hidden = !hasCategory;
    $q('#qa-to-wrap').hidden = !isTransfer;
    const hasCards = state.type === TYPES.EXPENSE && usableCards.length > 0;
    $q('#qa-acc-label').textContent = isTransfer ? 'De'
      : state.type === TYPES.INCOME ? 'Entrou em' : hasCards ? 'Conta ou cartão' : 'Conta';
    $q('#qa-save').textContent = isEdit ? 'Salvar alterações' : SAVE_LABEL[state.type];
    if (isTransfer && !state.to_account_id) state.to_account_id = pickAccount(memory.to_account_id, state.account_id);
    renderType(); renderCategories(); renderSources(); renderInstallments();
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
      applyDefaultSource(); // cartão só vale para despesa; os outros tipos voltam para a conta
      applyType();
    } else if (kind === 'cat') {
      state.category_id = value; state.subcategory_id = null;
      renderCategories();
    } else if (kind === 'sub') {
      state.subcategory_id = state.subcategory_id === value ? null : value; // toque de novo desmarca
      renderCategories();
    } else if (kind === 'acc') {
      state.account_id = value; state.credit_card_id = null;
      if (state.to_account_id === value) state.to_account_id = null; // origem e destino não podem coincidir
      renderSources(); renderInstallments();
    } else if (kind === 'card') {
      state.credit_card_id = value; state.account_id = null;
      renderSources(); renderInstallments();
    } else if (kind === 'inst') {
      if (value === 'other') {
        customInstallments = true;
        state.installments = Math.max(2, Number($q('#qa-inst-custom').value) || 2);
        $q('#qa-inst-custom').value = state.installments;
        renderInstallments();
        $q('#qa-inst-custom').focus();
      } else {
        customInstallments = false;
        state.installments = Number(value);
        renderInstallments();
      }
    } else if (kind === 'to') {
      state.to_account_id = value;
      renderSources();
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
  $q('#qa-inst-custom').addEventListener('input', (e) => {
    clearError();
    state.installments = Number(e.target.value);
    renderInstallmentNote();
  });

  const form = $q('#qa-form');
  const saveButton = $q('#qa-save');

  /** Grava conforme a origem: conta (insert/update direto) ou cartão (funções atômicas do banco). */
  async function persist(value, installments) {
    if (!value.credit_card_id) {
      if (isEdit) await updateTransaction(transaction.id, value);
      else await createTransaction(value);
      return isEdit ? 'Movimentação atualizada' : SAVED[value.type];
    }
    const card = cards.find((c) => c.id === value.credit_card_id);
    if (isEdit) {
      // Só recalcula a fatura se a data mudou (senão a compra continua onde está).
      const invoice = value.date !== transaction.date ? invoiceFor(card, value.date) : null;
      await updateCardPurchase(transaction.id, {
        amount: value.amount, date: value.date, description: value.description, notes: value.notes,
        category_id: value.category_id, subcategory_id: value.subcategory_id,
      }, invoice);
      return 'Compra atualizada';
    }
    const { parcels } = planPurchase(card, { date: value.date, total: value.amount, count: installments });
    await createCardPurchase({
      credit_card_id: card.id,
      // parcelada sem descrição: usa o nome da categoria para a compra ficar identificável
      description: value.description ?? (installments > 1 ? categories.get(value.category_id)?.name ?? null : null),
      notes: value.notes, category_id: value.category_id, subcategory_id: value.subcategory_id,
      total_amount: value.amount, installments_count: installments, parcels,
    });
    return installments > 1 ? `Compra em ${installments}x adicionada` : 'Despesa adicionada';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = validateTransaction(
      {
        ...state, amount: money.getAmount(),
        description: $q('#qa-desc').value, notes: $q('#qa-notes').value,
      },
      { accounts, cards, categories, subcategories },
      { allowAccountIds: keep, allowCardId: transaction?.credit_card_id },
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
      const message = await persist(result.value, result.installments);
      remember({
        type: result.value.type, account_id: result.value.account_id,
        credit_card_id: result.value.credit_card_id,
        to_account_id: result.value.to_account_id, category_id: result.value.category_id,
      });
      toast.success(message);
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
