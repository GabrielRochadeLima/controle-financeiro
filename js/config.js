/*
 * Configuração pública do Supabase.
 *
 * Preencha com os valores de: Supabase Dashboard > Project Settings > API.
 *  - SUPABASE_URL:      "Project URL"
 *  - SUPABASE_ANON_KEY: chave "anon" / "publishable" (feita para ficar no navegador;
 *                       quem protege os dados é o RLS do banco).
 *
 * NUNCA coloque aqui a chave "service_role" / "secret".
 */
export const SUPABASE_URL = 'https://irlxktcyucvckejrxunk.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlybHhrdGN5dWN2Y2tlanJ4dW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTMzNTcsImV4cCI6MjA3MzcyOTM1N30.9JqCS8cN_Lzrc1BYGYmVIpF9JPyLNUmxD0hKoNhStVA';

// Schema do Postgres onde vivem as tabelas deste sistema. Precisa estar em
// Settings > API > Exposed schemas (o nome exposto é exatamente este).
export const SUPABASE_SCHEMA = 'controle-financeiro';
