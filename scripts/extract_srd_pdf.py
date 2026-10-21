"""
Extrai do PDF oficial do SRD 5.2.1 os dados que não existem no dataset estruturado do Open5e:

* Glossário de Regras ("Rules Glossary", páginas 176-191): ações, áreas de efeito,
  condições, perigos, atitudes e regras gerais.
* Proficiências obtidas ao entrar em cada classe por multiclasse ("As a Multiclass Character").

Uso (requer `pip install -r requirements-dev.txt`):
  python scripts/extract_srd_pdf.py caminho/SRD_CC_v5.2.1.pdf data/srd_5_2_1/srd_pdf_extract.json
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import pymupdf

GLOSSARY_FIRST_PAGE = 175  # índice 0-based da página "Rules Glossary" (página 176 do livro)
GLOSSARY_STOP_HEADING = "Gameplay Toolbox"
GLOSSARY_SKIP_HEADINGS = {"Rules Glossary", "Glossary Conventions", "Rules Definitions"}
CLASSES_PAGE_RANGE = (25, 83)

CLASS_NAMES = [
    "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk",
    "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard",
]


def _is_heading(span: dict[str, Any]) -> bool:
    return span["font"] == "GillSans-SemiBold" and span["size"] >= 11.9


def _is_body(span: dict[str, Any]) -> bool:
    # Texto corrido (Cambria) e listas inline (GillSans 10pt). Tabelas usam GillSans 9.5pt
    # e cabeçalho/rodapé de página GillSans 11pt: ambos ficam de fora.
    return span["font"].startswith("Cambria") or (span["font"] == "GillSans" and round(span["size"], 1) == 10.0)


def _append_line(text: str, line: str) -> str:
    """Concatena linhas desfazendo a hifenização de fim de linha ("num-" + "ber" -> "number")."""
    line = line.strip()
    if not line:
        return text
    if not text:
        return line
    if text.endswith("-") and not text.endswith(" -"):
        head = text[:-1].rsplit(" ", 1)[-1]
        if re.search(r"[\d-]", head) or line[:1].isupper():
            return text + line
        return text[:-1] + line
    if text.endswith("—"):
        return text + line
    return text + " " + line


def extract_glossary(doc: pymupdf.Document) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    block_text = ""
    block_lead_in = False
    block_is_list = False

    def flush_block() -> None:
        nonlocal block_text, block_lead_in, block_is_list
        if current is not None and block_text.strip():
            current["blocks"].append({"lead_in": block_lead_in, "text": re.sub(r"\s+", " ", block_text).strip()})
        block_text = ""
        block_lead_in = False
        block_is_list = False

    for page in doc.pages(GLOSSARY_FIRST_PAGE, doc.page_count):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = [s for s in line["spans"] if s["text"]]
                if not spans:
                    continue
                if all(_is_heading(s) for s in spans if s["text"].strip()):
                    title = " ".join(s["text"].strip() for s in spans if s["text"].strip())
                    flush_block()
                    if title == GLOSSARY_STOP_HEADING:
                        return [_normalize_entry(e) for e in entries if e["heading"] not in GLOSSARY_SKIP_HEADINGS]
                    if current is not None and not current["blocks"] and current["heading"].endswith(("of", "and")):
                        current["heading"] += " " + title  # título quebrado em duas linhas
                        continue
                    current = {"heading": title, "blocks": []}
                    entries.append(current)
                    continue

                body_spans = [s for s in spans if _is_body(s)]
                if not body_spans:
                    continue
                starts_paragraph = body_spans[0]["text"].startswith("\t")
                visible = [s for s in body_spans if s["text"].strip()]
                if not visible:
                    if starts_paragraph:
                        flush_block()
                    continue
                # Listas inline (GillSans) viram um bloco próprio, com itens separados por vírgula.
                is_list = all(s["font"] == "GillSans" for s in visible)
                if starts_paragraph or is_list != block_is_list:
                    flush_block()
                    block_lead_in = visible[0]["font"] == "Cambria-BoldItalic"
                    block_is_list = is_list
                line_text = "".join(s["text"] for s in body_spans).replace("\t", " ")
                if is_list and block_text:
                    block_text += ", " + line_text.strip()
                else:
                    block_text = _append_line(block_text, line_text)
    flush_block()
    return [_normalize_entry(e) for e in entries if e["heading"] not in GLOSSARY_SKIP_HEADINGS]


def _normalize_entry(entry: dict[str, Any]) -> dict[str, Any]:
    match = re.match(r"^(?P<name>.+?)\s*\[(?P<tag>[^\]]+)\]$", entry["heading"])
    name = match.group("name") if match else entry["heading"]
    tag = match.group("tag") if match else None

    paragraphs: list[str] = []
    bullets: list[dict[str, str]] = []
    see_also: list[str] = []
    for block in entry["blocks"]:
        text = block["text"]
        see = re.search(r"\s*See also\s+(.+)$", text)
        if see:
            see_also.extend(re.findall(r"“([^”(]+?)[.,]?”", see.group(1)))
            text = text[: see.start()].strip()
            if not text:
                continue
        lead = re.match(r"^(?P<title>[^.]{1,80})\.\s+(?P<body>.+)$", text) if block["lead_in"] else None
        if lead:
            bullets.append({"name": lead.group("title"), "text": lead.group("body")})
        else:
            paragraphs.append(text)

    return {"name": name, "tag": tag, "paragraphs": paragraphs, "bullets": bullets, "see_also": see_also}


def extract_multiclass(doc: pymupdf.Document) -> dict[str, str]:
    lines: list[str] = []
    for page in doc.pages(*CLASSES_PAGE_RANGE):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                lines.append("".join(s["text"] for s in line["spans"]))
    flat = ""
    for line in lines:
        flat = _append_line(flat, line.replace("\t", " "))
    flat = re.sub(r"\s+", " ", flat)

    result: dict[str, str] = {}
    for class_name in CLASS_NAMES:
        match = re.search(
            rf"Gain (?:the following traits|the Hit Point Die(?: trait)?) from the Core {class_name} Traits table"
            rf"(?::\s*[^•]+?)?\.(?=\s*•)",
            flat,
        )
        result[class_name.lower()] = match.group(0).strip() if match else ""
    return result


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(2)
    pdf_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    with pymupdf.open(pdf_path) as doc:
        data = {
            "source": "System Reference Document 5.2.1 (SRD_CC_v5.2.1.pdf)",
            "rules_glossary": extract_glossary(doc),
            "multiclass_proficiencies": extract_multiclass(doc),
        }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    missing = [k for k, v in data["multiclass_proficiencies"].items() if not v]
    print(f"[OK] {len(data['rules_glossary'])} entradas de glossário -> {out_path}")
    if missing:
        print(f"[WARN] Multiclasse não encontrada para: {', '.join(missing)}")


if __name__ == "__main__":
    main()
