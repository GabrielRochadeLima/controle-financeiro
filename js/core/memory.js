// Memória de escolhas frequentes do lançamento rápido (só no aparelho, localStorage).
// Serve para ganhar velocidade: última conta usada vem selecionada e as categorias
// mais usadas aparecem primeiro. Nada disso é dado financeiro.
const KEY = 'cf-quick';

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      type: data.type || 'expense',
      account_id: data.account_id || null,
      to_account_id: data.to_account_id || null,
      usage: data.usage && typeof data.usage === 'object' ? data.usage : {},
    };
  } catch {
    return { type: 'expense', account_id: null, to_account_id: null, usage: {} };
  }
}

export const getMemory = read;

export function remember({ type, account_id, to_account_id, category_id }) {
  const memory = read();
  memory.type = type;
  memory.account_id = account_id;
  if (to_account_id) memory.to_account_id = to_account_id;
  if (category_id) memory.usage[category_id] = (memory.usage[category_id] || 0) + 1;
  try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* sem storage: ignora */ }
}
