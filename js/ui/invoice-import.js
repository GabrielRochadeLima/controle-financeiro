// Importar fatura de cartão (PDF): escolhe o cartão e o arquivo, lê no navegador, mostra uma
// tela de REVISÃO (nada é gravado antes de confirmar) e grava as compras marcadas de uma vez.
// As regras de leitura moram em core/invoice-import.js; aqui só há tela e orquestração.
import { html, mount, $ } from '../core/dom.js';
import { formatDate, formatMoney, todayISO } from '../core/format.js';
import { addDays, addMonths, invoiceFor } from '../core/cards.js';
import {
  BANKS, buildCategoryMemory, normalizeDescription, parseInvoice, placeInWindow, suggestCategory,
} from '../core/invoice-import.js';
import { isValidISODate } from '../core/validation.js';
import { emitDataChanged } from '../core/events.js';
import { friendlyError } from '../core/supabase.js';
import { getCategories } from '../services/reference.js';
import { getCards } from '../services/cards.js';
import {
  findImportedIds, findInvoice, importCardLines, loadCategoryHistory, readPdfLines,
} from '../services/invoice-import.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

const KIND_NOTE = { payment: 'Pagamento (não é compra)', credit: 'Estorno ou crédito (não importa)' };
const cents = (v) => Math.round(v * 100);

/** @param {{ presetCardId?: string|null }} options */
export async function openInvoiceImport({ presetCardId = null } = {}) {
  let cards; let categories;
  try {
    [cards, categories] = await Promise.all([getCards(), getCategories()]);
  } catch (err) {
    toast.error(friendlyError(err, 'Não foi possível abrir a importação.'));
    return;
  }
  const activeCards = cards.filter((c) => c.status === 'active');
  const expenseCats = [...categories.values()].filter((c) => c.kind === 'expense').sort((a, b) => a.sort_order - b.sort_order);

  const { el, close } = openModal({
    title: 'Importar fatura (PDF)',
    body: html`<div id="ii"></div>`,
  });
  const box = $('#ii', el);

  if (!activeCards.length) {
    mount(box, html`<p class="text-secondary">Cadastre um cartão primeiro: a fatura importada precisa de um cartão.</p>
      <div class="modal-actions"><a class="btn btn-primary" href="#/cartoes" id="ii-go">Ir para Cartões</a></div>`);
    $('#ii-go', box).addEventListener('click', close);
    return;
  }

  // ---------------- etapa 1: cartão + arquivo ----------------
  function stepFile(message = '', needPassword = false) {
    mount(box, html`
      <form class="form" id="ii-form" novalidate>
        <div class="field">
          <label for="ii-card">Cartão desta fatura</label>
          <select class="select" id="ii-card">
            ${activeCards.map((c) => html`<option value="${c.id}">${c.name}</option>`)}
          </select>
        </div>
        <div class="field">
          <label for="ii-file">Arquivo PDF da fatura</label>
          <input class="input" type="file" id="ii-file" accept="application/pdf,.pdf">
          <span class="field-hint">O arquivo é lido aqui no seu aparelho e não é enviado a nenhum servidor.
            Funciona com Nubank e Mercado Pago; outros bancos usam um leitor genérico que você revisa.</span>
        </div>
        ${needPassword && html`
          <div class="field">
            <label for="ii-pass">Senha do PDF</label>
            <input class="input" type="password" id="ii-pass" autocomplete="off">
          </div>`}
        <div class="form-error" id="ii-error" role="alert" ${message ? '' : 'hidden'}>${message}</div>
        <div class="modal-actions"><button type="submit" class="btn btn-primary" id="ii-read">Ler fatura</button></div>
      </form>`);
    const select = $('#ii-card', box);
    if (presetCardId && activeCards.some((c) => c.id === presetCardId)) select.value = presetCardId;

    $('#ii-form', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = $('#ii-file', box).files[0];
      const error = $('#ii-error', box);
      if (!file) { error.textContent = 'Escolha o arquivo PDF da fatura.'; error.hidden = false; return; }
      const button = $('#ii-read', box);
      button.classList.add('is-loading'); button.disabled = true;
      const cardId = select.value;
      try {
        const lines = await readPdfLines(file, $('#ii-pass', box)?.value ?? '');
        const parsed = parseInvoice(lines, { today: todayISO() });
        await stepReview(cardId, parsed);
      } catch (err) {
        if (err.code === 'password' || err.code === 'wrong_password') {
          stepFile(err.code === 'wrong_password' ? 'Senha incorreta.' : 'Este PDF é protegido por senha. Informe a senha.', true);
          return;
        }
        const text = err.code === 'too_big' ? 'Arquivo muito grande (máximo 15 MB).'
          : err.code === 'invalid' ? 'Não consegui abrir este PDF. Confira se é a fatura em PDF.'
            : friendlyError(err, 'Não foi possível ler a fatura.');
        stepFile(text);
      }
    });
  }

  // ---------------- etapa 2: revisão ----------------
  async function stepReview(cardId, parsed) {
    const card = cards.find((c) => c.id === cardId);
    const [history, importedIds] = await Promise.all([
      loadCategoryHistory().catch(() => []),
      findImportedIds(parsed.lines.map((l) => l.external_id)).catch(() => new Set()),
    ]);
    const memory = buildCategoryMemory(history);

    // Datas da fatura: as do PDF; se faltarem, as regras do cartão a partir da compra mais recente.
    const latest = parsed.lines.map((l) => l.printed_date).sort().pop() ?? todayISO();
    const fallback = invoiceFor(card, latest);
    const win = {
      closing: parsed.closing_date ?? fallback.closing_date,
      due: parsed.due_date ?? fallback.due_date,
      start: parsed.period_start ?? fallback.period_start,
    };

    const rows = parsed.lines.map((line) => {
      const imported = importedIds.has(line.external_id);
      const importable = line.kind === 'purchase' && !imported;
      const hint = importable ? suggestCategory(line.description, memory) : null;
      return {
        line,
        importable,
        selected: importable,
        note: imported ? 'Já importada' : KIND_NOTE[line.kind] ?? null,
        description: line.description,
        category_id: hint && categories.has(hint.category_id) ? hint.category_id : '',
        subcategory_id: hint?.subcategory_id ?? null,
        date: line.date,
      };
    });

    mount(box, html`
      <div class="imp">
        <p class="text-secondary">
          ${BANKS[parsed.bank]} · ${card.name} · ${parsed.lines.filter((l) => l.kind === 'purchase').length} compras encontradas.
          Confira e ajuste antes de importar.
        </p>
        ${parsed.warnings.length > 0 && html`<div class="form-error">${parsed.warnings.join(' ')}</div>`}
        <div class="field-row">
          <div class="field"><label for="ii-closing">Fechamento</label>
            <input class="input" type="date" id="ii-closing" value="${win.closing}"></div>
          <div class="field"><label for="ii-due">Vencimento</label>
            <input class="input" type="date" id="ii-due" value="${win.due}"></div>
        </div>
        <p class="field-hint" id="ii-invoice-note"></p>
        <ul class="imp-list">${rows.map((r, i) => html`
          <li class="imp-row ${r.importable ? '' : 'is-off'}" data-i="${i}" data-key="${normalizeDescription(r.line.merchant)}">
            <input type="checkbox" class="imp-check" data-sel aria-label="Importar" ${r.selected && html`checked`} ${!r.importable && html`disabled`}>
            <div class="imp-main">
              <input class="input imp-desc" data-desc maxlength="120" aria-label="Descrição" value="${r.description}" ${!r.importable && html`disabled`}>
              <div class="imp-meta">
                <span data-date>${formatDate(r.date)}</span>
                ${r.line.card_mask && html`<span>•••• ${r.line.card_mask}</span>`}
                ${r.note && html`<span class="badge">${r.note}</span>`}
              </div>
              ${r.importable && html`
                <select class="select imp-cat" data-cat aria-label="Categoria">
                  <option value="">Sem categoria</option>
                  ${expenseCats.map((c) => html`<option value="${c.id}" ${c.id === r.category_id && html`selected`}>${c.icon ?? ''} ${c.name}</option>`)}
                </select>`}
            </div>
            <strong class="imp-amount money">${formatMoney(r.line.amount)}</strong>
          </li>`)}
        </ul>
        <div class="imp-summary" id="ii-summary" aria-live="polite"></div>
        <div class="form-error" id="ii-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="ii-back">Voltar</button>
          <button type="button" class="btn btn-primary" id="ii-import">Importar</button>
        </div>
      </div>`);

    const list = $('.imp-list', box);
    const importButton = $('#ii-import', box);
    const errorBox = $('#ii-error', box);
    let invoiceBlocked = false;

    function summary() {
      const picked = rows.filter((r) => r.selected);
      const sum = picked.reduce((s, r) => s + cents(r.line.amount), 0) / 100;
      const before = rows.filter((r) => r.note === 'Já importada').reduce((s, r) => s + cents(r.line.amount), 0) / 100;
      const diff = parsed.total != null ? Math.round((sum + before - parsed.total) * 100) / 100 : null;
      mount($('#ii-summary', box), html`
        <span><strong>${picked.length}</strong> selecionadas · <strong class="money">${formatMoney(sum)}</strong>
          ${before > 0 && html`<span class="text-secondary"> + ${formatMoney(before)} já importadas</span>`}</span>
        ${parsed.total != null && html`<span class="${diff === 0 ? 'text-success' : 'text-danger'}">
          Total no PDF: ${formatMoney(parsed.total)}${diff === 0 ? ' · confere' : ` · diferença de ${formatMoney(Math.abs(diff))}`}</span>`}`);
      importButton.textContent = picked.length ? `Importar ${picked.length} ${picked.length === 1 ? 'compra' : 'compras'}` : 'Importar';
      importButton.disabled = picked.length === 0 || invoiceBlocked;
    }

    function readWindow() {
      const closing = $('#ii-closing', box).value;
      const due = $('#ii-due', box).value;
      if (!isValidISODate(closing) || !isValidISODate(due)) return null;
      // O ciclo começa no dia seguinte ao fechamento anterior (mesma regra do app).
      const start = closing === win.closing && win.start ? win.start : addDays(addMonths(closing, -1), 1);
      return { period_start: start, closing_date: closing, due_date: due };
    }

    async function refreshInvoice() {
      const w = readWindow();
      const note = $('#ii-invoice-note', box);
      invoiceBlocked = false;
      if (!w) { note.textContent = 'Informe as datas de fechamento e vencimento.'; invoiceBlocked = true; summary(); return; }
      rows.forEach((r) => { r.date = placeInWindow(r.line.printed_date, w.period_start, w.closing_date); });
      list.querySelectorAll('.imp-row').forEach((li, i) => { li.querySelector('[data-date]').textContent = formatDate(rows[i].date); });
      try {
        const existing = await findInvoice(cardId, w.closing_date);
        if (existing?.paid_at) {
          note.textContent = 'Esta fatura já foi paga e não aceita novas compras. Desfaça o pagamento no cartão para importar.';
          invoiceBlocked = true;
        } else if (existing && Number(existing.purchases_count) > 0) {
          note.textContent = `Esta fatura já tem ${existing.purchases_count} compras (${formatMoney(existing.total_amount)}). `
            + 'Compras iguais que você lançou à mão podem ficar duplicadas: desmarque-as aqui.';
        } else note.textContent = `Fatura que fecha em ${formatDate(w.closing_date)} e vence em ${formatDate(w.due_date)}.`;
      } catch { note.textContent = ''; }
      summary();
    }

    list.addEventListener('change', (e) => {
      const li = e.target.closest('.imp-row');
      if (!li) return;
      const row = rows[Number(li.dataset.i)];
      if (e.target.matches('[data-sel]')) row.selected = e.target.checked;
      if (e.target.matches('[data-cat]')) {
        row.category_id = e.target.value;
        row.subcategory_id = null;
        // mesma loja => mesma categoria (e vale também para as outras linhas ainda sem categoria)
        list.querySelectorAll(`.imp-row[data-key="${CSS.escape(li.dataset.key)}"]`).forEach((other) => {
          const o = rows[Number(other.dataset.i)];
          if (o === row || !o.importable) return;
          o.category_id = row.category_id; o.subcategory_id = null;
          other.querySelector('[data-cat]').value = row.category_id;
        });
      }
      summary();
    });
    list.addEventListener('input', (e) => {
      if (!e.target.matches('[data-desc]')) return;
      rows[Number(e.target.closest('.imp-row').dataset.i)].description = e.target.value;
    });
    $('#ii-closing', box).addEventListener('change', refreshInvoice);
    $('#ii-due', box).addEventListener('change', refreshInvoice);
    $('#ii-back', box).addEventListener('click', () => stepFile());

    importButton.addEventListener('click', async () => {
      const w = readWindow();
      errorBox.hidden = true;
      if (!w) { errorBox.textContent = 'Confira as datas de fechamento e vencimento.'; errorBox.hidden = false; return; }
      if (w.due_date < w.closing_date) {
        errorBox.textContent = 'O vencimento não pode ser antes do fechamento.'; errorBox.hidden = false; return;
      }
      const chosen = rows.filter((r) => r.selected).map((r) => ({
        date: r.date,
        description: (r.description || r.line.merchant).trim(),
        amount: r.line.amount,
        category_id: r.category_id || '',
        subcategory_id: r.category_id ? r.subcategory_id ?? '' : '',
        external_id: r.line.external_id,
      }));
      importButton.classList.add('is-loading'); importButton.disabled = true;
      try {
        const result = await importCardLines(cardId, w, chosen);
        const parts = [`${result.imported} ${result.imported === 1 ? 'compra importada' : 'compras importadas'}`];
        if (result.skipped) parts.push(`${result.skipped} já existiam`);
        toast.success(parts.join(' · '));
        close();
        emitDataChanged();
        location.hash = `#/cartao?id=${cardId}&inv=${result.invoice_id}`;
      } catch (err) {
        errorBox.textContent = err?.code === 'CF001'
          ? 'Esta fatura já foi paga. Desfaça o pagamento no cartão para importar.'
          : friendlyError(err, 'Não foi possível importar. Nada foi gravado.');
        errorBox.hidden = false;
        importButton.classList.remove('is-loading'); importButton.disabled = false;
      }
    });

    await refreshInvoice();
  }

  stepFile();
}
