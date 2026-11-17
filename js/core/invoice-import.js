/*
 * LEITURA DE FATURA DE CARTÃO (PDF já convertido em linhas de texto, ver core/pdf-lines.js).
 * Funções puras: recebem as linhas e devolvem a fatura interpretada; nada de DOM, rede ou banco.
 *
 * CONVENÇÕES (documentadas porque os PDFs não trazem tudo):
 *  - As datas dos lançamentos vêm sem ano; o ano é inferido a partir do fechamento
 *    (mês depois do fechamento = ano anterior).
 *  - A DATA gravada é sempre uma data DENTRO do ciclo da fatura: o que o banco imprime fora
 *    dele (parcela mostrando a data da compra original, ou o dia do fechamento anterior) é
 *    levado para o mesmo dia do mês dentro do ciclo. Assim, regras de fatura do app
 *    (invoiceFor) devolvem a mesma fatura se o usuário editar a compra depois.
 *  - Parcelas viram compras comuns desta fatura, com "(3/10)" na descrição: as demais
 *    parcelas já estão (ou estarão) nas faturas dos outros meses.
 *  - Pagamentos e estornos NÃO são compras: aparecem na revisão, desmarcados.
 *  - Cada linha ganha um external_id estável (banco + fechamento + hash + ocorrência) para
 *    importar a mesma fatura duas vezes sem duplicar.
 */
import { parseMoney, parseISODate, toISODate } from './format.js';
import { addDays, addMonths } from './cards.js';

const MONTHS = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const MONTH_NAMES = 'JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ';
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validDay = (y, m, d) => {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};
const NEG = '[−–-]'; // inclui o sinal de menos tipográfico (U+2212)

export const BANKS = Object.freeze({
  nubank: 'Nubank',
  mercadopago: 'Mercado Pago',
  csv: 'Arquivo CSV',
  ofx: 'Arquivo OFX',
  generic: 'Outro banco',
});

/** Ano de uma data dd/mm que não traz ano: meses depois do mês de referência são do ano anterior. */
export function inferYear(month, refISO) {
  const [y, m] = refISO.split('-').map(Number);
  return month > m ? y - 1 : y;
}

/**
 * Coloca uma data dentro do ciclo [start, end]: se já está, mantém; senão usa o mesmo dia do
 * mês dentro do ciclo (dia inexistente, como 31 em fevereiro, vira o fim do ciclo).
 */
export function placeInWindow(iso, start, end) {
  if (iso >= start && iso <= end) return iso;
  const day = parseISODate(iso).getDate();
  const s = parseISODate(start);
  for (const offset of [0, 1]) {
    const first = new Date(s.getFullYear(), s.getMonth() + offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    if (day > last) continue;
    const candidate = toISODate(new Date(first.getFullYear(), first.getMonth(), day));
    if (candidate >= start && candidate <= end) return candidate;
  }
  return end;
}

/** FNV-1a de 32 bits em hexadecimal: identificador curto e estável (não é segurança). */
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function detectBank(lines) {
  const text = lines.join('\n').toLowerCase();
  if (/mercado\s*pago/.test(text) && /detalhes de consumo|movimenta[çc][õo]es na fatura/.test(text)) return 'mercadopago';
  if (/nu pagamentos|nubank/.test(text) && /transa[çc][õo]es de \d{2} [a-zç]{3}/i.test(text)) return 'nubank';
  return 'generic';
}

const PAYMENT_RE = /^(pagamento|saldo restante|pgto)/i;
const CREDIT_RE = /^(estorno|cr[eé]dito|desconto)/i;

function installmentOf(text) {
  const m = text.match(/\s*-?\s*parcela\s+(\d+)\s*(?:\/|de)\s*(\d+)\s*$/i);
  if (!m) return { name: text.trim(), installment: null };
  return { name: text.slice(0, m.index).replace(/\s*-\s*$/, '').trim(), installment: { number: Number(m[1]), count: Number(m[2]) } };
}

function makeLine({ printedISO, name, installment, amount, negative, mask }) {
  const label = installment ? `${name} (${installment.number}/${installment.count})` : name;
  const kind = PAYMENT_RE.test(name) ? 'payment' : negative || CREDIT_RE.test(name) ? 'credit' : 'purchase';
  return { printed_date: printedISO, merchant: name, description: label.slice(0, 120), amount, installment, card_mask: mask, kind };
}

// ---------- Nubank ----------

const NU_LINE = new RegExp(`^(\\d{2}) (${MONTH_NAMES}) (?:[•*·.]+\\s?(\\d{4}) )?(.+?) (${NEG})?R\\$ ([\\d.]+,\\d{2})$`);

function parseNubank(lines) {
  const out = { due_date: null, closing_date: null, period_start: null, total: null, lines: [] };
  const due = lines.join('\n').match(new RegExp(`Data de vencimento:\\s*(\\d{2}) (${MONTH_NAMES}) (\\d{4})`));
  if (due) out.due_date = isoOf(Number(due[3]), MONTHS[due[2]], Number(due[1]));

  const period = lines.join('\n').match(new RegExp(`Per[ií]odo vigente:\\s*(\\d{2}) (${MONTH_NAMES}) a (\\d{2}) (${MONTH_NAMES})`));
  if (period && out.due_date) {
    const end = { d: Number(period[3]), m: MONTHS[period[4]] };
    const start = { d: Number(period[1]), m: MONTHS[period[2]] };
    out.closing_date = isoOf(inferYear(end.m, out.due_date), end.m, end.d);
    // O Nubank imprime o dia do fechamento anterior como início; o ciclo do app começa no dia seguinte.
    const printedStart = isoOf(inferYear(start.m, out.closing_date), start.m, start.d);
    out.period_start = addDays(printedStart, 1);
  }

  for (const line of lines) {
    const total = line.match(/^Total a pagar (?:R\$ )?([\d.]+,\d{2})$/);
    if (total && out.total == null) out.total = parseMoney(total[1]);
  }

  const ref = out.closing_date || out.due_date;
  for (const line of lines) {
    const m = line.match(NU_LINE);
    if (!m || !ref) continue;
    const month = MONTHS[m[2]];
    const year = inferYear(month, ref);
    if (!validDay(year, month, Number(m[1]))) continue;
    const { name, installment } = installmentOf(m[4]);
    out.lines.push(makeLine({
      printedISO: isoOf(year, month, Number(m[1])), name, installment,
      amount: parseMoney(m[6]), negative: Boolean(m[5]), mask: m[3] || null,
    }));
  }
  return out;
}

// ---------- Mercado Pago ----------

const MP_LINE = /^(\d{2})\/(\d{2}) (.+?)(?: Parcela (\d+) de (\d+))? ([−–-])?R\$ ([\d.]+,\d{2})$/;

function parseMercadoPago(lines) {
  const out = { due_date: null, closing_date: null, period_start: null, total: null, lines: [] };
  const text = lines.join('\n');
  const due = text.match(/Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (due) out.due_date = isoOf(Number(due[3]), Number(due[2]), Number(due[1]));
  const closing = text.match(/Fechamento da fatura\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if (closing) out.closing_date = isoOf(Number(closing[3]), Number(closing[2]), Number(closing[1]));

  const consumo = text.match(/Consumos de (\d{2})\/(\d{2}) a (\d{2})\/(\d{2})/);
  if (consumo) {
    if (!out.closing_date && out.due_date) out.closing_date = isoOf(inferYear(Number(consumo[4]), out.due_date), Number(consumo[4]), Number(consumo[3]));
    if (out.closing_date) {
      out.period_start = isoOf(inferYear(Number(consumo[2]), out.closing_date), Number(consumo[2]), Number(consumo[1]));
    }
  }
  if (out.closing_date && !out.period_start) out.period_start = addDays(addMonths(out.closing_date, -1), 1);

  const resumo = lines.findIndex((l) => /^Resumo da fatura$/i.test(l));
  if (resumo >= 0) {
    for (const line of lines.slice(resumo + 1)) {
      const t = line.match(/^Total R\$ ([\d.]+,\d{2})$/);
      if (t) { out.total = parseMoney(t[1]); break; }
    }
  }

  let mask = null;
  const ref = out.closing_date || out.due_date;
  for (const line of lines) {
    const card = line.match(/^Cart[ãa]o .*\[\*+(\d{4})\]/);
    if (card) { mask = card[1]; continue; }
    const m = line.match(MP_LINE);
    if (!m || !ref) continue;
    const month = Number(m[2]);
    const year = inferYear(month, ref);
    if (!validDay(year, month, Number(m[1]))) continue;
    const installment = m[4] ? { number: Number(m[4]), count: Number(m[5]) } : null;
    out.lines.push(makeLine({
      printedISO: isoOf(year, month, Number(m[1])), name: m[3].trim(), installment,
      amount: parseMoney(m[7]), negative: Boolean(m[6]), mask,
    }));
  }
  return out;
}

// ---------- genérico (outros bancos): melhor esforço, o usuário revisa tudo ----------

function parseGeneric(lines, today) {
  const out = { due_date: null, closing_date: null, period_start: null, total: null, lines: [] };
  const text = lines.join('\n');
  const due = text.match(/(?:vencimento|vence em)\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (due) out.due_date = isoOf(Number(due[3]), Number(due[2]), Number(due[1]));
  const closing = text.match(/fechamento[^\d\n]*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (closing) out.closing_date = isoOf(Number(closing[3]), Number(closing[2]), Number(closing[1]));
  const total = text.match(/total (?:da fatura|a pagar)[^\d\n]*R?\$?\s*([\d.]+,\d{2})/i);
  if (total) out.total = parseMoney(total[1]);

  const ref = out.closing_date || out.due_date || today;
  const slash = /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))? (.+?) ([−–-])?(?:R\$ ?)?([\d.]+,\d{2})$/;
  const named = new RegExp(`^(\\d{2}) (${MONTH_NAMES}) (.+?) (${NEG})?(?:R\\$ ?)?([\\d.]+,\\d{2})$`, 'i');
  for (const line of lines) {
    let day; let month; let year; let rest; let neg; let value;
    const a = line.match(slash);
    const b = a ? null : line.match(named);
    if (a) {
      day = Number(a[1]); month = Number(a[2]);
      year = a[3] ? (a[3].length === 2 ? 2000 + Number(a[3]) : Number(a[3])) : inferYear(month, ref);
      rest = a[4]; neg = a[5]; value = a[6];
    } else if (b) {
      day = Number(b[1]); month = MONTHS[b[2].toUpperCase()]; year = inferYear(month, ref);
      rest = b[3]; neg = b[4]; value = b[5];
    } else continue;
    if (!validDay(year, month, day)) continue;
    const { name, installment } = installmentOf(rest);
    if (!name) continue;
    out.lines.push(makeLine({
      printedISO: isoOf(year, month, day), name, installment, amount: parseMoney(value), negative: Boolean(neg), mask: null,
    }));
  }
  return out;
}

/**
 * Interpreta a fatura.
 * @param {string[]} lines  linhas de todas as páginas, em ordem
 * @param {{ today?: string, bank?: string }} options
 * @returns {{
 *   bank: string, due_date: string|null, closing_date: string|null, period_start: string|null,
 *   total: number|null,
 *   lines: { printed_date, date, merchant, description, amount, installment, card_mask, kind, external_id }[],
 *   warnings: string[] }}
 */
export function parseInvoice(lines, { today = toISODate(new Date()), bank } = {}) {
  const kind = bank || detectBank(lines);
  const raw = kind === 'nubank' ? parseNubank(lines)
    : kind === 'mercadopago' ? parseMercadoPago(lines)
      : parseGeneric(lines, today);

  const warnings = [];
  if (!raw.due_date) warnings.push('Não encontramos a data de vencimento no PDF.');
  if (!raw.closing_date) warnings.push('Não encontramos a data de fechamento no PDF.');
  if (!raw.lines.length) warnings.push('Nenhuma compra foi reconhecida neste PDF.');

  const seen = new Map();
  const parsed = raw.lines.map((l) => {
    const date = raw.period_start && raw.closing_date ? placeInWindow(l.printed_date, raw.period_start, raw.closing_date) : l.printed_date;
    const key = `${l.printed_date}|${l.merchant}|${l.installment ? `${l.installment.number}/${l.installment.count}` : ''}|${l.amount.toFixed(2)}|${l.card_mask ?? ''}`;
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    return {
      ...l, date,
      external_id: `imp-${kind}-${raw.closing_date ?? raw.due_date ?? 'x'}-${hash32(key)}-${occurrence}`,
    };
  });

  return {
    bank: kind,
    due_date: raw.due_date,
    closing_date: raw.closing_date,
    period_start: raw.period_start,
    total: raw.total,
    lines: parsed,
    warnings,
  };
}

// ---------- CSV (.csv) e OFX (.ofx) ----------

function parseFlexibleDate(raw, refISO) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDay(y, mo, d) ? isoOf(y, mo, d) : null;
  }
  m = s.match(/^(\d{2})[/-](\d{2})(?:[/-](\d{2,4}))?$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : inferYear(mo, refISO);
    return validDay(y, mo, d) ? isoOf(y, mo, d) : null;
  }
  return null;
}

function parseSignedMoney(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const neg = new RegExp(NEG).test(s) || /^\(.*\)$/.test(s);
  const cleaned = s.replace(new RegExp(NEG, 'g'), '').replace(/[()R$\s]/gi, '');
  const val = parseMoney(cleaned);
  if (!Number.isFinite(val) || val === 0) return null;
  return neg ? -Math.abs(val) : Math.abs(val);
}

function splitCsvRow(line, delimiter) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseInstallmentText(text, parcelCol = '') {
  const col = String(parcelCol ?? '').trim();
  if (col) {
    const cm = col.match(/(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/i);
    if (cm && Number(cm[2]) > 1) {
      const stripped = installmentOf(text);
      return { name: stripped.name, installment: { number: Number(cm[1]), count: Number(cm[2]) } };
    }
  }
  const base = installmentOf(text);
  if (base.installment) return base;
  const slashEnd = text.match(/^(.+?)\s+(?:parc(?:ela)?\.?\s*)?(\d{1,2})\/(\d{1,2})$/i);
  if (slashEnd && Number(slashEnd[3]) > 1 && Number(slashEnd[2]) <= Number(slashEnd[3])) {
    return {
      name: slashEnd[1].replace(/\s*-\s*$/, '').trim(),
      installment: { number: Number(slashEnd[2]), count: Number(slashEnd[3]) },
    };
  }
  return base;
}

function finalizeStructuredLines(rawLines, kind, { closing_date = null, due_date = null, period_start = null, total = null, warnings = [] } = {}) {
  // Se a maioria dos lançamentos (exceto pagamentos explícitos) vier com sinal negativo
  // (padrão de arquivos OFX e alguns CSVs bancários), invertemos o sinal para que compras
  // sejam positivas e créditos/pagamentos sejam negativos.
  const nonPay = rawLines.filter((r) => !PAYMENT_RE.test(r.name));
  const negCount = nonPay.filter((r) => r.signedAmount < 0).length;
  const posCount = nonPay.filter((r) => r.signedAmount > 0).length;
  const invertSign = negCount > posCount;

  const seen = new Map();
  const lines = rawLines.map((r) => {
    const signed = invertSign ? -r.signedAmount : r.signedAmount;
    const base = makeLine({
      printedISO: r.printedISO,
      name: r.name,
      installment: r.installment,
      amount: Math.abs(signed),
      negative: signed < 0,
      mask: r.mask ?? null,
    });
    const date = period_start && closing_date ? placeInWindow(base.printed_date, period_start, closing_date) : base.printed_date;
    const key = r.fitid
      ? `fitid:${r.fitid}`
      : `${base.printed_date}|${base.merchant}|${base.installment ? `${base.installment.number}/${base.installment.count}` : ''}|${base.amount.toFixed(2)}|${base.card_mask ?? ''}`;
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    return {
      ...base,
      date,
      external_id: `imp-${kind}-${closing_date ?? due_date ?? 'x'}-${hash32(key)}-${occurrence}`,
    };
  });

  if (!lines.length) warnings.push('Nenhuma compra foi reconhecida neste arquivo.');
  return {
    bank: kind,
    due_date,
    closing_date,
    period_start,
    total,
    lines,
    warnings,
  };
}

/**
 * Interpreta arquivo CSV de fatura de cartão (Nubank, Inter, Itaú, C6, XP, Bradesco, etc.).
 */
export function parseCsvInvoice(text, { today = toISODate(new Date()) } = {}) {
  const rows = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!rows.length) {
    return finalizeStructuredLines([], 'csv');
  }

  // Detecta o delimitador predominante (; , ou tab)
  const sample = rows.slice(0, 5).join('\n');
  const delimiter = [';', ',', '\t'].sort(
    (a, b) => (sample.split(b).length - 1) - (sample.split(a).length - 1),
  )[0];

  const matrix = rows.map((r) => splitCsvRow(r, delimiter));
  const first = matrix[0].map((c) => normalizeDescription(c));

  const findCol = (patterns) => first.findIndex((h) => patterns.some((p) => p.test(h)));
  let dateCol = findCol([/^(data|date|dt)/]);
  let descCol = findCol([/(titul|title|descri|lancament|historico|estabelecimento|merchant|nome)/]);
  let amtCol = findCol([/^(valor|amount|value|total|preco|vlr|r\$)/, /(valor.*r\$|em r\$)/]);
  const parcelCol = findCol([/^(parcela|installment)/]);
  const maskCol = findCol([/(cartao|card|final)/]);

  const hasHeader = dateCol >= 0 || descCol >= 0 || amtCol >= 0;
  const startRow = hasHeader ? 1 : 0;

  const rawLines = [];
  for (let i = startRow; i < matrix.length; i += 1) {
    const cols = matrix[i];
    if (cols.length < 2) continue;

    let dIdx = dateCol;
    let aIdx = amtCol;
    let mIdx = descCol;

    if (dIdx < 0) dIdx = cols.findIndex((c) => parseFlexibleDate(c, today) != null);
    if (dIdx < 0) continue;
    const printedISO = parseFlexibleDate(cols[dIdx], today);
    if (!printedISO) continue;

    if (aIdx < 0) {
      for (let c = cols.length - 1; c >= 0; c -= 1) {
        if (c === dIdx) continue;
        if (/^-?\s*(?:R\$\s*)?[\d.]+,\d{2}$|^-?\s*(?:R\$\s*)?\d+\.\d{2}$/i.test(cols[c])) {
          aIdx = c;
          break;
        }
      }
    }
    if (aIdx < 0) continue;
    const signedAmount = parseSignedMoney(cols[aIdx]);
    if (signedAmount == null) continue;

    if (mIdx < 0) {
      // Escolhe a coluna textual mais descritiva que não seja data nem valor
      mIdx = cols.findIndex((c, idx) => idx !== dIdx && idx !== aIdx && idx !== parcelCol && c.length > 1);
    }
    const rawDesc = (mIdx >= 0 ? cols[mIdx] : '').trim();
    if (!rawDesc) continue;

    const { name, installment } = parseInstallmentText(rawDesc, parcelCol >= 0 ? cols[parcelCol] : '');
    if (!name) continue;

    let mask = null;
    if (maskCol >= 0 && cols[maskCol]) {
      const mm = cols[maskCol].match(/(\d{4})\s*$/);
      if (mm) mask = mm[1];
    }

    rawLines.push({ printedISO, name, installment, signedAmount, mask });
  }

  return finalizeStructuredLines(rawLines, 'csv');
}

/**
 * Interpreta arquivo OFX (Open Financial Exchange 1.x SGML ou 2.x XML) de cartão de crédito.
 */
export function parseOfxInvoice(text, { today = toISODate(new Date()) } = {}) {
  const src = String(text ?? '');
  const tagValue = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]+)`, 'i'));
    return m ? m[1].trim() : null;
  };
  const ofxDate = (raw) => {
    if (!raw) return null;
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDay(y, mo, d) ? isoOf(y, mo, d) : null;
  };

  const dtEnd = ofxDate(tagValue(src, 'DTEND'));
  const closing_date = dtEnd || null;
  const period_start = closing_date ? addDays(addMonths(closing_date, -1), 1) : null;

  let mask = null;
  const acct = tagValue(src, 'ACCTID');
  if (acct) {
    const mm = acct.replace(/\D/g, '').match(/(\d{4})$/);
    if (mm) mask = mm[1];
  }

  const blocks = src.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>|$))/gi) ?? [];
  const rawLines = [];

  for (const block of blocks) {
    const printedISO = ofxDate(tagValue(block, 'DTPOSTED')) || today;
    const trnAmt = tagValue(block, 'TRNAMT');
    const signedAmount = parseSignedMoney(trnAmt);
    if (signedAmount == null) continue;

    const memo = tagValue(block, 'MEMO');
    const nameTag = tagValue(block, 'NAME');
    const rawDesc = [memo, nameTag].sort((a, b) => (b?.length || 0) - (a?.length || 0))[0] ?? '';
    if (!rawDesc) continue;

    const { name, installment } = parseInstallmentText(rawDesc);
    if (!name) continue;

    const fitid = tagValue(block, 'FITID');
    rawLines.push({ printedISO, name, installment, signedAmount, mask, fitid });
  }

  return finalizeStructuredLines(rawLines, 'ofx', { closing_date, period_start });
}

/** Soma (em centavos exatos) do que seria importado: só compras. */
export function purchasesTotal(lines) {
  return lines.filter((l) => l.kind === 'purchase').reduce((s, l) => s + Math.round(l.amount * 100), 0) / 100;
}

// ---------- categoria sugerida pelo histórico do próprio usuário ----------

export const normalizeDescription = (text) => String(text ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(\d+\/\d+\)/g, ' ')
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** @param {{ description, category_id, subcategory_id }[]} rows  movimentações anteriores */
export function buildCategoryMemory(rows) {
  const counts = new Map(); // descrição normalizada -> Map("cat|sub" -> n)
  for (const r of rows) {
    if (!r.category_id) continue;
    const key = normalizeDescription(r.description);
    if (!key) continue;
    const bucket = counts.get(key) ?? new Map();
    const id = `${r.category_id}|${r.subcategory_id ?? ''}`;
    bucket.set(id, (bucket.get(id) || 0) + 1);
    counts.set(key, bucket);
  }
  const memory = new Map();
  for (const [key, bucket] of counts) {
    const [best] = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
    const [category_id, subcategory_id] = best[0].split('|');
    memory.set(key, { category_id, subcategory_id: subcategory_id || null });
  }
  return memory;
}

/** Procura a descrição exata; senão a mais longa conhecida que seja prefixo (ou tenha a nova como prefixo). */
export function suggestCategory(description, memory) {
  const key = normalizeDescription(description);
  if (!key) return null;
  if (memory.has(key)) return memory.get(key);
  let best = null;
  for (const known of memory.keys()) {
    if (known.length < 4) continue;
    if ((key.startsWith(known) || known.startsWith(key)) && (!best || known.length > best.length)) best = known;
  }
  return best ? memory.get(best) : null;
}
