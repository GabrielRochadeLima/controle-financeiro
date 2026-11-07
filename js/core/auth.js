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
  ['invalid totp code', 'Código de 6 dígitos inválido ou expirado.'],
  ['verification failed', 'Código de 6 dígitos inválido ou expirado.'],
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

/**
 * Situação da autenticação em duas etapas (2FA / TOTP) da sessão atual.
 * @returns {Promise<{ enabled: boolean, needsMfa: boolean, factorId: string|null, factors: object[] }>}
 */
export async function getMfaStatus() {
  const [{ data: aal }, { data: factorsData }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const verified = (factorsData?.totp ?? []).filter((f) => f.status === 'verified');
  const needsMfa = aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2';
  return {
    enabled: verified.length > 0,
    needsMfa,
    factorId: verified[0]?.id ?? null,
    factors: verified,
  };
}

/**
 * Guarda de rota: sem sessão, ou se o usuário tem 2FA ativo mas ainda não
 * validou o código de 6 dígitos (aal1 -> aal2), manda para o login.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    location.replace('login.html');
    return null;
  }
  try {
    const mfa = await getMfaStatus();
    if (mfa.needsMfa) {
      location.replace('login.html?mfa=1');
      return null;
    }
  } catch (err) {
    console.error('[auth] falha ao checar 2FA', err);
  }
  return session;
}

export async function signIn(email, password) {
  const invalid = validateCredentials({ email, password }, { checkPassword: false });
  if (invalid) return { ok: false, message: invalid };
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, message: authMessage(error) };
  try {
    const mfa = await getMfaStatus();
    if (mfa.needsMfa && mfa.factorId) {
      return { ok: true, needsMfa: true, factorId: mfa.factorId };
    }
  } catch (err) {
    console.error('[auth] mfa check', err);
  }
  return { ok: true, needsMfa: false };
}

/** Inicia o cadastro de um autenticador TOTP (remove rascunhos não verificados antes). */
export async function enrollTotp(friendlyName = 'Financeiro') {
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.all ?? []) {
    if (f.status === 'unverified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (error) return { ok: false, message: authMessage(error) };
  return {
    ok: true,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

/** Confirma o código de 6 dígitos do aplicativo autenticador (no login ou ao ativar). */
export async function verifyTotp(factorId, code) {
  const cleanCode = String(code ?? '').replace(/\D+/g, '');
  if (cleanCode.length !== 6) {
    return { ok: false, message: 'Digite os 6 números do aplicativo autenticador.' };
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: cleanCode,
  });
  return error ? { ok: false, message: authMessage(error) } : { ok: true };
}

/** Desativa o 2FA removendo o fator TOTP. */
export async function unenrollTotp(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
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
