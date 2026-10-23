# Doc2Table — Step D2T-S1 Prototype (WBS 4.1)

Flexible native Word table extraction on GitHub Pages with source-linked raw leftovers.

## Quick Start Launcher

To run the prototype locally:

```cmd
start-d2t.cmd
```

This starts a local lightweight HTTP server on port 8091 (or the next available port) serving the `prototype/` directory and automatically opens your default browser to `http://localhost:8091/`.

Alternatively, you can open `prototype/index.html` directly or serve it via any static web server. It has zero backend dependencies and works under any subpath (including GitHub Pages).

---

## Walkthrough Demo Steps

### Step 1: Open Native Word.docx
1. Launch the prototype using `start-d2t.cmd`.
2. Drag and drop `Native Word.docx` into the drop zone (or click **"Open .docx file"** and browse to `C:\CodeC\Doc to Table\Native Word.docx`).
3. Observe status bar and navigator:
   - **Total tables:** 140
   - **Body-level tables:** 131
   - **Nested tables:** 9 (e.g., Table 3 in 2, 11 in 10, 33 in 32, 35 in 34, 37 in 36, 39 in 38, 41 in 40, 44 in 43, 52 in 51)
   - **Total rows:** 610

### Step 2: Inspect a Physical Table & Source XML
1. Click any table in the left sidebar (e.g., **Table 1** or nested **Table 3**).
2. The **Grid** tab shows the unaltered physical table with cell contents. Spanned cells are labeled `⬅ span` and nested tables are indicated with `📋 [nested table N]`.
3. Switch to the **Source XML** tab to inspect the raw `<w:tbl>` OpenXML element with syntax highlighting.

### Step 3: Header Row Selection (0, 1, 2) & Data Start
1. In the top controls bar, test **Header rows**:
   - `0 (no header)`: Generates synthetic headers (`Column_1`, `Column_2`, ...). All table rows are exported as data.
   - `1`: First physical row (row 0) becomes the column headers. Data starts at row 1.
   - `2`: Combines row 0 and row 1 (`HeaderA / HeaderB`). Data starts at row 2.
2. Adjust **Data starts at row** independently of the header row count.
3. Switch to the **CSV Preview** tab to see real-time updates of the RFC 4180 CSV projection.

### Step 4: Leading-Zero Strings & CSV Export
1. Select a table containing leading-zero codes (such as Table 44 or Table 52).
2. In the **CSV Preview** tab, observe literal strings such as `031` and `001` preserved exactly (never truncated to numbers like `31` or `1`).
3. Click **"⬇ Download CSV"** to save the `.csv` file.
4. Switch to the **Provenance** tab to inspect the companion record for every exported value:
   - Source file SHA-256 hash
   - Source XML part (`word/document.xml`)
   - Source table index
   - Source physical row index
   - Source physical cell index
   - Raw cell text

### Step 5: Screenshot-Only Docx (Word Table snaps.docx)
1. Drop or select `Word Table snaps.docx`.
2. The prototype displays:
   - **0 native tables** (both body-level and nested)
   - Notice: **12 image occurrences** with explicit **not-converted** status.
   - Zero invented or hallucinated tables.

---

## Running Node Tests on Real Inputs

To run the comprehensive automated test suite against the real files:

```bash
node tests/test_d2t_s1.js
```

This verifies:
- Cryptographic SHA-256 hashes of both real inputs
- Accurate table inventory (140 total: 131 body, 9 nested, 610 rows)
- Nested table relationships and absence of parent double-credit
- GridSpan expansion (spans of 2, 8, 20) and row normalization
- Header row configurations (0, 1, 2) and independent data start
- Leading-zero string preservation (`031`, `001`)
- Companion provenance records for every CSV cell
- Screenshot-only docx detection (0 native tables, 12 images)
