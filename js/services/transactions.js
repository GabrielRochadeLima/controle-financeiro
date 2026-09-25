// Movimentações: listagem paginada com filtros, totais do filtro e operações de escrita.
import { supabase } from '../core/supabase.js';
import { periodSummary } from '../core/finance.js';
import { NO_CATEGORY, isUuid } from '../core/filters.js';
import { unwrap } from './db.js';

export const PAGE_SIZE = 30;
const SUM_PAGE = 1000;   // tamanho de página do Supabase por consulta
const SUM_MAX_PAGES = 10; // teto de segurança do total (10 mil linhas)

const COLUMNS = 'id, type, amount, date, description, notes, account_id, to_account_id, ' +
  'credit_card_id, invoice_id, category_id, subcategory_id, installment_plan_id, installment_number, ' +
  'plan:installment_plans(installments_count)';

/**
 * @typedef {object} Criteria
 * @property {string} from  data inicial (inclusiva, ISO)
 * @property {string} to    data final (EXCLUSIVA, ISO)
 * @property {string} [type]
 * @property {string} [search]       busca na descrição
 * @property {string|null} [accountId]  conta de origem OU destino (transferências entram dos dois lados)
 * @property {string|null} [cardId]     cartão (compras e pagamentos de fatura dele)
 * @property {string} [categoryId]   id, ou NO_CATEGORY para "sem categoria"
 * @property {string} [subcategoryId]
 * @property {number|null} [min]
 * @property {number|null} [max]
 */

/**
 * Aplica os critérios a uma consulta. É o ÚNICO lugar que traduz filtros em Supabase, usado
 * pela lista e pelo total: os dois sempre concordam. Ids são validados (uuid) antes de
 * entrar em filtros textuais como o `or`.
 */
export function applyCriteria(query, c) {
  let q = query.gte('date', c.from).lt('date', c.to);
  if (c.type) q = q.eq('type', c.type);
  if (isUuid(c.accountId)) q = q.or(`account_id.eq.${c.accountId},to_account_id.eq.${c.accountId}`);
  if (isUuid(c.cardId)) q = q.eq('credit_card_id', c.cardId);
  if (c.categoryId === NO_CATEGORY) {
    // transferências e investimentos nunca têm categoria: só receita/despesa faz sentido aqui
    q = q.is('category_id', null).in('type', ['expense', 'income']);
  } else if (isUuid(c.categoryId)) {
    q = q.eq('category_id', c.categoryId);
    if (isUuid(c.subcategoryId)) q = q.eq('subcategory_id', c.subcategoryId);
  }
  if (c.min != null) q = q.gte('amount', c.min);
  if (c.max != null) q = q.lte('amount', c.max);
  // remove curingas do LIKE para o texto digitado ser tratado literalmente
  const term = (c.search || '').trim().replace(/[%_\\,()]/g, ' ').trim();
  if (term) q = q.ilike('description', `%${term}%`);
  return q;
}

/** @param {Criteria & { page?: number }} c  @returns {{ rows: object[], hasMore: boolean }} */
export async function listTransactions({ page = 0, ...criteria }) {
  const query = applyCriteria(supabase.from('transactions').select(COLUMNS), criteria)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    // pede uma linha a mais só para saber se existe próxima página
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const rows = await unwrap(query);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

/**
 * Totais de TUDO que casa com os critérios (não só da página carregada), com as mesmas regras
 * do resto do app (periodSummary: transferência e pagamento de fatura não são receita/despesa).
 * Baixa só tipo e valor, página a página. `truncated` = passou do teto e o total é parcial.
 */
export async function sumTransactions(criteria) {
  const rows = [];
  for (let p = 0; p < SUM_MAX_PAGES; p += 1) {
    const chunk = await unwrap(applyCriteria(supabase.from('transactions').select('type, amount'), criteria)
      .order('date').order('id')
      .range(p * SUM_PAGE, p * SUM_PAGE + SUM_PAGE - 1));
    rows.push(...chunk);
    if (chunk.length < SUM_PAGE) return { ...periodSummary(rows), count: rows.length, truncated: false };
  }
  return { ...periodSummary(rows), count: rows.length, truncated: true };
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
