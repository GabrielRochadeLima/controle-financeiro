// Modal baseado em <dialog>: foco preso, Esc e clique fora fecham, sem dependências.
// No celular vira bottom sheet (ver css/components.css).
import { html, mount } from '../core/dom.js';
import { icon } from './icons.js';

/**
 * Abre um modal.
 * @param {{ title: string, body: import('../core/dom.js').Safe, onClose?: () => void }} options
 * @returns {{ el: HTMLDialogElement, close: () => void }}
 */
export function openModal({ title, body, onClose }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  mount(dialog, html`
    <div class="modal-head">
      <h2>${title}</h2>
      <button type="button" class="btn btn-icon" data-close aria-label="Fechar">${icon('x')}</button>
    </div>
    <div class="modal-body">${body}</div>`);

  document.body.append(dialog);

  // A limpeza é síncrona em close(): não depende do evento "close" (assíncrono).
  // O evento continua ligado para os fechamentos nativos (tecla Esc).
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    dialog.remove();
    onClose?.();
  };
  const close = () => {
    if (dialog.open) dialog.close();
    finish();
  };

  dialog.addEventListener('click', (e) => {
    // clique no backdrop (o próprio <dialog>) ou no botão de fechar
    if (e.target === dialog || e.target.closest('[data-close]')) close();
  });
  dialog.addEventListener('close', finish);

  dialog.showModal();
  return { el: dialog, close };
}

/**
 * Diálogo de confirmação para ações destrutivas. Resolve com true (confirmou)
 * ou false (cancelou, Esc ou clique fora). Para escolhas com mais de duas
 * opções (ex.: excluir parcela / futuras / toda a compra) usar openModal.
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
}) {
  return new Promise((resolve) => {
    let answer = false;
    const { el, close } = openModal({
      title,
      body: html`
        <p class="text-secondary">${message}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-answer="no">${cancelLabel}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes">
            ${confirmLabel}
          </button>
        </div>`,
      onClose: () => resolve(answer),
    });
    el.querySelector('[data-answer="yes"]').addEventListener('click', () => { answer = true; close(); });
    el.querySelector('[data-answer="no"]').addEventListener('click', close);
    el.querySelector('[data-answer="no"]').focus();
  });
}
