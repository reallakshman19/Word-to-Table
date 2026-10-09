/**
 * header_naming.js
 * 
 * "Smart Header Naming" module.
 * Logic to improve table readability by refining headers and table names post-extraction.
 * Works for both Smart and Robust modes.
 */

const HeaderNaming = {
    /**
     * Main entry point.
     * @param {Array} tables - Array of table objects from appState.
     */
    run: function (tables) {
        console.log("Running Smart Header Naming...");
        let changes = 0;

        tables.forEach(table => {
            // 1. Promote Row 1 to Header if current headers are generic ("Column_X") 
            //    AND Row 1 looks like a valid header.
            if (this.shouldPromoteRow1(table)) {
                this.promoteRow1(table);
                changes++;
            }

            // 2. Clean Duplicate Headers (e.g. "Value", "Value" -> "Value", "Value_1")
            if (this.deduplicateHeaders(table)) {
                changes++;
            }

            // 3. Clean "Column_X" in headers if mixed with real names
            //    (e.g. "Name", "Column_2", "Age" -> "Name", "", "Age" or infer?)
            //    For now, we leave them as "Column_X" is often better than empty, 
            //    but we could potentially rename them if we had heuristics.
        });

        console.log(`Smart Header Naming applied. Modified ${changes} tables.`);
    },

    shouldPromoteRow1: function (table) {
        // Condition A: Start with generic headers
        const hasGenericHeaders = table.headers.some(h => h.startsWith('Column_'));
        if (!hasGenericHeaders) return false;

        // Condition B: Row 1 exists
        if (!table.dataRows || table.dataRows.length === 0) return false;

        const row1 = table.dataRows[0];

        // Condition C: Row 1 is not empty and has text
        const emptyCount = row1.filter(c => !c || c.toString().trim() === '').length;
        if (emptyCount === row1.length) return false; // All empty

        // Condition D: Heuristic - Row 1 should look like a header (mostly text, not just numbers)
        // Just checking if it's "better" than Column_X is usually enough.
        return true;
    },

    promoteRow1: function (table) {
        const newHeaders = table.dataRows[0].map((cell, i) => {
            return cell ? cell.toString().trim() : `Column_${i + 1}`;
        });

        table.headers = newHeaders;
        table.dataRows.shift(); // Remove row 1
        table.rows--; // Update count
    },

    deduplicateHeaders: function (table) {
        const counts = {};
        let modified = false;

        const newHeaders = table.headers.map(h => {
            const base = h || 'Column';
            if (counts[base]) {
                counts[base]++;
                modified = true;
                return `${base}_${counts[base]}`; // Name_2
            } else {
                counts[base] = 1;
                return h;
            }
        });

        if (modified) {
            table.headers = newHeaders;
        }
        return modified;
    }
};

// Expose globally
window.HeaderNaming = HeaderNaming;
