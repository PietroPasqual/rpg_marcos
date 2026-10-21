# Dados do SRD 5.2.1

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## Origem dos arquivos

* `open5e/*.json` — cópia sem alterações dos arquivos do documento `srd-2024` do projeto Open5e (https://github.com/open5e/open5e-api, pasta `data/v2/wizards-of-the-coast/srd-2024`), uma transcrição estruturada do SRD 5.2.
* `srd_pdf_extract.json` — extraído automaticamente do PDF oficial `SRD_CC_v5.2.1.pdf` (`scripts/extract_srd_pdf.py`): o Glossário de Regras, as proficiências de multiclasse e os capítulos de regras em texto corrido (`book`: Playing the Game, Character Creation, Equipment, Spells, Gameplay Toolbox, Magic Items e Monsters), com títulos, negrito/itálico e tabelas em Markdown.

Para atualizar: `python scripts/download_srd_data.py` (ou `python sync_srd_cli.py --download`).

## Alterações feitas na importação

O importador (`srd_importer.py`) reorganiza esse conteúdo nos modelos da API e faz pequenas correções: remove marcação de links que vazou de outra ferramenta (ex.: `Sphere [Area of Effect]|XPHB|Sphere`), corrige nomes trocados ou com erro de digitação (`In sight` → `Insight`, coluna "Cantrips Known" do Druida → "Wild Shape", `Unarmoed` → `Unarmored`), retira o preço que vinha no nome de algumas ferramentas e calcula valores derivados (XP e bônus de proficiência por Nível de Desafio, Iniciativa passiva, modificadores de atributo).
