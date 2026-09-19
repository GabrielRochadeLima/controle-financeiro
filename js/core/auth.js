// Autenticação (Supabase Auth). Toda função devolve { ok, ... } com mensagem
// amigável, para a UI não precisar interpretar erros técnicos.
//
// 2FA no futuro: supabase.auth.mfa.* usa a mesma sessão; bastará adicionar um
// passo após signIn (checar assurance level) sem mudar o restante do app.
import { supabase } from './supabase.js';

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AUTH_MESSAGES = [
  ['invalid login credentials', 'E-mail ou senha incorretos.'],
  ['email not confirmed', 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.'],
  ['user already registered', 'Já existe uma conta com este e-mail.'],
  ['password should be at least', `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`],
  ['same password', 'A nova senha precisa ser diferente da atual.'],
  ['rate limit', 'Muitas tentativas. Aguarde um pouco e tente de novo.'],
  ['failed to fetch', 'Sem conexão com o servidor. Verifique sua internet.'],
];

function authMessage(error) {
  const msg = String(error?.message || '').toLowerCase();
  const hit = AUTH_MESSAGES.find(([needle]) => msg.includes(needle));
  if (!hit) console.error('[auth]', error);
  return hit ? hit[1] : 'Não foi possível concluir. Tente novamente.';
}

export function validateCredentials({ email, password }, { checkPassword = true } = {}) {
  if (!EMAIL_RE.test(String(email || '').trim())) return 'Informe um e-mail válido.';
  if (checkPassword && String(password || '').length < MIN_PASSWORD) {
    return `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`;
  }
  return null;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Guarda de rota: sem sessão, manda para o login. Retorna a sessão ou null. */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    location.replace('login.html');
    return null;
  }
  return session;
}

export async function signIn(email, password) {
  const invalid = validateCredentials({ email, password }, { checkPassword: false });
  if (invalid) return { ok: false, message: invalid };
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return error ? { ok: false, message: authMessage(error) } : { ok: true };
}

export async function signUp({ name, email, password }) {
  const invalid = validateCredentials({ email, password });
  if (invalid) return { ok: false, message: invalid };
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    // display_name é lido pelo trigger handle_new_user para criar o profile.
    options: { data: { display_name: (name || '').trim() } },
  });
  if (error) return { ok: false, message: authMessage(error) };
  // Com confirmação de e-mail ativa, não há sessão até o usuário confirmar.
  return { ok: true, needsConfirmation: !data.session };
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace('login.html');
}

export async function requestPasswordReset(email) {
  const invalid = validateCredentials({ email }, { checkPassword: false });
  if (invalid) return { ok: false, message: invalid };
  const redirectTo = new URL('login.html', location.href).href;
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  return error ? { ok: false, message: authMessage(error) } : { ok: true };
}

export async function updatePassword(password) {
  if (String(password || '').length < MIN_PASSWORD) {
    return { ok: false, message: `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.` };
  }
  const { error } = await supabase.auth.updateUser({ password });
  return error ? { ok: false, message: authMessage(error) } : { ok: true };
}

/** Reage a logout em outra aba ou sessão expirada. */
export function onSignedOut(callback) {
  return supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback();
  });
}
