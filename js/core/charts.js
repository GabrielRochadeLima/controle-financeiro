/*
 * Matemática dos gráficos do dashboard (funções puras, sem DOM): séries por mês,
 * escala "redonda" do eixo, geometria das barras e arcos da rosca.
 * O desenho em SVG fica em js/ui/charts.js.
 */
import { toISODate } from './format.js';

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthShort = (month0) => MONTHS_SHORT[month0];

// ---------- séries por mês ----------

/** Intervalo a consultar: do dia 1 do mês mais antigo da série até hoje. */
export function chartRange(today, count = 6) {
  const [y, m] = today.split('-').map(Number);
  return { from: toISODate(new Date(y, m - 1 - (count - 1), 1)), until: today };
}

/**
 * Últimos `count` meses (o atual por último). Meses sem movimento não vêm do banco,
 * então são completados com zero. `partial` marca o mês corrente (ainda incompleto).
 * @param rows  linhas de monthly_flows: { month_start, income, expense, investment }
 */
export function monthSeries(rows, today, count = 6) {
  const [ty, tm] = today.split('-').map(Number);
  const byKey = new Map(rows.map((r) => [r.month_start, r]));
  return Array.from({ length: count }, (_, i) => {
    const offset = count - 1 - i;
    const d = new Date(ty, tm - 1 - offset, 1);
    const row = byKey.get(toISODate(d));
    return {
      key: toISODate(d),
      year: d.getFullYear(),
      month0: d.getMonth(),
      income: Number(row?.income) || 0,
      expense: Number(row?.expense) || 0,
      investment: Number(row?.investment) || 0,
      partial: offset === 0,
    };
  });
}

/** Média dos meses já encerrados que tiveram movimento (o mês corrente é parcial e fica de fora). */
export function closedMonthsAverage(series) {
  const closed = series.filter((m) => !m.partial && (m.income > 0 || m.expense > 0));
  if (!closed.length) return null;
  const avg = (key) => Math.round((closed.reduce((s, m) => s + m[key] * 100, 0) / closed.length)) / 100;
  return { months: closed.length, income: avg('income'), expense: avg('expense') };
}

// ---------- escala e rótulos ----------

/** Escala com valores "redondos" (1, 2, 2,5, 5 × 10^k): { max, ticks: [0 ... max] }. */
export function niceScale(maxValue, targetTicks = 3) {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };
  const rough = maxValue / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const n = rough / magnitude;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  const step = nice * magnitude;
  const max = Math.ceil(maxValue / step - 1e-9) * step;
  const ticks = [];
  for (let v = 0; v <= max + step / 1e6; v += step) ticks.push(Math.round(v * 100) / 100);
  return { max, ticks };
}

const trimmed = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

/** Rótulo curto para o eixo (sem "R$": o valor exato com moeda aparece no detalhe): 0, 950, 1,5 mil, 12 mil, 1,2 mi. */
export function compactMoney(value) {
  const v = Math.abs(value);
  if (v === 0) return '0';
  if (v >= 1_000_000) return `${trimmed(v / 1_000_000)} mi`;
  if (v >= 1_000) return `${trimmed(v / 1_000)} mil`;
  return trimmed(v);
}

// ---------- barras agrupadas (receitas × despesas) ----------

/** Caminho de uma barra: cantos de cima arredondados (raio r), base reta no eixo. */
export function roundedTopPath(x, y, w, h, r = 4) {
  if (!(h > 0) || !(w > 0)) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}H${x + w - rr}A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}V${y + h}Z`;
}

/**
 * Layout das barras. Cada mês é uma coluna com duas barras (receita à esquerda,
 * despesa à direita) separadas por um respiro de `gap` px; barras de no máximo `maxBar` px.
 * A área de toque de cada mês é a coluna inteira (bem maior que a barra).
 */
export function barLayout(series, { width = 340, height = 200, pad = { top: 10, right: 8, bottom: 26, left: 40 }, maxBar = 24, gap = 2 } = {}) {
  const plot = { x: pad.left, y: pad.top, w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
  const peak = Math.max(0, ...series.flatMap((m) => [m.income, m.expense]));
  const scale = niceScale(peak);
  const yOf = (v) => plot.y + plot.h - (v / scale.max) * plot.h;
  const colW = plot.w / series.length;
  const barW = Math.max(4, Math.min(maxBar, (colW * 0.7 - gap) / 2));

  const groups = series.map((m, i) => {
    const x0 = plot.x + i * colW;
    const cx = x0 + colW / 2;
    const bar = (kind, value, bx) => {
      const top = yOf(value);
      return { kind, value, x: round(bx), y: round(top), w: round(barW), h: round(plot.y + plot.h - top) };
    };
    return {
      index: i, cx: round(cx), x: round(x0), w: round(colW),
      bars: [bar('income', m.income, cx - gap / 2 - barW), bar('expense', m.expense, cx + gap / 2)],
    };
  });
  return { plot, scale, ticks: scale.ticks.map((value) => ({ value, y: round(yOf(value)) })), groups, barW: round(barW) };
}

const round = (n) => Math.round(n * 100) / 100;

// ---------- rosca (parte do todo) ----------

/**
 * Agrupa categorias para a rosca: até 6 fatias. Com mais de 6, mostra as 5 maiores
 * e junta o resto em "Outros". Entrada ordenada do maior para o menor (spendingByCategory).
 */
export function donutItems(categories, maxSegments = 6) {
  const list = categories.filter((c) => c.total > 0);
  if (list.length <= maxSegments) return list.map((c) => ({ ...c, other: false }));
  const head = list.slice(0, maxSegments - 1);
  const rest = list.slice(maxSegments - 1);
  const total = rest.reduce((s, c) => s + Math.round(c.total * 100), 0) / 100;
  const percent = rest.reduce((s, c) => s + c.percent, 0);
  return [...head.map((c) => ({ ...c, other: false })),
    { categoryId: null, name: 'Outros', icon: '…', total, percent, count: rest.length, other: true }];
}

/**
 * Arcos como círculos com stroke-dasharray (o "respiro" entre fatias é um vão de `gap`
 * unidades, sem contorno). `radius` e `gap` na mesma unidade do viewBox.
 */
export function donutSegments(values, { radius = 46, gap = 2 } = {}) {
  const total = values.reduce((s, v) => s + v, 0);
  const circumference = 2 * Math.PI * radius;
  if (!(total > 0)) return { circumference, segments: [] };
  let start = 0;
  const single = values.filter((v) => v > 0).length === 1; // anel único: sem vão
  const segments = values.map((value) => {
    const length = (value / total) * circumference;
    const visible = single ? circumference : Math.max(0, length - gap);
    const seg = {
      length: round(length),
      dash: `${round(visible)} ${round(circumference - visible)}`,
      offset: round(-(start + (single ? 0 : gap / 2))),
    };
    start += length;
    return seg;
  });
  return { circumference: round(circumference), segments };
}
