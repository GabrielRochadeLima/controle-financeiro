// Categorias e subcategorias: criar, editar e excluir (nada fixo no código).
import { html, mount, $, $$ } from '../core/dom.js';
import { validateCategory } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import {
  countUsage, createCategory, createSubcategory, deleteCategory, deleteSubcategory,
  loadCategoryTree, updateCategory, updateSubcategory,
} from '../services/categories.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { emptyState, errorState, loadingState } from '../ui/states.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const COLORS = ['#F97316', '#EF4444', '#EC4899', '#8B5CF6', '#6366F1', '#0EA5E9', '#14B8A6', '#16A34A', '#F59E0B', '#64748B'];
const EMOJIS = ['🍽️', '🛒', '🚗', '🏠', '💊', '🎮', '📚', '🔁', '🛍️', '📦', '💰', '💼', '📈', '✈️', '🎁', '🐶', '👕', '💡', '📱', '☕', '🏋️', '🎬'];

// Aba selecionada persiste enquanto o app está aberto (a tela recarrega após cada salvamento).
const view = { kind: 'expense' };

const subCount = (map, id) => {
  const n = (map.get(id) || []).length;
  return `${n} ${n === 1 ? 'subcategoria' : 'subcategorias'}`;
};

const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : 'var(--primary)');

function categoriesView({ categories, subsByCategory }) {
  const list = categories.filter((c) => c.kind === view.kind);
  return html`
    <div class="page">
      <header class="page-header">
        <h1>Categorias</h1>
        <button type="button" class="btn btn-primary btn-sm" id="new-category">${icon('plus')}<span>Nova</span></button>
      </header>

      <div class="segmented" role="tablist" aria-label="Tipo de categoria">
        <button type="button" role="tab" data-kind="expense" aria-selected="${String(view.kind === 'expense')}">Despesas</button>
        <button type="button" role="tab" data-kind="income" aria-selected="${String(view.kind === 'income')}">Receitas</button>
      </div>

      ${list.length ? html`
        <div class="section">${list.map((c) => html`
          <div class="card card-flat cat-card">
            <button type="button" class="cat-card-head" data-edit-category="${c.id}">
              <span class="avatar" style="background:${safeColor(c.color)}22">${c.icon || '📦'}</span>
              <span class="list-item-main">
                <span class="list-item-title">${c.name}</span>
                <span class="list-item-sub">${subCount(subsByCategory, c.id)}</span>
              </span>
              <span class="cat-dot" style="--dot:${safeColor(c.color)}"></span>
            </button>
            <div class="chips">
              ${(subsByCategory.get(c.id) || []).map((s) => html`
                <button type="button" class="chip chip-sub" data-edit-sub="${s.id}" data-cat="${c.id}">${s.name}</button>`)}
              <button type="button" class="chip chip-sub chip-add" data-new-sub="${c.id}">+ Subcategoria</button>
            </div>
          </div>`)}
        </div>`
        : html`<div class="card">${emptyState({
          iconName: 'tag', title: 'Nenhuma categoria',
          text: 'Crie categorias para organizar seus gastos e receitas.',
          actionLabel: 'Criar categoria', actionId: 'empty-new-category',
        })}</div>`}
    </div>`;
}

/** Formulário de categoria (criar/editar). */
function openCategoryForm(category, data) {
  const isEdit = Boolean(category);
  let color = category?.color ?? COLORS[0];
  let emoji = category?.icon ?? EMOJIS[0];

  const { el, close } = openModal({
    title: isEdit ? 'Editar categoria' : 'Nova categoria',
    body: html`
      <form class="form" id="cat-form" novalidate>
        <div class="field">
          <label for="cat-name">Nome</label>
          <input class="input" id="cat-name" maxlength="60" autocomplete="off" placeholder="Ex.: Mercado">
        </div>
        <div class="field"><label>Ícone</label><div class="emoji-grid" id="cat-emojis"></div></div>
        <div class="field"><label>Cor</label><div class="swatches" id="cat-colors"></div></div>
        <div class="form-error" id="cat-error" role="alert" hidden></div>
        <div class="modal-actions">
          ${isEdit && html`<button type="button" class="btn btn-ghost text-danger" id="cat-delete">Excluir</button>`}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>`,
  });

  const error = $('#cat-error', el);
  const showError = (m) => { error.textContent = m; error.hidden = false; };
  const paint = () => {
    mount($('#cat-emojis', el), html`${EMOJIS.map((e) => html`
      <button type="button" class="emoji-btn" data-emoji="${e}" aria-pressed="${String(e === emoji)}">${e}</button>`)}`);
    mount($('#cat-colors', el), html`${COLORS.map((c) => html`
      <button type="button" class="swatch" style="--swatch:${c}" data-color="${c}" aria-label="Cor ${c}"
              aria-pressed="${String(c === color)}"></button>`)}`);
  };
  paint();
  $('#cat-name', el).value = category?.name ?? '';
  if (!isEdit) $('#cat-name', el).focus();

  el.addEventListener('click', (e) => {
    const emojiBtn = e.target.closest('[data-emoji]');
    const colorBtn = e.target.closest('[data-color]');
    if (emojiBtn) { emoji = emojiBtn.dataset.emoji; paint(); }
    if (colorBtn) { color = colorBtn.dataset.color; paint(); }
  });

  $('#cat-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const siblings = data.categories.filter((c) => c.kind === (category?.kind ?? view.kind));
    const result = validateCategory({ name: $('#cat-name', el).value, color }, siblings, category?.id);
    if (!result.ok) { showError(Object.values(result.errors)[0]); return; }

    const button = $('button[type="submit"]', el);
    button.classList.add('is-loading'); button.disabled = true;
    try {
      const value = { name: result.value.name, color, icon: emoji };
      if (isEdit) await updateCategory(category.id, value);
      else {
        const nextOrder = Math.max(-1, ...siblings.map((c) => c.sort_order)) + 1;
        await createCategory({ ...value, kind: view.kind }, nextOrder);
      }
      toast.success(isEdit ? 'Categoria atualizada' : 'Categoria criada');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível salvar a categoria.'));
      button.classList.remove('is-loading'); button.disabled = false;
    }
  });

  $('#cat-delete', el)?.addEventListener('click', async () => {
    try {
      const used = await countUsage('category_id', category.id);
      const subs = (data.subsByCategory.get(category.id) || []).length;
      const impact = [
        used ? `${used} movimentação(ões) ficarão sem categoria` : null,
        subs ? `${subs} subcategoria(s) serão excluídas` : null,
        'o orçamento desta categoria, se houver, será removido',
      ].filter(Boolean).join('; ');
      const confirmed = await confirmDialog({
        title: `Excluir "${category.name}"?`,
        message: `Ao excluir: ${impact}. Essa ação não pode ser desfeita.`,
        confirmLabel: 'Excluir', danger: true,
      });
      if (!confirmed) return;
      await deleteCategory(category.id);
      toast.success('Categoria excluída');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível excluir a categoria.'));
    }
  });
}

/** Formulário de subcategoria (criar/editar). */
function openSubcategoryForm({ sub, category, data }) {
  const isEdit = Boolean(sub);
  const siblings = data.subsByCategory.get(category.id) || [];
  const { el, close } = openModal({
    title: isEdit ? 'Editar subcategoria' : `Nova subcategoria em ${category.name}`,
    body: html`
      <form class="form" id="sub-form" novalidate>
        <div class="field">
          <label for="sub-name">Nome</label>
          <input class="input" id="sub-name" maxlength="60" autocomplete="off" placeholder="Ex.: Restaurante">
        </div>
        <div class="form-error" id="sub-error" role="alert" hidden></div>
        <div class="modal-actions">
          ${isEdit && html`<button type="button" class="btn btn-ghost text-danger" id="sub-delete">Excluir</button>`}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>`,
  });
  const error = $('#sub-error', el);
  const showError = (m) => { error.textContent = m; error.hidden = false; };
  $('#sub-name', el).value = sub?.name ?? '';
  if (!isEdit) $('#sub-name', el).focus();

  $('#sub-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = validateCategory({ name: $('#sub-name', el).value }, siblings, sub?.id);
    if (!result.ok) { showError(Object.values(result.errors)[0]); return; }
    const button = $('button[type="submit"]', el);
    button.classList.add('is-loading'); button.disabled = true;
    try {
      if (isEdit) await updateSubcategory(sub.id, result.value.name);
      else await createSubcategory(category.id, result.value.name, Math.max(-1, ...siblings.map((s) => s.sort_order)) + 1);
      toast.success(isEdit ? 'Subcategoria atualizada' : 'Subcategoria criada');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível salvar a subcategoria.'));
      button.classList.remove('is-loading'); button.disabled = false;
    }
  });

  $('#sub-delete', el)?.addEventListener('click', async () => {
    try {
      const used = await countUsage('subcategory_id', sub.id);
      const confirmed = await confirmDialog({
        title: `Excluir "${sub.name}"?`,
        message: used
          ? `${used} movimentação(ões) continuarão na categoria "${category.name}", sem subcategoria.`
          : 'Essa ação não pode ser desfeita.',
        confirmLabel: 'Excluir', danger: true,
      });
      if (!confirmed) return;
      await deleteSubcategory(sub.id);
      toast.success('Subcategoria excluída');
      close();
      emitDataChanged();
    } catch (err) {
      showError(friendlyError(err, 'Não foi possível excluir a subcategoria.'));
    }
  });
}

export async function mountPage(outlet) {
  mount(outlet, loadingState(3));
  let data;
  try {
    data = await loadCategoryTree();
  } catch (err) {
    console.error('[categorias]', err);
    mount(outlet, html`<div class="page">${errorState()}</div>`);
    $('#retry', outlet)?.addEventListener('click', () => mountPage(outlet));
    return;
  }

  const byId = (id) => data.categories.find((c) => c.id === id);

  // Redesenha a tela e reata os eventos. Os listeners ficam em elementos DENTRO
  // do outlet (que é recriado a cada render); o outlet em si é compartilhado
  // entre todas as rotas e nunca deve receber listeners.
  function render() {
    mount(outlet, categoriesView(data));
    const page = outlet.firstElementChild;

    const create = () => openCategoryForm(null, data);
    $('#new-category', page).addEventListener('click', create);
    $('#empty-new-category', page)?.addEventListener('click', create);

    $$('[data-kind]', page).forEach((btn) => btn.addEventListener('click', () => {
      view.kind = btn.dataset.kind;
      render();
    }));

    page.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit-category]');
      const newSub = e.target.closest('[data-new-sub]');
      const editSub = e.target.closest('[data-edit-sub]');
      if (edit) openCategoryForm(byId(edit.dataset.editCategory), data);
      else if (newSub) openSubcategoryForm({ category: byId(newSub.dataset.newSub), data });
      else if (editSub) {
        const category = byId(editSub.dataset.cat);
        const sub = (data.subsByCategory.get(category.id) || []).find((s) => s.id === editSub.dataset.editSub);
        openSubcategoryForm({ sub, category, data });
      }
    });
  }
  render();
}

export { mountPage as mount };
