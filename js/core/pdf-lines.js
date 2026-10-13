// Reconstrói as LINHAS de texto de uma página de PDF a partir dos itens do pdf.js
// (getTextContent): agrupa por altura (y) e ordena da esquerda para a direita (x).
// Função pura: o leitor (ui/services) só entrega os itens.

/**
 * @param {{ str: string, transform: number[] }[]} items  itens do pdf.js (transform[4]=x, [5]=y)
 * @param {{ yTolerance?: number }} options
 * @returns {string[]} linhas de cima para baixo, com espaços normalizados
 */
export function itemsToLines(items, { yTolerance = 3 } = {}) {
  const cells = items
    .filter((i) => typeof i.str === 'string' && i.str.trim() !== '')
    .map((i) => ({ x: i.transform[4], y: i.transform[5], s: i.str.trim() }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  for (const cell of cells) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - cell.y) <= yTolerance) row.cells.push(cell);
    else rows.push({ y: cell.y, cells: [cell] });
  }
  return rows.map((r) => r.cells
    .sort((a, b) => a.x - b.x)
    .map((c) => c.s)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim());
}
