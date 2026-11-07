// Investimentos (o ativo) e suas movimentações (aportes e resgates).
import { supabase } from '../core/supabase.js';
import { cached, invalidate } from '../core/store.js';
import { unwrap } from './db.js';

export const getInvestments = () => cached('investments', () =>
  unwrap(supabase.from('investments')
    .select('id, name, kind, institution, status, current_amount, notes')
    .order('name')));

export async function createInvestment(value) {
  await unwrap(supabase.from('investments').insert(value));
  invalidate('investments');
}

export async function updateInvestment(id, value) {
  await unwrap(supabase.from('investments').update(value).eq('id', id));
  invalidate('investments');
}

/** Os aportes continuam (investment_id vira null neles); só o cadastro do ativo é excluído. */
export async function deleteInvestment(id) {
  await unwrap(supabase.from('investments').delete().eq('id', id));
  invalidate('investments');
}

/** Todos os aportes e resgates até hoje (para somar o saldo investido líquido por ativo). */
export const loadAportes = () => unwrap(supabase.from('transactions')
  .select('id, type, amount, date, investment_id')
  .in('type', ['investment', 'investment_redemption'])
  .order('date', { ascending: false }));
