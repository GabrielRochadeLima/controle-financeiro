// Tela de acesso: entrar, criar conta, recuperar e redefinir senha.
import './core/theme.js';
import { isConfigured, supabase } from './core/supabase.js';
import { getSession, requestPasswordReset, signIn, signUp, updatePassword } from './core/auth.js';
import { $ } from './core/dom.js';

const views = ['main', 'forgot', 'reset'];
const forms = { login: $('#form-login'), signup: $('#form-signup') };
let inRecovery = location.hash.includes('type=recovery');

function showView(name) {
  views.forEach((v) => { $(`#view-${v}`).hidden = v !== name; });
  $('#auth-subtitle').textContent = {
    main: 'Entre para controlar seu dinheiro.',
    forgot: 'Sem problema, acontece.',
    reset: 'Escolha uma senha nova.',
  }[name];
}

function showTab(tab) {
  const isLogin = tab === 'login';
  forms.login.hidden = !isLogin;
  forms.signup.hidden = isLogin;
  $('#tab-login').setAttribute('aria-selected', String(isLogin));
  $('#tab-signup').setAttribute('aria-selected', String(!isLogin));
  clearMessages();
}

function clearMessages() {
  const notice = $('#notice');
  notice.hidden = true;
  document.querySelectorAll('[data-error]').forEach((el) => { el.hidden = true; });
}

function showError(form, message) {
  const el = form.querySelector('[data-error]');
  el.textContent = message;
  el.hidden = false;
}

function showNotice(message, kind = 'success') {
  const notice = $('#notice');
  notice.className = kind === 'success' ? 'form-success' : 'form-error';
  notice.textContent = message;
  notice.hidden = false;
}

/** Envolve o submit: bloqueia duplo clique, mostra loading e limpa erros antigos. */
function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    const button = form.querySelector('button[type="submit"]');
    button.classList.add('is-loading');
    button.disabled = true;
    try {
      await handler();
    } finally {
      button.classList.remove('is-loading');
      button.disabled = false;
    }
  });
}

const goToApp = () => location.replace('index.html');

async function init() {
  if (!isConfigured) {
    showNotice('Configure js/config.js com a URL e a chave pública do seu projeto Supabase (veja o README).', 'error');
    document.querySelectorAll('.auth-card form').forEach((f) => { f.hidden = true; });
    $('.segmented').hidden = true;
    return;
  }

  // Link de recuperação: o Supabase cria uma sessão temporária e dispara este evento.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') { inRecovery = true; showView('reset'); }
  });

  if (inRecovery) showView('reset');
  else if (await getSession()) { goToApp(); return; }

  $('#tab-login').addEventListener('click', () => showTab('login'));
  $('#tab-signup').addEventListener('click', () => showTab('signup'));
  $('#go-forgot').addEventListener('click', () => {
    $('#forgot-email').value = $('#login-email').value;
    clearMessages();
    showView('forgot');
  });
  $('#back-login').addEventListener('click', () => { clearMessages(); showView('main'); });

  onSubmit(forms.login, async () => {
    const result = await signIn($('#login-email').value, $('#login-password').value);
    if (result.ok) goToApp();
    else showError(forms.login, result.message);
  });

  onSubmit(forms.signup, async () => {
    const result = await signUp({
      name: $('#signup-name').value,
      email: $('#signup-email').value,
      password: $('#signup-password').value,
    });
    if (!result.ok) return showError(forms.signup, result.message);
    if (result.needsConfirmation) {
      showTab('login');
      $('#login-email').value = $('#signup-email').value;
      showNotice('Conta criada! Enviamos um link de confirmação para o seu e-mail.');
    } else {
      goToApp();
    }
  });

  onSubmit($('#form-forgot'), async () => {
    const result = await requestPasswordReset($('#forgot-email').value);
    if (!result.ok) return showError($('#form-forgot'), result.message);
    showView('main');
    showNotice('Se este e-mail tiver cadastro, você receberá um link para redefinir a senha.');
  });

  onSubmit($('#form-reset'), async () => {
    const result = await updatePassword($('#reset-password').value);
    if (!result.ok) return showError($('#form-reset'), result.message);
    goToApp();
  });
}

init();
