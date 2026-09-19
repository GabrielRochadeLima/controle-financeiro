// Aplica o tema antes da primeira pintura (evita flash claro -> escuro).
// Fica em arquivo próprio e SÍNCRONO (sem type="module") para que a CSP possa
// proibir scripts inline. A lógica completa de troca de tema está em core/theme.js.
try {
  var pref = localStorage.getItem('cf-theme') || 'system';
  var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) { /* localStorage indisponível: fica no tema claro */ }
