/**
 * ui_test_suite.js
 * Automated verification of Client-Side Logic and State
 * 
 * Usage: Copy/Paste into Console or Inject via Browser Tool
 */

(async function runTests() {
    console.clear();
    console.log("%c🧪 Starting UI Test Suite...", "color: #00ff00; font-size: 16px; font-weight: bold;");

    const report = { passed: 0, failed: 0, errors: [] };

    function assert(condition, message) {
        if (condition) {
            console.log(`%c[PASS] ${message}`, "color: #4caf50");
            report.passed++;
        } else {
            console.error(`%c[FAIL] ${message}`, "color: #f44336; font-weight: bold");
            report.failed++;
            report.errors.push(message);
        }
    }

    async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ─── 1. Mock Data Setup ───
    console.log("\n🔹 Setting up Mock Data...");
    try {
        const mockResult = {
            success: true,
            totalPages: 3,
            tables: [
                { index: 0, pageNumber: 1, tableName: "Table 1", rows: 5, cols: 3, confidence: "high", html: "<table></table>", headers: ["A", "B", "C"], dataRows: [["1", "2", "3"], ["4", "5", "6"]] },
                { index: 1, pageNumber: 1, tableName: "Table 2", rows: 2, cols: 2, confidence: "low", html: "<table></table>", headers: ["X", "Y"], dataRows: [["a", "b"]] },
                { index: 2, pageNumber: 2, tableName: "Table 3", rows: 3, cols: 3, confidence: "high", html: "<table></table>", headers: ["Col1", "Col2", "Col3"], dataRows: [["d1", "d2", "d3"]] }
            ],
            logs: ["Extraction started", "Found 3 tables"]
        };

        // Inject into loadResultIntoState (exposed globally?)
        // app.js functions are global.
        if (typeof loadResultIntoState === 'function') {
            loadResultIntoState(mockResult, "test_doc.docx");
            assert(appState.tables.length === 3, "State loaded 3 tables");
            assert(appState.totalPages === 3, "State loaded 3 pages");
        } else {
            throw new Error("loadResultIntoState not found");
        }
    } catch (e) {
        assert(false, `Setup Failed: ${e.message}`);
    }

    // ─── 2. Interactive Actions ───
    console.log("\n🔹 Testing Interactive Actions...");

    // Test Approval
    try {
        const tableIdx = 1; // "Table 2" (Low confidence)
        assert(appState.tables[tableIdx].approved === false, "Table 2 starts rejected");

        if (typeof setApproval === 'function') {
            setApproval(tableIdx, true);
            assert(appState.tables[tableIdx].approved === true, "setApproval(true) updates state");

            setApproval(tableIdx, false);
            assert(appState.tables[tableIdx].approved === false, "setApproval(false) updates state");
        } else {
            assert(false, "setApproval function missing");
        }
    } catch (e) { assert(false, `Approval Test Error: ${e.message}`); }

    // Test Merge Column
    try {
        // Table 1: Headers ["A", "B", "C"], Rows [["1", "2", "3"]...]
        const tIdx = 0;
        const colIdx = 1; // "B"
        const initialCols = appState.tables[tIdx].cols;

        console.log("Testing mergeColumn...");
        if (typeof mergeColumn === 'function') {
            // Merge "B" (1) and "C" (2) -> Direction 'right' means merge 1 and 2
            await mergeColumn(tIdx, colIdx, 'right');

            const t = appState.tables[tIdx];
            assert(t.cols === initialCols - 1, "Column count decreased");
            assert(t.headers.length === 2, "Header count decreased");
            // Header at 1 should be "B C"
            assert(t.headers[1] === "B C" || t.headers[1] === "B  C", `Header merged correctly: ${t.headers[1]}`);
            // Data at row 0, col 1 should be "2 3"
            assert(t.dataRows[0][1] === "2 3" || t.dataRows[0][1] === "2  3", `Data merged correctly: ${t.dataRows[0][1]}`);
        } else {
            assert(false, "mergeColumn function missing");
        }
    } catch (e) { assert(false, `Merge Column Test Error: ${e.message}`); }

    // ─── 3. Table Editor Logic ───
    console.log("\n🔹 Testing Table Editor Logic...");
    try {
        if (typeof tableEditor !== 'undefined') {
            tableEditor.loadTable(0);
            assert(tableEditor.activeTableIndex === 0, "Editor loaded Table 1");

            // Test Page Filter Logic (Pure Logic Check)
            if (app.getTablesByPage) {
                const p1Tables = app.getTablesByPage(1);
                assert(p1Tables.length === 2, "Page 1 has 2 tables");
                const p2Tables = app.getTablesByPage(2);
                assert(p2Tables.length === 1, "Page 2 has 1 table");
            } else {
                assert(false, "app.getTablesByPage missing");
            }
        } else {
            assert(false, "tableEditor instance missing");
        }
    } catch (e) { assert(false, `Editor Test Error: ${e.message}`); }

    // ─── 4. Output Tab Logic ───
    console.log("\n🔹 Testing Output Tab Logic...");
    try {
        if (typeof OutputTab !== 'undefined') {
            // Check tree building logic (if accessible)
            // We can check if `appState.tables` structure is compatible
            assert(appState.tables[0].rows > 0, "Table 1 has rows for export");
        }
    } catch (e) { assert(false, `Output Test Error: ${e.message}`); }

    // ─── Summary ───
    console.log("\n══════════════════════════");
    if (report.failed === 0) {
        console.log(`%c✅ ALL TESTS PASSED (${report.passed}/${report.passed})`, "color: #00ff00; font-size: 14px; font-weight: bold;");
    } else {
        console.log(`%c❌ ${report.failed} TESTS FAILED`, "color: #ff0000; font-size: 14px; font-weight: bold;");
        report.errors.forEach(e => console.error(`- ${e}`));
    }

    // Return result object for external capture
    return report;

})();
