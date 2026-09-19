// Helpers de DOM. Todo texto de usuário é escapado por padrão (proteção contra XSS).

class Safe {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Marca um trecho já seguro (ex.: SVG de ícone, resultado de outro `html`). */
export const raw = (value) => new Safe(value);

function render(value) {
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === false || value == null) return '';
  return esc(value);
}

/** Template tag: interpolações são escapadas, exceto Safe/arrays de Safe. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Safe(out);
}

/** Substitui o conteúdo de `el` por HTML seguro. */
export function mount(el, safeHtml) {
  el.innerHTML = safeHtml instanceof Safe ? safeHtml.value : esc(safeHtml);
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Debounce simples (buscas, filtros). */
export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
