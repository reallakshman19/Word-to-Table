# Doc2Table — Steps D2T-S1 & D2T-S1.1 Prototype (WBS 4.1 & 4.1.1)

Flexible native Word table extraction on GitHub Pages with source-linked raw leftovers.

## SCTL-P1.1 — Source Traceability tab (DRAFT / OWNER TRIAL PENDING)

This additive fourth top-level workspace is separate from Tables, CAPS and Word/HTML diff. It **does not repair conversions** or claim whole-source coverage. The base application and the Source Traceability viewer stay independent when switching workspaces.

**One-command launch:** Run `start-d2t.cmd` at the repository root. Browser-local secure-origin SHA-256 and bundled JSZip are used; no document is uploaded or persisted by SCTL.

**Five-step Owner/OTM demo:**

1. Launch and confirm **Tables | CAPS | Word/HTML diff | Source Traceability** all appear. Load a DOCX into Tables if you want to inspect state retention.
2. Open **Source Traceability**. Expect **NO VERIFIED SOURCE LOADED** with no Notes page shown.
3. Select the *private* `SCTL_P1_Missing_Source_Lens_R5_Private_Prototype.zip` (1,888,155 bytes; SHA-256 `8b5e5c8f3184f6a68dab4888ee38165473345cb37daa9a34d122532c6b1d1805`). It is **not bundled in the GitHub Pages/public repository**. The browser rejects any other ZIP, including same-size wrong hashes.
4. In the isolated offline report, click the highlighted Notes Table #2 to inspect original paragraphs, source occurrence ID, and target correspondence/absence evidence; navigate and zoom. **WORD_FIDELITY_NOT_VERIFIED** remains visible because its LibreOffice-rendered preview is not an authenticated Word page.
5. Switch to the other three tabs and back. Verify the original data/selection and the imported report remain visible. No converter or diff workflow was modified.

**Regression:** Hosted PR-only workflow `.github/workflows/xy-checks.yml` runs `tests/sctl_p11_browser.cjs` against the staged Pages build, in addition to existing XY, CAPS and staging checks. It exercises empty state, synthetic incorrect inputs, equal-size incorrect hash, actual synthetic DOCX state retention, and no upload requests. On a trusted machine with the actual private ZIP, optionally run:

```bash
SCTL_PRIVATE_ZIP="/absolute/private/path/SCTL_P1_Missing_Source_Lens_R5_Private_Prototype.zip" node tests/sctl_p11_browser.cjs
```

(Requires `npm install --no-save playwright@1.62.1` and `npx playwright install chrome`. Do **not** set `SCTL_PRIVATE_ZIP` in public CI.) Original R5 files stay outside `prototype/` and generated Pages assets. Public GitHub stores only application code and expected hashes. No authenticated Word PDF, independent fidelity verdict or Owner acceptance is claimed.

---

## Quick Start Launcher

To run the prototype locally:

```cmd
start-d2t.cmd
```

This starts a local lightweight HTTP server on port 8091 (or the next available port) serving the `prototype/` directory and automatically opens your default browser to `http://localhost:8091/`.

Alternatively, you can open `prototype/index.html` directly or serve it via any static web server. It has zero backend dependencies and works under any subpath (including GitHub Pages).

---

## Walkthrough Demo Steps (D2T-S1.1 / B2.1)

### Demo 1: Table Dropdown & Physical IDs (List all)
1. Launch the prototype using `start-d2t.cmd` and drop `Native Word.docx` (from `C:\CodeC\Doc to Table\Native Word.docx`).
2. In **List all** mode, use the **Select Table** dropdown to pick physical tables **#3**, **#11**, and **#33**.
3. Confirm that the displayed physical IDs, dimensions, and nested relationships match the source table inventory (#1 to #140).

### Demo 2: Table Filter (List all vs Only Tables with data)
1. Switch the **Filter** dropdown between **List all** and **Only Tables with data**.
2. **Only Tables with data** applies the predicate: `rowCount >= 2 AND colCount >= 2` (logical grid column count >= 2; no text condition). Exactly 50 tables qualify.
3. Observe:
   - Blank 2x2 table #8 stays in the filter.
   - Populated 1x2 table #1 is excluded from the filter.
   - All eligible nested tables (#3, #11, #33, #35, #37, #39, #41) remain visible.
   - Switching back to **List all** restores all 140 tables without renumbering or changing stable IDs.
   - If the currently selected table survives filtering (e.g. #3), its selection is retained. If an excluded table was selected (e.g. #1), selection is explicitly cleared and exports are disabled with a prompt to select a visible table.

### Demo 3: Auto Header v3 — Rule 1 Top Band (#11, #33, #35, #37, #39, #41)
1. In the dropdown, select **#11** or **#33**.
2. Click **⚡ Auto**.
3. Observe:
   - Header rows set to `0-1` (`headerRowCount = 2`).
   - Data starts at row `2` (`dataStart = 2`).
   - Explanation badge shows: `Rule 1: Top band (group title) at row 0 + column header at row 1 -> headers 0-1, data from row 2`.
4. Switch to **CSV Preview** tab: verify group title and column header are included and data begins at row 2.
5. Manually adjust header rows or data start: observe that manual edits operate independently without being locked.

### Demo 4: Auto Header v3 — Rule 2 Label Under Header (#3)
1. Select table **#3**.
2. Click **⚡ Auto**.
3. Observe:
   - Header row set to `0` (`headerRowCount = 1`).
   - Data starts at row `2` (`dataStart = 2`).
   - Label `"Pressure bar(g)"` from source row 1 is folded into header cell 0.
   - Source row 1 is excluded from the data projection; data row 2 contains `"DN 15-1200"`.
   - Explanation badge shows: `Rule 2: Header row 0 (all-bold) + label row 1 folded ("Pressure bar(g)"), data from row 2`.
4. Switch to **Grid** tab: header cell 0 shows `"Pressure bar(g)"` with indicator `[folded: Pressure bar(g)]`, and row 1 is styled as a label row excluded from data.
5. Switch to **Source XML** tab: observe raw row 1 is completely unmutated.
6. Switch to **Provenance** tab: observe that header cell (0, 0) contains companion provenance recording BOTH the destination (`Row 0, Cell 0`) and the label source (`Row 1, Cell 0 ["Pressure bar(g)"]`).
7. Repeated clicks on **⚡ Auto** do NOT duplicate label text (idempotent).

### Demo 5: Auto Header v3 — Rule 3 & Rule 4 (#44, #52, #14, #5, #8)
1. Select **#44** or **#52**:
   - Click **⚡ Auto**: consecutive bold rows 0-1 including `(DN)` are selected as headers (`headerRowCount = 2`), data starts at row 2.
2. Select **#14**:
   - Click **⚡ Auto**: header row 0 selected (`headerRowCount = 1`, data starts at 1) due to differing source cell count (3 vs last row 4).
3. Select **#5**, **#8**, **#20**, **#24**, **#58**, **#92**, or **#128**:
   - Click **⚡ Auto**: row 0 is body-like -> `0` header rows selected, data starts at row 0 (`Rule 4`).
   - In CSV preview, row 0 is retained as data.
   - Exactly 40 of the 50 eligible tables get 0 headers.

---

## Running Node Tests on Real Inputs

Both test suites run against the real files in place (`Native Word.docx` and `Word Table snaps.docx`):

### 1. D2T-S1 Baseline Suite (72 tests)
```bash
node tests/test_d2t_s1.js
```

### 2. D2T-S1.1 Targets & Falsifiers Suite (109 tests)
```bash
node tests/test_d2t_s1_1.js
```

### Verified Coverage:
- File integrity and SHA-256 validation
- 140 total physical tables, 131 body-level, 9 nested without parent double-credit
- Filter predicate `rowCount >= 2 && colCount >= 2` (50 eligible tables)
- Blank 2x2 retained, 1x2 excluded, nested eligible tables preserved
- Selection retention and explicit clearance when filtered out
- Auto v3 Rule 1: Top band (group title) on #11, #33, #35, #37, #39, #41
- Auto v3 Rule 2: Label folding and data exclusion on #3 with companion provenance
- Auto v3 Rule 3: Consecutive bold rows on #44, #52, differing cell count on #14
- Auto v3 Rule 4: Stop at first body-like row (40 of 50 tables get no header)
- Idempotency and independent manual controls
- Leading-zero strings (`031`, `001`) preserved in CSV
- Screenshot-only docx detection (0 native tables, 12 images)
