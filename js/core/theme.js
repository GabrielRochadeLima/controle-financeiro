// Tema claro/escuro/automático. A preferência fica em localStorage.
// O <head> de cada página tem um script inline mínimo que aplica o tema antes
// da primeira pintura (evita flash); aqui fica a lógica para alternar.

const KEY = 'cf-theme'; // 'light' | 'dark' | 'system'
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePreference() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

function resolve(pref) {
  return pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
}

export function applyTheme(pref = getThemePreference()) {
  const theme = resolve(pref);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0e1014' : '#f4f5f7');
  return theme;
}

export function setThemePreference(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* modo privado: segue sem persistir */ }
  return applyTheme(pref);
}

/** Alterna claro <-> escuro (atalho para botões de ícone). */
export function toggleTheme() {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  return setThemePreference(current === 'dark' ? 'light' : 'dark');
}

// Segue o sistema em tempo real quando a preferência é "automático".
media.addEventListener('change', () => {
  if (getThemePreference() === 'system') applyTheme('system');
});

applyTheme();
