// Dados de referência (contas, categorias, perfil): mudam pouco e são usados em
// quase toda tela, então ficam em cache (core/store.js). Quem alterá-los deve
// chamar invalidate('accounts' | 'categories' | 'profile').
import { supabase } from '../core/supabase.js';
import { cached } from '../core/store.js';
import { unwrap } from './db.js';

export const getAccounts = () => cached('accounts', () =>
  unwrap(supabase.from('accounts')
    .select('id, name, institution, type, initial_balance, status')
    .order('name')));

/** Categorias como Map id -> categoria (lookup O(1) para listas). */
export const getCategories = () => cached('categories', async () => {
  const rows = await unwrap(supabase.from('categories')
    .select('id, name, kind, color, icon, sort_order')
    .order('sort_order'));
  return new Map(rows.map((c) => [c.id, c]));
});

export const getSubcategories = () => cached('subcategories', () =>
  unwrap(supabase.from('subcategories')
    .select('id, category_id, name, sort_order')
    .order('sort_order')));

export const getProfile = () => cached('profile', async () => {
  const { data: { user } } = await supabase.auth.getUser();
  const profile = await unwrap(supabase.from('profiles')
    .select('display_name').eq('id', user.id).maybeSingle());
  return { email: user.email, displayName: profile?.display_name || '' };
});

export async function updateDisplayName(name) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('profiles')
    .upsert({ id: user.id, display_name: name.trim() || null });
  if (error) throw error;
}

/**
 * Garante perfil e categorias padrão do usuário (RPC idempotente). O resultado
 * fica marcado no localStorage por usuário para não repetir a chamada a cada abertura.
 */
export async function ensureBootstrapped(userId) {
  const flag = `cf-bootstrapped:${userId}`;
  try { if (localStorage.getItem(flag)) return; } catch { /* sem storage: só chama de novo */ }
  const { error } = await supabase.rpc('bootstrap_user');
  if (error) throw error;
  try { localStorage.setItem(flag, '1'); } catch { /* ignora */ }
}
