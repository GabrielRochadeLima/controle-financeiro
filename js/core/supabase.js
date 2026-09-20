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

/**
 * Registro ainda referenciado por outro. O Postgres usa 23503 (foreign_key_violation) e,
 * para FKs com ON DELETE RESTRICT (o caso de contas, cartões e compras), 23001 (restrict_violation).
 */
export const isInUseError = (error) => error?.code === '23503' || error?.code === '23001';

// Erros próprios das funções de cartão do banco (supabase/migrations/003_cards_invoices.sql).
const CARD_ERRORS = {
  CF001: 'Esta compra está em uma fatura já paga. Desfaça o pagamento da fatura para alterá-la.',
  CF002: 'Não encontramos este item. Atualize a página e tente de novo.',
  CF003: 'Os valores das parcelas não conferem. Tente novamente.',
  CF004: 'Esta fatura já foi paga.',
  CF005: 'Esta fatura não tem valor a pagar.',
};

/** Converte erro técnico do Supabase em mensagem amigável (nunca expõe detalhes ao usuário). */
export function friendlyError(error, fallback = 'Algo deu errado. Tente novamente.') {
  if (!error) return fallback;
  const msg = String(error.message || '').toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return 'Sem conexão com o servidor. Verifique sua internet.';
  }
  if (CARD_ERRORS[error.code]) return CARD_ERRORS[error.code];
  if (error.code === '23505') return 'Já existe um registro com esse nome.';
  if (isInUseError(error)) return 'Este item está em uso e não pode ser removido.';
  if (error.code === '42501') return 'Você não tem permissão para essa ação.';
  console.error('[supabase]', error); // detalhe técnico só no console
  return fallback;
}
