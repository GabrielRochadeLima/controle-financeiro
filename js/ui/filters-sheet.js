// Folha de filtros de Movimentações: origem (conta/cartão), categoria, valor e período.
import { html, mount, $ } from '../core/dom.js';
import { parseMoney } from '../core/format.js';
import { NO_CATEGORY, emptyFilters, validateFilters } from '../core/filters.js';
import { openModal } from './modal.js';

const moneyText = (v) => (v == null ? '' : String(v).replace('.', ','));

/**
 * @param {{ filters: object, ref: { accounts, cards, categories: Map, subcategories }, onApply: (f) => void }} options
 */
export function openFiltersSheet({ filters, ref, onApply }) {
  const { accounts, cards, categories, subcategories } = ref;
  const catList = [...categories.values()];
  const expenseCats = catList.filter((c) => c.kind === 'expense');
  const incomeCats = catList.filter((c) => c.kind === 'income');

  const { el, close } = openModal({
    title: 'Filtros',
    body: html`
      <form class="form" id="filters-form" novalidate>
        <div class="field">
          <label for="f-source">Conta ou cartão</label>
          <select class="select" id="f-source">
            <option value="">Todas as contas e cartões</option>
            ${accounts.length > 0 && html`<optgroup label="Contas">
              ${accounts.map((a) => html`<option value="a:${a.id}">${a.name}${a.status === 'archived' ? ' (arquivada)' : ''}</option>`)}
            </optgroup>`}
            ${cards.length > 0 && html`<optgroup label="Cartões">
              ${cards.map((c) => html`<option value="c:${c.id}">${c.name}${c.status === 'archived' ? ' (arquivado)' : ''}</option>`)}
            </optgroup>`}
          </select>
        </div>

        <div class="field">
          <label for="f-cat">Categoria</label>
          <select class="select" id="f-cat">
            <option value="">Todas</option>
            <option value="${NO_CATEGORY}">Sem categoria</option>
            ${expenseCats.length > 0 && html`<optgroup label="Despesas">
              ${expenseCats.map((c) => html`<option value="${c.id}">${c.icon ?? ''} ${c.name}</option>`)}</optgroup>`}
            ${incomeCats.length > 0 && html`<optgroup label="Receitas">
              ${incomeCats.map((c) => html`<option value="${c.id}">${c.icon ?? ''} ${c.name}</option>`)}</optgroup>`}
          </select>
        </div>
        <div class="field" id="f-sub-wrap" hidden>
          <label for="f-sub">Subcategoria</label>
          <select class="select" id="f-sub"></select>
        </div>

        <div class="field">
          <span class="field-label">Valor</span>
          <div class="field-row">
            <input class="input" id="f-min" inputmode="decimal" placeholder="Mínimo" aria-label="Valor mínimo" autocomplete="off">
            <input class="input" id="f-max" inputmode="decimal" placeholder="Máximo" aria-label="Valor máximo" autocomplete="off">
          </div>
        </div>

        <div class="field">
          <span class="field-label">Período personalizado</span>
          <div class="field-row">
            <input class="input" type="date" id="f-from" aria-label="De">
            <input class="input" type="date" id="f-to" aria-label="Até">
          </div>
          <span class="field-hint">Em branco, vale o mês escolhido na tela.</span>
        </div>

        <div class="form-error" id="f-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="f-clear">Limpar tudo</button>
          <button type="submit" class="btn btn-primary">Aplicar</button>
        </div>
      </form>`,
  });

  const paintSubs = (categoryId, selected) => {
    const subs = subcategories.filter((s) => s.category_id === categoryId);
    $('#f-sub-wrap', el).hidden = subs.length === 0;
    mount($('#f-sub', el), html`<option value="">Todas</option>${subs.map((s) =>
      html`<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${s.name}</option>`)}`);
  };

  // estado inicial
  $('#f-source', el).value = filters.source;
  $('#f-cat', el).value = filters.categoryId;
  paintSubs(filters.categoryId, filters.subcategoryId);
  $('#f-min', el).value = moneyText(filters.min);
  $('#f-max', el).value = moneyText(filters.max);
  $('#f-from', el).value = filters.from ?? '';
  $('#f-to', el).value = filters.to ?? '';

  $('#f-cat', el).addEventListener('change', (e) => paintSubs(e.target.value, ''));

  $('#f-clear', el).addEventListener('click', () => { onApply(emptyFilters()); close(); });

  $('#filters-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const read = (id) => $(id, el).value.trim();
    const parse = (text) => (text === '' ? null : parseMoney(text));
    const result = validateFilters({
      source: read('#f-source'),
      categoryId: read('#f-cat'),
      subcategoryId: $('#f-sub-wrap', el).hidden ? '' : read('#f-sub'),
      min: parse(read('#f-min')),
      max: parse(read('#f-max')),
      from: read('#f-from') || null,
      to: read('#f-to') || null,
    });
    if (!result.ok) {
      const box = $('#f-error', el);
      box.textContent = Object.values(result.errors)[0];
      box.hidden = false;
      return;
    }
    onApply(result.value);
    close();
  });
}
