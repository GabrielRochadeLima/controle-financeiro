# Financeiro — controle financeiro pessoal

Sistema web pessoal, **mobile-first**, para controlar despesas, receitas, contas, cartões, parcelamentos, recorrências, orçamentos, metas e investimentos. A métrica de qualidade do projeto: **registrar uma despesa em poucos segundos pelo celular**.

> **Status: Fase 2 concluída** (contas, categorias, movimentações e lançamento rápido, sobre a base da Fase 1). Veja o [roadmap](#roadmap).

## Funcionalidades

| Fase | Escopo | Status |
|------|--------|--------|
| 1 | Estrutura, layout responsivo, tema claro/escuro, Supabase, autenticação, schema + RLS, dashboard básico | ✅ |
| 2 | Contas, receitas, despesas, transferências, investimentos (aporte), categorias, **lançamento rápido** | ✅ |
| 3 | Cartões, faturas, parcelamentos | ⏳ |
| 4 | Recorrências, orçamentos, previsões | ⏳ |
| 5 | Metas, investimentos | ⏳ |
| 6 | Importação CSV/Excel, leitura de PDF, IA, Open Finance, 2FA | 🔮 futuro |

O que já funciona:

- **Lançamento rápido** (botão **+** no centro da barra inferior): digite o valor (`4590` vira `45,90`), toque na categoria e na conta, salve. A última conta usada já vem marcada, as categorias mais usadas aparecem primeiro e o tipo lembra o último usado. Descrição, observações e subcategoria são opcionais. Despesa, receita, transferência e investimento (aporte).
- **Movimentações**: lista por mês agrupada por dia, busca por descrição, filtro por tipo, "carregar mais" e edição/exclusão ao tocar numa linha.
- **Contas**: saldo atual de cada conta, criar, editar, arquivar e excluir (só sem histórico).
- **Categorias e subcategorias** totalmente editáveis, com ícone e cor; a exclusão avisa o impacto.
- Login, cadastro, recuperação de senha, sessão persistente, tema claro/escuro e dashboard.

Compras no cartão, faturas e parcelas (Fase 3) ainda não existem: os módulos das fases seguintes mostram uma tela "Em breve".

## Tecnologias

- HTML5, CSS3 (variáveis CSS), JavaScript puro (módulos ES) — **sem framework e sem build**.
- Supabase: PostgreSQL, Auth e Row Level Security.
- Única dependência de runtime: `@supabase/supabase-js` v2.116.0 (MIT), empacotada em `js/vendor/supabase.js` e servida pelo próprio site (sem CDN de terceiros). Como regenerar: veja [Atualizar o supabase-js](#atualizar-o-supabase-js).

## Estrutura do projeto

```
├── index.html              app shell (área autenticada, rotas por hash: #/, #/contas ...)
├── login.html              entrar / criar conta / recuperar e redefinir senha
├── .github/workflows/      deploy automático no GitHub Pages
├── manifest.webmanifest    permite "Adicionar à tela inicial" no celular
├── css/                    variables (tokens de tema) · global · components · dashboard · auth · responsive
├── js/
│   ├── config.js           URL e chave pública do Supabase  ← você edita
│   ├── app.js              guarda de sessão + rotas
│   ├── login.js · theme-init.js (tema antes da 1ª pintura)
│   ├── vendor/             supabase-js empacotado (não editar à mão)
│   ├── core/               supabase, auth, router, store (cache), theme, format, dom (escape XSS), finance (REGRAS), validation, events, memory
│   ├── services/           acesso a dados (reference, accounts, categories, transactions, dashboard)
│   ├── ui/                 componentes: modal + confirmação, toast, estados, nav, ícones, lançamento rápido, campo de valor
│   └── pages/              uma view por rota (dashboard, transactions, accounts, categories, settings, more, coming-soon)
├── supabase/migrations/    001_initial_schema.sql (schema completo) · 002_drop_subcategory_check.sql
├── supabase/tests/         rls_two_users.sql (teste de isolamento entre usuários)
└── assets/icons/
```

### Decisões que diferem do briefing (e por quê)

- **App de página única (SPA) com rotas por hash**, em vez de um HTML por módulo. Navegação instantânea, um único carregamento do Supabase/sessão, e a barra inferior e o botão "+" ficam sempre presentes. Cada página ainda é um módulo carregado sob demanda.
- **`installments` virou `installment_plans` + parcelas em `transactions`.** Saldo, fatura, previsão e orçamento somam uma única tabela, sem `UNION` e sem duplicar valor/data em dois lugares.
- **Sem coluna de status em fatura/transação.** Aberta/Fechada/Atrasada é derivada de datas no JS; só `paid_at` é gravado. "Efetivada" é `date <= hoje`.
- **`users` = `profiles`** (1:1 com `auth.users`), criado pela função `bootstrap_user()` que o app chama após o login (não há trigger em `auth.users`, porque o projeto é compartilhado com outros apps e o cadastro de qualquer um deles dispararia o trigger).
- **Rótulo "Movimentos"** na barra inferior: "Movimentações" quebra linha em 360px. A página continua se chamando Movimentações.

## Configuração do Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. **Banco:** *SQL Editor* → execute, **nesta ordem**, [`001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql) e [`002_drop_subcategory_check.sql`](supabase/migrations/002_drop_subcategory_check.sql). Requer PostgreSQL 15+ (padrão do Supabase). O script cria e usa o schema **`controle-financeiro`** (não toca em `public`, então convive com outros apps no mesmo projeto).
   Depois, em *Project Settings → API → Exposed schemas*, confirme que `controle-financeiro` está na lista.
3. **Auth → URL Configuration:** em *Site URL* coloque a URL onde o app roda (ex.: `http://localhost:5500`) e adicione em *Redirect URLs* a URL completa de `login.html` (ex.: `http://localhost:5500/login.html`). Sem isso o link de "Esqueci minha senha" não volta para o app.
4. **Auth → Providers → Email:** mantenha a confirmação de e-mail ligada (recomendado). Com ela, quem se cadastra precisa confirmar antes de entrar; o app já trata esse caso.
5. **Chaves:** *Project Settings → API* → copie **Project URL** e a chave **anon/publishable**.

### Variáveis necessárias

Editar `js/config.js`:

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'chave-anon-publica';
export const SUPABASE_SCHEMA = 'controle-financeiro'; // schema exposto na API
```

A chave `anon` é pública por projeto: quem protege os dados é o RLS. **Nunca** coloque `service_role`/secret no frontend.

### Como aplicar o RLS

Já está no `001_initial_schema.sql`: todas as tabelas com dados do usuário têm RLS ligado e uma policy `own_rows` (`user_id = auth.uid()`, para leitura e escrita); `profiles` usa `id = auth.uid()`. O papel `anon` não tem acesso a nenhuma tabela. As views/funções de agregação usam `security invoker`, então respeitam o RLS de quem consulta.

Para conferir depois de aplicar: *Authentication → Policies* deve listar `own_rows` em cada tabela, e o *Security Advisor* não deve apontar tabelas sem RLS.

## Publicar na internet (GitHub Pages)

O app é 100% estático. O workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publica **somente** `index.html`, `login.html`, `manifest.webmanifest`, `css/`, `js/` e `assets/`: `supabase/` (migrations e testes), este README e o resto do repositório **não vão para o site**, mesmo que o repositório seja privado.

**Antes de colocar dados reais**

1. Rode [`supabase/tests/rls_two_users.sql`](supabase/tests/rls_two_users.sql) (instruções no topo do arquivo). Deve terminar com "RLS OK". Se aparecer "FALHA", **não publique**.
2. Confirme em *Security Advisor* (Supabase) que não há tabelas sem RLS no schema `controle-financeiro`.

**Passo a passo**

1. Crie um repositório no GitHub (o Pages em repositório **privado** exige plano pago, como o GitHub Pro; o site publicado continua público de qualquer forma). Depois, na pasta do projeto:
   ```bash
   git add .
   git commit -m "Financeiro: fases 1 e 2"
   git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPO.git
   git push -u origin main
   ```
2. No GitHub: *Settings → Pages → Build and deployment → Source: **GitHub Actions***. O push acima dispara o deploy (aba *Actions*). A URL final é `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
3. No Supabase: *Authentication → URL Configuration*:
   - **Site URL:** `https://SEU-USUARIO.github.io/NOME-DO-REPO/`
   - **Redirect URLs:** `https://SEU-USUARIO.github.io/NOME-DO-REPO/login.html`
   Sem isso o link de "Esqueci minha senha" não volta para o app.
4. Abra a URL no celular e use *Adicionar à tela inicial*.

**Segurança da publicação**

- **Política de conteúdo (CSP)** via `<meta>` nas duas páginas: só executa código do próprio site (nada inline) e só conecta com `*.supabase.co`. O GitHub Pages não permite cabeçalhos HTTP, então `frame-ancestors` (anti-clickjacking) não pode ser aplicado. Em hospedagens com cabeçalhos (Cloudflare Pages, Netlify), adicione `Content-Security-Policy: frame-ancestors 'none'` e `X-Content-Type-Options: nosniff`.
- **Origem compartilhada:** todos os sites de `SEU-USUARIO.github.io` compartilham o mesmo `localStorage`, onde o Supabase guarda a sessão. Não publique outros sites nessa mesma conta se não confiar no código deles; para isolar, use uma conta/organização só para este app ou um domínio próprio.
- A chave `anon` em `js/config.js` é pública por projeto; o RLS protege os dados. Nunca versione `service_role`.
- Não guarde o repositório dentro do OneDrive se for trabalhar com git no dia a dia: a sincronização pode corromper a pasta `.git`. Prefira clonar em uma pasta fora do OneDrive.

### Atualizar o supabase-js

O arquivo `js/vendor/supabase.js` é gerado, não editado. Para atualizar (em uma pasta temporária qualquer):

```bash
npm init -y && npm i @supabase/supabase-js@NOVA.VERSAO esbuild
echo "export { createClient } from '@supabase/supabase-js';" > entry.js
npx esbuild entry.js --bundle --format=esm --platform=browser --target=es2020 --minify --legal-comments=inline --outfile=CAMINHO/js/vendor/supabase.js
```

Teste o login e o dashboard depois de atualizar e ajuste a versão citada neste README e em `js/core/supabase.js`.

## Como executar localmente

O app precisa ser servido por HTTP (módulos ES não funcionam abrindo o arquivo direto). Na pasta do projeto:

```bash
python -m http.server 5500
# ou: npx serve -l 5500
```

Abra `http://localhost:5500/login.html`. Se `js/config.js` ainda tiver os valores de exemplo, o app mostra um aviso de configuração em vez de quebrar.

## Regras financeiras (resumo)

Centralizadas em [`js/core/finance.js`](js/core/finance.js):

- **Receita ≠ transferência ≠ despesa.** Transferência move dinheiro entre duas contas e não entra em receitas nem despesas. O saldo reflete as duas pontas.
- **Compra no cartão não baixa o saldo da conta.** Ela conta como despesa na data da compra e entra na fatura; o **pagamento da fatura** (`invoice_payment`) é que baixa a conta, sem contar como despesa de novo.
- **Investimento** tem tipo próprio (só o aporte, por enquanto) e é reportado à parte.
- Valores são sempre positivos; o `type` define a direção. Cálculos em centavos inteiros.
- "Do mês" no dashboard = dia 1 até hoje; lançamentos futuros (parcelas, recorrências) pertencem à previsão.

## Preparado para o futuro (nada disso está implementado)

`transactions.source`, `external_id` (único por usuário) e `metadata` permitem plugar importação CSV/Excel, leitura de PDF de fatura, lançamento por texto com IA e Open Finance sem mudar o schema: a etapa de "revisão pelo usuário" produz linhas normais em `transactions`. 2FA usa `supabase.auth.mfa` sobre a mesma sessão (ponto de extensão documentado em `js/core/auth.js`).

## Roadmap

- **Fase 3:** cartões (limite usado/disponível), geração e fechamento de faturas, compras parceladas (editar/cancelar sem corromper as demais), pagamento de fatura atômico via RPC.
- **Fase 4:** recorrências (geração idempotente, editar uma/futuras, pausar/encerrar), orçamentos por categoria, previsão dos próximos meses e saldo projetado.
- **Fase 5:** metas com contribuições e investimentos.
- **Fase 6:** importação, PDF, IA, Open Finance, 2FA.
