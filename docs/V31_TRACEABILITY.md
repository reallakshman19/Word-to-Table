# Source traceability v3.1 — staged implementation

Scope: Static GitHub Pages. No backend requirement or invisible extraction claim.
Baseline main: f548803785e8ea94d5db17a110c592d4d6a7b718.

## Phase A data model (implemented here)
- source_inventory.js inventories original word/document.xml paragraphs and canonical table cells, including empty cells, merged-span information and nested tables. Unsupported source stories and tags emit diagnostics.
- output_inventory.js parses HTML inertly and enumerates target occurrences. It deliberately excludes scripts, templates and hidden content.
- diff_engine.js matches generated output only using verified embedded IDs, and companion HTML only using position-constrained candidates, never global substring presence.
- tests/diff_engine.test.js contains negative occurrence tests.

## Deliberate limits
This data model does not by itself establish an end-to-end conversion audit. Source ID annotation, converter events, runtime UI integration, complete exports, and independent browser tests are later stages. A green source-fidelity badge MUST NOT be shown until all gates are met. Physical Word pagination is not inferred from block counters. No R5 acceptance is claimed without the private source and independently authored oracle.

## Status
Phase A under construction; not production-ready. Do not merge/deploy until explicit owner acceptance.

## Adversarial correction F0-F4 — 2026-10-24
- Added explicit CANDIDATE_MATCH for uncorroborated matching text. Companion mode and post-hoc generated source annotations cannot certify fidelity.
- Generated matching rejects row/column/table displacement even when source IDs happen to match; true reorders need independently recorded transforms.
- Tracked-change wrappers retain inserted current text, skip deleted text, and emit diagnostics; those occurrences are UNSUPPORTED pending a revision policy.
- CSS target visibility is not computed by DOMParser; stylesheet presence is flagged, and companion visible-text preservation remains uncertified.
- This remains a HOLD: ConversionLedger still annotates IDs after serialization. To certify fidelity, bind provenance at actual converter emission, reconcile actual export bytes, and independently verify R5/Edge.

## F5–F7 and exported-artifact boundary
- F5 nested-table rows no longer contaminate outer-table grids; nested OOXML tables remain inventoried with an explicit unsupported-conversion diagnostic until actual nested conversion can be mapped.
- F7 standalone HTML and CSV include source rows, orphan output occurrences and source coverage exceptions as separate record types.
- F6 remains OPEN: a QA report generated from reconstructed table HTML does not prove byte fidelity of the Output tab CSV/Excel artifacts or selected-table exports.
- The app and offline HTML explicitly mark final-export artifact verification FALSE; no production certification is implied.
- Original R5 files, Edge, local-server parity and independent authorized reviewer validation still not run.

## F6 browser export artifact scope
Browser mode now produces selected-table CSV files and a native OOXML XLSX bundle using bundled JSZip. It reads back the exact prepared bytes, checks values against selected table grids and publishes file-specific SHA-256 hashes (including selected table identities) in the audit UI/export metadata. These prove **pre-download payload parity**, not persisted disk bytes and not original DOCX completeness. Server mode remains marked unverified until the backend can attest on-disk artifacts; existing local-server behavior is not rewritten.

## Companion refined-table report support — R5_after structure
- Browser companion parser recognizes HTML sections with `section.table-section[id=tN]`, using `tN` as an unverified *ordinal hint* to Word table N (never as independently verified identity).
- Skip generated display-only row-number column, and derived Group column cells. Retain counts of excluded decoration separately; source table numbering no longer drifts after a missing table.
- Source row hints from `title="Source row N"` are used for provisional candidate positions; no false PRESERVED status.
- Display-only report headings, TOC and summary are not treated as original DOCX paragraphs.
- Expose omitted source tables explicitly; report's "Only Tables with data" is not proof of an actual converter filtering event.
- No uploaded customer HTML is committed into this repository.

## R5_after independently observed source-text defect (private HTML not checked in)
- The original checked-in R5.docx contains 91 OOXML `w:noBreakHyphen` nodes; older `SourceInventory` and browser converter discarded them.
- Source inventory and legacy browser table parser now keep `w:noBreakHyphen` as U+2011 and `w:softHyphen` as U+00AD. Stripping either must not cause a false exact preservation classification.
- The companion report is a 44-table refined report with source-numbered `t1,t3,...,t45` sections. Table #2 is omitted, but a verified filter event is not available.
- Paired HTML is user-provided and remains local, not committed. Source-to-target counts must be qualified as text candidates rather than guaranteed source identity.
