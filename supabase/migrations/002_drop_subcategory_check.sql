-- Remove a constraint transactions_subcategory_needs_category.
--
-- Motivo: ao excluir uma categoria, o Postgres executa duas ações referenciais
-- na mesma linha de transactions (category_id -> NULL e, via cascade das
-- subcategorias, subcategory_id -> NULL). Como CHECK é imediato e a ordem das
-- ações não é garantida, o CHECK pode ser avaliado com category_id NULL e
-- subcategory_id ainda preenchido, e a exclusão da categoria falharia.
--
-- A regra "subcategoria só existe com categoria (e pertence a ela)" continua
-- garantida na aplicação: js/core/validation.js -> validateTransaction.
--
-- Como aplicar: SQL Editor > cole e execute (seguro rodar mais de uma vez).
alter table "controle-financeiro".transactions
  drop constraint if exists transactions_subcategory_needs_category;
