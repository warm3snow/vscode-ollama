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
            <select id="model" onclick="refreshModels()">
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
            
            // 保存当前设置到 webview 状态
            const currentState = {
                baseUrl: "${config.baseUrl}",
                model: "${config.model}",
                maxTokens: ${config.maxTokens},
                keepAlive: "${config.keepAlive}",
                performanceMode: "${config.performanceMode}"
            };
            vscode.setState(currentState);

            // 页面加载时恢复状态
            window.addEventListener('load', () => {
                const state = vscode.getState();
                if (state) {
                    document.getElementById('baseUrl').value = state.baseUrl;
                    document.getElementById('model').value = state.model;
                    document.getElementById('maxTokens').value = state.maxTokens;
                    document.getElementById('keepAlive').value = state.keepAlive;
                    document.getElementById('performanceMode').value = state.performanceMode;
                }
            });

            function saveSettings() {
                const settings = {
                    baseUrl: document.getElementById('baseUrl').value,
                    model: document.getElementById('model').value,
                    maxTokens: parseInt(document.getElementById('maxTokens').value),
                    keepAlive: document.getElementById('keepAlive').value,
                    performanceMode: document.getElementById('performanceMode').value
                };
                
                // 保存到 VSCode 配置
                vscode.postMessage({
                    command: 'saveSettings',
                    settings
                });

                // 更新 webview 状态
                vscode.setState(settings);
            }

            async function refreshModels() {
                vscode.postMessage({
                    command: 'refreshModels',
                    baseUrl: document.getElementById('baseUrl').value
                });
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'updateModels') {
                    const modelSelect = document.getElementById('model');
                    const currentModel = modelSelect.value;
                    modelSelect.innerHTML = message.models
                        .map(model => 
                            \`<option value="\${model}" \${model === currentModel ? 'selected' : ''}>\${model}</option>\`
                        ).join('');
                }
            });
        </script>
    </body>
    </html>`;
    
    return html;
} 