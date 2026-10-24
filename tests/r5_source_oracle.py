"""Independent stdlib OOXML source count for the checked-in R5.docx.
This is intentionally separate from browser SourceInventory and converter.
Does NOT assert historical text-fidelity or Word's physical page count.
"""
import hashlib
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

docx = Path(__file__).resolve().parents[1] / "R5.docx"
if not docx.is_file():
    raise SystemExit("Original repository R5.docx is absent")
raw = docx.read_bytes()
ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
with zipfile.ZipFile(docx) as z:
    root = ET.fromstring(z.read("word/document.xml"))
body = root.find(ns+"body")
if body is None:
    raise SystemExit("DOCX has no body")
counts = {"topLevelParagraphs": 0, "tableCount": 0, "canonicalCells": 0}
def table(tbl):
    counts["tableCount"] += 1
    for tr in list(tbl):
        if tr.tag != ns+"tr":
            continue
        for cell in list(tr):
            if cell.tag != ns+"tc":
                continue
            counts["canonicalCells"] += 1
            for child in list(cell):
                if child.tag == ns+"tbl":
                    table(child)
for child in list(body):
    if child.tag == ns+"p":
        counts["topLevelParagraphs"] += 1
    elif child.tag == ns+"tbl":
        table(child)
counts["supportedOccurrenceCount"] = counts["topLevelParagraphs"] + counts["canonicalCells"]
counts["sourceSha256"] = hashlib.sha256(raw).hexdigest()
json.dump(counts, sys.stdout, sort_keys=True)
sys.stdout.write("\n")
