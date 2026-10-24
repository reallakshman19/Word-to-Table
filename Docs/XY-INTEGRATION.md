# X/Y integration in the active Doc2Table prototype

The launched application is `prototype/index.html`. The existing Tables workspace
retains S1.3 header selection, refinement, recovery, Undo, title paths and CSV.
Two adjacent workspaces connect its actual output to the supplied prototypes.

The workspaces retain the individual apps' presentation: the Word comparison
uses a dark dashboard, live status cards, review filters and paired source/output
cards; CAPS uses a catalog with KPI cards, search/group/type/size filters,
pagination, five workspace tabs and a field inspector. Configuration forms update
the real transformer. HTML drag-and-drop in CAPS preserves the loaded Word audit.
Technical identities and full raw evidence remain available on demand. All styles
are bundled locally; the historical Word design preview's sample counts, page
numbers and data are not copied into the running application.
All workspaces share one dark palette in `prototype/css/theme.css`. Main tabs
are ordered **Tables → CAPS → Word/HTML diff**, with prototype X/Y labels removed.

## Y: Word / HTML diff

1. Open a DOCX in Tables; select a table and adjust its header/data controls.
2. Open **Word/HTML diff**, then **Audit current table**. Alternatively,
   run the existing Batch operation and choose **Audit last batch**.
3. Upload companion HTML to compare an external result. Such matches remain
   candidates: imported source attributes cannot create observed emission links.
4. Search/filter raw source occurrences, inspect every output link and coverage
   warning, or download the complete JSON, CSV or standalone HTML audit.
   Filtering/pagination never removes records from exports.

The inventory independently reads canonical OOXML cells and outside-cell
paragraphs. It preserves empty cells and repeated occurrences. Original bytes,
source SHA-256, structural paths, actual target bytes/hash, unsupported features
and unmatched target extras remain available. Current-table output deliberately
leaves other document occurrences unrepresented in that target.

Native CSV serialization and batch HTML receive runtime operation receipts.
Header contributors, recovered headers, repeated Group values and multiple
destinations are explicit. `VERIFIED_*` means an observed serialization relation;
it is not engineering approval, complete Word rendering, or a fidelity certificate.
Nested tables, vertical merges, textboxes and unsupported story parts receive
limited/unsupported dispositions. Original DOCX download preserves their bytes.
The inventory is not a complete Word package renderer. Binary `.doc` is not parsed.

## X: HTML to CAPS

Use the current generated output, the current fresh Y target, or uploaded
Compare/After HTML. After-only input is identified explicitly; no Before document
is fabricated. Select a CAPS field to inspect its value, rule/config dependencies,
unresolved lineage and, where authenticated, its original Word occurrence in Y.

The supplied v2.3 browser transformation engine is reused with explicit changes:
private metadata defaults/reference tie records are removed; thermowell processing
examines the first body row when headers are in `thead`; every suppressed record
retains its complete values in the raw audit. The source `caps_app.html` identity is
`a60d15f59c8df5db262754b8db0fc8b98e2af8c38f61c7bdf08a7dbca690bd21`.
This derived vendor file is a documented size exception. Other new modules are
under 300 lines; the existing parser/controller/recovery implementations are intact.

All 30 emitted fields receive dispositions, including unresolved blank values.
The diagnostic export retains original HTML, configuration/hashes, raw emitted
and suppressed records, primary contexts and unclassified source cells. Only a
limited set of field derivations is instrumented; inherited approximate catalog
joins, defaults and suppression decisions still require review. The original
prototype's broader frozen field-ledger claims are not transferred to arbitrary
new inputs or configurations.

Validated export remains blocked. Provisional CSV exports all current computed
rows after explicit acknowledgement, regardless of catalog filters. Export rejects
stale results, empty output, incomplete columns and non-finite values. Spreadsheet
formula-like strings are escaped in CSV; evidence JSON retains their raw values,
unresolved fields and complete suppressed records. A new transformation resets
acknowledgement. Changing source/config invalidates results.

Optional frozen-reference qualification separately requires the exact registered
HTML and privately uploaded CSV, equality of every newly computed record/field
occurrence and the frozen output hash. A qualified export preserves that reference
serialization. Reference data supplies disclosed metadata/order/serialization;
it never replaces mismatched computed field values or certifies other inputs.

## Static delivery and checks

`python scripts/build_pages.py --output <empty-directory>` stages only this
prototype's HTML, JavaScript, CSS and `.nojekyll`. The Pages workflow uploads that
directory. Source packages, Word documents, reference CSVs, logs and tests are
excluded; the two supplied private packages are also Git-ignored. No backend or
CDN is required by the staged application. Workflow changes do not constitute an
actual hosted CI run or deployment.

Run `node tests/xy_caps_export_test.cjs`, `node tests/xy_compare_test.cjs`,
`node tests/xy_reference_test.cjs`, and
`python -m unittest discover -s tests -p test_pages_bundle.py`.
`node tests/xy_integration_browser.cjs` uses Playwright with real Chrome and
synthetic inputs. `XY_SITE_ROOT` selects a staged site. Optional `XY_PRIVATE_*`
and `XY_NATIVE_*` environment variables supply local-only fixtures/expectations;
none are embedded in the tests or delivery. `XY_NATIVE_BASELINE` supplies a
separately measured untouched baseline for existing title-path discrepancies.

The six historical `test_d2t_s1*.js` suites contain original-document expectations
and now run from the Owner's private fixture bundle. Set `D2T_PRIVATE_TEST_DIR`
to that directory before running them. Without it, each suite explicitly reports
SKIP; that is not a passing original-document test. The public synthetic checks
remain self-contained. The delivery branch contains a clean snapshot based on
main; older public branches and their history have not been rewritten.

Local checks found an existing S1.3 UI title-path discrepancy against private
expectations; baseline and candidate reproduce the same result. Recovery headers
and Undo match. This integration preserves that behavior and does not certify it
as corrected. Full `.doc` support, unsupported Word features, engineering
validation, collision rulings and Owner acceptance remain outside this delivery.
