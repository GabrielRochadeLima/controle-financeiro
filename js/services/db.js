// Helper comum dos serviços: resolve uma query do Supabase ou lança o erro.
export async function unwrap(builder) {
  const { data, error } = await builder;
  if (error) throw error;
  return data;
}
