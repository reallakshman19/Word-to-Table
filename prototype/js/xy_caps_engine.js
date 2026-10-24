/* Derived vendor engine: supplied CAPS v2.3, caps_app.html SHA a60d15f59c8df5db262754b8db0fc8b98e2af8c38f61c7bdf08a7dbca690bd21.
 * Deliberate adaptations: unknown metadata defaults instead of private R5 defaults;
 * no embedded private reference records/tie ranks; inspect every thermowell body row
 * (its header can be in thead); retain full suppressed record values in raw audit.
 * Export parity must be established at runtime.
 * Inherited transformer remains a vendor-size exception, not new authored architecture.
 */
const XYCapsEngine = (() => {
    const REFERENCE_TIE_ORDER = new Map();
    const tieIdentity = r => JSON.stringify([r['Short name'],r['Short name bolts'],r['Comp Description bolts'],
      r['Size 1 (DN)'],r['Size 2 (DN)'],r['Pipe dia (DN)'],r['Bolt length (mm)'],r['MESC number']]);
    function stripHtmlTags(str) {
      return str.replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#\d+;/g, '')
                .replace(/&[a-z]+;/g, '')
                .trim();
    }

    function extractTableRowsFromHtml(tableHtml, sectionName) {
      const secRegex = new RegExp(`<${sectionName}[^>]*>([\\s\\S]*?)<\\/${sectionName}>`, 'i');
      const secMatch = tableHtml.match(secRegex);
      if (!secMatch) return [];
      const secHtml = secMatch[1];
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const rows = [];
      let trMatch;
      while ((trMatch = trRegex.exec(secHtml)) !== null) {
        const rh = trMatch[1];
        let cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cells = [];
        let cm;
        while ((cm = cellRegex.exec(rh)) !== null) {
          cells.push(stripHtmlTags(cm[1]));
        }
        if (cells.length === 0) {
          cellRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
          while ((cm = cellRegex.exec(rh)) !== null) {
            cells.push(stripHtmlTags(cm[1]));
          }
        }
        if (cells.length > 0 && /^(H|\d+)$/.test(cells[0].trim())) {
          cells.shift();
        }
        rows.push(cells);
      }
      return rows;
    }

    function transformHtmlInBrowser(htmlText, cfg) {
      const DN_TO_NPS = cfg.dn_to_nps_map || {};
      const BOLT_FRACTIONS = cfg.bolt_fractions_map || {};
      const BOLT_LEN_MM_TO_IN = cfg.bolt_length_mm_to_in_map || {};
      const APPL_DEFAULTS = cfg.appl_code_defaults || {
        'PI': 'KS01', 'FL': 'KS01', 'FI': 'KS01', 'RF': 'KS01',
        'VS': 'KP11', 'LI': 'KS01', 'OT_BOLTS': 'KM01', 'OT_OTHER': ''
      };

      function formatBoltLengthIn(mm) {
        const mmi = Math.round(mm);
        if (BOLT_LEN_MM_TO_IN[String(mmi)]) return BOLT_LEN_MM_TO_IN[String(mmi)];
        const inches = mmi / 25.4;
        let whole = Math.floor(inches);
        let frac = Math.round((inches - whole) * 8);
        if (frac === 8) { whole += 1; frac = 0; }
        const fracMap = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' };
        if (frac === 0) return String(whole);
        const fracStr = fracMap[frac] || '';
        return whole > 0 ? `${whole}${fracStr}` : fracStr;
      }

      function formatBoltDia(diaStr) {
        const s = diaStr.trim();
        return BOLT_FRACTIONS[s] || s;
      }

      // 1. Extract After Tables
      const secRegex = /<section\s+class="table-section"\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gi;
      const tables = [];
      let sm;
      while ((sm = secRegex.exec(htmlText)) !== null) {
        const secId = sm[1];
        const secBody = sm[2];
        const colRegex = /<div\s+class="compare-col"[^>]*>/gi;
        const colStarts = [];
        let cm;
        while ((cm = colRegex.exec(secBody)) !== null) {
          colStarts.push(cm.index);
        }
        if (colStarts.length < 2) continue;
        const afterBlock = secBody.substring(colStarts[1]);
        const titleM = afterBlock.match(/class="compare-col-title"[^>]*>([\s\S]*?)<\/div>/i);
        const title = titleM ? stripHtmlTags(titleM[1]) : '';
        if (!title.toLowerCase().includes('after')) continue;

        const tableM = afterBlock.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
        if (!tableM) continue;
        const tableHtml = tableM[0];

        const theadRows = extractTableRowsFromHtml(tableHtml, 'thead');
        const tbodyRows = extractTableRowsFromHtml(tableHtml, 'tbody');
        const arch = classifyBrowserArchetype(theadRows, tbodyRows);

        tables.push({
          id: secId,
          archetype: arch,
          thead_rows: theadRows,
          tbody_rows: tbodyRows,
          sample_header: theadRows[0] ? theadRows[0].slice(0, 4) : [],
        });
      }

      // 2. Build Spec Metadata
      const specMeta = {
        class_number: cfg.spec_meta_defaults?.class_number ?? '',
        mat_description: cfg.spec_meta_defaults?.mat_description ?? '',
        ca_mm: cfg.spec_meta_defaults?.ca_mm ?? '',
        ca_in: cfg.spec_meta_defaults?.ca_in ?? '',
        rating: cfg.spec_meta_defaults?.rating ?? '',
        rev: cfg.spec_meta_defaults?.rev ?? '',
        comp_code: cfg.general?.comp_code_default || 'E&P',
      };

      for (const tbl of tables) {
        const allText = tbl.thead_rows.concat(tbl.tbody_rows).flat().join(' ');
        if (!allText.toLowerCase().includes('class no')) continue;

        const rows = tbl.thead_rows.concat(tbl.tbody_rows);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          for (let j = 0; j < row.length; j++) {
            const cl = row[j].toLowerCase().trim();
            if (cl.includes('class no')) {
              let val = row[j + 1] || '';
              if (!val && i + 1 < rows.length) val = rows[i + 1][0] || '';
              const m = val.match(/(\d+)/);
              if (m) specMeta.class_number = parseInt(m[1]);
            }
            if (cl.includes('corrosion') || cl === 'ca' || cl === 'ca (mm)') {
              const val = row[j + 1] || '';
              const m = val.match(/(\d+(?:\.\d+)?)/);
              if (m) {
                const ca = parseFloat(m[1]);
                specMeta.ca_mm = Math.round(ca);
                specMeta.ca_in = parseFloat((ca / 25.4).toFixed(2));
              }
            }
            if (cl.includes('rating') || cl.includes('asme rating')) {
              const val = row[j + 1] || '';
              const m = val.match(/(\d+)/);
              if (m) specMeta.rating = parseInt(m[1]);
            }
            if ((cl.includes('revision letter') || cl === 'rev.' || cl === 'rev') && !specMeta.rev) {
              const val = (row[j + 1] || '').trim().toUpperCase();
              if (val) specMeta.rev = val;
            }
          }
        }

        if (tbl.thead_rows) {
          for (const thRow of tbl.thead_rows) {
            for (const cell of thRow) {
              const clm = cell.toLowerCase();
              if (cell.length > 8 && (clm.includes('steel') || clm.includes('carbon') || clm.includes('stainless') || clm.includes('duplex') || clm.includes('lining'))) {
                specMeta.mat_description = cell.trim();
                break;
              }
            }
          }
        }
        if (specMeta.class_number) break;
      }

      // 3. Build Schedule Map (Archetype B)
      const scheduleMap = {};
      tables.filter(t => t.archetype === 'B').forEach(t => {
        let lastSched = null;
        t.tbody_rows.forEach(row => {
          if (row.length < 2) return;
          const dnStr = row[0].trim();
          const schedStr = row[1].trim();
          const m = dnStr.match(/(\d+)/);
          if (!m) return;
          const dn = parseInt(m[1]);
          if (schedStr) lastSched = schedStr;
          if (lastSched) scheduleMap[dn] = lastSched;
        });
      });

      // 4. Build Component Catalog (Archetype D)
      const SECTION_GROUP_MAP = {
        'pipe': 'PI', 'flanges': 'FL', 'fittings': 'FI', 'reducing fittings': 'RF',
        'valves': 'VS', 'instruments': 'LI', 'miscellaneous': 'OT', 'misc': 'OT',
        'bolts': 'OT', 'gaskets': 'OT'
      };

      const compCatalog = {};
      tables.filter(t => t.archetype === 'D').forEach(t => {
        t.tbody_rows.forEach(row => {
          if (row.length < 2) return;
          if (row.length === 2) {
            const sname = row[0].trim();
            const desc = row[1].trim();
            if (/^[A-Z0-9]{2,8}$/.test(sname)) {
              compCatalog[sname] = {
                comp_group: 'RF',
                comp_description: desc,
                mat_code: 'A105',
                class_mat_desc: 'ASTM A105',
                appl_code: '',
              };
            }
            return;
          }

          const groupLabel = row[0].trim().toLowerCase();
          const shortName = row[1].trim();
          const description = row[2].trim();
          let astmRaw = '';
          if (row.length >= 5) astmRaw = row[4].trim();
          else if (row.length === 4) astmRaw = row[3].trim();

          if (!shortName || ['short name', 'short', ''].includes(shortName.toLowerCase())) return;
          if (!/^[A-Z0-9]{2,8}$/.test(shortName)) return;

          let compGroup = 'OT';
          for (const [kw, grp] of Object.entries(SECTION_GROUP_MAP)) {
            if (groupLabel.includes(kw)) {
              compGroup = grp;
              break;
            }
          }

          let matCode = '';
          const matM = astmRaw.match(/A(\d{3}[A-Z]?)/i);
          if (matM) {
            matCode = 'A' + matM[1].toUpperCase();
          } else if (astmRaw) {
            matCode = astmRaw.replace(/[^A-Z0-9]/g, '').substring(0, 6);
          }

          compCatalog[shortName] = {
            comp_group: compGroup,
            comp_description: description,
            mat_code: matCode,
            class_mat_desc: astmRaw,
            appl_code: '',
          };
        });
      });

      // 5. Matrix Column DN sizes
      let matrixDnSizes = [15, 20, 25, 40, 50, 80, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600];
      const eHdr = tables.find(t => t.archetype === 'E_HDR');
      if (eHdr && eHdr.thead_rows[0]) {
        const found = eHdr.thead_rows[0].filter(c => /^\d+$/.test(c.trim())).map(c => parseInt(c.trim()));
        if (found.length > 0) matrixDnSizes = found;
      }

      // Reverse lookup for Matrix Engine
      const descToCat = {};
      for (const [sname, info] of Object.entries(compCatalog)) {
        const cd = info.comp_description.trim().toLowerCase();
        if (cd) descToCat[cd] = [sname, info];
      }

      const rawRecords = [];

      // Engine 1: Matrix Component Grids (E_DATA)
      tables.filter(t => t.archetype === 'E_DATA').forEach(t => {
        const allRows = t.thead_rows.concat(t.tbody_rows);
        allRows.forEach((row, sourceRow) => {
          const region = sourceRow < t.thead_rows.length ? 'thead' : 'tbody';
          const regionRow = region === 'thead' ? sourceRow : sourceRow-t.thead_rows.length;
          if (row.length < 4) return;
          const itemDesc = row[1].trim();
          const mescPrefix = row[2].trim();
          if (!/^\d{5,7}(\s+\d+)?$/.test(mescPrefix)) return;
          const cleanPrefix = mescPrefix.replace(/\s+/g, '');

          let catEntry = descToCat[itemDesc.toLowerCase()];
          if (!catEntry) {
            for (const [k, v] of Object.entries(descToCat)) {
              if (k.includes(itemDesc.toLowerCase()) || itemDesc.toLowerCase().includes(k)) {
                catEntry = v;
                break;
              }
            }
          }

          let shortName = itemDesc.substring(0, 4).toUpperCase();
          let compGroup = 'OT';
          let matCode = '';
          let classMatDesc = '';
          let compDesc = itemDesc;
          let applCode = '';

          if (catEntry) {
            const [sname, cinfo] = catEntry;
            shortName = sname;
            compGroup = cinfo.comp_group;
            matCode = cinfo.mat_code;
            classMatDesc = cinfo.class_mat_desc;
            compDesc = cinfo.comp_description;
            applCode = cinfo.appl_code || APPL_DEFAULTS[compGroup] || '';
          } else {
            applCode = APPL_DEFAULTS[compGroup] || '';
          }

          for (let k = 3; k < row.length; k++) {
            const suffix = row[k].trim();
            if (!suffix || !/^\d+$/.test(suffix)) continue;
            const dnIdx = k - 3;
            if (dnIdx >= matrixDnSizes.length) continue;
            const dn = matrixDnSizes[dnIdx];
            const mescStr = cleanPrefix + suffix.padStart(10 - cleanPrefix.length, '0');
            const mescNum = parseInt(mescStr);

            const isBw = (compGroup === 'PI') || compDesc.toLowerCase().includes('bw') || (compGroup === 'FI' && !compDesc.toLowerCase().includes('thrd'));
            const sched = isBw ? (scheduleMap[dn] || null) : null;

            rawRecords.push({
              '__source': {section_id:t.id, region, row:regionRow, column:k, rule_id:'MATRIX_PREFIX_SUFFIX/v1'},
              'Short name': shortName,
              'Short name bolts': null,
              'Appl code': applCode,
              'Comp Description': compDesc,
              'Comp Description bolts': null,
              'Comp Group': compGroup,
              'Size 1 (DN)': dn,
              'Size 1 (NPS)': DN_TO_NPS[String(dn)] || String(dn),
              'Size 2 (DN)': null,
              'Size 2 (NPS)': null,
              'Wlth 1 (Schedule / mm)': sched,
              'Wlth 1 (Schedule / in)': sched,
              'Wlth 2 (Schedule / mm)': null,
              'Wlth 2 (Schedule / in)': null,
              'Pipe dia (DN)': null,
              'Pipe dia (NPS)': null,
              'Bolt dia (in)': null,
              'Bolt length (mm)': null,
              'Bolt length (in)': null,
              'Number of bolts': null,
              'MESC number': mescNum,
              'Mat. code': matCode,
              'Class Material description': classMatDesc,
            });
          }
        });
      });

      // Engine 2: Reducing Buttweld (F_BW)
      tables.filter(t => t.archetype === 'F_BW').forEach(t => {
        const headerRow = t.tbody_rows[0] || [];
        const colNames = headerRow.map(c => c.trim());

        for (let i = 1; i < t.tbody_rows.length; i++) {
          const row = t.tbody_rows[i];
          if (row.length < 4) continue;
          const runStr = row[0].trim();
          const brStr = row[2].trim();
          if (!/^\d+$/.test(runStr) || !/^\d+$/.test(brStr)) continue;
          const runDn = parseInt(runStr);
          const brDn = parseInt(brStr);

          for (let j = 3; j < row.length; j++) {
            const val = row[j].trim();
            if (val && /^\d{10}$/.test(val)) {
              const sname = colNames[j] || 'RECB';
              const cinfo = compCatalog[sname] || {};
              const compDesc = cinfo.comp_description || sname;
              const matCode = cinfo.mat_code || 'A234WPB';
              const classMatDesc = cinfo.class_mat_desc || 'ASTM A234WPB';
              const applCode = cinfo.appl_code || APPL_DEFAULTS['RF'] || 'KS01';

              rawRecords.push({
                '__source': {section_id:t.id, region:'tbody', row:i, column:j, rule_id:'REDUCING_BW_DIRECT/v1'},
                'Short name': sname,
                'Short name bolts': null,
                'Appl code': applCode,
                'Comp Description': compDesc,
                'Comp Description bolts': null,
                'Comp Group': 'RF',
                'Size 1 (DN)': runDn,
                'Size 1 (NPS)': DN_TO_NPS[String(runDn)] || String(runDn),
                'Size 2 (DN)': brDn,
                'Size 2 (NPS)': DN_TO_NPS[String(brDn)] || String(brDn),
                'Wlth 1 (Schedule / mm)': scheduleMap[runDn] || null,
                'Wlth 1 (Schedule / in)': scheduleMap[runDn] || null,
                'Wlth 2 (Schedule / mm)': scheduleMap[brDn] || null,
                'Wlth 2 (Schedule / in)': scheduleMap[brDn] || null,
                'Pipe dia (DN)': null,
                'Pipe dia (NPS)': null,
                'Bolt dia (in)': null,
                'Bolt length (mm)': null,
                'Bolt length (in)': null,
                'Number of bolts': null,
                'MESC number': parseInt(val),
                'Mat. code': matCode,
                'Class Material description': classMatDesc,
              });
            }
          }
        }
      });

      // Engine 3: Reducing Branch Outlets (F_BR)
      const classDns = Object.keys(scheduleMap).map(k => parseInt(k)).sort((a, b) => a - b);
      tables.filter(t => t.archetype === 'F_BR').forEach(t => {
        const headerRow = t.tbody_rows[0] || [];
        const colNames = headerRow.map(c => c.trim());

        for (let i = 1; i < t.tbody_rows.length; i++) {
          const row = t.tbody_rows[i];
          if (row.length < 5) continue;
          const brStr = row[0].trim();
          const runMinStr = row[1].trim();
          const runMaxStr = (row.length > 3 && row[3].trim()) ? row[3].trim() : runMinStr;
          if (!/^\d+$/.test(brStr) || !/^\d+$/.test(runMinStr)) continue;

          const brDn = parseInt(brStr);
          const runMin = parseInt(runMinStr);
          const runMax = /^\d+$/.test(runMaxStr) ? parseInt(runMaxStr) : runMin;

          const matchingDns = classDns.filter(d => d >= runMin && d <= runMax);

          for (let j = 4; j < row.length; j++) {
            const val = row[j].trim();
            if (val && /^\d{10}$/.test(val)) {
              const sname = colNames[j] || 'BN3P';
              const cinfo = compCatalog[sname] || {};
              const compDesc = cinfo.comp_description || 'Branch outlet bw';
              const matCode = cinfo.mat_code || 'A105';
              const classMatDesc = cinfo.class_mat_desc || 'ASTM A105';
              const applCode = cinfo.appl_code || APPL_DEFAULTS['RF'] || 'KS01';

              for (const d of matchingDns) {
                rawRecords.push({
                  '__source': {section_id:t.id, region:'tbody', row:i, column:j, rule_id:'REDUCING_BRANCH_EXPANSION/v1', expansion_dn:d},
                  'Short name': sname,
                  'Short name bolts': null,
                  'Appl code': applCode,
                  'Comp Description': compDesc,
                  'Comp Description bolts': null,
                  'Comp Group': 'RF',
                  'Size 1 (DN)': d,
                  'Size 1 (NPS)': DN_TO_NPS[String(d)] || String(d),
                  'Size 2 (DN)': brDn,
                  'Size 2 (NPS)': DN_TO_NPS[String(brDn)] || String(brDn),
                  'Wlth 1 (Schedule / mm)': scheduleMap[d] || null,
                  'Wlth 1 (Schedule / in)': scheduleMap[d] || null,
                  'Wlth 2 (Schedule / mm)': scheduleMap[brDn] || null,
                  'Wlth 2 (Schedule / in)': scheduleMap[brDn] || null,
                  'Pipe dia (DN)': null,
                  'Pipe dia (NPS)': null,
                  'Bolt dia (in)': null,
                  'Bolt length (mm)': null,
                  'Bolt length (in)': null,
                  'Number of bolts': null,
                  'MESC number': parseInt(val),
                  'Mat. code': matCode,
                  'Class Material description': classMatDesc,
                });
              }
            }
          }
        }
      });

      // Engine 4: Bolting Engine (G_BOLT)
      const boltRules = cfg.bolting_rules || {};
      const typeMappings = boltRules.type_mappings || [];
      const defaultBoltShort = boltRules.default_bolt_short_name || 'STB1';
      const defaultBoltDesc = boltRules.default_bolt_description || 'Studbolt with nuts';
      const stbInfo = compCatalog['STBT'] || compCatalog['STB1'] || {};
      const boltMatCode = stbInfo.mat_code || 'B7M';
      const boltClassMatDesc = stbInfo.class_mat_desc || 'ASTM A193 Gr. B7M / A194 Gr. 2HM';

      tables.filter(t => t.archetype === 'G_BOLT').forEach(t => {
        for (const [sourceRow, row] of t.tbody_rows.entries()) {
          if (row.length < 7) continue;
          const descRaw = row[0].replace(/\s+/g, ' ').trim();
          const dnStr = row[1].trim();
          const nrStr = row[2].trim();
          const inchStr = row[3].trim();
          const mmStr = row[5].trim();
          const mescStr = row[6].trim();

          if (!(/^\d+$/.test(dnStr) && /^\d+$/.test(nrStr) && /^\d+$/.test(mescStr))) continue;

          const dn = parseInt(dnStr);
          const nr = parseInt(nrStr);
          const mm = /^\d+$/.test(mmStr) ? parseInt(mmStr) : 0;
          const mesc = parseInt(mescStr);

          const descLow = descRaw.toLowerCase();
          let shortNameBolts = null;
          for (const tm of typeMappings) {
            const kw = (tm.keyword || '').toLowerCase();
            if (kw !== 'default' && descLow.includes(kw)) {
              shortNameBolts = tm.short_name_bolts;
              break;
            }
          }
          if (!shortNameBolts) {
            for (const tm of typeMappings) {
              if (tm.keyword === 'default') {
                shortNameBolts = tm.short_name_bolts;
                break;
              }
            }
          }
          if (!shortNameBolts) shortNameBolts = 'BSF1';

          rawRecords.push({
            '__source': {section_id:t.id, region:'tbody', row:sourceRow, column:6, rule_id:'BOLTING_TYPE_AND_LENGTH/v1'},
            'Short name': defaultBoltShort,
            'Short name bolts': shortNameBolts,
            'Appl code': APPL_DEFAULTS['OT_BOLTS'] || 'KM01',
            'Comp Description': defaultBoltDesc,
            'Comp Description bolts': descRaw,
            'Comp Group': 'OT',
            'Size 1 (DN)': null,
            'Size 1 (NPS)': null,
            'Size 2 (DN)': null,
            'Size 2 (NPS)': null,
            'Wlth 1 (Schedule / mm)': null,
            'Wlth 1 (Schedule / in)': null,
            'Wlth 2 (Schedule / mm)': null,
            'Wlth 2 (Schedule / in)': null,
            'Pipe dia (DN)': dn,
            'Pipe dia (NPS)': DN_TO_NPS[String(dn)] || String(dn),
            'Bolt dia (in)': formatBoltDia(inchStr),
            'Bolt length (mm)': mm,
            'Bolt length (in)': formatBoltLengthIn(mm),
            'Number of bolts': nr,
            'MESC number': mesc,
            'Mat. code': boltMatCode,
            'Class Material description': boltClassMatDesc,
          });
        }
      });

      // Engine 5: Thermowells (G_TW)
      tables.filter(t => t.archetype === 'G_TW').forEach(t => {
        const twInfo = compCatalog['TWNS'] || compCatalog['TWND'] || {};
        const twMatCode = twInfo.mat_code || 'F55';
        const twClassMatDesc = twInfo.class_mat_desc || 'ASTM A182-F55';

        for (let i = 0; i < t.tbody_rows.length; i++) {
          const row = t.tbody_rows[i];
          if (row.length >= 2 && /^\d+$/.test(row[0].trim()) && /^\d+$/.test(row[1].trim())) {
            const l = parseInt(row[0].trim());
            const mesc = parseInt(row[1].trim());

            rawRecords.push({
              '__source': {section_id:t.id, region:'tbody', row:i, column:1, rule_id:'THERMOWELL_FIXED_DN50/v1'},
              'Short name': 'TWNS',
              'Short name bolts': null,
              'Appl code': APPL_DEFAULTS['LI'] || 'KS01',
              'Comp Description': `Thermowell flgd DN 50 L=${l} mm`,
              'Comp Description bolts': null,
              'Comp Group': 'LI',
              'Size 1 (DN)': 50,
              'Size 1 (NPS)': DN_TO_NPS['50'] || null,
              'Size 2 (DN)': null,
              'Size 2 (NPS)': null,
              'Wlth 1 (Schedule / mm)': null,
              'Wlth 1 (Schedule / in)': null,
              'Wlth 2 (Schedule / mm)': null,
              'Wlth 2 (Schedule / in)': null,
              'Pipe dia (DN)': null,
              'Pipe dia (NPS)': null,
              'Bolt dia (in)': null,
              'Bolt length (mm)': null,
              'Bolt length (in)': null,
              'Number of bolts': null,
              'MESC number': mesc,
              'Mat. code': twMatCode,
              'Class Material description': twClassMatDesc,
            });
          }
        }
      });

      // 6. Normalization & Deduplication (30 canonical cols)
      const rows = [];
      for (const r of rawRecords) {
        rows.push({
          '__source': r.__source,
          'Class number': specMeta.class_number,
          'Mat Description': specMeta.mat_description,
          'Ca (mm)': specMeta.ca_mm,
          'Ca (in)': specMeta.ca_in,
          'Rating': specMeta.rating,
          'Rev.': specMeta.rev,
          'Short name': r['Short name'],
          'Short name bolts': r['Short name bolts'] || '',
          'Appl code': r['Appl code'] || '',
          'Comp Description': r['Comp Description'] || '',
          'Comp Description bolts': r['Comp Description bolts'] || '',
          'Comp Group': r['Comp Group'] || '',
          'Size 1 (DN)': r['Size 1 (DN)'],
          'Size 1 (NPS)': r['Size 1 (NPS)'],
          'Size 2 (DN)': r['Size 2 (DN)'],
          'Size 2 (NPS)': r['Size 2 (NPS)'],
          'Wlth 1 (Schedule / mm)': r['Wlth 1 (Schedule / mm)'],
          'Wlth 1 (Schedule / in)': r['Wlth 1 (Schedule / in)'],
          'Wlth 2 (Schedule / mm)': r['Wlth 2 (Schedule / mm)'],
          'Wlth 2 (Schedule / in)': r['Wlth 2 (Schedule / in)'],
          'Pipe dia (DN)': r['Pipe dia (DN)'],
          'Pipe dia (NPS)': r['Pipe dia (NPS)'],
          'Bolt dia (in)': r['Bolt dia (in)'],
          'Bolt length (mm)': r['Bolt length (mm)'],
          'Bolt length (in)': r['Bolt length (in)'] || '',
          'Number of bolts': r['Number of bolts'],
          'MESC number': r['MESC number'],
          'Mat. code': r['Mat. code'] || '',
          'Class Material description': r['Class Material description'] || '',
          'Comp. code': specMeta.comp_code || 'E&P',
        });
      }

      // Deduplicate on composite primary key
      const seen = new Set();
      const deduped = [];
      const rawAudit = [];
      const firstByKey = new Map();
      for (const r of rows) {
        const record={...r};delete record.__source;
        const key = [
          r['Short name'],
          r['Short name bolts'],
          r['Size 1 (DN)'],
          r['Size 2 (DN)'],
          r['Pipe dia (DN)'],
          r['Bolt length (mm)'],
          r['MESC number']
        ].join('|');
        if (!seen.has(key)) {
          seen.add(key);
          firstByKey.set(key,r);
          deduped.push(r);
          rawAudit.push({disposition:'EMITTED',source:r.__source,record});
        } else {
          const first = firstByKey.get(key);
          rawAudit.push({disposition:'SUPPRESSED_UNRESOLVED',source:r.__source,record,
            retained_source:first.__source, changed_bolt_description:r['Comp Description bolts'] !== first['Comp Description bolts'],
            retained_bolt_description:first['Comp Description bolts'],
            suppressed_bolt_description:r['Comp Description bolts']});
        }
      }

      // Sort canonically
      const groupOrder = { 'PI': 1, 'FL': 2, 'FI': 3, 'RF': 4, 'VS': 5, 'LI': 6, 'OT': 7 };
      deduped.sort((a, b) => {
        const ga = groupOrder[a['Comp Group']] || 99;
        const gb = groupOrder[b['Comp Group']] || 99;
        if (ga !== gb) return ga - gb;

        const sna = a['Short name'] || '';
        const snb = b['Short name'] || '';
        if (sna !== snb) return sna.localeCompare(snb);

        const s1a = a['Size 1 (DN)'] || 0;
        const s1b = b['Size 1 (DN)'] || 0;
        if (s1a !== s1b) return s1a - s1b;

        const s2a = a['Size 2 (DN)'] || 0;
        const s2b = b['Size 2 (DN)'] || 0;
        if (s2a !== s2b) return s2a - s2b;

        const pda = a['Pipe dia (DN)'] || 0;
        const pdb = b['Pipe dia (DN)'] || 0;
        if (pda !== pdb) return pda - pdb;

        const bla = a['Bolt length (mm)'] || 0;
        const blb = b['Bolt length (mm)'] || 0;
        if (bla !== blb) return bla - blb;

        const mescDiff = a['MESC number'] - b['MESC number'];
        if (mescDiff !== 0) return mescDiff;
        // Preserve the registered R5 reference's legacy tie ordering.
        const ra = REFERENCE_TIE_ORDER.get(tieIdentity(a));
        const rb = REFERENCE_TIE_ORDER.get(tieIdentity(b));
        if (ra !== undefined && rb !== undefined) return ra - rb;
        return 0;
      });

      const sourceLinks = deduped.map(r => r.__source);
      deduped.forEach(r => delete r.__source); // keep the canonical 30-column export unmodified
      return {
        source_links:sourceLinks,
        raw_audit:rawAudit,
        traceability:{status:'REVIEW_REQUIRED',validated_export_allowed:false,
          reason:'Unapproved legacy suppressions and field dependencies not fully traced'},
        spec_meta: specMeta,
        schedule_map: scheduleMap,
        sections: tables.map(t => ({
          id: t.id,
          archetype: t.archetype,
          thead_rows: t.thead_rows.length,
          tbody_rows: t.tbody_rows.length,
          sample_header: t.sample_header,
          source_rows: {thead:t.thead_rows,tbody:t.tbody_rows},
        })),
        records: deduped,
        legacy_collisions: rows.length - deduped.length,
      };
    }

    function classifyBrowserArchetype(thead, tbody) {
      const headers = thead.flat().map(c => c.trim()).filter(Boolean);
      const headersLow = headers.map(h => h.toLowerCase());
      const fhr = thead[0] || [];
      const fhrLow = fhr.map(c => c.toLowerCase().trim());
      const row0 = tbody[0] || [];
      const row0Low = row0.map(c => c.toLowerCase().trim());

      if (headersLow.some(h => h.includes('pipe size dn'))) return 'I';

      const tempLike = fhrLow.filter(h => /^-?\d+$/.test(h)).length;
      const hasTempLabel = headersLow.some(h => h.includes('temperature') || h.includes('°c'));
      if (tempLike >= 3 && hasTempLabel) return 'A';
      if (row0Low.some(c => c.includes('temperature')) && row0Low.some(c => c.includes('pressure'))) return 'A';

      if (headersLow.includes('dn') && headersLow.includes('schedule') && fhrLow.length <= 3) return 'B';
      if (headersLow.some(h => h.includes('run size'))) return 'C';

      if (headersLow.includes('nr') && headersLow.some(h => h.includes('mesc')) && headersLow.some(h => h.includes('group'))) return 'G_BOLT';
      if (headersLow.some(h => h.includes('thermowell')) || (row0Low[0] && row0Low[0].includes('length (mm)'))) return 'G_TW';

      const assemblyKeywords = ['drain', 'vent', 'monofl', 'annulus', 'assembly', 'fig.', 'pi.conn', 'temp instr'];
      if (fhrLow[0] && assemblyKeywords.some(kw => fhrLow[0].includes(kw))) return 'H';

      if (fhrLow[0] && fhrLow[0].includes('nominal pipe size')) return 'E_HDR';

      if (fhr.length >= 15 || row0.length >= 15) {
        const mescThead = fhr.length > 2 && /^\d{5,7}(\s+\d+)?$/.test(fhr[2].trim());
        const mescTbody = row0.length > 2 && /^\d{5,7}(\s+\d+)?$/.test(row0[2].trim());
        if (mescThead || mescTbody) return 'E_DATA';
      }

      let runXBr = row0Low.includes('run') && row0Low.includes('x') && row0Low.includes('br');
      if (!runXBr && fhrLow.length > 0) {
        runXBr = fhrLow.includes('run') && fhrLow.includes('x') && fhrLow.includes('br');
      }
      if (runXBr) return 'F_BW';

      let branchRun = row0Low.includes('branch') && row0Low.some(c => c.includes('run'));
      if (!branchRun && fhrLow.length > 0) {
        branchRun = fhrLow.includes('branch') && fhrLow.some(c => c.includes('run'));
      }
      if (branchRun) return 'F_BR';

      const groupKeywords = new Set(['pipe', 'flanges', 'fittings', 'reducing fittings', 'valves', 'instruments', 'miscellaneous', 'misc', 'bolts', 'gaskets']);
      if (row0.length > 0 && groupKeywords.has(row0Low[0]) && row0.length <= 6) return 'D';
      if (fhrLow.length > 0 && fhrLow[0] === 'group' && fhrLow.filter(Boolean).length === 1 && fhr.length <= 6) return 'D';
      if (fhrLow.length > 0 && fhrLow[0].includes('comp.name')) return 'D';

      if (tbody.length <= 10 && tbody.every(r => r.length <= 6)) return 'META';

      return 'UNKNOWN';
    }


    return {transform:transformHtmlInBrowser};
})();
