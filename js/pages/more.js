// Menu "Mais" (celular): atalhos para as áreas que não cabem na barra inferior.
import { html, mount } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { SECONDARY } from '../ui/nav.js';

export function mountPage(outlet) {
  mount(outlet, html`
    <div class="page">
      <header class="page-header"><h1>Mais</h1></header>
      <div class="card card-flat">
        <ul class="list menu-list">
          ${SECONDARY.map((item) => html`
            <li>
              <a class="list-item" href="#${item.path}">
                <span class="icon-lead">${icon(item.icon)}</span>
                <span class="list-item-main"><span class="list-item-title">${item.label}</span></span>
                ${icon('chevron', 'chevron')}
              </a>
            </li>`)}
        </ul>
      </div>
    </div>`);
}

export { mountPage as mount };
