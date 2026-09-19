// Roteador por hash (#/rota). Funciona em qualquer hospedagem estática, sem
// configuração de servidor, e cada página é carregada só quando visitada.

/**
 * @param {Object<string, () => Promise<{mount: Function}>>} routes  mapa rota -> import dinâmico
 * @param {{ outlet: HTMLElement, notFound: string, onChange?: (path: string) => void }} options
 */
export function createRouter(routes, { outlet, notFound = '/', onChange }) {
  let token = 0; // descarta renderizações antigas se o usuário navegar rápido

  const currentPath = () => {
    const path = location.hash.replace(/^#/, '') || '/';
    return path.split('?')[0];
  };

  async function render() {
    const path = currentPath();
    const load = routes[path];
    if (!load) { location.replace(`#${notFound}`); return; }

    const mine = ++token;
    onChange?.(path);
    try {
      const page = await load();
      if (mine !== token) return;
      outlet.replaceChildren();
      await page.mount(outlet);
      window.scrollTo(0, 0);
      outlet.focus({ preventScroll: true });
    } catch (err) {
      if (mine !== token) return;
      console.error('[router]', err);
      outlet.innerHTML = '<div class="empty"><h3>Não foi possível abrir esta página</h3><p>Recarregue e tente novamente.</p></div>';
    }
  }

  window.addEventListener('hashchange', render);
  return { start: render, refresh: render, path: currentPath };
}
