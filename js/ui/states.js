// Estados reutilizáveis: vazio, carregando e erro.
import { html } from '../core/dom.js';
import { icon } from './icons.js';

/** Estado vazio com ação opcional: { icon, title, text, actionLabel, actionHref } */
export function emptyState({ iconName = 'info', title, text, actionLabel, actionHref, actionId }) {
  return html`
    <div class="empty">
      <div class="empty-icon">${icon(iconName)}</div>
      <h3>${title}</h3>
      ${text && html`<p>${text}</p>`}
      ${actionLabel && actionHref && html`<a class="btn btn-primary" href="${actionHref}">${actionLabel}</a>`}
      ${actionLabel && !actionHref && html`<button type="button" class="btn btn-primary" id="${actionId}">${actionLabel}</button>`}
    </div>`;
}

/** Esqueleto de carregamento (evita "pulos" de layout enquanto os dados chegam). */
export function loadingState(blocks = 3) {
  return html`
    <div class="page" aria-busy="true" aria-label="Carregando">
      <div class="skeleton skeleton-line" style="width:40%"></div>
      ${Array.from({ length: blocks }, () => html`<div class="skeleton skeleton-block"></div>`)}
    </div>`;
}

export function errorState(message = 'Não foi possível carregar os dados.') {
  return html`
    <div class="card page-error">
      ${emptyState({ iconName: 'alert', title: 'Ops!', text: message, actionLabel: 'Tentar novamente', actionId: 'retry' })}
    </div>`;
}
