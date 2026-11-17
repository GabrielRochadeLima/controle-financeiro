// Modal de ajuste rápido do saldo atual de uma conta bancária.
// Você informa o saldo real que está hoje no banco e o app recalcula a base (initial_balance)
// sem criar receita ou despesa artificial nos gráficos do mês.
import { html, mount, $ } from '../core/dom.js';
import { formatMoney, parseMoney } from '../core/format.js';
import { adjustedInitialBalance } from '../core/finance.js';
import { MAX_AMOUNT } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { loadAccountsWithBalance, updateAccount } from '../services/accounts.js';
import { chip } from './chips.js';
import { openModal } from './modal.js';
import { emptyState } from './states.js';
import { toast } from './toast.js';

export function formatDiff(diff) {
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.005) return 'Sem diferença';
  const sign = diff > 0 ? '+ ' : '− ';
  return `${sign}${formatMoney(Math.abs(diff))}`;
}

export async function openBalanceAdjustModal({ presetAccountId = null, preloadedAccounts = null } = {}) {
  let accounts;
  try {
    accounts = preloadedAccounts ?? await loadAccountsWithBalance();
  } catch (err) {
    toast.error(friendlyError(err, 'Não foi possível carregar as contas.'));
    return;
  }
  const active = accounts.filter((a) => a.status === 'active');

  if (!active.length) {
    openModal({
      title: 'Ajustar saldo',
      body: emptyState({
        iconName: 'wallet',
        title: 'Nenhuma conta ativa',
        text: 'Crie uma conta primeiro para poder ajustar o saldo.',
        actionLabel: 'Ir para Contas',
        actionHref: '#/contas',
      }),
    });
    return;
  }

  let selectedId = active.find((a) => a.id === presetAccountId)?.id ?? active[0].id;
  const currentAccount = () => active.find((a) => a.id === selectedId) ?? active[0];

  const { el, close } = openModal({
    title: 'Ajustar saldo da conta',
    body: html`
      <form class="form" id="adj-form" novalidate>
        ${active.length > 1 && html`
          <div class="qa-section">
            <h3 class="qa-label">Conta</h3>
            <div class="chips" id="adj-accounts"></div>
          </div>`}

        <div class="card card-flat" style="padding:var(--space-3);background:var(--surface-2)">
          <div class="tile-row">
            <span class="text-secondary">Saldo no app hoje</span>
            <strong class="money" id="adj-current"></strong>
          </div>
          <div class="tile-row" style="margin-top:var(--space-2)">
            <span class="text-secondary">Diferença do ajuste</span>
            <strong class="money" id="adj-diff">Sem diferença</strong>
          </div>
        </div>

        <div class="field">
          <label for="adj-target">Saldo real no banco agora (R$)</label>
          <input class="input" id="adj-target" inputmode="decimal" placeholder="0,00" autocomplete="off">
          <span class="field-hint">Digite o valor exato que aparece hoje no seu aplicativo do banco (use "-" se estiver negativo).</span>
        </div>

        <div class="form-error" id="adj-error" role="alert" hidden></div>

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn-primary" id="adj-save">Salvar novo saldo</button>
        </div>
      </form>`,
  });

  const input = $('#adj-target', el);
  const currentEl = $('#adj-current', el);
  const diffEl = $('#adj-diff', el);
  const errorEl = $('#adj-error', el);
  const showError = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };

  function paintAccounts() {
    const box = $('#adj-accounts', el);
    if (!box) return;
    mount(box, html`${active.map((a) => chip('acc', a.id, a.name, { selected: a.id === selectedId }))}`);
  }

  function updatePreview() {
    errorEl.hidden = true;
    const acc = currentAccount();
    currentEl.textContent = formatMoney(acc.balance);
    const raw = input.value.trim();
    const target = raw === '' ? NaN : parseMoney(raw);
    if (!Number.isFinite(target)) {
      diffEl.textContent = '—';
      diffEl.className = 'money text-secondary';
      return;
    }
    const { diff } = adjustedInitialBalance(acc, acc.balance, target);
    diffEl.textContent = formatDiff(diff);
    diffEl.className = `money ${diff > 0.004 ? 'text-success' : diff < -0.004 ? 'text-danger' : 'text-secondary'}`;
  }

  function selectAccount(id) {
    selectedId = id;
    const acc = currentAccount();
    input.value = acc.balance.toFixed(2).replace('.', ',');
    paintAccounts();
    updatePreview();
    input.focus();
    input.select?.();
  }

  $('#adj-accounts', el)?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chip="acc"]');
    if (btn) selectAccount(btn.dataset.value);
  });

  input.addEventListener('input', updatePreview);

  $('#adj-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const acc = currentAccount();
    const raw = input.value.trim();
    const target = raw === '' ? NaN : parseMoney(raw);
    if (!Number.isFinite(target) || Math.abs(target) > MAX_AMOUNT) {
      showError('Informe um saldo válido.');
      input.focus();
      return;
    }

    const { initial_balance } = adjustedInitialBalance(acc, acc.balance, target);
    const btn = $('#adj-save', el);
    btn.classList.add('is-loading');
    btn.disabled = true;
    try {
      await updateAccount(acc.id, { initial_balance });
      toast.success(`Saldo de ${acc.name} ajustado para ${formatMoney(target)}`);
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível ajustar o saldo.'));
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  });

  selectAccount(selectedId);
}
