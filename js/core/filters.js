// Filtros de Movimentações (lógica pura: sem DOM e sem Supabase).
// A tela guarda um objeto `filters`; o serviço o traduz em consulta (services/transactions.js).
import { formatDate, formatMoney, toISODate } from './format.js';
import { addDays } from './cards.js';
import { MAX_AMOUNT, isValidISODate } from './validation.js';

/** Valor especial do filtro de categoria: movimentações (receita/despesa) sem categoria. */
export const NO_CATEGORY = 'none';

/**
 * source:  '' (todas) | 'a:<id da conta>' | 'c:<id do cartão>'
 * categoryId: '' | NO_CATEGORY | id;  subcategoryId: '' | id
 * min/max: número ou null;  from/to: datas ISO inclusivas ou null (período personalizado)
 */
export const emptyFilters = () => ({
  source: '', categoryId: '', subcategoryId: '', min: null, max: null, from: null, to: null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID.test(String(v ?? ''));

export function parseSource(source) {
  const [kind, id] = String(source || '').split(':');
  return {
    accountId: kind === 'a' && isUuid(id) ? id : null,
    cardId: kind === 'c' && isUuid(id) ? id : null,
  };
}

export const hasCustomPeriod = (f) => Boolean(f.from && f.to);

/** Grupos de filtro ativos (cada um vira um "chip" removível e conta no selo do botão). */
export function activeGroups(f) {
  const groups = [];
  if (f.source) groups.push('source');
  if (f.categoryId) groups.push('category');
  if (f.min != null || f.max != null) groups.push('value');
  if (hasCustomPeriod(f)) groups.push('period');
  return groups;
}

/** Período da consulta: { from, to } com `to` EXCLUSIVO. Personalizado tem prioridade sobre o mês. */
export function resolvePeriod(f, month) {
  if (hasCustomPeriod(f)) return { from: f.from, to: addDays(f.to, 1) };
  return {
    from: toISODate(new Date(month.getFullYear(), month.getMonth(), 1)),
    to: toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 1)),
  };
}

/** Valida o que o usuário digitou na folha de filtros. Retorna { ok, errors, value }. */
export function validateFilters(input) {
  const errors = {};
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const min = num(input.min);
  const max = num(input.max);
  for (const [key, v] of [['min', min], ['max', max]]) {
    if (v != null && (!Number.isFinite(v) || v < 0 || v > MAX_AMOUNT)) errors[key] = 'Informe um valor válido.';
  }
  if (!errors.min && !errors.max && min != null && max != null && min > max) {
    errors.max = 'O valor máximo deve ser maior ou igual ao mínimo.';
  }

  const from = input.from || null;
  const to = input.to || null;
  if ((from && !to) || (!from && to)) errors.period = 'Informe as duas datas do período.';
  else if (from && (!isValidISODate(from) || !isValidISODate(to))) errors.period = 'Informe datas válidas.';
  else if (from && from > to) errors.period = 'A data inicial deve ser anterior à final.';

  const ok = Object.keys(errors).length === 0;
  return {
    ok, errors,
    value: ok ? {
      source: input.source || '',
      categoryId: input.categoryId || '',
      subcategoryId: input.categoryId && input.categoryId !== NO_CATEGORY ? input.subcategoryId || '' : '',
      min, max, from, to,
    } : null,
  };
}

/**
 * Rótulos dos chips ativos. `ref`: { accounts, cards, categories (Map), subcategories }.
 * @returns {{ key: 'source'|'category'|'value'|'period', label: string }[]}
 */
export function activeChips(f, ref) {
  const label = {
    source: () => {
      const { accountId, cardId } = parseSource(f.source);
      if (accountId) return ref.accounts.find((a) => a.id === accountId)?.name ?? 'Conta';
      return `💳 ${ref.cards.find((c) => c.id === cardId)?.name ?? 'Cartão'}`;
    },
    category: () => {
      if (f.categoryId === NO_CATEGORY) return 'Sem categoria';
      const cat = ref.categories.get(f.categoryId);
      const sub = f.subcategoryId ? ref.subcategories.find((s) => s.id === f.subcategoryId) : null;
      return `${cat?.icon ?? ''} ${cat?.name ?? 'Categoria'}${sub ? ` › ${sub.name}` : ''}`.trim();
    },
    value: () => {
      if (f.min != null && f.max != null) return `${formatMoney(f.min)} – ${formatMoney(f.max)}`;
      return f.min != null ? `A partir de ${formatMoney(f.min)}` : `Até ${formatMoney(f.max)}`;
    },
    period: () => `${formatDate(f.from)} – ${formatDate(f.to)}`,
  };
  return activeGroups(f).map((key) => ({ key, label: label[key]() }));
}

/** Remove um grupo de filtro (botão × do chip). */
export function clearGroup(f, key) {
  const next = { ...f };
  if (key === 'source') next.source = '';
  if (key === 'category') { next.categoryId = ''; next.subcategoryId = ''; }
  if (key === 'value') { next.min = null; next.max = null; }
  if (key === 'period') { next.from = null; next.to = null; }
  return next;
}
