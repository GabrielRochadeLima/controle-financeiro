// Chip de escolha rápida (reutilizado no lançamento rápido, pagamento de fatura etc.).
import { html } from '../core/dom.js';

/**
 * @param kind   identifica o grupo (data-chip) para delegação de eventos
 * @param value  valor escolhido (data-value)
 */
export const chip = (kind, value, label, { icon = '', selected = false, cls = '' } = {}) => html`
  <button type="button" class="chip ${cls}" data-chip="${kind}" data-value="${value}"
          aria-pressed="${String(selected)}">
    ${icon && html`<span aria-hidden="true">${icon}</span>`}<span>${label}</span>
  </button>`;
