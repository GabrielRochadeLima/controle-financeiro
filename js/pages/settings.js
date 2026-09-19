// Configurações: perfil, tema e sessão.
import { html, mount, $, $$ } from '../core/dom.js';
import { signOut } from '../core/auth.js';
import { friendlyError } from '../core/supabase.js';
import { getThemePreference, setThemePreference } from '../core/theme.js';
import { invalidate } from '../core/store.js';
import { getProfile, updateDisplayName } from '../services/reference.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const THEMES = [
  ['light', 'Claro'],
  ['dark', 'Escuro'],
  ['system', 'Automático'],
];

export async function mountPage(outlet) {
  let profile;
  try {
    profile = await getProfile();
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
        <div class="section-head"><h2>Sessão</h2></div>
        <button class="btn btn-ghost btn-block" type="button" id="logout">
          ${icon('logout')}<span>Sair da conta</span>
        </button>
      </section>
    </div>`);

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
