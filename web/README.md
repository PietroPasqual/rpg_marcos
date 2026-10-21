# Montador de Ficha e Livro de Regras D&D 5e (regras de 2024)

Site em **React + TypeScript + Vite** que monta fichas de personagem passo a passo, usando a API de catálogo do SRD 5.2.1 deste repositório como única fonte das regras. Não há servidor próprio nem contas: as fichas ficam no navegador (`localStorage`) e podem ser exportadas/importadas como arquivo JSON.

## Como rodar

Em dois terminais, a partir da raiz do repositório:

```bash
# 1. API de catálogo (veja o README da raiz)
uvicorn main_api:app --port 8000

# 2. Site, em modo de desenvolvimento
cd web
npm install
npm run dev          # http://localhost:5173
```

O Vite encaminha `/api` para `http://localhost:8000`. Para apontar para outra API: `VITE_API_PROXY=http://outro-host:8000 npm run dev`.

## Como publicar

**Opção 1 — um único processo.** Compile o site e deixe a própria API servi-lo:

```bash
cd web && npm install && npm run build
cd .. && uvicorn main_api:app --host 0.0.0.0 --port 8000   # site em /, API em /api/v1, docs em /docs
```

Se a pasta `web/dist` existe, a API a serve em `/` (veja `mount_web_app` em `main_api.py`).

**Opção 2 — site em hospedagem estática** (Netlify, GitHub Pages, S3...) e API em outro endereço:

```bash
VITE_API_BASE=https://api.meusite.com npm run build   # publique a pasta dist/
```

A API já libera CORS para qualquer origem (somente leitura).

**Opção 3 — GitHub Pages, sem API.** O modo estático lê JSON pré-gerados em vez de chamar a API (inclusive a busca do livro, feita no navegador):

```bash
python scripts/export_static_site.py                 # gera web/public/data/*.json
cd web && VITE_STATIC_DATA=1 npm run build           # publique a pasta dist/
```

O workflow `.github/workflows/pages.yml` faz isso a cada push na `main`; ative em Settings → Pages → Source: GitHub Actions. O build usa caminhos relativos, então funciona em `usuario.github.io/repositorio/`.

## Testes e verificação

```bash
npm test            # Vitest: regras, cálculos e validação (117 testes)
npm run typecheck   # TypeScript
npm run build       # typecheck + build de produção
```

Os testes usam um catálogo congelado em `src/test/catalog.fixture.json`, gerado pela própria API (`python scripts/export_catalog_fixture.py`, na raiz) — rode de novo se o catálogo mudar. Um teste de estresse (`matrix.test.ts`) preenche automaticamente **toda classe em 13 níveis e toda combinação de espécie × antecedente** e exige que nenhuma fique com pendências nem com valores impossíveis.

## Estrutura

```
src/
  api/        cliente HTTP e tipos do catálogo
  domain/     regras puras, sem React (o que mais importa)
    plan.ts       o que o personagem precisa escolher, dado classe/nível/espécie/antecedente
    derive.ts     todos os cálculos da ficha (atributos, PV, CA, perícias, ataques, magias...)
    validation.ts pendências por etapa;  prune.ts remove escolhas que deixaram de valer
    autofill.ts   "Preencher o que falta";  equipment.ts inventário;  feats.ts, spells.ts
  book/       Livro de Regras: páginas (pages/), detalhes de verbetes (detail/), lista+detalhe, busca
  components/ assistente (steps/), ficha (Sheet.tsx), lista de personagens (Home.tsx)
  state/      armazenamento local, exportar/importar
```

## Livro de Regras (`#/livro`)

Compêndio do SRD 5.2.1 dentro do mesmo site, lendo a mesma API:

- **Regras do jogo:** o texto do livro na ordem original (partes e capítulos, com tabelas), índice lateral, anterior/próximo e números de página.
- **Glossário** de termos de regra, **classes** (tabela de níveis, características, subclasses, opções), **espécies**, **antecedentes**, **talentos**, **magias** (filtros de nível, escola, classe, concentração e ritual), **armas** (com maestrias), **armaduras**, **ferramentas**, **equipamento de aventura**, **itens mágicos** (raridade, categoria, sintonização) e **monstros** (ND, tipo, bloco de estatísticas).
- **Busca global** no topo (`/api/v1/search`) e links diretos para cada verbete (`#/livro/magias/fireball`).
- Itens mágicos, monstros, glossário e as partes do texto das regras são baixados sob demanda (`src/book/lazy.ts`), para o montador de ficha continuar leve.

## O que está implementado (montador)

- **Nível 1 a 20**, com as 12 classes do SRD, subclasse, aumentos de atributo/talentos por nível e Dádivas Épicas.
- **Multiclasse:** quantas classes quiser (nível total até 20), com pré-requisito de 13 nos atributos primários, proficiências parciais da classe adicional, escolhas e magias separadas por classe, espaços de magia combinados (tabela de Conjurador Multiclasse; Magia de Pacto à parte), salvaguardas só da classe inicial e dados de vida de cada classe.
- **Pontos de vida:** valor médio, rolagem (botão ou digitando cada dado de vida) por classe e nível; o 1º nível da classe inicial é sempre o dado máximo.
- **Atributos:** Matriz Padrão, Compra de Pontos (27) e Manual; aumentos do antecedente (+2/+1 ou +1/+1/+1).
- **Espécie:** linhagem/ancestralidade (Elfo, Gnomo, Tiefling, Dragonato, Golias), tamanho, perícia (Humano, Elfo), atributo de conjuração; velocidade e visão no escuro da linhagem; Anão (+1 PV por nível).
- **Escolhas de classe:** perícias, ferramentas, especialização (Ladino, Bardo, Patrulheiro, Mago), Ordem Divina/Primal, Estilo de Luta (com Guerreiro Abençoado/Druídico), Maestria de Arma, Invocações Místicas, Metamagia.
- **Talentos:** Aumento de Atributo, Magic Initiate, Skilled, +1 de atributo; efeitos numéricos de Alert, Tough, Defense e Archery.
- **Magias:** truques, magias preparadas, grimório do Mago, Arcana Mística do Bruxo, espaços (inclusive Magia de Pacto), CD e ataque; magias de subclasse, espécie e talentos.
- **Efeitos automáticos:** dano da Fúria e do Ataque Furtivo nas linhas de ataque, Marca do Caçador (sempre preparada, +1d6/+1d10), estilos Armas Grandes e Duas Armas, Afinidade Elemental do Feiticeiro Dracônico (escolha do tipo, resistência e +Car no dano da magia), reservas (Lay on Hands, Bardic Inspiration, Action Surge, Indomitable, Arcane Recovery, Sopro do Dragonborn) e usos por descanso lidos do texto das características (Bônus de Proficiência ou modificador), como a ancestralidade do Golias e a Adrenaline Rush do Orc.
- **Cálculos:** PV, CA (armadura, escudo, Defesa sem Armadura do Bárbaro e do Monge, Resiliência Dracônica), iniciativa, velocidade (Movimento Rápido, Movimento sem Armadura, penalidade por Força), perícias (meia proficiência do Bardo), salvaguardas, ataques e dano (acuidade, maestria), proficiências, peso e ouro.
- **Equipamento:** opções A/B/C da classe e do antecedente, inventário editável, equipar armaduras e armas.
- **Ficha:** completa, para imprimir/PDF (abre as seções recolhidas), modo escuro, funciona no celular; exportar/importar JSON, duplicar, excluir.

## Limitações conhecidas

- Efeitos que dependem de situações do jogo (estar em Fúria, ter vantagem, empunhar uma arma só, escolher o alvo marcado) aparecem como **texto ao lado do ataque**, não como valores fixos: a ficha não controla o estado do combate.
- **Conjuração de subclasse** (Cavaleiro Místico do Guerreiro, Trapaceiro Arcano do Ladino) não tem escolhas de magia no assistente.
- Características muito específicas continuam só como texto, sem alterar números (por exemplo Elemental Affinity além do tipo escolhido, Hunter's Mark além do dano, Divine Smite).
- Os textos das regras estão em **inglês**, como no SRD; só a interface está em português.
- Não há contas nem sincronização: se limpar os dados do navegador, as fichas somem. Exporte para guardar cópias.

## Atribuição

O site exibe, no rodapé e na ficha, o texto de atribuição exigido pela licença CC-BY 4.0 do SRD 5.2.1 (retornado também por `GET /api/v1/about`). Mantenha-o em qualquer publicação.
