/*
 * REGRAS FINANCEIRAS CENTRALIZADAS.
 * Funções puras (sem DOM, sem Supabase): recebem dados, devolvem números.
 * Toda tela que precisa de saldo, resumo do mês etc. passa por aqui, para
 * que a mesma regra não seja reimplementada (e divergida) em cada lugar.
 *
 * Contas em centavos inteiros internamente para evitar erros de ponto flutuante.
 */

export const TYPES = Object.freeze({
  EXPENSE: 'expense',
  INCOME: 'income',
  TRANSFER: 'transfer',
  INVESTMENT: 'investment',
  INVOICE_PAYMENT: 'invoice_payment',
});

export const TYPE_LABELS = Object.freeze({
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
  investment: 'Investimento',
  invoice_payment: 'Pagamento de fatura',
});

const cents = (value) => Math.round((Number(value) || 0) * 100);
const fromCents = (c) => c / 100;

export function sumMoney(values) {
  return fromCents(values.reduce((total, v) => total + cents(v), 0));
}

/**
 * Saldo atual de uma conta.
 * `flows` vem da função SQL account_flows (somas brutas por tipo).
 *   saldo = inicial + receitas + transferências recebidas
 *           − despesas − transferências enviadas − investimentos − pagamentos de fatura
 * Compra no cartão NÃO aparece aqui: ela só sai da conta quando a fatura é paga.
 */
export function accountBalance(account, flows) {
  const f = flows || {};
  return fromCents(
    cents(account.initial_balance) +
      cents(f.income) + cents(f.transfer_in) -
      cents(f.expense) - cents(f.transfer_out) - cents(f.investment) - cents(f.invoice_payment),
  );
}

/** Saldo total = soma dos saldos das contas ativas. */
export function totalBalance(accounts, flowsByAccount) {
  return fromCents(
    accounts
      .filter((a) => a.status === 'active')
      .reduce((total, a) => total + cents(accountBalance(a, flowsByAccount[a.id])), 0),
  );
}

/**
 * Resumo de um conjunto de movimentações (normalmente as do mês).
 * Transferência e pagamento de fatura ficam de fora: não são receita nem despesa.
 * Investimento é reportado à parte (não é gasto, mas também não é "sobra").
 */
export function periodSummary(transactions) {
  let income = 0;
  let expense = 0;
  let invested = 0;
  for (const t of transactions) {
    if (t.type === TYPES.INCOME) income += cents(t.amount);
    else if (t.type === TYPES.EXPENSE) expense += cents(t.amount);
    else if (t.type === TYPES.INVESTMENT) invested += cents(t.amount);
  }
  return {
    income: fromCents(income),
    expense: fromCents(expense),
    invested: fromCents(invested),
    left: fromCents(income - expense), // "quanto sobrou"
  };
}

/**
 * Despesas agrupadas por categoria, da maior para a menor.
 * `categories` é um Map id -> categoria (para nome/cor/ícone).
 */
export function spendingByCategory(transactions, categories) {
  const totals = new Map();
  let grand = 0;
  for (const t of transactions) {
    if (t.type !== TYPES.EXPENSE) continue;
    const key = t.category_id ?? null;
    const c = cents(t.amount);
    totals.set(key, (totals.get(key) || 0) + c);
    grand += c;
  }
  return [...totals.entries()]
    .map(([id, total]) => {
      const cat = id ? categories.get(id) : null;
      return {
        categoryId: id,
        name: cat?.name ?? 'Sem categoria',
        color: cat?.color ?? null,
        icon: cat?.icon ?? '📦',
        total: fromCents(total),
        percent: grand ? (total / grand) * 100 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** Sinal visual de uma movimentação na lista: +receita, −despesa, transferência neutra. */
export function transactionSign(type) {
  if (type === TYPES.INCOME) return 1;
  if (type === TYPES.TRANSFER) return 0;
  return -1;
}
