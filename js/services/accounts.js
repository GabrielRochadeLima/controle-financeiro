// Contas: leitura com saldo calculado e operações de escrita.
import { supabase } from '../core/supabase.js';
import { todayISO } from '../core/format.js';
import { accountBalance } from '../core/finance.js';
import { invalidate } from '../core/store.js';
import { getAccounts } from './reference.js';
import { unwrap } from './db.js';

export async function loadAccountsWithBalance() {
  const [accounts, flows] = await Promise.all([
    getAccounts(),
    unwrap(supabase.rpc('account_flows', { p_until: todayISO() })),
  ]);
  const byAccount = Object.fromEntries(flows.map((f) => [f.account_id, f]));
  return accounts.map((a) => ({ ...a, balance: accountBalance(a, byAccount[a.id]) }));
}

export async function createAccount(value) {
  await unwrap(supabase.from('accounts').insert(value));
  invalidate('accounts');
}

export async function updateAccount(id, value) {
  await unwrap(supabase.from('accounts').update(value).eq('id', id));
  invalidate('accounts');
}

export const setAccountStatus = (id, status) => updateAccount(id, { status });

/** O banco recusa (FK restrict) se a conta tiver movimentações: a UI sugere arquivar. */
export async function deleteAccount(id) {
  await unwrap(supabase.from('accounts').delete().eq('id', id));
  invalidate('accounts');
}
