// Validação de dados ANTES de chamar o Supabase. Funções puras: recebem o que o
// usuário informou + dados de referência e devolvem { ok, errors, value }.
// As mensagens são para o usuário final (nunca técnicas).
import { parseISODate, toISODate } from './format.js';
import { TYPES } from './finance.js';

export const MAX_AMOUNT = 999_999_999.99;
export const MAX_INSTALLMENTS = 120; // mesmo teto da constraint de installment_plans

export const ACCOUNT_TYPES = Object.freeze({
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro',
  wallet: 'Carteira digital',
  investment: 'Corretora',
  other: 'Outra',
});

/** Data ISO "YYYY-MM-DD" existente no calendário (rejeita 2026-02-31) e em faixa razoável. */
export function isValidISODate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
  const d = parseISODate(iso);
  return toISODate(d) === iso && d.getFullYear() >= 2000 && d.getFullYear() <= 2100;
}

const clean = (s) => String(s ?? '').trim();

/**
 * @param input  { type, amount (number), date, account_id, to_account_id, credit_card_id,
 *                 installments, category_id, subcategory_id, description, notes }
 * @param ref    { accounts: [], cards?: [], categories: Map, subcategories: [] }
 *   Despesa no cartão: `credit_card_id` no lugar de `account_id`; `installments` (1 = à vista).
 * @param opts   { allowAccountIds?: string[] }  contas arquivadas já usadas ao editar
 */
export function validateTransaction(input, ref, opts = {}) {
  const errors = {};
  const type = input.type;
  const onCard = type === TYPES.EXPENSE && Boolean(input.credit_card_id);
  const activeCard = onCard && (ref.cards ?? []).find(
    (c) => c.id === input.credit_card_id && (c.status === 'active' || opts.allowCardId === c.id),
  );
  const activeAccount = (id) => ref.accounts.find(
    (a) => a.id === id && (a.status === 'active' || opts.allowAccountIds?.includes(id)),
  );

  if (!Object.values(TYPES).includes(type) || type === TYPES.INVOICE_PAYMENT) {
    errors.type = 'Escolha o tipo da movimentação.';
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Informe um valor maior que zero.';
  else if (amount > MAX_AMOUNT) errors.amount = 'Valor muito alto.';

  if (!isValidISODate(input.date)) errors.date = 'Informe uma data válida.';

  if (onCard) {
    if (!activeCard) errors.account_id = 'Escolha um cartão válido.';
  } else if (!input.account_id || !activeAccount(input.account_id)) {
    errors.account_id = type === TYPES.TRANSFER ? 'Escolha a conta de origem.'
      : type === TYPES.EXPENSE ? 'Escolha a conta ou o cartão.' : 'Escolha a conta.';
  }

  // Parcelamento só existe em compra no cartão (à vista = 1).
  const installments = onCard ? Number(input.installments ?? 1) : 1;
  if (onCard && (!Number.isInteger(installments) || installments < 1 || installments > MAX_INSTALLMENTS)) {
    errors.installments = `Informe de 1 a ${MAX_INSTALLMENTS} parcelas.`;
  }

  if (type === TYPES.TRANSFER) {
    if (!input.to_account_id || !activeAccount(input.to_account_id)) {
      errors.to_account_id = 'Escolha a conta de destino.';
    } else if (input.to_account_id === input.account_id) {
      errors.to_account_id = 'Origem e destino devem ser contas diferentes.';
    }
  }

  // Categoria só existe para receita/despesa; é obrigatória se o usuário tem alguma daquele tipo.
  let categoryId = null;
  let subcategoryId = null;
  if (type === TYPES.EXPENSE || type === TYPES.INCOME) {
    const ofKind = [...ref.categories.values()].filter((c) => c.kind === type);
    const category = input.category_id ? ref.categories.get(input.category_id) : null;
    if (category && category.kind === type) {
      categoryId = category.id;
      if (input.subcategory_id) {
        const sub = ref.subcategories.find(
          (s) => s.id === input.subcategory_id && s.category_id === category.id,
        );
        if (sub) subcategoryId = sub.id;
        else errors.subcategory_id = 'Subcategoria inválida para esta categoria.';
      }
    } else if (ofKind.length > 0) {
      errors.category_id = 'Escolha a categoria.';
    }
  }

  const description = clean(input.description);
  if (description.length > 120) errors.description = 'Descrição muito longa (máx. 120 caracteres).';

  const ok = Object.keys(errors).length === 0;
  const isTransfer = type === TYPES.TRANSFER;
  return {
    ok,
    errors,
    installments,
    // `value` respeita a constraint transactions_shape_chk do banco para cada tipo.
    value: ok ? {
      type,
      amount: Math.round(amount * 100) / 100,
      date: input.date,
      description: description || null,
      notes: clean(input.notes) || null,
      account_id: onCard ? null : input.account_id,
      to_account_id: isTransfer ? input.to_account_id : null,
      credit_card_id: onCard ? input.credit_card_id : null,
      category_id: categoryId,
      subcategory_id: subcategoryId,
    } : null,
  };
}

export function validateAccount(input, existing = [], selfId = null) {
  const errors = {};
  const name = clean(input.name);
  if (!name) errors.name = 'Informe o nome da conta.';
  else if (name.length > 60) errors.name = 'Nome muito longo (máx. 60 caracteres).';
  else if (existing.some((a) => a.id !== selfId && a.name.toLowerCase() === name.toLowerCase())) {
    errors.name = 'Você já tem uma conta com esse nome.';
  }
  if (!(input.type in ACCOUNT_TYPES)) errors.type = 'Escolha o tipo da conta.';
  const balance = Number(input.initial_balance);
  if (!Number.isFinite(balance) || Math.abs(balance) > MAX_AMOUNT) {
    errors.initial_balance = 'Informe um saldo inicial válido.';
  }
  const institution = clean(input.institution);
  if (institution.length > 60) errors.institution = 'Nome da instituição muito longo.';
  const ok = Object.keys(errors).length === 0;
  return {
    ok, errors,
    value: ok ? { name, type: input.type, institution: institution || null,
                  initial_balance: Math.round(balance * 100) / 100 } : null,
  };
}

/** Categoria ou subcategoria: `siblings` = irmãs do mesmo nível/tipo (para checar duplicidade). */
export function validateCategory(input, siblings = [], selfId = null) {
  const errors = {};
  const name = clean(input.name);
  if (!name) errors.name = 'Informe o nome.';
  else if (name.length > 60) errors.name = 'Nome muito longo (máx. 60 caracteres).';
  else if (siblings.some((s) => s.id !== selfId && s.name.toLowerCase() === name.toLowerCase())) {
    errors.name = 'Já existe um item com esse nome aqui.';
  }
  if (input.color != null && !/^#[0-9a-f]{6}$/i.test(input.color)) errors.color = 'Cor inválida.';
  return { ok: Object.keys(errors).length === 0, errors, value: { name } };
}

/** Cartão de crédito: dias entre 1 e 31; limite >= 0; conta de pagamento (opcional) deve existir. */
export function validateCard(input, existing = [], accounts = [], selfId = null) {
  const errors = {};
  const name = clean(input.name);
  if (!name) errors.name = 'Informe o nome do cartão.';
  else if (name.length > 60) errors.name = 'Nome muito longo (máx. 60 caracteres).';
  else if (existing.some((c) => c.id !== selfId && c.name.toLowerCase() === name.toLowerCase())) {
    errors.name = 'Você já tem um cartão com esse nome.';
  }
  const limit = Number(input.credit_limit);
  if (!Number.isFinite(limit) || limit < 0 || limit > MAX_AMOUNT) errors.credit_limit = 'Informe um limite válido (zero ou mais).';
  const day = (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 31;
  if (!day(input.closing_day)) errors.closing_day = 'O dia de fechamento deve estar entre 1 e 31.';
  if (!day(input.due_day)) errors.due_day = 'O dia de vencimento deve estar entre 1 e 31.';
  const institution = clean(input.institution);
  if (institution.length > 60) errors.institution = 'Nome da instituição muito longo.';
  const pay = input.default_payment_account_id || null;
  if (pay && !accounts.some((a) => a.id === pay)) errors.default_payment_account_id = 'Conta de pagamento inválida.';
  const ok = Object.keys(errors).length === 0;
  return {
    ok, errors,
    value: ok ? {
      name, institution: institution || null, credit_limit: Math.round(limit * 100) / 100,
      closing_day: Number(input.closing_day), due_day: Number(input.due_day),
      default_payment_account_id: pay,
    } : null,
  };
}
