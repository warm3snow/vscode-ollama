import * as vscode from 'vscode';

export function getSettingsWebviewContent(config: any): string {
    const html = `<!DOCTYPE html>
    <html>
    <head>
        <style>
            body {
                padding: 20px;
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
            }
            .setting-item {
                margin-bottom: 20px;
            }
            .setting-label {
                display: block;
                margin-bottom: 5px;
                font-size: 14px;
                font-weight: bold;
            }
            input, select {
                width: 100%;
                padding: 8px;
                border: 1px solid var(--vscode-input-border);
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 4px;
            }
            button {
                padding: 8px 16px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
            button:hover {
                background: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <h1>Ollama Settings</h1>
        
        <div class="setting-item">
            <label class="setting-label">Base URL</label>
            <input type="text" id="baseUrl" value="${config.baseUrl}" />
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Model</label>
            <select id="model">
                <option value="${config.model}">${config.model}</option>
            </select>
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Max Tokens</label>
            <input type="number" id="maxTokens" value="${config.maxTokens}" />
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Keep Alive</label>
            <select id="keepAlive">
                ${['1 minute', '5 minutes', '10 minutes', '30 minutes']
                    .map(value => 
                        `<option value="${value}" ${value === config.keepAlive ? 'selected' : ''}>${value}</option>`
                    ).join('')}
            </select>
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Performance Mode</label>
            <select id="performanceMode">
                ${['Base (Default)', 'Fast', 'Ultra']
                    .map(value => 
                        `<option value="${value}" ${value === config.performanceMode ? 'selected' : ''}>${value}</option>`
                    ).join('')}
            </select>
        </div>

        <button onclick="saveSettings()">Save Settings</button>

        <script>
            const vscode = acquireVsCodeApi();
            
            function saveSettings() {
                const settings = {
                    baseUrl: document.getElementById('baseUrl').value,
                    model: document.getElementById('model').value,
                    maxTokens: parseInt(document.getElementById('maxTokens').value),
                    keepAlive: document.getElementById('keepAlive').value,
                    performanceMode: document.getElementById('performanceMode').value
                };
                
                vscode.postMessage({
                    command: 'saveSettings',
                    settings
                });
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'updateModels') {
                    const modelSelect = document.getElementById('model');
                    modelSelect.innerHTML = message.models
                        .map(model => 
                            \`<option value="\${model}" \${model === message.currentModel ? 'selected' : ''}>\${model}</option>\`
                        ).join('');
                }
            });
        </script>
    </body>
    </html>`;
    
    return html;
} 