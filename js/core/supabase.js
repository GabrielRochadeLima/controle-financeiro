// Cliente Supabase único da aplicação. A biblioteca (v2.116.0, MIT) é servida pelo
// próprio site em js/vendor/ (sem CDN de terceiros). Para atualizar: ver README.
import { createClient } from '../vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SCHEMA } from '../config.js';

export const isConfigured =
  /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(SUPABASE_URL) &&
  !SUPABASE_ANON_KEY.startsWith('SUA-');

// persistSession + autoRefreshToken (padrão) mantêm a sessão entre visitas.
export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      // Todas as consultas (from/rpc) vão para o schema do sistema, não para public.
      db: { schema: SUPABASE_SCHEMA },
    })
  : null;

/** Converte erro técnico do Supabase em mensagem amigável (nunca expõe detalhes ao usuário). */
export function friendlyError(error, fallback = 'Algo deu errado. Tente novamente.') {
  if (!error) return fallback;
  const msg = String(error.message || '').toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return 'Sem conexão com o servidor. Verifique sua internet.';
  }
  if (error.code === '23505') return 'Já existe um registro com esse nome.';
  if (error.code === '23503') return 'Este item está em uso e não pode ser removido.';
  if (error.code === '42501') return 'Você não tem permissão para essa ação.';
  console.error('[supabase]', error); // detalhe técnico só no console
  return fallback;
}
