// Importação de fatura: leitura do PDF NO NAVEGADOR (pdf.js empacotado em js/vendor/pdfjs,
// nada é enviado a servidor) e gravação das compras revisadas pela função import_card_lines
// (supabase/migrations/005_import_card_lines.sql).
import { supabase } from '../core/supabase.js';
import { itemsToLines } from '../core/pdf-lines.js';
import { unwrap } from './db.js';

export const MAX_PDF_BYTES = 15 * 1024 * 1024;

let pdfjsPromise = null;

/** pdf.js só é baixado na primeira importação (são ~1,8 MB com o worker). */
function loadPdfjs() {
  pdfjsPromise ??= import('../vendor/pdfjs/pdf.min.js').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
    return pdfjs;
  });
  return pdfjsPromise;
}

/**
 * Linhas de texto de todas as páginas, em ordem.
 * @throws {Error} com `code`: 'too_big' | 'password' | 'wrong_password' | 'invalid'
 */
export async function readPdfLines(file, password = '') {
  if (file.size > MAX_PDF_BYTES) throw Object.assign(new Error('PDF muito grande'), { code: 'too_big' });
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, password: password || undefined, isEvalSupported: false }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw Object.assign(new Error('PDF protegido'), { code: password ? 'wrong_password' : 'password' });
    }
    throw Object.assign(new Error('PDF inválido'), { code: 'invalid', cause: err });
  }
  try {
    const lines = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      lines.push(...itemsToLines(content.items));
    }
    return lines;
  } finally {
    doc.destroy();
  }
}

/** Quais external_id já existem (importações anteriores). */
export async function findImportedIds(ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await unwrap(supabase.from('transactions').select('external_id').in('external_id', chunk));
    rows.forEach((r) => found.add(r.external_id));
  }
  return found;
}

/** Fatura já existente (com total e situação) para o cartão e fechamento, ou null. */
export async function findInvoice(cardId, closingDate) {
  const rows = await unwrap(supabase.from('v_invoices').select('*')
    .eq('credit_card_id', cardId).eq('closing_date', closingDate).limit(1));
  return rows[0] ?? null;
}

/** Histórico de descrição -> categoria do usuário, para sugerir categorias. */
export const loadCategoryHistory = () => unwrap(supabase.from('transactions')
  .select('description, category_id, subcategory_id')
  .eq('type', 'expense').not('category_id', 'is', null).not('description', 'is', null)
  .order('date', { ascending: false }).limit(3000));

/**
 * @param {string} cardId
 * @param {{ period_start: string, closing_date: string, due_date: string }} invoice
 * @param {{ date, description, amount, category_id, subcategory_id, external_id }[]} lines
 * @returns {{ invoice_id: string, imported: number, skipped: number }}
 */
export const importCardLines = (cardId, invoice, lines) =>
  unwrap(supabase.rpc('import_card_lines', { p_card: cardId, p_invoice: invoice, p_lines: lines }));
