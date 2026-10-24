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
