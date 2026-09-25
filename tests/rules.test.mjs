// Testes das regras puras (sem dependências): node tests/rules.test.mjs
// Cobrem fatura/vencimento/parcelas (js/core/cards.js) e validações (js/core/validation.js).
import { addMonths, cardLimit, currentInvoice, invoiceFor, invoiceStatus, planPurchase, splitInstallments } from '../js/core/cards.js';
import { validateCard, validateTransaction } from '../js/core/validation.js';
import { parseMoney } from '../js/core/format.js';
import { NO_CATEGORY, activeChips, activeGroups, clearGroup, emptyFilters, isUuid, parseSource, resolvePeriod, validateFilters } from '../js/core/filters.js';
import { barLayout, chartRange, closedMonthsAverage, compactMoney, donutItems, donutSegments, monthSeries, niceScale, roundedTopPath } from '../js/core/charts.js';

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


// ---- gráficos ----
eq('intervalo de 6 meses', chartRange('2026-09-20', 6), { from: '2026-04-01', until: '2026-09-20' });
eq('intervalo cruza o ano', chartRange('2026-02-10', 6).from, '2025-09-01');
const ms = monthSeries([{ month_start: '2026-08-01', income: '5000', expense: '1200.5', investment: '0' }, { month_start: '2026-09-01', income: 100, expense: 50 }], '2026-09-20', 6);
eq('série: 6 meses, o atual por último e parcial', [ms.length, ms[5].key, ms[5].partial, ms[0].key, ms[0].partial], [6, '2026-09-01', true, '2026-04-01', false]);
eq('série: mês sem movimento vira zero', [ms[3].income, ms[3].expense], [0, 0]);
eq('série: valores numéricos', [ms[4].income, ms[4].expense], [5000, 1200.5]);
eq('média ignora o mês parcial e meses vazios', closedMonthsAverage(ms), { months: 1, income: 5000, expense: 1200.5 });
eq('média sem dados', closedMonthsAverage(monthSeries([], '2026-09-20')), null);
eq('escala 0', niceScale(0).ticks, [0, 1]);
eq('escala 4.300', niceScale(4300).ticks, [0, 2000, 4000, 6000]);
eq('escala 950', niceScale(950).ticks, [0, 500, 1000]);
eq('escala 12.400', niceScale(12400).max, 15000);
for (const v of [1, 7, 99, 1234, 56789, 1e6 + 1]) { const sc = niceScale(v); if (!(sc.max >= v && sc.ticks[0] === 0 && sc.ticks.length <= 6)) { fails++; console.log('FALHA escala', v, sc); } }
eq('rótulos compactos', [0, 950, 1000, 1500, 12000, 1200000].map(compactMoney), ['0', 'R$ 950', 'R$ 1 mil', 'R$ 1,5 mil', 'R$ 12 mil', 'R$ 1,2 mi']);
eq('barra: base reta e topo arredondado', roundedTopPath(10, 20, 24, 50, 4).startsWith('M10 70V24A4 4 0 0 1 14 20'), true);
eq('barra zerada não desenha', roundedTopPath(10, 20, 24, 0, 4), '');
eq('raio limitado pela altura', roundedTopPath(0, 0, 24, 2, 4).includes('A2 2'), true);
const lay = barLayout(ms);
eq('layout: 6 grupos, 2 barras cada', [lay.groups.length, lay.groups.every((g) => g.bars.length === 2)], [6, true]);
eq('layout: barra <= 24px', lay.barW <= 24, true);
eq('layout: respiro entre as duas barras = 2px', (() => { const [a, b] = lay.groups[4].bars; return Math.round((b.x - (a.x + a.w)) * 100) / 100; })(), 2);
eq('layout: barras dentro da área do gráfico', lay.groups.every((g) => g.bars.every((b) => b.y >= lay.plot.y - 0.01 && b.y + b.h <= lay.plot.y + lay.plot.h + 0.01)), true);
eq('layout: barra maior encosta no topo da escala', lay.groups[4].bars[0].value === 5000 && lay.groups[4].bars[0].h > lay.groups[5].bars[0].h, true);
const cats = [10, 9, 8, 7, 6, 5, 4, 3].map((t, i) => ({ categoryId: 'c' + i, name: 'C' + i, icon: 'x', total: t, percent: t }));
eq('rosca: até 6 fatias mostra todas', donutItems(cats.slice(0, 6)).length, 6);
eq('rosca: mais de 6 vira 5 + Outros', (() => { const d = donutItems(cats); return [d.length, d[5].name, d[5].total, d[5].other, d[5].count]; })(), [6, 'Outros', 12, true, 3]);
eq('rosca: ignora total zero', donutItems([{ total: 0 }]).length, 0);
const dn = donutSegments([50, 30, 20], { radius: 46, gap: 2 });
eq('rosca: soma dos comprimentos = circunferência', Math.abs(dn.segments.reduce((s, x) => s + x.length, 0) - dn.circumference) < 0.05, true);
eq('rosca: cada fatia perde 2 de comprimento visível', dn.segments.every((x) => Math.abs(x.length - 2 - parseFloat(x.dash)) < 0.02), true);
eq('rosca: anel único fechado', donutSegments([100]).segments[0].dash.startsWith(String(Math.round(donutSegments([100]).circumference * 100) / 100)), true);
eq('rosca vazia', donutSegments([0, 0]).segments, []);


// ---- filtros de movimentações ----
const A1 = '11111111-1111-1111-1111-111111111111';
eq('uuid válido/ inválido', [isUuid(A1), isUuid("x') or (1=1"), isUuid('')], [true, false, false]);
eq('origem: conta', parseSource('a:' + A1), { accountId: A1, cardId: null });
eq('origem: cartão', parseSource('c:' + A1), { accountId: null, cardId: A1 });
eq('origem: lixo é ignorado (sem injeção no filtro or)', parseSource("a:x),(amount.gt.0"), { accountId: null, cardId: null });
eq('período: mês', resolvePeriod(emptyFilters(), new Date(2026, 8, 20)), { from: '2026-09-01', to: '2026-10-01' });
eq('período: dezembro vira o ano', resolvePeriod(emptyFilters(), new Date(2026, 11, 5)), { from: '2026-12-01', to: '2027-01-01' });
eq('período personalizado: fim inclusivo => to exclusivo', resolvePeriod({ ...emptyFilters(), from: '2026-09-01', to: '2026-09-30' }, new Date(2026, 0, 1)), { from: '2026-09-01', to: '2026-10-01' });
eq('filtros vazios não são ativos', activeGroups(emptyFilters()), []);
eq('grupos ativos', activeGroups({ ...emptyFilters(), source: 'a:' + A1, categoryId: NO_CATEGORY, min: 0, from: '2026-09-01', to: '2026-09-02' }), ['source', 'category', 'value', 'period']);
eq('valor: mínimo zero conta como filtro', activeGroups({ ...emptyFilters(), min: 0 }), ['value']);
const vf = (i) => validateFilters({ ...emptyFilters(), ...i });
eq('validação ok (vazio)', vf({}).ok, true);
eq('min > max', vf({ min: 100, max: 50 }).ok, false);
eq('min = max', vf({ min: 50, max: 50 }).ok, true);
eq('valor negativo', vf({ min: -1 }).ok, false);
eq('valor NaN', vf({ max: 'abc' }).ok, false);
eq('só uma data', vf({ from: '2026-09-01' }).ok, false);
eq('data inexistente', vf({ from: '2026-02-31', to: '2026-03-01' }).ok, false);
eq('início depois do fim', vf({ from: '2026-09-10', to: '2026-09-01' }).ok, false);
eq('período válido', vf({ from: '2026-09-01', to: '2026-09-10' }).value.to, '2026-09-10');
eq('subcategoria some se a categoria some', vf({ subcategoryId: 's1' }).value.subcategoryId, '');
eq('subcategoria some com "sem categoria"', vf({ categoryId: NO_CATEGORY, subcategoryId: 's1' }).value.subcategoryId, '');
eq('subcategoria mantida com categoria', vf({ categoryId: 'c1', subcategoryId: 's1' }).value.subcategoryId, 's1');
const fref = { accounts: [{ id: A1, name: 'Nubank' }], cards: [{ id: 'k1', name: 'Itaú Card' }], categories: new Map([['c1', { id: 'c1', name: 'Alimentação', icon: '🍽️' }]]), subcategories: [{ id: 's1', name: 'Mercado' }] };
eq('chips', activeChips({ ...emptyFilters(), source: 'a:' + A1, categoryId: 'c1', subcategoryId: 's1', min: 50, max: null, from: '2026-09-01', to: '2026-09-15' }, fref).map((c) => c.label),
  ['Nubank', '🍽️ Alimentação › Mercado', 'A partir de R$ 50,00', '01/09/2026 – 15/09/2026']);
eq('chip de cartão e faixa de valor', activeChips({ ...emptyFilters(), source: 'c:k1', min: 10, max: 20 }, fref).map((c) => c.key + ':' + c.label.replace(/ /g, ' ')), ['source:💳 Cartão', 'value:R$ 10,00 – R$ 20,00']);
eq('limpar grupo categoria', clearGroup({ ...emptyFilters(), categoryId: 'c1', subcategoryId: 's1', min: 1 }, 'category'), { ...emptyFilters(), min: 1 });

console.log(fails ? `\n${fails} FALHA(S)` : 'todos os testes passaram');
process.exitCode = fails ? 1 : 0;
