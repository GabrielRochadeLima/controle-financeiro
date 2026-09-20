# Financeiro — controle financeiro pessoal

Sistema web pessoal, **mobile-first**, para controlar despesas, receitas, contas, cartões, parcelamentos, recorrências, orçamentos, metas e investimentos. A métrica de qualidade do projeto: **registrar uma despesa em poucos segundos pelo celular**.

> **Status: Fase 3 concluída** (cartões, faturas e parcelamentos, sobre as fases 1 e 2). Veja o [roadmap](#roadmap).

## Funcionalidades

| Fase | Escopo | Status |
|------|--------|--------|
| 1 | Estrutura, layout responsivo, tema claro/escuro, Supabase, autenticação, schema + RLS, dashboard básico | ✅ |
| 2 | Contas, receitas, despesas, transferências, investimentos (aporte), categorias, **lançamento rápido** | ✅ |
| 3 | Cartões, faturas, parcelamentos | ✅ |
| 4 | Recorrências, orçamentos, previsões | ⏳ |
| 5 | Metas, investimentos | ⏳ |
| 6 | Importação CSV/Excel, leitura de PDF, IA, Open Finance, 2FA | 🔮 futuro |

O que já funciona:

- **Lançamento rápido** (botão **+** no centro da barra inferior): digite o valor (`4590` vira `45,90`), toque na categoria e na conta, salve. A última conta usada já vem marcada, as categorias mais usadas aparecem primeiro e o tipo lembra o último usado. Descrição, observações e subcategoria são opcionais. Despesa, receita, transferência e investimento (aporte).
- **Movimentações**: lista por mês agrupada por dia, busca por descrição, filtro por tipo, "carregar mais" e edição/exclusão ao tocar numa linha.
- **Contas**: saldo atual de cada conta, criar, editar, arquivar e excluir (só sem histórico).
- **Categorias e subcategorias** totalmente editáveis, com ícone e cor; a exclusão avisa o impacto.
- Login, cadastro, recuperação de senha, sessão persistente, tema claro/escuro e dashboard.

- **Cartões**: limite usado/disponível, fatura atual, criar/editar/arquivar/excluir (só sem compras).
- **Faturas**: uma por mês de fechamento, navegáveis; status Aberta / Fechada / Paga / Atrasada; **pagar fatura** (sai da conta escolhida) e **desfazer pagamento**. Fatura paga fica imutável.
- **Compras no cartão** pelo mesmo lançamento rápido: escolha o cartão no lugar da conta, e as **parcelas** (à vista, 2x…12x ou qualquer número até 120). O app mostra em qual fatura a compra cai e o valor de cada parcela.
- **Compra parcelada**: detalhe com todas as parcelas e a situação de cada fatura; editar descrição/categoria (vale para todas) e excluir com escolha do impacto (só esta parcela, esta e as próximas, ou toda a compra). Parcelas em faturas pagas são preservadas.
- Dashboard com as faturas próximas (abertas, fechadas ou atrasadas).

Orçamentos, metas e investimentos (fases 4–5) ainda não existem: esses módulos mostram uma tela "Em breve".

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
├── css/                    variables (tokens de tema) · global · components · dashboard · forms · cards · auth · responsive
├── js/
│   ├── config.js           URL e chave pública do Supabase  ← você edita
│   ├── app.js              guarda de sessão + rotas
│   ├── login.js · theme-init.js (tema antes da 1ª pintura)
│   ├── vendor/             supabase-js empacotado (não editar à mão)
│   ├── core/               supabase, auth, router, store (cache), theme, format, dom (escape XSS), finance + cards (REGRAS), validation, events, memory
│   ├── services/           acesso a dados (reference, accounts, categories, transactions, cards, dashboard)
│   ├── ui/                 componentes: modal + confirmação, toast, estados, nav, ícones, lançamento rápido, campo de valor, formulário de cartão, detalhe de parcelamento
│   └── pages/              uma view por rota (dashboard, transactions, accounts, categories, cards, card, settings, more, coming-soon)
├── supabase/migrations/    001_initial_schema · 002_drop_subcategory_check · 003_cards_invoices
├── supabase/tests/         rls_two_users.sql · cards_behaviour.sql (testes para rodar no SQL Editor)
├── tests/                  rules.test.mjs (regras de fatura/parcela/validação: `node tests/rules.test.mjs`)
└── assets/icons/
```

### Decisões que diferem do briefing (e por quê)

- **App de página única (SPA) com rotas por hash**, em vez de um HTML por módulo. Navegação instantânea, um único carregamento do Supabase/sessão, e a barra inferior e o botão "+" ficam sempre presentes. Cada página ainda é um módulo carregado sob demanda.
- **`installments` virou `installment_plans` + parcelas em `transactions`.** Saldo, fatura, previsão e orçamento somam uma única tabela, sem `UNION` e sem duplicar valor/data em dois lugares.
- **Compras no cartão e pagamentos são gravados por funções do banco** (`create_card_purchase`, `pay_invoice`, `delete_installments`...), para serem atômicos (compra parcelada = plano + parcelas + faturas, tudo ou nada). As **regras** (qual fatura recebe a compra, vencimento, divisão das parcelas) continuam no JS; o banco só persiste e protege (fatura paga é imutável, por trigger).
- **Sem coluna de status em fatura/transação.** Aberta/Fechada/Atrasada é derivada de datas no JS; só `paid_at` é gravado. "Efetivada" é `date <= hoje`.
- **`users` = `profiles`** (1:1 com `auth.users`), criado pela função `bootstrap_user()` que o app chama após o login (não há trigger em `auth.users`, porque o projeto é compartilhado com outros apps e o cadastro de qualquer um deles dispararia o trigger).
- **Rótulo "Movimentos"** na barra inferior: "Movimentações" quebra linha em 360px. A página continua se chamando Movimentações.

## Configuração do Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. **Banco:** *SQL Editor* → execute, **nesta ordem**, [`001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql), [`002_drop_subcategory_check.sql`](supabase/migrations/002_drop_subcategory_check.sql) e [`003_cards_invoices.sql`](supabase/migrations/003_cards_invoices.sql). Requer PostgreSQL 15+ (padrão do Supabase). O script cria e usa o schema **`controle-financeiro`** (não toca em `public`, então convive com outros apps no mesmo projeto).
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
2. Depois da migration 003, rode também [`supabase/tests/cards_behaviour.sql`](supabase/tests/cards_behaviour.sql): deve terminar com "TESTES 003 OK".
3. Confirme em *Security Advisor* (Supabase) que não há tabelas sem RLS no schema `controle-financeiro`.

**Ordem de deploy quando há migration nova:** primeiro rode a migration no SQL Editor do Supabase, **depois** dê o `git push`. Se o código novo subir antes do banco estar pronto, as telas novas dão erro até a migration ser aplicada. As migrations são aditivas e não apagam dados.

**Passo a passo**

1. Crie um repositório no GitHub (o Pages em repositório **privado** exige plano pago, como o GitHub Pro; o site publicado continua público de qualquer forma). Depois, na pasta do projeto:
   ```bash
   git add .
   git commit -m "Financeiro: primeira versão"
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

Centralizadas em [`js/core/finance.js`](js/core/finance.js) (saldos, resumos) e [`js/core/cards.js`](js/core/cards.js) (faturas e parcelas):

- **Receita ≠ transferência ≠ despesa.** Transferência move dinheiro entre duas contas e não entra em receitas nem despesas. O saldo reflete as duas pontas.
- **Compra no cartão não baixa o saldo da conta.** Ela conta como despesa na data da compra e entra na fatura; o **pagamento da fatura** (`invoice_payment`) é que baixa a conta, sem contar como despesa de novo.
- **Investimento** tem tipo próprio (só o aporte, por enquanto) e é reportado à parte.
- Valores são sempre positivos; o `type` define a direção. Cálculos em centavos inteiros.
- "Do mês" no dashboard = dia 1 até hoje; lançamentos futuros (parcelas, recorrências) pertencem à previsão.

**Cartão, fatura e parcelas** (convenções; variam entre bancos e estão documentadas em `cards.js`):

- A compra feita **até o dia do fechamento (inclusive)** entra na fatura que fecha naquele mês; depois, na do mês seguinte.
- O vencimento cai no mesmo mês do fechamento se o dia de vencimento for **maior** que o de fechamento (fecha 3, vence 10); senão, no mês seguinte (fecha 25, vence 5). Dia inexistente no mês (31 em fevereiro) vira o último dia do mês.
- **Parcelas:** a sobra de centavos fica nas primeiras (100,00 em 3x = 33,34 + 33,33 + 33,33), e cada parcela vai para a fatura seguinte à anterior, sempre em faturas diferentes.
- **Limite usado** = soma das compras em faturas não pagas, **inclusive parcelas futuras**: a compra parcelada bloqueia o valor total do limite até as faturas serem pagas.
- **Status da fatura:** Paga (tem `paid_at`) → Atrasada (venceu e não foi paga) → Fechada (passou o fechamento) → Aberta.
- **Fatura paga é imutável:** não aceita inserir, excluir nem alterar valor/data das compras (trava no banco); só descrição e categoria. Para mexer, desfaça o pagamento.
- Mudar os dias de fechamento/vencimento de um cartão vale para compras novas; faturas já criadas mantêm as datas.
- Pagamento só de fatura **inteira** (pagamento parcial não existe ainda).

## Preparado para o futuro (nada disso está implementado)

`transactions.source`, `external_id` (único por usuário) e `metadata` permitem plugar importação CSV/Excel, leitura de PDF de fatura, lançamento por texto com IA e Open Finance sem mudar o schema: a etapa de "revisão pelo usuário" produz linhas normais em `transactions`. 2FA usa `supabase.auth.mfa` sobre a mesma sessão (ponto de extensão documentado em `js/core/auth.js`).

## Roadmap

- **Fase 4:** recorrências (geração idempotente, editar uma/futuras, pausar/encerrar), orçamentos por categoria, previsão dos próximos meses e saldo projetado.
- **Fase 5:** metas com contribuições e investimentos.
- **Fase 6:** importação, PDF, IA, Open Finance, 2FA.
