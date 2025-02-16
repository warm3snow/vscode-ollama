"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettingsWebviewContent = getSettingsWebviewContent;
function getSettingsWebviewContent(config) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ollama Settings</title>
        <style>
            body {
                padding: 20px;
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
            }
            .setting-group {
                margin-bottom: 20px;
            }
            .setting-item {
                margin: 10px 0;
                padding: 10px;
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
            }
            .setting-title {
                font-weight: bold;
                margin-bottom: 5px;
            }
            .setting-value {
                color: var(--vscode-textPreformat-foreground);
            }
        </style>
    </head>
    <body>
        <h1>Ollama Settings</h1>
        <div class="setting-group">
            <div class="setting-item">
                <div class="setting-title">Base URL</div>
                <div class="setting-value">${config.baseUrl}</div>
            </div>
            <div class="setting-item">
                <div class="setting-title">Model</div>
                <div class="setting-value">${config.model}</div>
            </div>
            <div class="setting-item">
                <div class="setting-title">Max Tokens</div>
                <div class="setting-value">${config.maxTokens}</div>
            </div>
            <div class="setting-item">
                <div class="setting-title">Keep Alive</div>
                <div class="setting-value">${config.keepAlive}</div>
            </div>
            <div class="setting-item">
                <div class="setting-title">Performance Mode</div>
                <div class="setting-value">${config.performanceMode}</div>
            </div>
        </div>
        <button onclick="vscode.postMessage({ command: 'openSettings' })">
            Open VSCode Settings
        </button>
    </body>
    </html>`;
}
//# sourceMappingURL=settingsWebview.js.map