/* SCTL-P1.1: Private local-only, exact-artifact Missing Source Lens viewer.
 * No original R5 content, images, or report bytes are shipped with this source.
 * Uses bundled JSZip; no fetch, upload, localStorage, IndexedDB or service worker.
 */
const SCTLTab = (() => {
    'use strict';
    const EXPECTED = Object.freeze({
        bytes: 1888155,
        zipSha: '8b5e5c8f3184f6a68dab4888ee38165473345cb37daa9a34d122532c6b1d1805',
        docxSha: '7508f9575b799efa49d2070e27099edc98819e046e8933b43ec261ba7350862c',
        htmlSha: 'ab02ee8c46a58a1990df943e35c0c42bab71859b7ce9b265a3fe04f777d056e7',
        occurrence: '7508f9575b79:body-table-002:d55ee04d80349fdf'
    });
    const $ = id => document.getElementById(id);
    let generation = 0;
    let loaded = false;

    function status(value, error) {
        const element = $('sctl-status');
        element.textContent = value;
        element.dataset.status = error ? 'error' : (loaded ? 'verified' : 'empty');
    }
    function reset() {
        generation += 1;
        loaded = false;
        const frame = $('sctl-frame');
        if (frame) {
            frame.removeAttribute('srcdoc');
            frame.hidden = true;
        }
        const summary = $('sctl-summary');
        if (summary) summary.hidden = true;
        status('NO VERIFIED SOURCE LOADED', false);
    }
    function hex(buffer) {
        return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    function validateEvidence(evidence) {
        if (!evidence || evidence.schema !== 'sctl.source-occurrence.v1' ||
            evidence.source?.sha256 !== EXPECTED.docxSha ||
            evidence.target?.sha256 !== EXPECTED.htmlSha ||
            evidence.occurrence?.id !== EXPECTED.occurrence ||
            evidence.occurrence?.document_table_ordinal !== 2 ||
            evidence.occurrence?.title !== 'Notes' ||
            evidence.render?.fidelity !== 'WORD_FIDELITY_NOT_VERIFIED' ||
            evidence.render?.page_count !== 13 ||
            !Array.isArray(evidence.render?.images) ||
            evidence.render.images.length !== 13 ||
            !Array.isArray(evidence.occurrence?.page_segments) ||
            !evidence.occurrence.page_segments.some(p => p.page === 2) ||
            evidence.capture?.classification !== 'NOT_CAPTURED_CONFIRMED' ||
            evidence.scope?.tables_assessed !== 1 ||
            evidence.scope?.whole_document_coverage_claim !== false) {
            throw new Error('Report source identity, table, or evidence scope does not match SCTL-P1');
        }
    }
    // Even verified private report HTML is isolated from parent scripts, cookies and
    // existing tab state. Offline CSP limits network connections/remote resources.
    function isolatedHtml(report) {
        const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; " +
            "script-src 'unsafe-inline'; font-src data:; connect-src 'none'; " +
            "form-action 'none'; base-uri 'none'; object-src 'none'";
        const meta = '<meta http-equiv="Content-Security-Policy" content="' + policy + '">';
        if (!/<head(?:\s|>)/i.test(report)) throw new Error('Report has no HTML head');
        return report.replace(/<head([^>]*)>/i, '<head$1>' + meta);
    }
    async function importFile(file) {
        // Fail closed on a missing, rejected, or superseded input.
        reset();
        const token = generation;
        if (!file) return false;
        try {
            if (!/\.zip$/i.test(file.name) || file.size !== EXPECTED.bytes)
                throw new Error('Incorrect private ZIP filename type or byte length');
            if (!window.crypto?.subtle || !window.JSZip)
                throw new Error('Secure browser hashing or local ZIP reader is unavailable');
            status('Verifying private ZIP SHA-256 locally…', false);
            const raw = await file.arrayBuffer();
            const sha = hex(await window.crypto.subtle.digest('SHA-256', raw));
            if (token !== generation) return false;
            if (sha !== EXPECTED.zipSha) throw new Error('ZIP SHA-256 mismatch. Nothing loaded');
            const archive = await window.JSZip.loadAsync(raw);
            const htmlEntry = archive.file('report/index.html');
            const evidenceEntry = archive.file('report/evidence.json');
            if (!htmlEntry || !evidenceEntry) throw new Error('Verified archive lacks required report');
            const [html, evidenceText] = await Promise.all([
                htmlEntry.async('string'), evidenceEntry.async('string')
            ]);
            if (token !== generation) return false;
            const evidence = JSON.parse(evidenceText);
            validateEvidence(evidence);
            if (!html.includes('SCTL / Missing Source Lens') ||
                !html.includes('id="hit"') ||
                !html.includes(EXPECTED.occurrence) ||
                !html.includes('WORD_FIDELITY_NOT_VERIFIED')) {
                throw new Error('Source-page viewer is missing its expected occurrence');
            }
            const safeHtml = isolatedHtml(html);
            if (token !== generation) return false;
            const frame = $('sctl-frame');
            // Sandbox explicitly omits allow-same-origin, top navigation and forms.
            frame.srcdoc = safeHtml;
            frame.hidden = false;
            $('sctl-summary').hidden = false;
            loaded = true;
            status('VERIFIED LOCAL REPORT · Notes / source Table #2 · 13 preview pages', false);
            return true;
        } catch (error) {
            if (token === generation) {
                loaded = false;
                $('sctl-frame').removeAttribute('srcdoc');
                $('sctl-frame').hidden = true;
                $('sctl-summary').hidden = true;
                status('REJECTED: ' + error.message + ' · NO VERIFIED SOURCE LOADED', true);
            }
            return false;
        }
    }
    function init() {
        const host = $('tab-trace');
        if (!host) return;
        host.innerHTML = '<div class="sctl-shell"><div class="sctl-heading">' +
            '<div><span class="xy-eyebrow">SCTL-P1.1 · ORIGINAL SOURCE LENS</span>' +
            '<h2>Source Traceability</h2>' +
            '<p>Inspect original content omitted from the supplied conversion. No repair is performed.</p></div>' +
            '<label class="sctl-pick">＋ Select private P1 ZIP' +
            '<input id="sctl-file" type="file" accept=".zip"></label></div>' +
            '<p class="sctl-status" id="sctl-status" role="status" aria-live="polite">NO VERIFIED SOURCE LOADED</p>' +
            '<p class="sctl-guidance">The file is read and SHA-256 checked in this browser only. ' +
            'No private R5 material is bundled with the public application or uploaded.</p>' +
            '<div class="sctl-summary" id="sctl-summary" hidden>' +
            '<strong>WORD_FIDELITY_NOT_VERIFIED</strong> — LibreOffice PDF preview only; ' +
            'original Microsoft Word page geometry has not been authenticated. ' +
            'The target omission classification applies only to supplied R5_after.html; ' +
            'the conversion-filter cause is unknown.</div>' +
            '<iframe id="sctl-frame" title="Private source page and Notes table evidence" ' +
            'sandbox="allow-scripts" referrerpolicy="no-referrer" hidden></iframe></div>';
        $('sctl-file').addEventListener('change', event => {
            const file = event.target.files[0];
            event.target.value = '';
            importFile(file);
        });
    }
    init();
    return Object.freeze({importFile, reset, isLoaded: () => loaded, expected: EXPECTED});
})();