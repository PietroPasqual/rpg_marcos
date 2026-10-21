# Como colocar o site no ar

O site (montador de fichas + Livro de Regras) roda no **GitHub Pages**, de graça e sem servidor. As **contas** (login e
sincronização de fichas) são opcionais e precisam de um servidor: aqui o caminho gratuito usa o **Render** (servidor) e o
**Neon** (banco Postgres). Sem a parte 2, o site funciona normalmente com as fichas guardadas só no navegador.

## Parte 1: site no GitHub Pages

1. No GitHub, abra o repositório → **Settings** → **General** → seção **Default branch** → clique no ícone de setas →
   escolha **`main`** → **Update** → confirme. (O Pages só publica a partir do branch padrão.)
2. **Settings** → **Pages** → em **Source** deve estar **GitHub Actions** (já está).
3. **Actions** → workflow **Publicar site (GitHub Pages)** → **Run workflow** → branch `main` → **Run workflow**.
4. Em uns 2 minutos o site fica em `https://pietropasqual.github.io/rpg_marcos/`.

Depois disso, todo merge na `main` republica o site sozinho.

## Parte 2 (opcional): contas e sincronização

### 2.1 Banco de dados (Neon)

1. Entre em <https://neon.tech> e crie uma conta (dá para entrar com o GitHub).
2. **Create project**: nome `rpg-marcos`, Postgres na versão sugerida, região mais perto de você (ex.: São Paulo, se houver).
3. No painel do projeto, clique em **Connect** e copie a **connection string**. Ela começa com `postgresql://` e termina
   com `?sslmode=require`. Guarde-a: é a senha do banco.

### 2.2 Servidor (Render)

1. Entre em <https://render.com> e crie uma conta com o GitHub, autorizando o acesso ao repositório `rpg_marcos`.
2. **New** → **Blueprint** → escolha o repositório `rpg_marcos`. O Render lê o arquivo `render.yaml` do repositório.
3. Ele vai pedir o valor de **`ACCOUNTS_DATABASE_URL`**: cole a connection string do Neon. Os outros valores
   (`ACCOUNTS_SECRET`, `ACCOUNTS_TRUST_PROXY`) já vêm prontos.
4. Clique em **Apply** e espere o deploy terminar (alguns minutos).
5. Copie o endereço do serviço, algo como `https://rpg-marcos-api.onrender.com`, e teste abrindo
   `https://rpg-marcos-api.onrender.com/api/v1/auth/status`: deve aparecer `{"enabled":true,...}`.

### 2.3 Ligar o login no site

1. No GitHub: **Settings** → **Secrets and variables** → **Actions** → aba **Variables** → **New repository variable**.
2. Nome: `ACCOUNTS_URL`. Valor: o endereço do Render, **sem barra no final** (ex.: `https://rpg-marcos-api.onrender.com`).
3. **Actions** → **Publicar site (GitHub Pages)** → **Run workflow** de novo.
4. Abra o site: deve aparecer **Entrar** no topo. Crie sua conta e pronto.

### Bom saber

* O plano gratuito do Render **dorme depois de 15 minutos sem uso**: o primeiro login depois disso pode levar perto de um
  minuto. Enquanto isso o site continua funcionando e as fichas ficam no navegador; a sincronização acontece quando o
  servidor acorda.
* Para impedir que estranhos criem contas, depois que o seu grupo tiver se cadastrado: no Render → seu serviço →
  **Environment** → adicione `ACCOUNTS_REGISTRATION` = `closed` → **Save** (o serviço reinicia).
* **Não há recuperação de senha por e-mail.** Quem esquecer a senha perde o acesso à conta (as fichas que estiverem no
  navegador continuam lá e podem ser exportadas).
* Nunca coloque a connection string do Neon nem o `ACCOUNTS_SECRET` no código ou no GitHub: eles ficam só no Render.
