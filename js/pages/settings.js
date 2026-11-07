// Configurações: perfil, aparência, segurança (2FA / TOTP) e sessão.
import { html, mount, $, $$ } from '../core/dom.js';
import { enrollTotp, getMfaStatus, signOut, unenrollTotp, verifyTotp } from '../core/auth.js';
import { friendlyError } from '../core/supabase.js';
import { getThemePreference, setThemePreference } from '../core/theme.js';
import { invalidate } from '../core/store.js';
import { getProfile, updateDisplayName } from '../services/reference.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const THEMES = [
  ['light', 'Claro'],
  ['dark', 'Escuro'],
  ['system', 'Automático'],
];

export async function mountPage(outlet) {
  let profile;
  let mfa = { enabled: false, factorId: null };
  try {
    [profile, mfa] = await Promise.all([
      getProfile(),
      getMfaStatus().catch(() => ({ enabled: false, factorId: null })),
    ]);
  } catch (err) {
    toast.error(friendlyError(err, 'Não foi possível carregar seu perfil.'));
    profile = { email: '', displayName: '' };
  }
  const pref = getThemePreference();

  mount(outlet, html`
    <div class="page">
      <header class="page-header"><h1>Configurações</h1></header>

      <section class="section">
        <div class="section-head"><h2>Perfil</h2></div>
        <form class="card form" id="profile-form" novalidate>
          <div class="field">
            <label for="display-name">Como devemos te chamar?</label>
            <input class="input" id="display-name" maxlength="60" autocomplete="given-name"
                   value="${profile.displayName}" placeholder="Seu nome">
          </div>
          <div class="field">
            <label for="email">E-mail</label>
            <input class="input" id="email" value="${profile.email}" disabled>
          </div>
          <button class="btn btn-primary" type="submit">Salvar</button>
        </form>
      </section>

      <section class="section">
        <div class="section-head"><h2>Aparência</h2></div>
        <div class="card settings-group">
          <div class="segmented" role="group" aria-label="Tema">
            ${THEMES.map(([value, label]) => html`
              <button type="button" data-theme-pref="${value}" aria-pressed="${String(value === pref)}">${label}</button>`)}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Segurança</h2></div>
        <div class="card" id="mfa-box"></div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Sessão</h2></div>
        <button class="btn btn-ghost btn-block" type="button" id="logout">
          ${icon('logout')}<span>Sair da conta</span>
        </button>
      </section>
    </div>`);

  function renderMfa() {
    const box = $('#mfa-box', outlet);
    mount(box, html`
      <div class="tile-row" style="margin-bottom:var(--space-2)">
        <strong>Autenticação em duas etapas (2FA)</strong>
        <span class="badge ${mfa.enabled ? 'badge-success' : 'badge-neutral'}">
          ${mfa.enabled ? 'Ativada' : 'Desativada'}
        </span>
      </div>
      <p class="text-secondary" style="margin-bottom:var(--space-3)">
        ${mfa.enabled
          ? 'Sua conta pede o código de 6 dígitos do aplicativo autenticador ao entrar.'
          : 'Proteja sua conta exigindo um código de 6 dígitos (Google Authenticator, Authy, 1Password) além da senha.'}
      </p>
      ${mfa.enabled
        ? html`<button type="button" class="btn btn-ghost text-danger" id="mfa-disable">Desativar 2FA</button>`
        : html`<button type="button" class="btn btn-primary" id="mfa-enable">Ativar 2FA</button>`}
    `);

    $('#mfa-enable', box)?.addEventListener('click', openEnrollModal);
    $('#mfa-disable', box)?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Desativar verificação em duas etapas?',
        message: 'Sua conta voltará a pedir apenas e-mail e senha para entrar.',
        confirmLabel: 'Desativar',
        danger: true,
      });
      if (!ok) return;
      const res = await unenrollTotp(mfa.factorId);
      if (!res.ok) { toast.error(res.message); return; }
      mfa = { enabled: false, factorId: null };
      renderMfa();
      toast.success('2FA desativado');
    });
  }

  async function openEnrollModal() {
    const enrolled = await enrollTotp('Financeiro');
    if (!enrolled.ok) {
      toast.error(enrolled.message);
      return;
    }
    const { el, close } = openModal({
      title: 'Ativar verificação em duas etapas',
      body: html`
        <form class="form" id="mfa-enroll-form" novalidate>
          <p class="text-secondary">
            1. Escaneie o QR Code abaixo no seu aplicativo autenticador (ou copie a chave manual).
          </p>
          <div style="display:flex;justify-content:center;padding:var(--space-3);background:#fff;border-radius:var(--radius-md)">
            <img src="${enrolled.qrCode}" alt="QR Code para aplicativo autenticador" width="180" height="180">
          </div>
          <div class="field">
            <label for="mfa-secret">Chave manual</label>
            <input class="input" id="mfa-secret" value="${enrolled.secret}" readonly>
          </div>
          <div class="field">
            <label for="mfa-verify-code">2. Digite o código de 6 dígitos gerado</label>
            <input class="input" id="mfa-verify-code" inputmode="numeric" autocomplete="one-time-code"
                   maxlength="6" placeholder="000000" required>
          </div>
          <div class="form-error" id="mfa-enroll-error" role="alert" hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button type="submit" class="btn btn-primary">Confirmar e ativar</button>
          </div>
        </form>`,
    });

    const codeInput = $('#mfa-verify-code', el);
    codeInput.focus();
    $('#mfa-enroll-form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('#mfa-enroll-error', el);
      errEl.hidden = true;
      const btn = $('button[type="submit"]', el);
      btn.classList.add('is-loading'); btn.disabled = true;
      const res = await verifyTotp(enrolled.factorId, codeInput.value);
      btn.classList.remove('is-loading'); btn.disabled = false;
      if (!res.ok) {
        errEl.textContent = res.message;
        errEl.hidden = false;
        return;
      }
      mfa = { enabled: true, factorId: enrolled.factorId };
      renderMfa();
      close();
      toast.success('Autenticação em duas etapas ativada!');
    });
  }

  renderMfa();

  $('#profile-form', outlet).addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('button[type="submit"]', e.currentTarget);
    button.classList.add('is-loading');
    try {
      await updateDisplayName($('#display-name', outlet).value);
      invalidate('profile');
      toast.success('Perfil atualizado');
    } catch (err) {
      toast.error(friendlyError(err, 'Não foi possível salvar o perfil.'));
    } finally {
      button.classList.remove('is-loading');
    }
  });

  $$('[data-theme-pref]', outlet).forEach((btn) => {
    btn.addEventListener('click', () => {
      setThemePreference(btn.dataset.themePref);
      $$('[data-theme-pref]', outlet).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });

  $('#logout', outlet).addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Sair da conta?',
      message: 'Você precisará entrar novamente para acessar seus dados.',
      confirmLabel: 'Sair',
      danger: true,
    });
    if (confirmed) await signOut();
  });
}

export { mountPage as mount };
