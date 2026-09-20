// Tela honesta para módulos de fases futuras: diz o que virá e quando,
// sem simular funcionalidade que ainda não existe.
import { html, mount } from '../core/dom.js';
import { emptyState } from '../ui/states.js';

const MODULES = {
  orcamentos: { title: 'Orçamentos', phase: 4, icon: 'pie', text: 'Defina limites mensais por categoria e acompanhe o consumo.' },
  metas: { title: 'Metas', phase: 5, icon: 'target', text: 'Objetivos financeiros com contribuições e progresso.' },
  investimentos: { title: 'Investimentos', phase: 5, icon: 'trend', text: 'Registro dos valores investidos.' },
};

export function forRoute(key) {
  const m = MODULES[key];
  return {
    mount(outlet) {
      mount(outlet, html`
        <div class="page">
          <header class="page-header"><h1>${m.title}</h1></header>
          <div class="card">${emptyState({
            iconName: m.icon,
            title: `Em breve — Fase ${m.phase}`,
            text: m.text,
          })}</div>
        </div>`);
    },
  };
}
