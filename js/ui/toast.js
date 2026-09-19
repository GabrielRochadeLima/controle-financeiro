// Toast: feedback rápido que some sozinho.
import { esc } from '../core/dom.js';
import { icon } from './icons.js';

const DURATION = 2800;
let region;

function getRegion() {
  if (!region || !region.isConnected) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  return region;
}

function show(message, kind, iconName) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${icon(iconName)}<span>${esc(message)}</span>`;
  getRegion().append(el);

  const dismiss = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  };
  el.addEventListener('click', dismiss);
  setTimeout(dismiss, kind === 'error' ? DURATION * 1.6 : DURATION);
}

export const toast = {
  success: (message) => show(message, 'success', 'check'),
  error: (message) => show(message, 'error', 'alert'),
  info: (message) => show(message, 'info', 'info'),
};
