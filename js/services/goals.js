// Metas e contribuições. O valor guardado de uma meta é a soma das contribuições
// (core/goals.js); aqui só lemos e gravamos as linhas.
import { supabase } from '../core/supabase.js';
import { cached, invalidate } from '../core/store.js';
import { unwrap } from './db.js';

const GOAL_COLUMNS = 'id, name, target_amount, target_date, status, completed_at, color, icon, notes';

export const getGoals = () => cached('goals', () =>
  unwrap(supabase.from('financial_goals').select(GOAL_COLUMNS).order('created_at')));

/** Todas as contribuições (poucas por usuário), mais recentes primeiro. */
export const getContributions = () => cached('contributions', () =>
  unwrap(supabase.from('goal_contributions')
    .select('id, goal_id, amount, date, note')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })));

const refresh = () => invalidate('goals', 'contributions');

export async function createGoal(value) {
  await unwrap(supabase.from('financial_goals').insert(value));
  refresh();
}

export async function updateGoal(id, value) {
  await unwrap(supabase.from('financial_goals').update(value).eq('id', id));
  refresh();
}

export const completeGoal = (id) => updateGoal(id, { status: 'completed', completed_at: new Date().toISOString() });
export const reopenGoal = (id) => updateGoal(id, { status: 'active', completed_at: null });

/** As contribuições somem junto (ON DELETE CASCADE). */
export async function deleteGoal(id) {
  await unwrap(supabase.from('financial_goals').delete().eq('id', id));
  refresh();
}

export async function addContribution(goalId, value) {
  await unwrap(supabase.from('goal_contributions').insert({ goal_id: goalId, ...value }));
  refresh();
}

export async function deleteContribution(id) {
  await unwrap(supabase.from('goal_contributions').delete().eq('id', id));
  refresh();
}
