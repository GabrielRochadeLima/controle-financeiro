// Categorias e subcategorias: árvore para a tela de gestão e operações de escrita.
import { supabase } from '../core/supabase.js';
import { invalidate } from '../core/store.js';
import { getCategories, getSubcategories } from './reference.js';
import { unwrap } from './db.js';

const refresh = () => invalidate('categories', 'subcategories');

/** { categories: [...], subsByCategory: Map(id -> subs[]) } */
export async function loadCategoryTree() {
  const [map, subs] = await Promise.all([getCategories(), getSubcategories()]);
  const subsByCategory = new Map();
  for (const s of subs) {
    if (!subsByCategory.has(s.category_id)) subsByCategory.set(s.category_id, []);
    subsByCategory.get(s.category_id).push(s);
  }
  return { categories: [...map.values()], subsByCategory };
}

export async function createCategory({ name, kind, color, icon }, nextOrder = 0) {
  await unwrap(supabase.from('categories').insert({ name, kind, color, icon, sort_order: nextOrder }));
  refresh();
}

export async function updateCategory(id, { name, color, icon }) {
  await unwrap(supabase.from('categories').update({ name, color, icon }).eq('id', id));
  refresh();
}

export async function deleteCategory(id) {
  await unwrap(supabase.from('categories').delete().eq('id', id));
  refresh();
}

export async function createSubcategory(categoryId, name, nextOrder = 0) {
  await unwrap(supabase.from('subcategories')
    .insert({ category_id: categoryId, name, sort_order: nextOrder }));
  refresh();
}

export async function updateSubcategory(id, name) {
  await unwrap(supabase.from('subcategories').update({ name }).eq('id', id));
  refresh();
}

export async function deleteSubcategory(id) {
  await unwrap(supabase.from('subcategories').delete().eq('id', id));
  refresh();
}

/** Quantas movimentações usam a categoria/subcategoria (para avisar do impacto ao excluir). */
export async function countUsage(column, id) {
  const { count, error } = await supabase.from('transactions')
    .select('id', { count: 'exact', head: true }).eq(column, id);
  if (error) throw error;
  return count ?? 0;
}
