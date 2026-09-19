// Evento global "os dados mudaram": quem grava (lançamento rápido, formulários)
// avisa; o app inteiro reage (a tela atual recarrega, caches são renovados).
const EVENT = 'cf:data-changed';

export const emitDataChanged = () => document.dispatchEvent(new CustomEvent(EVENT));
export const onDataChanged = (callback) => document.addEventListener(EVENT, callback);
