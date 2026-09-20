// Testes das regras puras (sem dependências): node tests/rules.test.mjs
// Cobrem fatura/vencimento/parcelas (js/core/cards.js) e validações (js/core/validation.js).
import { addMonths, cardLimit, currentInvoice, invoiceFor, invoiceStatus, planPurchase, splitInstallments } from '../js/core/cards.js';
import { validateCard, validateTransaction } from '../js/core/validation.js';
import { parseMoney } from '../js/core/format.js';

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FALHA ${label}\n   obtido  ${JSON.stringify(got)}\n   esperado ${JSON.stringify(want)}`); }
};
const win = (card, iso) => { const w = invoiceFor(card, iso); return [w.period_start, w.closing_date, w.due_date]; };

// ---- fatura: fecha dia 3, vence dia 10 (exemplo do briefing) ----
const nu = { closing_day: 3, due_day: 10 };
eq('compra antes do fechamento', win(nu, '2026-09-02'), ['2026-08-04', '2026-09-03', '2026-09-10']);
eq('compra NO dia do fechamento fica na fatura', win(nu, '2026-09-03'), ['2026-08-04', '2026-09-03', '2026-09-10']);
eq('compra depois do fechamento vai para a seguinte', win(nu, '2026-09-04'), ['2026-09-04', '2026-10-03', '2026-10-10']);
eq('virada de ano', win(nu, '2026-12-20'), ['2026-12-04', '2027-01-03', '2027-01-10']);
// vencimento no mês seguinte (fecha 25, vence 5)
const c25 = { closing_day: 25, due_day: 5 };
eq('fecha 25 vence 5', win(c25, '2026-09-10'), ['2026-08-26', '2026-09-25', '2026-10-05']);
eq('fecha 25 vence 5 (virada de ano)', win(c25, '2026-12-30'), ['2026-12-26', '2027-01-25', '2027-02-05']);
// dia 31 em meses curtos
const c31 = { closing_day: 31, due_day: 10 };
eq('fecha 31 em fevereiro', win(c31, '2027-02-15'), ['2027-02-01', '2027-02-28', '2027-03-10']);
eq('fecha 31: último dia de fev fica em fev', win(c31, '2027-02-28')[1], '2027-02-28');
eq('fecha 31: bissexto', win(c31, '2028-02-29')[1], '2028-02-29');
// nunca gerar datas que violem os checks do banco (due >= closing, start <= closing)
for (const [c, d] of [[1, 1], [31, 31], [28, 29], [30, 30], [15, 15], [10, 31], [31, 1]]) {
  for (let m = 1; m <= 12; m++) {
    const w = invoiceFor({ closing_day: c, due_day: d }, `2026-${String(m).padStart(2, '0')}-14`);
    if (!(w.due_date >= w.closing_date && w.period_start <= w.closing_date)) { fails++; console.log('FALHA datas inválidas', c, d, m, w); }
  }
}
eq('addMonths 31/jan +1', addMonths('2027-01-31', 1), '2027-02-28');
eq('addMonths vira o ano', addMonths('2026-11-15', 3), '2027-02-15');

// ---- parcelas ----
eq('100/3', splitInstallments(100, 3), [33.34, 33.33, 33.33]);
eq('1200/12', splitInstallments(1200, 12), Array(12).fill(100));
for (let i = 0; i < 5000; i++) {
  const total = Math.round(Math.random() * 1e7) / 100 + 0.01;
  const n = 2 + Math.floor(Math.random() * 60);
  const sum = Math.round(splitInstallments(total, n).reduce((a, b) => a + b * 100, 0));
  if (sum !== Math.round(total * 100)) { fails++; console.log('FALHA soma das parcelas', total, n, sum); break; }
}
const p = planPurchase(nu, { date: '2026-09-05', total: 1200, count: 12 });
eq('12x: parcela 1', [p.parcels[0].amount, p.parcels[0].invoice.closing_date], [100, '2026-10-03']);
eq('12x: parcela 12', [p.parcels[11].date, p.parcels[11].invoice.closing_date], ['2027-08-05', '2027-09-03']);
eq('12x: cada parcela em uma fatura diferente', new Set(p.parcels.map((x) => x.invoice.closing_date)).size, 12);
const q = planPurchase({ closing_day: 28, due_day: 5 }, { date: '2027-01-31', total: 300, count: 3 });
eq('31/jan com fechamento 28: faturas distintas', q.parcels.map((x) => x.invoice.closing_date), ['2027-02-28', '2027-03-28', '2027-04-28']);

// ---- status e limite ----
const inv = { closing_date: '2026-09-03', due_date: '2026-09-10', paid_at: null };
eq('aberta até o fechamento', invoiceStatus(inv, '2026-09-03'), 'open');
eq('fechada depois', invoiceStatus(inv, '2026-09-04'), 'closed');
eq('fechada no vencimento', invoiceStatus(inv, '2026-09-10'), 'closed');
eq('atrasada', invoiceStatus(inv, '2026-09-11'), 'overdue');
eq('paga', invoiceStatus({ ...inv, paid_at: '2026-09-12T00:00:00Z' }, '2027-01-01'), 'paid');
const lim = cardLimit({ credit_limit: 5000 }, [{ total_amount: 900.1 }, { total_amount: 39.9 }]);
eq('limite usado/disponível', [lim.used, lim.available], [940, 4060]);
eq('limite estourado', cardLimit({ credit_limit: 100 }, [{ total_amount: 250 }]).percent, 100);
eq('fatura atual virtual', [currentInvoice({ id: 'k', ...nu }, [], '2026-09-18').id, currentInvoice({ id: 'k', ...nu }, [], '2026-09-18').closing_date], [null, '2026-10-03']);

// ---- validação ----
const ref = {
  accounts: [{ id: 'a1', name: 'N', status: 'active' }],
  cards: [{ id: 'k1', status: 'active' }, { id: 'k2', status: 'archived' }],
  categories: new Map([['c1', { id: 'c1', kind: 'expense' }]]), subcategories: [],
};
const base = { type: 'expense', amount: 1200, date: '2026-09-18', category_id: 'c1' };
const ok = (i, o) => validateTransaction(i, ref, o);
eq('cartão 12x', [ok({ ...base, credit_card_id: 'k1', installments: 12 }).ok, ok({ ...base, credit_card_id: 'k1', installments: 12 }).value.account_id], [true, null]);
eq('0 parcelas', ok({ ...base, credit_card_id: 'k1', installments: 0 }).ok, false);
eq('121 parcelas', ok({ ...base, credit_card_id: 'k1', installments: 121 }).ok, false);
eq('parcelas fracionadas', ok({ ...base, credit_card_id: 'k1', installments: 2.5 }).ok, false);
eq('cartão arquivado', ok({ ...base, credit_card_id: 'k2', installments: 1 }).ok, false);
eq('cartão arquivado permitido na edição', ok({ ...base, credit_card_id: 'k2', installments: 1 }, { allowCardId: 'k2' }).ok, true);
eq('despesa sem conta nem cartão', ok(base).ok, false);
eq('valor zero', ok({ ...base, account_id: 'a1', amount: 0 }).ok, false);
eq('data inexistente', ok({ ...base, account_id: 'a1', date: '2026-02-31' }).ok, false);
eq('receita ignora cartão', ok({ type: 'income', amount: 5, date: '2026-09-18', account_id: 'a1', credit_card_id: 'k1' }).value.credit_card_id, null);
eq('cartão válido', validateCard({ name: 'Inter', credit_limit: '5000', closing_day: '3', due_day: '10' }, [], []).ok, true);
eq('cartão: dias inválidos', validateCard({ name: 'X', credit_limit: 0, closing_day: 0, due_day: 32 }, [], []).ok, false);
eq('cartão: nome duplicado', validateCard({ name: 'nubank', credit_limit: 1, closing_day: 3, due_day: 10 }, [{ id: 'x', name: 'Nubank' }], []).ok, false);
eq('parseMoney 1.234,56', parseMoney('1.234,56'), 1234.56);
eq('parseMoney 45.90', parseMoney('45.90'), 45.9);

console.log(fails ? `\n${fails} FALHA(S)` : 'todos os testes passaram');
process.exitCode = fails ? 1 : 0;
