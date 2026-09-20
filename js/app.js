// Ponto de entrada do app autenticado: guarda de sessão, shell e rotas.
import './core/theme.js';
import { friendlyError, isConfigured } from './core/supabase.js';
import { onSignedOut, requireSession } from './core/auth.js';
import { createRouter } from './core/router.js';
import { $ } from './core/dom.js';
import { renderBottomNav, renderSidebar } from './ui/nav.js';
import { onDataChanged } from './core/events.js';
import { toast } from './ui/toast.js';
import { ensureBootstrapped } from './services/reference.js';

const page = (name) => () => import(`./pages/${name}.js`);
const soon = (key) => () => import('./pages/coming-soon.js').then((m) => m.forRoute(key));

// Cada rota carrega seu módulo sob demanda (nada é baixado antes de precisar).
const routes = {
  '/': page('dashboard'),
  '/mais': page('more'),
  '/configuracoes': page('settings'),
  '/movimentacoes': page('transactions'),
  '/contas': page('accounts'),
  '/categorias': page('categories'),
  '/cartoes': page('cards'),
  '/cartao': page('card'),
  '/orcamentos': soon('orcamentos'),
  '/metas': soon('metas'),
  '/investimentos': soon('investimentos'),
};

async function start() {
  if (!isConfigured) {
    $('#setup-notice').hidden = false;
    $('.app').hidden = true;
    return;
  }
  const session = await requireSession();
  if (!session) return;
  onSignedOut(() => location.replace('login.html'));

  try {
    await ensureBootstrapped(session.user.id);
  } catch (err) {
    toast.error(friendlyError(err, 'Não foi possível preparar sua conta. Recarregue a página.'));
  }

  const outlet = $('#outlet');
  const bottomNav = $('#bottom-nav');
  const sidebar = $('#sidebar');

  const router = createRouter(routes, {
    outlet,
    notFound: '/',
    onChange: (path) => {
      const navPath = path === '/cartao' ? '/cartoes' : path; // detalhe do cartão acende "Cartões"
      renderBottomNav(bottomNav, navPath);
      renderSidebar(sidebar, navPath);
    },
  });

  // Ação global "Nova movimentação" (botão central, sidebar, dashboard e listas).
  // O lançamento rápido só é baixado na primeira vez que é usado.
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="new-transaction"]')) return;
    const { openTransactionForm } = await import('./ui/quick-add.js');
    openTransactionForm();
  });

  // Depois de qualquer gravação, a tela atual é recarregada com os dados novos.
  onDataChanged(() => router.refresh());

  router.start();
}

start();
