// Movimentações: listagem paginada com filtros e operações de escrita.
import { supabase } from '../core/supabase.js';
import { unwrap } from './db.js';

export const PAGE_SIZE = 30;

const COLUMNS = 'id, type, amount, date, description, notes, account_id, to_account_id, ' +
  'credit_card_id, category_id, subcategory_id';

/**
 * @param {{ from: string, to: string, type?: string, search?: string, page?: number }} f
 *   `from` inclusivo e `to` exclusivo (ISO). Busca por descrição.
 * @returns {{ rows: object[], hasMore: boolean }}
 */
export async function listTransactions({ from, to, type, search, page = 0 }) {
  let query = supabase.from('transactions').select(COLUMNS)
    .gte('date', from).lt('date', to)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    // pede uma linha a mais só para saber se existe próxima página
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (type) query = query.eq('type', type);
  // remove curingas do LIKE para o texto digitado ser tratado literalmente
  const term = (search || '').trim().replace(/[%_\,()]/g, ' ').trim();
  if (term) query = query.ilike('description', `%${term}%`);

  const rows = await unwrap(query);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function createTransaction(value) {
  await unwrap(supabase.from('transactions').insert(value));
}

export async function updateTransaction(id, value) {
  await unwrap(supabase.from('transactions').update(value).eq('id', id));
}

export async function deleteTransaction(id) {
  await unwrap(supabase.from('transactions').delete().eq('id', id));
}
