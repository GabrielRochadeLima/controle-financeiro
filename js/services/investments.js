// Investimentos (o ativo) e seus aportes (movimentações type='investment').
import { supabase } from '../core/supabase.js';
import { cached, invalidate } from '../core/store.js';
import { unwrap } from './db.js';

export const getInvestments = () => cached('investments', () =>
  unwrap(supabase.from('investments')
    .select('id, name, kind, institution, status, notes')
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

/** Todos os aportes até hoje (só o necessário para somar por investimento). */
export const loadAportes = () => unwrap(supabase.from('transactions')
  .select('id, amount, date, investment_id')
  .eq('type', 'investment')
  .order('date', { ascending: false }));
