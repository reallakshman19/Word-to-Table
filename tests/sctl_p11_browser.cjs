// SCTL-P1.1 browser checks. No private fixture content is committed or logged.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(process.env.XY_SITE_ROOT || path.join(__dirname, '../prototype'));
const report = { checks: [], failures: [], private: 'NOT_RUN' };
function check(label, truth) {
  report.checks.push({ label, result: truth ? 'PASS' : 'FAIL' });
  if (!truth) report.failures.push(label);
}
async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const network = [];
    page.on('request', r => {
      if (r.method() !== 'GET') network.push(r.method() + ' ' + r.url());
    });
    await page.route('https://example.test/Word-to-Table/**', async route => {
      const rel = new URL(route.request().url()).pathname.replace('/Word-to-Table/', '') || 'index.html';
      const file = path.resolve(root, rel);
      if (!(file === path.join(root, 'index.html') || file.startsWith(root + path.sep))) return route.abort();
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
      const contentType = file.endsWith('.js') ? 'application/javascript' :
        file.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ status: 200, body: fs.readFileSync(file), contentType });
    });
    await page.goto('https://example.test/Word-to-Table/');
    check('four top-level tabs exist', (await page.locator('.xy-tab').allTextContents()).join('|') ===
      'Tables|CAPS|Word/HTML diff|Source Traceability');
    check('original Tables remains initially visible', await page.locator('.app-body').isVisible());
    await page.selectOption('#tableFilter', 'data');
    // Existing table state is exercised on a synthetic DOCX, never an R5 substitute.
    const synthetic = await page.evaluate(async () => {
      const z = new JSZip();
      z.file('word/document.xml',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Head A</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>Head B</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
      return await z.generateAsync({type:'base64'});
    });
    await page.setInputFiles('#fileInput', {
      name:'public-synthetic.docx',mimeType:'application/octet-stream',buffer:Buffer.from(synthetic,'base64')
    });
    await page.waitForFunction(() => document.getElementById('statusMsg').textContent.startsWith('Done'));
    await page.selectOption('#headerRows', '2');
    const selectedBefore = await page.evaluate(() => app.getSelectedPhysicalIndex());
    check('synthetic Word table is actually loaded', selectedBefore === 1);
    await page.click('#xy-tab-trace');
    check('Source Traceability is independent fourth view',
      await page.locator('#tab-trace').isVisible() &&
      await page.locator('.app-body').isHidden() &&
      await page.locator('#tab-caps').isHidden() &&
      await page.locator('#tab-diffhtml').isHidden());
    check('private report absent before import', (await page.textContent('#sctl-status')).includes('NO VERIFIED SOURCE LOADED') &&
      await page.locator('#sctl-frame').isHidden() && await page.locator('#sctl-summary').isHidden());
    check('no backend or external upload form', await page.locator('#tab-trace form').count() === 0);
    const sandbox = await page.locator('#sctl-frame').getAttribute('sandbox');
    check('private report iframe sandbox has no same-origin privilege', sandbox === 'allow-scripts');
    await page.setInputFiles('#sctl-file', {
      name: 'wrong.zip', mimeType: 'application/zip', buffer: Buffer.from('not an authorized archive')
    });
    await page.waitForFunction(() => document.getElementById('sctl-status').textContent.startsWith('REJECTED:'));
    check('incorrect ZIP fails closed', (await page.textContent('#sctl-status')).includes('NO VERIFIED SOURCE LOADED') &&
      await page.locator('#sctl-frame').isHidden() && !(await page.evaluate(() => SCTLTab.isLoaded())));
    await page.setInputFiles('#sctl-file', {
      name: 'same-size-but-wrong.zip', mimeType: 'application/zip',
      buffer: Buffer.alloc(1888155, 0)
    });
    await page.waitForFunction(() => document.getElementById('sctl-status').textContent.includes('ZIP SHA-256 mismatch'));
    check('same-size incorrect SHA-256 fails closed',
      !(await page.evaluate(() => SCTLTab.isLoaded())) && await page.locator('#sctl-frame').isHidden());
    await page.click('#xy-tab-caps');
    check('CAPS remains available', await page.locator('#tab-caps').isVisible());
    await page.click('#xy-tab-diffhtml');
    check('Word/HTML diff remains available', await page.locator('#tab-diffhtml').isVisible());
    await page.click('#xy-tab-tables');
    check('Tables filter retained across all fourth-tab switches',
      await page.inputValue('#tableFilter') === 'data' &&
      await page.inputValue('#headerRows') === '2' &&
      await page.evaluate(() => app.getSelectedPhysicalIndex()) === selectedBefore &&
      (await page.textContent('#fileInfo')).includes('public-synthetic.docx') &&
      await page.locator('.app-body').isVisible());
    await page.click('#xy-tab-trace');
    check('rejected import remains rejected after tab switch', (await page.textContent('#sctl-status')).includes('NO VERIFIED SOURCE LOADED'));

    // Optional private run only on a trusted builder workstation, never in public CI.
    if (process.env.SCTL_PRIVATE_ZIP) {
      await page.setInputFiles('#sctl-file', process.env.SCTL_PRIVATE_ZIP);
      await page.waitForFunction(() => SCTLTab.isLoaded() ||
        document.getElementById('sctl-status').textContent.startsWith('REJECTED:'));
      check('authentic private P1 ZIP accepted', await page.evaluate(() => SCTLTab.isLoaded()));
      check('Word fidelity qualification visible', (await page.textContent('#sctl-summary')).includes('WORD_FIDELITY_NOT_VERIFIED'));
      const viewer = page.frameLocator('#sctl-frame');
      check('original Notes page two of thirteen', (await viewer.locator('#page-status').textContent()).includes('2 / 13'));
      await viewer.locator('#hit').click();
      check('click reveals source occurrence', (await viewer.locator('#ident').textContent()).includes('body-table-002'));
      check('actual target evidence shown', (await viewer.locator('#state').textContent()) === 'NOT_CAPTURED_CONFIRMED');
      await viewer.locator('#next').click();
      check('source pagination works', (await viewer.locator('#page-status').textContent()).includes('3 / 13'));
      await viewer.locator('#find').click();
      check('Notes jump works', (await viewer.locator('#page-status').textContent()).includes('2 / 13'));
      await viewer.locator('#zoomin').click();
      check('zoom works', (await viewer.locator('#zoom').textContent()).includes('120%'));
      await page.click('#xy-tab-tables');
      await page.click('#xy-tab-trace');
      check('loaded viewer persists across tabs', await page.evaluate(() => SCTLTab.isLoaded()) &&
        (await viewer.locator('#page-status').textContent()).includes('2 / 13'));
      report.private = 'PASS_IF_ALL_PRIVATE_CHECKS_PASS';
    }
    check('no unexpected browser errors', errors.length === 0);
    check('no non-GET upload requests', network.length === 0);
    report.errors = errors;
  } finally {
    await browser.close();
  }
}
run().then(() => {
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
}).catch(e => {
  console.error('SCTL browser test failed:', e.message);
  process.exitCode = 1;
});
