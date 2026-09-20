// Contas: lista com saldo atual, criação, edição, arquivamento e exclusão.
import { html, mount, $, $$ } from '../core/dom.js';
import { formatMoney, parseMoney } from '../core/format.js';
import { ACCOUNT_TYPES, validateAccount } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError, isInUseError } from '../core/supabase.js';
import {
  createAccount, deleteAccount, loadAccountsWithBalance, setAccountStatus, updateAccount,
} from '../services/accounts.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const accountRow = (a) => html`
  <li>
    <button type="button" class="list-item" data-id="${a.id}" style="width:100%;border:0;background:none;text-align:left;color:inherit">
      <span class="avatar">${icon('wallet')}</span>
      <span class="list-item-main">
        <span class="list-item-title">${a.name}</span>
        <span class="list-item-sub">${[a.institution, ACCOUNT_TYPES[a.type]].filter(Boolean).join(' · ')}</span>
      </span>
      <span class="list-item-end money ${a.balance < 0 ? 'text-danger' : ''}">${formatMoney(a.balance)}</span>
    </button>
  </li>`;

function accountsView(accounts) {
  const active = accounts.filter((a) => a.status === 'active');
  const archived = accounts.filter((a) => a.status === 'archived');
  const total = active.reduce((sum, a) => sum + Math.round(a.balance * 100), 0) / 100;

  return html`
    <div class="page">
      <header class="page-header">
        <h1>Contas</h1>
        <button type="button" class="btn btn-primary btn-sm" id="new-account">${icon('plus')}<span>Nova conta</span></button>
      </header>

      ${active.length ? html`
        <div class="card total-line">
          <span class="text-secondary">Saldo total</span>
          <strong class="money">${formatMoney(total)}</strong>
        </div>
        <div class="card card-flat"><ul class="list">${active.map(accountRow)}</ul></div>`
        : html`<div class="card">${emptyState({
          iconName: 'wallet', title: 'Nenhuma conta ainda',
          text: 'Cadastre seus bancos, carteira e poupança para acompanhar o saldo de cada um.',
          actionLabel: 'Criar primeira conta', actionId: 'empty-new-account',
        })}</div>`}

      ${archived.length > 0 && html`
        <details class="section">
          <summary class="text-secondary">Arquivadas (${archived.length})</summary>
          <div class="card card-flat" style="margin-top:var(--space-3)"><ul class="list">${archived.map(accountRow)}</ul></div>
        </details>`}
    </div>`;
}

function openAccountForm(account, all) {
  const isEdit = Boolean(account);
  const { el, close } = openModal({
    title: isEdit ? 'Editar conta' : 'Nova conta',
    body: html`
      <form class="form" id="account-form" novalidate>
        <div class="field">
          <label for="acc-name">Nome</label>
          <input class="input" id="acc-name" maxlength="60" placeholder="Ex.: Nubank" autocomplete="off">
        </div>
        <div class="field">
          <label for="acc-inst">Instituição (opcional)</label>
          <input class="input" id="acc-inst" maxlength="60" placeholder="Ex.: Nu Pagamentos" autocomplete="off">
        </div>
        <div class="field">
          <label for="acc-type">Tipo</label>
          <select class="select" id="acc-type">
            ${Object.entries(ACCOUNT_TYPES).map(([value, label]) => html`<option value="${value}">${label}</option>`)}
          </select>
        </div>
        <div class="field">
          <label for="acc-balance">Saldo inicial</label>
          <input class="input" id="acc-balance" inputmode="decimal" placeholder="0,00" autocomplete="off">
          <span class="field-hint">Quanto havia na conta quando você começou a usar o sistema. Pode ser negativo.</span>
        </div>
        <div class="form-error" id="acc-error" role="alert" hidden></div>
        <div class="modal-actions">
          ${isEdit && html`<button type="button" class="btn btn-ghost" id="acc-archive">
            ${account.status === 'active' ? 'Arquivar' : 'Reativar'}</button>`}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
        ${isEdit && html`<button type="button" class="btn btn-link text-danger" id="acc-delete">Excluir conta</button>`}
      </form>`,
  });

  const error = $('#acc-error', el);
  const showError = (message) => { error.textContent = message; error.hidden = false; };
  if (isEdit) {
    $('#acc-name', el).value = account.name;
    $('#acc-inst', el).value = account.institution ?? '';
    $('#acc-type', el).value = account.type;
    $('#acc-balance', el).value = String(account.initial_balance).replace('.', ',');
  } else {
    $('#acc-name', el).focus();
  }

  $('#account-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const balanceText = $('#acc-balance', el).value.trim();
    const result = validateAccount({
      name: $('#acc-name', el).value,
      institution: $('#acc-inst', el).value,
      type: $('#acc-type', el).value,
      initial_balance: balanceText === '' ? 0 : parseMoney(balanceText),
    }, all, account?.id);
    if (!result.ok) { showError(Object.values(result.errors)[0]); return; }

    const button = $('button[type="submit"]', el);
    button.classList.add('is-loading'); button.disabled = true;
    try {
      if (isEdit) await updateAccount(account.id, result.value);
      else await createAccount(result.value);
      toast.success(isEdit ? 'Conta atualizada' : 'Conta criada');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível salvar a conta.'));
      button.classList.remove('is-loading'); button.disabled = false;
    }
  });

  $('#acc-archive', el)?.addEventListener('click', async () => {
    const archiving = account.status === 'active';
    try {
      await setAccountStatus(account.id, archiving ? 'archived' : 'active');
      toast.success(archiving ? 'Conta arquivada' : 'Conta reativada');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível alterar a conta.'));
    }
  });

  $('#acc-delete', el)?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: `Excluir "${account.name}"?`,
      message: 'Só é possível excluir contas sem movimentações. Se ela tiver histórico, arquive-a em vez de excluir.',
      confirmLabel: 'Excluir', danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteAccount(account.id);
      toast.success('Conta excluída');
      close();
      emitDataChanged();
    } catch (err) {
      // a conta já tem movimentações (FK com ON DELETE RESTRICT)
      showError(isInUseError(err)
        ? 'Esta conta tem movimentações. Arquive-a em vez de excluir.'
        : friendlyError(err, 'Não foi possível excluir a conta.'));
    }
  });
}

export async function mountPage(outlet) {
  mount(outlet, loadingState(2));
  try {
    const accounts = await loadAccountsWithBalance();
    mount(outlet, accountsView(accounts));

    const create = () => openAccountForm(null, accounts);
    $('#new-account', outlet).addEventListener('click', create);
    $('#empty-new-account', outlet)?.addEventListener('click', create);
    $$('[data-id]', outlet).forEach((btn) => btn.addEventListener('click', () => {
      openAccountForm(accounts.find((a) => a.id === btn.dataset.id), accounts);
    }));
  } catch (err) {
    console.error('[contas]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet));
  }
}

export { mountPage as mount };
