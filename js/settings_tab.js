/**
 * settings_tab.js — Application configuration
 */

const appSettings = {
    smartHeaderNaming: true, // Renamed from enableAutoNamer
    enableValidator: true,
    debugMode: false,
    robustParsing: false,
    autoApprove: false
};

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
                <h2>Settings</h2>
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

        // Update UI immediately (e.g. status icons)
        if (typeof updateStatusBar === 'function') {
            updateStatusBar();
        }
    }
}

function loadSettings() {
    const saved = localStorage.getItem('appSettings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            Object.assign(appSettings, parsed);
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }
}

function resetSettings() {
    appSettings.smartHeaderNaming = true;
    appSettings.enableValidator = true;
    appSettings.debugMode = false;
    appSettings.robustParsing = false;
    appSettings.autoApprove = false;
    localStorage.removeItem('appSettings');
    renderSettingsTab();
}

// Initialize
document.addEventListener('DOMContentLoaded', loadSettings);
