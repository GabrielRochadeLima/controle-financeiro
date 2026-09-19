// Navegação: barra inferior (celular) e sidebar (desktop). Uma única lista
// de itens alimenta as duas, para nunca ficarem fora de sincronia.
import { html, mount, raw } from '../core/dom.js';
import { icon } from './icons.js';

// Itens principais: os 4 da barra inferior (o "+" fica no meio).
export const PRIMARY = [
  { path: '/', label: 'Início', icon: 'home' },
  // Rótulo curto: "Movimentações" não cabe em 360px sem quebrar linha na barra inferior.
  { path: '/movimentacoes', label: 'Movimentos', icon: 'list' },
  { path: '/cartoes', label: 'Cartões', icon: 'card' },
  { path: '/mais', label: 'Mais', icon: 'menu', mobileOnly: true },
];

// Itens secundários: ficam no menu "Mais" (celular) e na sidebar (desktop).
export const SECONDARY = [
  { path: '/contas', label: 'Contas', icon: 'wallet' },
  { path: '/categorias', label: 'Categorias', icon: 'tag' },
  { path: '/orcamentos', label: 'Orçamentos', icon: 'pie' },
  { path: '/metas', label: 'Metas', icon: 'target' },
  { path: '/investimentos', label: 'Investimentos', icon: 'trend' },
  { path: '/configuracoes', label: 'Configurações', icon: 'sliders' },
];

const link = (item, cls, path) => html`
  <a class="${cls}" href="#${item.path}" ${item.path === path ? raw('aria-current="page"') : ''}>
    ${icon(item.icon)}<span>${item.label}</span>
  </a>`;

// "Mais" acende também nas telas que ele abriga (contas, metas...).
const isActive = (item, path) =>
  item.path === path || (item.path === '/mais' && SECONDARY.some((s) => s.path === path));

export function renderBottomNav(el, currentPath) {
  const [home, moves, cards, more] = PRIMARY;
  const at = (item) => link(item, 'nav-link', isActive(item, currentPath) ? item.path : null);
  mount(el, html`
    ${at(home)}
    ${at(moves)}
    <div class="nav-add">
      <button type="button" class="nav-add-btn" data-action="new-transaction" aria-label="Nova movimentação">
        ${icon('plus')}
      </button>
    </div>
    ${at(cards)}
    ${at(more)}`);
}

export function renderSidebar(el, currentPath) {
  const items = [...PRIMARY.filter((i) => !i.mobileOnly), ...SECONDARY];
  mount(el, html`
    <div class="sidebar-brand">${icon('wallet')}<span>Financeiro</span></div>
    <button type="button" class="btn btn-primary" data-action="new-transaction">
      ${icon('plus')}<span>Nova movimentação</span>
    </button>
    <nav class="sidebar-nav" aria-label="Principal">
      ${items.map((item) => link(item, 'sidebar-link', currentPath))}
    </nav>`);
}
