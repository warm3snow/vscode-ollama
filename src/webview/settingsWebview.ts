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
            .save-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: var(--vscode-notificationToast-background);
                color: var(--vscode-notificationToast-foreground);
                padding: 8px 16px;
                border-radius: 4px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                z-index: 1000;
                animation: fadeInOut 2s ease-in-out;
            }
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateY(-20px); }
                10% { opacity: 1; transform: translateY(0); }
                90% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-20px); }
            }
            .test-connection-button {
                margin-top: 8px;
                padding: 6px 12px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
            .test-connection-button:hover {
                background: var(--vscode-button-hoverBackground);
            }
            .test-connection-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            .connection-status {
                margin-top: 8px;
                padding: 8px;
                border-radius: 4px;
                display: none;
            }
            .connection-status.success {
                display: block;
                background-color: var(--vscode-inputValidation-infoBackground);
                border: 1px solid var(--vscode-inputValidation-infoBorder);
            }
            .connection-status.error {
                display: block;
                background-color: var(--vscode-inputValidation-errorBackground);
                border: 1px solid var(--vscode-inputValidation-errorBorder);
            }
        </style>
    </head>
    <body>
        <h1>Ollama Settings</h1>
        
        <div class="setting-item">
            <label class="setting-label">Base URL</label>
            <input type="text" id="baseUrlInput" value="${config.baseUrl}" placeholder="Enter Ollama server base URL">
            <button id="testConnectionBtn" class="test-connection-button">Test Connection</button>
            <div id="connectionStatus" class="connection-status"></div>
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

        <div class="setting-item">
            <label class="setting-label">System Prompt</label>
            <textarea id="systemPrompt" rows="4" style="width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; resize: vertical;">${config.systemPrompt.replace(/"/g, '&quot;').replace(/\n/g, '&#10;')}</textarea>
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
                performanceMode: "${config.performanceMode}",
                systemPrompt: "${config.systemPrompt.replace(/"/g, '&quot;').replace(/\n/g, '&#10;')}"
            };
            vscode.setState(currentState);

            // 页面加载时恢复状态
            window.addEventListener('load', () => {
                const state = vscode.getState();
                if (state) {
                    document.getElementById('baseUrlInput').value = state.baseUrl;
                    document.getElementById('model').value = state.model;
                    document.getElementById('maxTokens').value = state.maxTokens;
                    document.getElementById('keepAlive').value = state.keepAlive;
                    document.getElementById('performanceMode').value = state.performanceMode;
                    document.getElementById('systemPrompt').value = state.systemPrompt;
                }
            });

            function saveSettings() {
                const settings = {
                    baseUrl: document.getElementById('baseUrlInput').value,
                    systemPrompt: document.getElementById('systemPrompt').value,
                    model: document.getElementById('model').value,
                    maxTokens: parseInt(document.getElementById('maxTokens').value),
                    keepAlive: document.getElementById('keepAlive').value,
                    performanceMode: document.getElementById('performanceMode').value
                };
                
                vscode.postMessage({
                    command: 'saveSettings',
                    settings
                });

                // 更新 webview 状态
                vscode.setState(settings);

                // 创建并显示保存成功提示
                const notification = document.createElement('div');
                notification.className = 'save-notification';
                notification.textContent = '设置已保存';
                document.body.appendChild(notification);

                // 2秒后自动移除提示
                setTimeout(() => {
                    notification.remove();
                }, 2000);
            }

            async function refreshModels() {
                vscode.postMessage({
                    command: 'refreshModels',
                    baseUrl: document.getElementById('baseUrlInput').value
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

            // Add test connection functionality
            document.getElementById('testConnectionBtn').addEventListener('click', async () => {
                const baseUrl = document.getElementById('baseUrlInput').value.trim();
                const testButton = document.getElementById('testConnectionBtn');
                const statusDiv = document.getElementById('connectionStatus');
                
                if (!baseUrl) {
                    vscode.postMessage({
                        command: 'showError',
                        message: 'Please enter the base URL'
                    });
                    return;
                }

                testButton.disabled = true;
                testButton.textContent = 'Testing...';
                statusDiv.className = 'connection-status';
                statusDiv.textContent = '';

                vscode.postMessage({
                    command: 'testConnection',
                    baseUrl: baseUrl
                });
            });

            // Handle test connection result
            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'testConnectionResult') {
                    const testButton = document.getElementById('testConnectionBtn');
                    const statusDiv = document.getElementById('connectionStatus');
                    
                    testButton.disabled = false;
                    testButton.textContent = 'Test Connection';
                    
                    if (message.success) {
                        statusDiv.className = 'connection-status success';
                        statusDiv.textContent = 'Test Connection is Success';
                    } else {
                        statusDiv.className = 'connection-status error';
                        statusDiv.textContent = 'Test Connection is Failed, Please check specified url';
                    }
                }
            });
        </script>
    </body>
    </html>`;
    
    return html;
} 