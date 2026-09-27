// Lançamentos recorrentes: a regra (recurring_transactions) e a geração de ocorrências.
// A GERAÇÃO roda no cliente: as datas vêm de core/recurring.js (mesma regra usada na
// previsão do dashboard) e cada ocorrência é um insert simples em transactions — não
// precisa de RPC porque é uma única tabela, sem escrita composta para tornar atômica.
import { supabase } from '../core/supabase.js';
import { cached, invalidate } from '../core/store.js';
import { todayISO } from '../core/format.js';
import { pendingDates } from '../core/recurring.js';
import { unwrap } from './db.js';

const COLUMNS = 'id, type, description, amount, account_id, credit_card_id, category_id, subcategory_id, ' +
  'frequency, start_date, end_date, status, generated_until';

export const getRecurring = () => cached('recurring', () =>
  unwrap(supabase.from('recurring_transactions').select(COLUMNS).order('description')));

export async function createRecurring(value) {
  await unwrap(supabase.from('recurring_transactions').insert(value));
  invalidate('recurring');
}

export async function updateRecurring(id, value) {
  await unwrap(supabase.from('recurring_transactions').update(value).eq('id', id));
  invalidate('recurring');
}

/** O banco preserva as movimentações já geradas (recurring_id vira null nelas). */
export async function deleteRecurring(id) {
  await unwrap(supabase.from('recurring_transactions').delete().eq('id', id));
  invalidate('recurring');
}

/**
 * Gera as ocorrências pendentes de todas as regras ativas, até hoje, e avança
 * `generated_until` de cada uma. Uma ocorrência por vez (não em lote): assim, se uma
 * já existir (corrida entre duas abas abertas — o índice único de recurring_id+data
 * barra a duplicata), só aquela data é ignorada e as seguintes continuam gerando.
 */
export async function generatePendingOccurrences() {
  const today = todayISO();
  const rules = await unwrap(supabase.from('recurring_transactions').select(COLUMNS).eq('status', 'active'));
  let changed = false;
  for (const rule of rules) {
    const dates = pendingDates(rule, today);
    if (!dates.length) continue;
    let last = rule.generated_until;
    for (const date of dates) {
      const { error } = await supabase.from('transactions').insert({
        type: rule.type,
        amount: rule.amount,
        date,
        description: rule.description,
        account_id: rule.account_id,
        credit_card_id: rule.credit_card_id,
        category_id: rule.category_id,
        subcategory_id: rule.subcategory_id,
        recurring_id: rule.id,
        source: 'recurring',
      });
      if (error && error.code !== '23505') throw error; // 23505: já existia (outra aba gerou antes)
      last = date;
    }
    const status = rule.end_date && last >= rule.end_date ? 'ended' : rule.status;
    await unwrap(supabase.from('recurring_transactions').update({ generated_until: last, status }).eq('id', rule.id));
    changed = true;
  }
  if (changed) invalidate('recurring');
}

/** Roda a geração no máximo uma vez por dia por usuário (chamada no boot do app). */
export async function ensureGeneratedToday(userId) {
  const flag = `cf-recur-generated:${userId}:${todayISO()}`;
  try { if (localStorage.getItem(flag)) return; } catch { /* sem storage: gera de novo */ }
  await generatePendingOccurrences();
  try { localStorage.setItem(flag, '1'); } catch { /* ignora */ }
}
