// Gráficos do dashboard em SVG puro (sem biblioteca). A matemática está em core/charts.js;
// as cores vêm de tokens CSS (--viz-*), então o tema claro/escuro funciona sem JS extra.
//
// Regras de leitura seguidas: legenda sempre presente; valor exato nunca depende só de
// hover (detalhe por toque/foco + visão em tabela); barras finas com 2px de respiro;
// texto usa cores de texto (o dado é a cor do marcador ao lado, nunca do texto).
import { html } from '../core/dom.js';
import {
  barLayout, closedMonthsAverage, compactMoney, donutItems, donutSegments, monthShort, roundedTopPath,
} from '../core/charts.js';
import { formatMoney, formatMonth, formatPercent } from '../core/format.js';

const slot = (i, other) => (other ? 'viz-other' : `viz-c${i + 1}`);
const monthName = (m) => formatMonth(new Date(m.year, m.month0, 1));
const signed = (v) => `${v < 0 ? '−' : '+'} ${formatMoney(Math.abs(v))}`;

// =====================================================================
// Rosca: gastos do mês por categoria (parte do todo, até 6 fatias)
// =====================================================================

/** @param byCategory saída de spendingByCategory(): maior -> menor. Retorna null sem gastos. */
export function categoryDonut(byCategory) {
  const items = donutItems(byCategory);
  if (!items.length) return null;
  const total = byCategory.reduce((s, c) => s + Math.round(c.total * 100), 0) / 100;
  const { segments } = donutSegments(items.map((i) => i.total), { radius: 46, gap: 2 });
  const summary = items.map((i) => `${i.name} ${formatPercent(i.percent)}`).join(', ');

  return html`
    <div class="donut" data-donut data-total="${formatMoney(total)}">
      <svg class="donut-svg" viewBox="0 0 120 120" role="group" aria-label="Gastos do mês por categoria: ${summary}">
        <g transform="rotate(-90 60 60)" fill="none">
          ${segments.map((s, i) => html`
            <circle class="donut-seg ${slot(i, items[i].other)}" data-seg="${i}" cx="60" cy="60" r="46"
                    stroke-dasharray="${s.dash}" stroke-dashoffset="${s.offset}"></circle>`)}
        </g>
        <text class="donut-label" x="60" y="56" text-anchor="middle" data-donut-label>Despesas do mês</text>
        <text class="donut-value" x="60" y="71" text-anchor="middle" data-donut-value>${formatMoney(total)}</text>
      </svg>

      <ul class="legend-list">
        ${items.map((it, i) => html`
          <li>
            <button type="button" class="legend-row" data-seg="${i}"
                    data-name="${it.name}" data-value="${formatMoney(it.total)}" data-pct="${formatPercent(it.percent)}">
              <span class="dot ${slot(i, it.other)}"></span>
              <span class="legend-name"><span aria-hidden="true">${it.icon}</span> ${it.name}${it.other ? html` <span class="text-secondary">(${it.count})</span>` : ''}</span>
              <span class="legend-value money">${formatMoney(it.total)} <span class="pct">${formatPercent(it.percent)}</span></span>
            </button>
          </li>`)}
      </ul>
    </div>`;
}

/** Interação da rosca: passar o mouse / focar / tocar numa linha destaca a fatia e mostra o valor no centro. */
export function bindDonut(root) {
  const donut = root.querySelector('[data-donut]');
  if (!donut) return;
  const label = donut.querySelector('[data-donut-label]');
  const value = donut.querySelector('[data-donut-value]');
  const rows = [...donut.querySelectorAll('.legend-row')];
  let pinned = null;

  const show = (i) => {
    donut.dataset.active = i ?? '';
    donut.querySelectorAll('.donut-seg').forEach((c) => c.classList.toggle('is-active', c.dataset.seg === String(i)));
    if (i == null) {
      label.textContent = 'Despesas do mês';
      value.textContent = donut.dataset.total;
    } else {
      const row = rows[i];
      label.textContent = row.dataset.name.length > 18 ? `${row.dataset.name.slice(0, 17)}…` : row.dataset.name;
      value.textContent = row.dataset.pct; // no centro cabe o percentual; o valor está na linha da legenda
    }
  };

  donut.addEventListener('pointerover', (e) => {
    const target = e.target.closest('[data-seg]');
    if (target && pinned == null) show(Number(target.dataset.seg));
  });
  donut.addEventListener('pointerout', (e) => { if (pinned == null && e.target.closest('[data-seg]')) show(null); });
  donut.addEventListener('focusin', (e) => { const t = e.target.closest('[data-seg]'); if (t && pinned == null) show(Number(t.dataset.seg)); });
  donut.addEventListener('focusout', () => { if (pinned == null) show(null); });
  // toque (celular): fixa a fatia; tocar de novo solta
  donut.addEventListener('click', (e) => {
    const t = e.target.closest('[data-seg]');
    if (!t) return;
    const i = Number(t.dataset.seg);
    pinned = pinned === i ? null : i;
    show(pinned);
  });
}

// =====================================================================
// Barras: receitas × despesas dos últimos meses
// =====================================================================

const detailHtml = (m) => html`
  <strong>${monthName(m)}${m.partial ? ' (até hoje)' : ''}</strong>
  <span class="detail-item"><i class="dot viz-c1"></i>Receitas <b class="money">${formatMoney(m.income)}</b></span>
  <span class="detail-item"><i class="dot viz-c2"></i>Despesas <b class="money">${formatMoney(m.expense)}</b></span>
  <span class="detail-item">Saldo <b class="money">${signed(m.income - m.expense)}</b></span>`;

/** @param series saída de monthSeries() */
export function monthlyChart(series) {
  if (!series.some((m) => m.income > 0 || m.expense > 0)) {
    return html`<p class="text-secondary chart-empty">Ainda não há receitas ou despesas nos últimos ${series.length} meses.</p>`;
  }
  const W = 340; const H = 200;
  const L = barLayout(series, { width: W, height: H });
  const last = series.length - 1;
  const average = closedMonthsAverage(series);

  return html`
    <div class="mchart" data-mchart>
      <div class="legend-inline" aria-hidden="true">
        <span><i class="dot viz-c1"></i>Receitas</span><span><i class="dot viz-c2"></i>Despesas</span>
      </div>

      <svg class="mchart-svg" viewBox="0 0 ${W} ${H}" role="group"
           aria-label="Receitas e despesas dos últimos ${series.length} meses. Use as colunas para ver o valor de cada mês.">
        ${L.ticks.map((t) => html`
          <line class="${t.value === 0 ? 'mb-axis' : 'mb-grid'}" x1="${L.plot.x}" x2="${L.plot.x + L.plot.w}" y1="${t.y}" y2="${t.y}"></line>
          <text class="mb-tick" x="${L.plot.x - 6}" y="${t.y + 3}" text-anchor="end">${compactMoney(t.value)}</text>`)}

        ${L.groups.map((g) => {
          const m = series[g.index];
          return html`
            <g class="mb-group ${g.index === last ? 'is-selected' : ''}" data-i="${g.index}" tabindex="0" role="button"
               aria-label="${monthName(m)}: receitas ${formatMoney(m.income)}, despesas ${formatMoney(m.expense)}">
              <rect class="mb-sel" x="${g.x + 1}" y="${L.plot.y}" width="${g.w - 2}" height="${L.plot.h}" rx="6"></rect>
              ${g.bars.map((b) => b.h > 0 && html`<path class="mb-bar ${b.kind === 'income' ? 'viz-c1' : 'viz-c2'}" d="${roundedTopPath(b.x, b.y, b.w, b.h, 4)}"></path>`)}
              <text class="mb-x ${m.partial ? 'is-current' : ''}" x="${g.cx}" y="${L.plot.y + L.plot.h + 17}" text-anchor="middle">${monthShort(m.month0)}</text>
              <rect class="mb-hit" x="${g.x}" y="${L.plot.y}" width="${g.w}" height="${H - L.plot.y}"></rect>
            </g>`;
        })}
      </svg>

      <p class="mb-detail" data-detail aria-live="polite">${detailHtml(series[last])}</p>
      ${average && html`<p class="chart-note">Média dos últimos ${average.months} ${average.months === 1 ? 'mês fechado' : 'meses fechados'}:
        receitas ${formatMoney(average.income)} · despesas ${formatMoney(average.expense)}</p>`}

      <details class="viz-table">
        <summary>Ver como tabela</summary>
        <div class="table-scroll">
          <table>
            <thead><tr><th scope="col">Mês</th><th scope="col">Receitas</th><th scope="col">Despesas</th><th scope="col">Saldo</th></tr></thead>
            <tbody>
              ${series.map((m) => html`<tr>
                <th scope="row">${monthShort(m.month0)}/${m.year}${m.partial ? '*' : ''}</th>
                <td class="money">${formatMoney(m.income)}</td><td class="money">${formatMoney(m.expense)}</td>
                <td class="money">${signed(m.income - m.expense)}</td></tr>`)}
            </tbody>
          </table>
        </div>
        <p class="chart-note">* mês em andamento (até hoje).</p>
      </details>
    </div>`;
}

/** Selecionar um mês (mouse, toque ou teclado) atualiza a linha de detalhe. */
export function bindMonthly(root, series) {
  const chart = root.querySelector('[data-mchart]');
  if (!chart) return;
  const detail = chart.querySelector('[data-detail]');
  const groups = [...chart.querySelectorAll('.mb-group')];
  const select = (i) => {
    groups.forEach((g) => g.classList.toggle('is-selected', Number(g.dataset.i) === i));
    detail.innerHTML = detailHtml(series[i]).value;
  };
  groups.forEach((g) => {
    const i = Number(g.dataset.i);
    g.addEventListener('pointerenter', () => select(i));
    g.addEventListener('focus', () => select(i));
    g.addEventListener('click', () => select(i));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); }
      if (e.key === 'ArrowRight' && groups[i + 1]) groups[i + 1].focus();
      if (e.key === 'ArrowLeft' && groups[i - 1]) groups[i - 1].focus();
    });
  });
}

