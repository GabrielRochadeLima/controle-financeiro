// Detalhe de uma compra parcelada: parcelas com a situação de cada fatura, edição de
// descrição/categoria (vale para todas as parcelas) e exclusão com escolha do impacto.
//
// Regra do banco (delete_installments): parcelas em faturas PAGAS nunca são removidas.
// Aqui só explicamos isso ao usuário antes de ele escolher.
import { html, mount, $ } from '../core/dom.js';
import { formatDate, formatMoney, todayISO } from '../core/format.js';
import { STATUS_LABELS, invoiceStatus } from '../core/cards.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { getCategories, getSubcategories } from '../services/reference.js';
import { deleteInstallments, getCards, loadPlan, updateInstallmentPlan } from '../services/cards.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

const STATUS_BADGE = { paid: 'badge-success', overdue: 'badge-danger', closed: 'badge-warning', open: '' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {{ planId: string, number?: number }} options  number = parcela que o usuário tocou
 */
export async function openPlanDetail({ planId, number = 1 }) {
  let data; let card; let categories; let subcategories;
  try {
    const loaded = await Promise.all([loadPlan(planId), getCards(), getCategories(), getSubcategories()]);
    [data, , categories, subcategories] = loaded;
    card = loaded[1].find((c) => c.id === data.plan.credit_card_id);
  } catch (err) {
    toast.error(friendlyError(err, 'Não foi possível abrir a compra.'));
    return;
  }

  const { plan, parcels } = data;
  const today = todayISO();
  const rows = parcels.map((p) => ({
    ...p, status: invoiceStatus(p.invoice, today),
    locked: Boolean(p.invoice?.paid_at), // fatura paga: não pode ser removida
  }));
  const each = rows.length ? rows[rows.length - 1].amount : 0;

  const { el, close } = openModal({
    title: plan.description,
    body: html`<div id="pd-body"></div>`,
  });
  const body = $('#pd-body', el);
  const done = (message) => { toast.success(message); close(); emitDataChanged(); };

  // ---------- visão principal ----------
  function showMain() {
    mount(body, html`
      <p class="text-secondary">
        ${card?.name ?? 'Cartão'} · ${plan.installments_count}x de ${formatMoney(each)} · total ${formatMoney(plan.total_amount)}
        ${plan.status === 'canceled' && html` <span class="badge badge-danger">Cancelada</span>`}
      </p>
      <div class="modal-actions pd-actions">
        <button type="button" class="btn btn-ghost" id="pd-edit">Editar</button>
        <button type="button" class="btn btn-ghost text-danger" id="pd-delete">Excluir…</button>
      </div>
      <ul class="list pd-list">
        ${rows.map((p) => html`
          <li class="list-item ${p.installment_number === number ? 'pd-current' : ''}">
            <span class="list-item-main">
              <span class="list-item-title">Parcela ${p.installment_number}/${plan.installments_count}</span>
              <span class="list-item-sub">${formatDate(p.date)} · fatura fecha ${formatDate(p.invoice.closing_date)}</span>
            </span>
            <span class="pd-end">
              <span class="money">${formatMoney(p.amount)}</span>
              <span class="badge ${STATUS_BADGE[p.status]}">${STATUS_LABELS[p.status]}</span>
            </span>
          </li>`)}
      </ul>`);
    $('#pd-edit', body).addEventListener('click', showEdit);
    $('#pd-delete', body).addEventListener('click', showDelete);
  }

  // ---------- edição (descrição e categoria valem para todas as parcelas) ----------
  function showEdit() {
    let categoryId = plan.category_id;
    const expenseCats = [...categories.values()].filter((c) => c.kind === 'expense');
    const paint = () => {
      const subs = subcategories.filter((s) => s.category_id === categoryId);
      mount($('#pd-cat', body), html`
        <option value="">Sem categoria</option>
        ${expenseCats.map((c) => html`<option value="${c.id}" ${c.id === categoryId ? 'selected' : ''}>${c.name}</option>`)}`);
      mount($('#pd-sub', body), html`
        <option value="">Sem subcategoria</option>
        ${subs.map((s) => html`<option value="${s.id}" ${s.id === plan.subcategory_id ? 'selected' : ''}>${s.name}</option>`)}`);
    };
    mount(body, html`
      <form class="form" id="pd-form" novalidate>
        <p class="field-hint">Valem para todas as parcelas. Valores e datas não mudam.</p>
        <div class="field">
          <label for="pd-desc">Descrição</label>
          <input class="input" id="pd-desc" maxlength="120" autocomplete="off">
        </div>
        <div class="field"><label for="pd-cat">Categoria</label><select class="select" id="pd-cat"></select></div>
        <div class="field"><label for="pd-sub">Subcategoria</label><select class="select" id="pd-sub"></select></div>
        <div class="form-error" id="pd-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="pd-back">Voltar</button>
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>`);
    $('#pd-desc', body).value = plan.description;
    paint();
    $('#pd-cat', body).addEventListener('change', (e) => { categoryId = e.target.value || null; plan.subcategory_id = null; paint(); });
    $('#pd-back', body).addEventListener('click', showMain);
    $('#pd-form', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = $('button[type="submit"]', body);
      button.classList.add('is-loading'); button.disabled = true;
      try {
        await updateInstallmentPlan(plan.id, {
          description: $('#pd-desc', body).value,
          category_id: categoryId,
          subcategory_id: $('#pd-sub', body).value || null,
        });
        done('Compra atualizada');
      } catch (err) {
        const box = $('#pd-error', body);
        box.textContent = friendlyError(err, 'Não foi possível salvar.');
        box.hidden = false;
        button.classList.remove('is-loading'); button.disabled = false;
      }
    });
  }

  // ---------- exclusão: escolha do impacto ----------
  function showDelete() {
    const deletable = (list) => list.filter((p) => !p.locked);
    const thisOne = rows.find((p) => p.installment_number === number) ?? rows[0];
    const fromHere = rows.filter((p) => p.installment_number >= thisOne.installment_number);
    const future = deletable(fromHere.filter((p) => p.installment_number > thisOne.installment_number));
    const lockedAll = rows.filter((p) => p.locked).length;

    // Só restam parcelas em faturas pagas: não há o que excluir até o pagamento ser desfeito.
    if (deletable(rows).length === 0) {
      mount(body, html`
        <p>Todas as parcelas desta compra estão em faturas pagas e não podem ser excluídas.</p>
        <p class="field-hint">Para excluir, desfaça o pagamento da fatura na tela do cartão.</p>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" id="pd-back">Voltar</button></div>`);
      $('#pd-back', body).addEventListener('click', showMain);
      return;
    }

    mount(body, html`
      <p>${future.length
        ? `Esta compra possui ${plural(future.length, 'parcela futura', 'parcelas futuras')}. O que deseja fazer?`
        : 'O que deseja fazer com esta compra?'}</p>
      <div class="stack">
        ${thisOne.locked
          ? html`<p class="field-hint">A parcela ${thisOne.installment_number} está em uma fatura paga e não pode ser excluída.</p>`
          : html`<button type="button" class="btn btn-ghost btn-block" data-del="one">
              Excluir apenas a parcela ${thisOne.installment_number}/${plan.installments_count}</button>`}
        ${future.length > 0 && html`<button type="button" class="btn btn-ghost btn-block" data-del="from">
          Excluir esta e as próximas (${plural(deletable(fromHere).length, 'parcela', 'parcelas')})</button>`}
        <button type="button" class="btn btn-danger btn-block" data-del="all">
          Excluir toda a compra (${plural(deletable(rows).length, 'parcela', 'parcelas')})</button>
      </div>
      ${lockedAll > 0 && html`<p class="field-hint">${plural(lockedAll, 'parcela já está', 'parcelas já estão')} em fatura paga e será mantida.
        Para removê-la, desfaça o pagamento da fatura antes.</p>`}
      <div class="form-error" id="pd-error" role="alert" hidden></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="pd-back">Cancelar</button></div>`);

    $('#pd-back', body).addEventListener('click', showMain);
    // listener no bloco de botões (recriado a cada visita): o `body` do modal é reaproveitado
    $('.stack', body).addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del]');
      if (!btn) return;
      const choice = btn.dataset.del;
      const from = choice === 'all' ? 1 : thisOne.installment_number;
      btn.disabled = true;
      try {
        const res = await deleteInstallments(plan.id, from, choice === 'one');
        const kept = res.locked ? ` (${plural(res.locked, 'parcela paga mantida', 'parcelas pagas mantidas')})` : '';
        done(`${plural(res.deleted, 'parcela excluída', 'parcelas excluídas')}${kept}`);
      } catch (err) {
        const box = $('#pd-error', body);
        box.textContent = friendlyError(err, 'Não foi possível excluir.');
        box.hidden = false;
        btn.disabled = false;
      }
    });
  }

  showMain();
}
