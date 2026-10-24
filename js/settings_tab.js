/**
 * settings_tab.js — Application configuration
 */

const appSettings = {
    smartHeaderNaming: true, // Renamed from enableAutoNamer
    enableValidator: true,
    debugMode: false,
    robustParsing: false,
    autoApprove: false,
    normalizeWhitespace: true,
    caseInsensitive: true
};

const CONFIG_DEFAULTS = Object.freeze({...appSettings});

// settings_tab.js — Application configuration

function renderSettingsTab() {
    console.log("renderSettingsTab called");
    try {
        const container = document.getElementById('tab-settings');
        if (!container) {
            console.error("Tab container not found!");
            return;
        }

        container.innerHTML = `
        <div class="settings-container">
            <!-- Header -->
            <div class="settings-header-banner">
                <h2>Config</h2>
                <p>Configure extraction rules, application behavior, and maintenance tools.</p>
            </div>

            <div class="settings-grid">
                <!-- Card 1: Extraction Engine -->
                <div class="settings-card">
                    <div class="card-header">
                        <div class="icon-box ios-blue"><i class="fas fa-magic"></i></div>
                        <h3>Extraction Engine</h3>
                    </div>
                    <div class="card-body">
                        <!-- Smart Header Naming -->
                        <div class="setting-item">
                            <div class="setting-info">
                                <label>Smart Header Naming</label>
                                <p>Auto-detects generic headers (e.g., 'Column_1') and promotes first row content.</p>
                            </div>
                            <div class="setting-control">
                                <label class="toggle-switch">
                                    <input type="checkbox" ${appSettings.smartHeaderNaming ? 'checked' : ''} onchange="toggleSetting('smartHeaderNaming')">
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>

                        <!-- Robust Parsing -->
                        <div class="setting-item">
                            <div class="setting-info">
                                <label>Robust Parsing (Experimental)</label>
                                <p>Use coordinate-based grid parsing. Better for merged cells, but slower.</p>
                            </div>
                            <div class="setting-control">
                                <label class="toggle-switch">
                                    <input type="checkbox" ${appSettings.robustParsing ? 'checked' : ''} onchange="toggleSetting('robustParsing')">
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>

                        <!-- Auto-Approve -->
                        <div class="setting-item">
                            <div class="setting-info">
                                <label>Auto-Approve Results</label>
                                <p>Automatically mark all tables as Approved.</p>
                            </div>
                            <div class="setting-control">
                                <label class="toggle-switch">
                                    <input type="checkbox" ${appSettings.autoApprove ? 'checked' : ''} onchange="toggleSetting('autoApprove')">
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Card 2: Application System -->
                <div class="settings-card">
                    <div class="card-header">
                        <div class="icon-box ios-gray"><i class="fas fa-cog"></i></div>
                        <h3>System & Logging</h3>
                    </div>
                    <div class="card-body">
                        <!-- Debug Mode -->
                        <div class="setting-item">
                            <div class="setting-info">
                                <label>Debug Mode</label>
                                <p>Enable verbose logging in Console and Logs tab.</p>
                            </div>
                            <div class="setting-control">
                                <label class="toggle-switch">
                                    <input type="checkbox" ${appSettings.debugMode ? 'checked' : ''} onchange="toggleSetting('debugMode')">
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>

                        <!-- Validator -->
                        <div class="setting-item">
                            <div class="setting-info">
                                <label>Auto-Validator</label>
                                <p>Run client-side validation rules on extraction.</p>
                            </div>
                            <div class="setting-control">
                                <label class="toggle-switch">
                                    <input type="checkbox" ${appSettings.enableValidator ? 'checked' : ''} onchange="toggleSetting('enableValidator')">
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Card 3: Tools & Actions -->
                <div class="settings-card full-width">
                     <div class="card-header">
                        <div class="icon-box ios-green"><i class="fas fa-tools"></i></div>
                        <h3>Maintenance Tools</h3>
                    </div>
                    <div class="card-body action-row-body">
                        <button class="btn-action primary" onclick="validator.reRun()">
                            <i class="fas fa-sync"></i> Re-Run Validator
                        </button>
                        <button class="btn-action danger" onclick="resetSettings()">
                            <i class="fas fa-undo"></i> Reset Actions
                        </button>
                    </div>
                </div>
            </div>

            <!-- Validator UI Mount Point -->
            <div id="validator-container" class="settings-card full-width" style="display:none;"> 
                 <!-- Hidden for now, or we can move Validator UI to the right if we want a split view. 
                      User requested "Modern, Spaced, Organized".
                      Validator Panel might be better in the "Validator" tab or a modal?
                      For now, I'll keep it as is but styled cleaner if it's supposed to be here.
                      Actually, current validator UI is a sidebar. Let's make it a section below.
                 -->
                  <div class="card-header">
                        <div class="icon-box ios-purple"><i class="fas fa-check-double"></i></div>
                        <h3>Active Validator Rules</h3>
                    </div>
                    <div id="validator-rules-target" class="validator-grid">
                        <!-- Rules injected here -->
                    </div>
            </div>
        </div>
    `;

        renderQaConfigExtension(container);

        // Initialize Validator UI (Re-attach to new DOM)
        if (typeof window.validator !== 'undefined') {
            // We need to make sure validator renders into our new #validator-rules-target
            // Current validator.js looks for #validator-rules-target? Yes.
            setTimeout(() => window.validator.renderPanel(), 100);
            document.getElementById('validator-container').style.display = 'block';
        }
    } catch (e) {
        console.error("Error rendering Settings Tab:", e);
        const container = document.getElementById('tab-settings');
        if (container) container.innerHTML = `<div class="error-state">Error rendering settings: ${e.message}</div>`;
    }
}

function toggleSetting(key) {
    if (appSettings.hasOwnProperty(key)) {
        appSettings[key] = !appSettings[key];
        console.log(`Settings: ${key} set to ${appSettings[key]}`);

        // Persist to localStorage if desired (optional)
        localStorage.setItem('appSettings', JSON.stringify(appSettings));
        localStorage.setItem('docxAppConfig', JSON.stringify(appSettings));

        // Update UI immediately (e.g. status icons)
        if (typeof updateStatusBar === 'function') {
            updateStatusBar();
        }
    }
}

function validateIncomingConfig(candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
        throw new Error('Config must be an object');
    const clean={};
    for (const [key,value] of Object.entries(candidate)) {
        if (!(key in CONFIG_DEFAULTS)) throw new Error('Unsupported config key: '+key);
        if (typeof value !== typeof CONFIG_DEFAULTS[key]) throw new Error('Wrong type for '+key);
        clean[key]=value;
    }
    return clean;
}
function loadSettings() {
    try {
        const newer=localStorage.getItem('docxAppConfig');
        const legacy=localStorage.getItem('appSettings');
        if (newer || legacy) {
            Object.assign(appSettings,validateIncomingConfig(JSON.parse(newer || legacy)));
            if (!newer) localStorage.setItem('docxAppConfig',JSON.stringify(appSettings));
        }
    } catch(e) { console.warn('Invalid saved Config; defaults retained:',e); }
}
function renderQaConfigExtension(container) {
    const card=document.createElement('section'); card.className='settings-card full-width';
    const body=document.createElement('div'); body.className='card-body';
    const title=document.createElement('h3');title.textContent='Diff & QA Rules';card.appendChild(title);
    [['normalizeWhitespace','Normalize whitespace in candidate matching'],
     ['caseInsensitive','Ignore case in candidate matching']].forEach(([key,label])=>{
        const row=document.createElement('label');row.className='setting-item';
        const control=document.createElement('input');control.type='checkbox';control.checked=appSettings[key];
        control.addEventListener('change',()=>{
            appSettings[key]=control.checked;
            localStorage.setItem('docxAppConfig',JSON.stringify(appSettings));
        });
        row.appendChild(control);row.appendChild(document.createTextNode(' '+label));body.appendChild(row);
    });
    const hint=document.createElement('p');
    hint.textContent='Table filtering is not claimed here: legacy conversion currently emits every extracted table. QA reports actual omissions instead of predicted FILTERED statuses.';
    body.appendChild(hint);
    for(const [label,handler] of [['Export Config JSON',exportConfigJson],
        ['Import Config JSON',()=>document.getElementById('config_import_file').click()]]) {
        const btn=document.createElement('button');btn.textContent=label;btn.type='button';
        btn.className='btn-action';btn.addEventListener('click',handler);body.appendChild(btn);
    }
    const input=document.createElement('input');input.type='file';input.accept='.json';
    input.id='config_import_file';input.hidden=true;
    input.addEventListener('change',()=>importConfigJson(input));body.appendChild(input);
    card.appendChild(body);
    const grid=container.querySelector('.settings-grid');if(grid)grid.appendChild(card);
}
function exportConfigJson() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(appSettings,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='docx_app_config.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importConfigJson(input) {
    const file=input.files&&input.files[0];if(!file)return;
    try {
        const clean=validateIncomingConfig(JSON.parse(await file.text()));
        Object.assign(appSettings,clean);
        localStorage.setItem('docxAppConfig',JSON.stringify(appSettings));
        renderSettingsTab();showStatus('Config imported','success');
    } catch(e){showStatus('Config rejected: '+e.message,'error');}
}
function resetSettings() {
    Object.assign(appSettings,CONFIG_DEFAULTS);
    localStorage.removeItem('appSettings');
    localStorage.removeItem('docxAppConfig');
    renderSettingsTab();
}
// Initialize
document.addEventListener('DOMContentLoaded', loadSettings);
