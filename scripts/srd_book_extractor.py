"""
Extrai do PDF oficial do SRD 5.2.1 os capítulos de regras em texto corrido, com a hierarquia de títulos,
negrito/itálico e tabelas, convertidos para Markdown. O catálogo estruturado do Open5e não os traz.

Layout do PDF (fontes -> papel):
  GillSans-SemiBold 26pt = título de parte; 18pt = capítulo; 14pt = seção; 12pt = subseção; 10.5pt = legenda de tabela
  GillSans/Cambria 9.5pt  = células de tabela (cada célula é uma linha posicionada)
  Cambria 10pt            = texto; GillSans 9pt = barra lateral; GillSans 8pt = nota de rodapé
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import pymupdf

# Parte -> (primeira página, última página, título que encerra a extração antes do fim da faixa), páginas 1-based.
BOOK_PARTS: dict[str, tuple[int, int, str | None]] = {
    "Playing the Game": (5, 18, None),
    "Character Creation": (19, 27, None),
    "Equipment": (89, 103, None),
    "Spells": (104, 107, "Acid Arrow"),
    "Rules Glossary": (176, 191, None),
    "Gameplay Toolbox": (192, 203, None),
    "Magic Items": (204, 209, "Magic Items A–Z"),
    "Monsters": (254, 257, None),
}

ROW_GAP = 13.8  # quebra de linha dentro de célula: 10,7-12,8pt; linha nova da tabela: 14,7-15,3pt (medido em todas as tabelas)


@dataclass
class Span:
    text: str
    font: str
    size: float

    @property
    def style(self) -> str:
        bold = "Bold" in self.font or "SemiBold" in self.font
        italic = "Italic" in self.font
        return ("b" if bold else "") + ("i" if italic else "")


@dataclass
class Line:
    x0: float
    x1: float
    y0: float
    y1: float
    spans: list[Span]
    page: int
    kind: str = ""

    @property
    def text(self) -> str:
        return "".join(s.text for s in self.spans)

    @property
    def first(self) -> Span:
        return next((s for s in self.spans if s.text.strip()), self.spans[0])


@dataclass
class Block:
    kind: str  # "p" ou "table"
    text: str
    caption: str | None = None

    @property
    def markdown(self) -> str:
        return f"**{self.caption}**\n\n{self.text}" if self.caption else self.text


@dataclass
class Section:
    part: str
    depth: int
    title: str
    page: int
    blocks: list[Block] = field(default_factory=list)

    @property
    def markdown(self) -> str:
        parts: list[str] = []
        previous_was_list = False
        for block in self.blocks:
            if not block.text.strip():
                continue
            is_list = block.kind == "p" and block.text.startswith("- ")
            # itens de lista consecutivos formam uma lista só (sem linha em branco entre eles)
            parts.append(("\n" if previous_was_list and is_list else "\n\n") + block.markdown if parts else block.markdown)
            previous_was_list = is_list
        return "".join(parts).strip()


def classify(line: Line) -> str:
    span = line.first
    font, size = span.font, round(span.size, 1)
    if "SC700" in font:
        return "sidebar_title"
    if size >= 10.9 and size <= 11.1 and font.startswith("GillSans"):
        return "skip"  # cabeçalho e número de página
    if font == "GillSans-SemiBold":
        if size >= 24:
            return "h1"
        if 17 <= size <= 19:
            return "h2"
        if 13 <= size <= 15:
            return "h3"
        if 11.5 <= size <= 12.5:
            return "h4"
        if 10.3 <= size <= 10.7:
            return "caption"
    if size < 6:
        return "skip"  # sobrescritos soltos (†)
    if font.startswith("GillSans") and 9.1 <= size <= 9.6:
        return "cell"
    if font.startswith("Cambria") and 9.3 <= size <= 9.7:
        return "cell"
    if font.startswith("ScalaSans") and 9.8 <= size <= 10.2:
        return "sidebar"  # barra lateral de "Running a Monster"
    if font.startswith("GillSans") and 8.8 <= size <= 9.1:
        return "sidebar"
    if font.startswith("GillSans") and 7.8 <= size <= 8.2:
        return "footnote"
    if font.startswith("Cambria") and 9.8 <= size <= 10.2:
        return "body"
    if font.startswith("GillSans") and 9.8 <= size <= 10.2:
        return "callout"  # listas de termos e fórmulas em destaque
    return "unknown"


# ---------------------------------------------------------------------------------------------
# Texto com estilo
# ---------------------------------------------------------------------------------------------

Run = tuple[str, str]  # (texto, estilo: "", "b", "i", "bi")


def line_runs(line: Line) -> list[Run]:
    runs: list[Run] = []
    for span in line.spans:
        text = span.text.replace("\t", " ").replace(" ", " ")
        if not text:
            continue
        runs.append((text, span.style))
    return runs


def join_runs(runs: list[Run], new: list[Run]) -> list[Run]:
    """Concatena a próxima linha, desfazendo a hifenização de fim de linha ("num-" + "ber" -> "number")."""
    if not new:
        return runs
    if not runs:
        return new[:]
    last_text, last_style = runs[-1]
    first_text, first_style = new[0]
    stripped = last_text.rstrip()
    if stripped.endswith("-") and len(stripped) > 1 and stripped[-2].isalpha() and first_text[:1].islower():
        runs = runs[:-1] + [(stripped[:-1], last_style)]
        return runs + new
    if last_text.endswith(" ") or first_text.startswith(" "):
        return runs + new
    return runs[:-1] + [(last_text + " ", last_style)] + new


def render_runs(runs: list[Run]) -> str:
    merged: list[Run] = []
    for text, style in runs:
        if merged and merged[-1][1] == style:
            merged[-1] = (merged[-1][0] + text, style)
        else:
            merged.append((text, style))
    out = ""
    for text, style in merged:
        core = text.strip()
        if not core or not style:
            out += text
            continue
        marker = {"b": "**", "i": "*", "bi": "***"}[style]
        lead = text[: len(text) - len(text.lstrip())]
        tail = text[len(text.rstrip()):]
        out += f"{lead}{marker}{core}{marker}{tail}"
    return re.sub(r"[ ]{2,}", " ", out).strip()


# ---------------------------------------------------------------------------------------------
# Tabelas
# ---------------------------------------------------------------------------------------------


def build_table(cells: list[Line]) -> str:
    """Reconstrói uma tabela Markdown a partir das células posicionadas (uma linha de texto por célula)."""
    rows: list[list[Line]] = []
    for cell in sorted(cells, key=lambda c: (round(c.y0), c.x0)):
        if rows and abs(rows[-1][0].y0 - cell.y0) <= 3:
            rows[-1].append(cell)
        else:
            rows.append([cell])
    header = sorted(rows[0], key=lambda c: c.x0)
    if len(header) < 2:
        # Primeira linha com uma célula só (título interno): trata como linha de seção e usa a seguinte como cabeçalho
        if len(rows) > 1:
            header = sorted(rows[1], key=lambda c: c.x0)
            rows = rows[1:]
    columns = len(header)

    def column_of(cell: Line) -> int:
        best, best_d = 0, 1e9
        cx = (cell.x0 + cell.x1) / 2
        for i, h in enumerate(header):
            d = min(abs(cell.x0 - h.x0), abs(cell.x1 - h.x1), abs(cx - (h.x0 + h.x1) / 2))
            if d < best_d - 0.01:
                best, best_d = i, d
        return best

    table: list[list[list[Run]]] = []  # linhas -> colunas -> runs
    section_rows: dict[int, str] = {}
    previous_y = None
    for row in rows:
        row = sorted(row, key=lambda c: c.x0)
        gap = 99 if previous_y is None else row[0].y0 - previous_y
        previous_y = row[0].y0
        if len(row) == 1 and all(s.style == "i" for s in row[0].spans if s.text.strip()) and len(table) > 0:
            section_rows[len(table)] = render_runs([(t, "") for t, _ in line_runs(row[0])])
            table.append([[] for _ in range(columns)])
            continue
        assigned = {column_of(c): c for c in row}
        starts_new = 0 in assigned and (gap > ROW_GAP or not table)
        if not table or starts_new or len(table) - 1 in section_rows and 0 in assigned:
            table.append([[] for _ in range(columns)])
        for col, cell in assigned.items():
            table[-1][col] = join_runs(table[-1][col], line_runs(cell))

    def md(cell: list[Run], plain: bool = False) -> str:
        runs = [(text, "") for text, _ in cell] if plain else cell
        return render_runs(runs).replace("|", "\\|")

    lines = ["| " + " | ".join(md(c, plain=True) for c in table[0]) + " |", "|" + "|".join("---" for _ in range(columns)) + "|"]
    for index, row in enumerate(table[1:], start=1):
        if index in section_rows:
            lines.append("| " + " | ".join([f"**{section_rows[index]}**"] + [""] * (columns - 1)) + " |")
        else:
            lines.append("| " + " | ".join(md(c) for c in row) + " |")
    return "\n".join(lines)


def is_statbox(cells: list[Line]) -> bool:
    """Caixa de dados de item ("Ability: ... Utilize: ... Weight: ..."): começa com um rótulo em negrito, não com um cabeçalho."""
    first = sorted(cells, key=lambda c: (round(c.y0), c.x0))[0]
    return first.first.style.startswith("b") and re.match(r"^[A-Z][A-Za-z ]+:", first.text.strip()) is not None


def build_statbox(cells: list[Line]) -> str:
    """Converte uma caixa de rótulos em lista: um item por rótulo, com as linhas de continuação agrupadas."""
    items: list[list[Run]] = []
    # coluna da esquerda de cima para baixo e depois a da direita, como se lê a caixa
    mid = (min(c.x0 for c in cells) + max(c.x1 for c in cells)) / 2
    ordered = sorted((c for c in cells if c.x0 < mid), key=lambda c: c.y0) + sorted((c for c in cells if c.x0 >= mid), key=lambda c: c.y0)
    for cell in ordered:
        runs = line_runs(cell)
        if cell.first.style.startswith("b") or not items:
            items.append(runs)
        else:
            items[-1] = join_runs(items[-1], runs)
    rendered = ["- " + render_runs(item) for item in items]
    return "\n".join(sorted(rendered, key=lambda item: item.startswith("- **Weight:**")))  # peso sempre por último


# ---------------------------------------------------------------------------------------------
# Extração
# ---------------------------------------------------------------------------------------------


def page_lines(page: pymupdf.Page, number: int) -> list[Line]:
    lines: list[Line] = []
    for block in page.get_text("dict")["blocks"]:
        for raw in block.get("lines", []):
            spans = [Span(s["text"], s["font"].split("+")[-1], s["size"]) for s in raw["spans"] if s["text"]]
            if not spans or not "".join(s.text for s in spans).strip():
                continue
            x0, y0, x1, y1 = raw["bbox"]
            line = Line(x0, x1, y0, y1, spans, number)
            line.kind = classify(line)
            lines.append(line)
    return lines


class BookExtractor:
    def __init__(self, doc: pymupdf.Document) -> None:
        self.doc = doc
        self.sections: list[Section] = []
        self.warnings: list[str] = []
        self.part_title = ""
        self.stop_title: str | None = None
        self.current: Section | None = None
        self.stop = False
        self._reset_buffers()

    def _reset_buffers(self) -> None:
        self.para: list[Run] = []
        self.para_is_formula = False
        self.para_kind = ""  # "p", "li", "sidebar", "footnote", "callout"
        self.table: list[Line] = []
        self.caption: str | None = None
        self.heading: list[Line] = []
        self.side_title = ""
        self.last_kind = ""
        self.last_y = 0.0

    # -- blocos --------------------------------------------------------------------------
    def _add_block(self, text: str, kind: str = "p", caption: str | None = None) -> None:
        if self.current is not None and text.strip():
            self.current.blocks.append(Block(kind, text, caption))

    def _flush_para(self) -> None:
        if not self.para:
            return
        text = render_runs(self.para)
        if self.para_kind == "callout":
            text = "- " + text
        elif self.para_kind == "li":
            text = "- " + text.removeprefix("• ").lstrip("• ").strip()
        elif self.para_kind == "sidebar":
            text = "> " + (f"**{self.side_title}** " if self.side_title else "") + text
            self.side_title = ""
        elif self.para_kind == "footnote":
            text = f"*{text.replace('*', '').strip()}*"
        self._add_block(text)
        self.para, self.para_kind = [], ""

    def _flush_table(self) -> None:
        if not self.table:
            return
        if is_statbox(self.table):
            self._add_block(build_statbox(self.table))
            self.caption = None
            self.table = []
            return
        markdown = build_table(self.table)
        previous = self.current.blocks[-1] if self.current is not None and self.current.blocks else None
        header = markdown.split("\n", 1)[0]
        if previous is not None and previous.kind == "table" and not self.caption and previous.text.split("\n", 1)[0] == header:
            # continuação da mesma tabela depois de uma quebra de coluna ou de página (o cabeçalho se repete)
            body = markdown.split("\n")[2:]  # sem cabeçalho nem separador
            if body:
                previous.text += "\n" + "\n".join(body)
        else:
            self._add_block(markdown, "table", self.caption)
        self.caption = None
        self.table = []

    def _flush_heading(self) -> None:
        if not self.heading:
            return
        kind = self.heading[0].kind
        text = " ".join(render_runs(line_runs(l)).replace("*", "") for l in self.heading).strip()
        page = self.heading[0].page
        self.heading = []
        depth = {"h1": 1, "h2": 2, "h3": 3, "h4": 4}[kind]
        if self.stop_title and text == self.stop_title:
            self.stop = True
            return
        self.current = Section(self.part_title, depth, text, page)
        self.sections.append(self.current)

    def _flush_all(self) -> None:
        self._flush_heading()
        self._flush_para()
        self._flush_table()

    # -- linhas --------------------------------------------------------------------------
    def feed(self, line: Line) -> None:
        kind = line.kind
        if kind == "skip":
            return
        if kind == "unknown":
            self.warnings.append(f"p{line.page}: fonte inesperada {line.first.font} {line.first.size:.1f}: {line.text[:50]!r}")
            kind = "body"

        if kind in {"h1", "h2", "h3", "h4"}:
            if self.heading and self.heading[0].kind == kind and -10 < line.y0 - self.heading[-1].y1 < 8:
                self.heading.append(line)  # título quebrado em duas linhas
            else:
                self._flush_all()
                self.heading = [line]
            self.last_kind = kind
            return
        self._flush_heading()
        if self.stop:
            return

        if kind == "caption":
            self._flush_para()
            self._flush_table()
            self.caption = (self.caption + " " if self.caption else "") + render_runs(line_runs(line)).replace("*", "")
        elif kind == "cell":
            self._flush_para()
            if self.table and line.y0 < self.table[-1].y0 - 30:  # nova coluna da página: outra tabela
                self._flush_table()
            self.table.append(line)
        elif kind == "sidebar_title":
            self._flush_para()
            self._flush_table()
            self.side_title = (self.side_title + line.text.strip()).replace("  ", " ")
        else:  # body, sidebar, footnote
            self._flush_table()
            new_kind = {"body": "p", "sidebar": "sidebar", "footnote": "footnote", "callout": "callout"}[kind]
            indented = line.spans[0].text.startswith("\t")
            bullet = kind == "body" and line.text.lstrip().startswith("•")
            starts_bold = line.first.style.startswith("b")
            if self.para:
                same_kind = new_kind == self.para_kind or (new_kind == "p" and self.para_kind == "li")
                last_bold = self.para[-1][1].startswith("b")
                # Termo em negrito no começo da linha ("**Constitution.** ...") abre um item novo, salvo se é só a quebra de um negrito
                new_item = (kind in {"body", "sidebar"} and starts_bold and not last_bold and self.para_kind in {"p", "li", "sidebar"})
                if kind == "callout":
                    new_item = starts_bold or self.para_kind == "callout" and not self.para_is_formula
                if not same_kind or indented or bullet or new_item:  # continuação de item de lista não tem recuo nem marcador
                    self._flush_para()
            if not self.para:
                self.para_kind = "li" if bullet else new_kind
                self.para_is_formula = kind == "callout" and starts_bold
            if not self.para:
                self.para_kind = "li" if bullet else new_kind
            self.para = join_runs(self.para, line_runs(line))
        self.last_kind = kind

    # -- páginas -------------------------------------------------------------------------
    def run_part(self, title: str, first: int, last: int, stop_title: str | None) -> None:
        self.part_title = title
        self.stop_title = stop_title
        self.stop = False
        self.current = None
        self._reset_buffers()
        for number in range(first, last + 1):
            for line in page_lines(self.doc[number - 1], number):
                if line.kind == "h1" and number != first:
                    self._flush_all()  # começou outra parte: terminou
                    return
                self.feed(line)
                if self.stop:
                    self._flush_para()
                    self._flush_table()
                    return
        self._flush_all()


def relocate_floating_tables(sections: list[Section]) -> int:
    """
    No PDF, tabelas ficam onde cabem na página, às vezes no meio de outra seção. Move cada tabela com legenda
    para logo após o parágrafo que a cita ("... na tabela Travel Terrain"), a menos que ela já esteja
    dentro da seção que a cita. Retorna quantas foram movidas.
    """
    moved = 0
    for si, section in enumerate(sections):
        for block in list(section.blocks):
            if block.kind != "table" or not block.caption:
                continue
            pattern = re.compile(rf"\b{re.escape(block.caption)}\s+table\b", re.IGNORECASE)
            target = None
            for ti, other in enumerate(sections):
                if other.part != section.part:
                    continue
                for bi, candidate in enumerate(other.blocks):
                    if candidate.kind == "p" and pattern.search(candidate.text):
                        target = (ti, bi)
                        break
                if target:
                    break
            if target is None or target[0] == si:
                continue
            ti = target[0]
            # a tabela já está dentro do escopo da seção que a cita (subseções posteriores)?
            inside = ti < si and all(sections[k].depth > sections[ti].depth for k in range(ti + 1, si + 1))
            if inside:
                continue
            section.blocks.remove(block)
            sections[ti].blocks.insert(target[1] + 1, block)
            moved += 1
    return moved


def extract_book(doc: pymupdf.Document) -> tuple[list[dict[str, Any]], list[str]]:
    extractor = BookExtractor(doc)
    for part, (first, last, stop_title) in BOOK_PARTS.items():
        extractor.run_part(part, first, last, stop_title)
    moved = relocate_floating_tables(extractor.sections)
    if moved:
        extractor.warnings.append(f"info: {moved} tabela(s) reposicionada(s) junto ao texto que as cita")
    sections = [
        {"part": s.part, "depth": s.depth, "title": s.title, "page": s.page, "markdown": s.markdown}
        for s in extractor.sections
        if s.markdown or s.depth > 1
    ]
    return sections, extractor.warnings
