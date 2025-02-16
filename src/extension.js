"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
const settingsWebview_1 = require("./webview/settingsWebview");
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    console.log('Activating vscode-ollama extension');
    // 获取配置函数
    function getOllamaConfig() {
        const config = vscode.workspace.getConfiguration('vscode-ollama');
        return {
            baseUrl: config.get('baseUrl') || 'http://127.0.0.1:11434',
            model: config.get('model') || 'deepseek-r1:32b',
            maxTokens: config.get('maxTokens') || 4096,
            keepAlive: config.get('keepAlive') || '5 minutes',
            performanceMode: config.get('performanceMode') || 'Base (Default)'
        };
    }
    // 注册设置命令
    let settingsCommand = vscode.commands.registerCommand('vscode-ollama.settings', () => {
        console.log('Opening Ollama settings panel');
        const panel = vscode.window.createWebviewPanel('ollamaSettings', 'Ollama Settings', vscode.ViewColumn.One, {
            enableScripts: true
        });
        const updateWebview = () => {
            const config = getOllamaConfig();
            panel.webview.html = (0, settingsWebview_1.getSettingsWebviewContent)(config);
        };
        updateWebview();
        // 监听配置变化
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('vscode-ollama')) {
                updateWebview();
            }
        }));
        // 处理 webview 消息
        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-ollama');
                    return;
            }
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(settingsCommand);
    // 注册测试连接命令
    let testConnectionCommand = vscode.commands.registerCommand('vscode-ollama.testConnection', async () => {
        const config = getOllamaConfig();
        try {
            const response = await fetch(`${config.baseUrl}/api/version`);
            if (response.ok) {
                vscode.window.showInformationMessage('Successfully connected to Ollama server');
            }
            else {
                vscode.window.showErrorMessage('Failed to connect to Ollama server');
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error connecting to Ollama: ${errorMessage}`);
        }
    });
    context.subscriptions.push(testConnectionCommand);
    // 使用配置初始化 Ollama 客户端
    function initOllamaClient() {
        const config = getOllamaConfig();
        // 这里添加初始化 Ollama 客户端的代码
        console.log('Initializing Ollama client with config:', config);
    }
    // 初始化
    initOllamaClient();
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map