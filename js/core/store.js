// Cache em memória para dados de referência (contas, categorias...).
// Evita repetir consultas ao Supabase a cada navegação; as telas que alteram
// esses dados chamam invalidate(chave) depois de salvar.

const entries = new Map(); // chave -> { promise }

/** Retorna o valor em cache ou executa `loader` uma única vez (dedupe de chamadas simultâneas). */
export function cached(key, loader) {
  if (!entries.has(key)) {
    const promise = loader().catch((err) => {
      entries.delete(key); // não cacheia falha
      throw err;
    });
    entries.set(key, promise);
  }
  return entries.get(key);
}

export function invalidate(...keys) {
  if (!keys.length) entries.clear();
  keys.forEach((k) => entries.delete(k));
}
