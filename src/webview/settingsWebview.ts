import * as vscode from 'vscode';

interface SettingsConfig {
	baseUrl: string;
	model: string;
	maxTokens: number;
	keepAlive: string;
	systemPrompt: string;
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export function getSettingsWebviewContent(config: SettingsConfig, webview: vscode.Webview): string {
	const nonce = getNonce();

	// 供 JS 内嵌使用的状态对象：JSON 序列化 + 转义 < 防止 </script> 提前闭合
	const stateObj = {
		baseUrl: config.baseUrl,
		model: config.model,
		maxTokens: config.maxTokens,
		keepAlive: config.keepAlive,
		systemPrompt: config.systemPrompt
	};
	const serializedState = JSON.stringify(stateObj).replace(/</g, '\\u003c');

	const keepAliveOptions = ['1 minute', '5 minutes', '10 minutes', '30 minutes'];

	const escapeAttr = (value: string) =>
		value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

	const html = `<!DOCTYPE html>
    <html>
    <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
            .setting-advanced {
                margin-bottom: 16px;
                border-top: 1px solid var(--vscode-panelSection-border);
                padding-top: 12px;
            }
            .setting-advanced > summary {
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                color: var(--vscode-descriptionForeground);
                user-select: none;
                list-style: none;
                margin-bottom: 8px;
            }
            .setting-advanced > summary::-webkit-details-marker {
                display: none;
            }
            .setting-advanced > summary::before {
                content: '\u25B8';
                display: inline-block;
                margin-right: 6px;
                transition: transform 0.15s ease;
            }
            .setting-advanced[open] > summary::before {
                transform: rotate(90deg);
            }
        </style>
    </head>
    <body>
        <h1>Ollama Settings</h1>

        <div class="setting-item">
            <label class="setting-label">Base URL</label>
            <input type="text" id="baseUrlInput" value="${escapeAttr(config.baseUrl)}" placeholder="Enter Ollama server base URL">
            <button id="testConnectionBtn" class="test-connection-button">Test Connection</button>
            <div id="connectionStatus" class="connection-status"></div>
        </div>

        <div class="setting-item">
            <label class="setting-label">Model</label>
            <div style="display: flex; gap: 8px;">
                <select id="model" style="flex: 1;">
                    <option value="${escapeAttr(config.model)}">${escapeAttr(config.model)}</option>
                </select>
                <button id="refreshModelsBtn" class="test-connection-button">Refresh</button>
            </div>
        </div>

        <div class="setting-item">
            <label class="setting-label">Max Tokens</label>
            <input type="number" id="maxTokens" value="${config.maxTokens}" />
        </div>

        <div class="setting-item">
            <label class="setting-label">Keep Alive</label>
            <select id="keepAlive">
                ${keepAliveOptions
                    .map(value =>
                        `<option value="${escapeAttr(value)}" ${value === config.keepAlive ? 'selected' : ''}>${escapeAttr(value)}</option>`
                    ).join('')}
            </select>
        </div>

        <details class="setting-advanced">
            <summary>Advanced</summary>
            <div class="setting-item">
                <label class="setting-label">System Prompt</label>
                <textarea id="systemPrompt" rows="4" style="width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; resize: vertical;">${escapeAttr(config.systemPrompt)}</textarea>
            </div>
        </details>

        <button id="saveBtn">Save Settings</button>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();

            // 全局错误捕获:转发到扩展端,便于排查 webview 脚本问题
            window.addEventListener('error', (e) => {
                vscode.postMessage({
                    command: 'webviewError',
                    message: e.message,
                    stack: e.error ? e.error.stack : ''
                });
            });

            // 保存当前设置到 webview 状态
            const currentState = ${serializedState};
            vscode.setState(currentState);

            // 页面加载时恢复状态并自动刷新模型列表
            window.addEventListener('load', () => {
                const state = vscode.getState();
                if (state) {
                    document.getElementById('baseUrlInput').value = state.baseUrl;
                    document.getElementById('model').value = state.model;
                    document.getElementById('maxTokens').value = state.maxTokens;
                    document.getElementById('keepAlive').value = state.keepAlive;
                    document.getElementById('systemPrompt').value = state.systemPrompt;
                }
                refreshModels();
            });

            // CSP 兼容的事件绑定(禁用内联 onclick)
            document.getElementById('saveBtn').addEventListener('click', saveSettings);
            document.getElementById('refreshModelsBtn').addEventListener('click', refreshModels);

            function saveSettings() {
                const settings = {
                    baseUrl: document.getElementById('baseUrlInput').value,
                    systemPrompt: document.getElementById('systemPrompt').value,
                    model: document.getElementById('model').value,
                    maxTokens: parseInt(document.getElementById('maxTokens').value),
                    keepAlive: document.getElementById('keepAlive').value
                };

                vscode.postMessage({
                    command: 'saveSettings',
                    settings
                });

                vscode.setState(settings);

                const notification = document.createElement('div');
                notification.className = 'save-notification';
                notification.textContent = 'Settings saved';
                document.body.appendChild(notification);

                setTimeout(() => {
                    notification.remove();
                }, 2000);
            }

            function refreshModels() {
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

                    // 模型为空(Ollama 不可达/未安装):保留当前选项并提示
                    if (!message.models || message.models.length === 0) {
                        const statusDiv = document.getElementById('connectionStatus');
                        statusDiv.className = 'connection-status error';
                        statusDiv.textContent = 'Failed to fetch models. Please check the Base URL or confirm Ollama is running.';
                        return;
                    }

                    modelSelect.innerHTML = message.models
                        .map(model =>
                            '<option value="' + model + '" ' + (model === currentModel ? 'selected' : '') + '>' + model + '</option>'
                        ).join('');

                    // 当前选中的模型不在列表中时,回退到第一个
                    if (message.models.indexOf(currentModel) === -1) {
                        modelSelect.value = message.models[0];
                    }
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
