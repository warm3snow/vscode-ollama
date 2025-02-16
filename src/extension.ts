// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getSettingsWebviewContent } from './webview/settingsWebview';
import { OllamaModelsResponse } from './types';
import { getChatWebviewContent } from './webview/chatWebview';

interface OllamaConfig {
	baseUrl: string;
	model: string;
	maxTokens: number;
	keepAlive: string;
	performanceMode: string;
}

// Add interface for chat response
interface OllamaChatResponse {
	model: string;
	created_at: string;
	message: {
		role: string;
		content: string;
	};
	done: boolean;
	done_reason?: string;
	total_duration?: number;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Activating vscode-ollama extension');

	// 获取配置函数
	function getOllamaConfig(): OllamaConfig {
		const config = vscode.workspace.getConfiguration('vscode-ollama');
		return {
			baseUrl: config.get<string>('baseUrl') || 'http://127.0.0.1:11434',
			model: config.get<string>('model') || 'deepseek-r1:32b',
			maxTokens: config.get<number>('maxTokens') || 4096,
			keepAlive: config.get<string>('keepAlive') || '5 minutes',
			performanceMode: config.get<string>('performanceMode') || 'Base (Default)'
		};
	}

	async function getAvailableModels(baseUrl: string): Promise<string[]> {
		try {
			const response = await fetch(`${baseUrl}/api/tags`);
			if (!response.ok) {
				throw new Error(`Failed to fetch models: ${response.statusText}`);
			}
			const data = await response.json() as OllamaModelsResponse;
			return data.models.map(m => m.model);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to fetch models: ${errorMessage}`);
			return [];
		}
	}

	// 注册设置命令
	let settingsCommand = vscode.commands.registerCommand('vscode-ollama.settings', async () => {
		console.log('Opening Ollama settings panel');
		
		const config = getOllamaConfig();
		const panel = vscode.window.createWebviewPanel(
			'ollamaSettings',
			'Ollama Settings',
			vscode.ViewColumn.One,
			{
				enableScripts: true
			}
		);

		const updateWebview = async () => {
			const currentConfig = getOllamaConfig();
			panel.webview.html = getSettingsWebviewContent(currentConfig);
			
			// Fetch and update models
			const models = await getAvailableModels(currentConfig.baseUrl);
			panel.webview.postMessage({
				command: 'updateModels',
				models,
				currentModel: currentConfig.model
			});
		};

		await updateWebview();

		// 监听配置变化
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('vscode-ollama')) {
					updateWebview();
				}
			})
		);

		// 处理 webview 消息
		panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'saveSettings':
						const config = vscode.workspace.getConfiguration('vscode-ollama');
						await config.update('baseUrl', message.settings.baseUrl, vscode.ConfigurationTarget.Global);
						await config.update('model', message.settings.model, vscode.ConfigurationTarget.Global);
						await config.update('maxTokens', message.settings.maxTokens, vscode.ConfigurationTarget.Global);
						await config.update('keepAlive', message.settings.keepAlive, vscode.ConfigurationTarget.Global);
						await config.update('performanceMode', message.settings.performanceMode, vscode.ConfigurationTarget.Global);
						vscode.window.showInformationMessage('Ollama settings saved successfully');
						return;
				}
			},
			undefined,
			context.subscriptions
		);
	});

	context.subscriptions.push(settingsCommand);

	// 注册测试连接命令
	let testConnectionCommand = vscode.commands.registerCommand('vscode-ollama.testConnection', async () => {
		const config = getOllamaConfig();
		try {
			const response = await fetch(`${config.baseUrl}/api/version`);
			if (response.ok) {
				vscode.window.showInformationMessage('Successfully connected to Ollama server');
			} else {
				vscode.window.showErrorMessage('Failed to connect to Ollama server');
			}
		} catch (error) {
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

	// Add chat command registration
	let chatCommand = vscode.commands.registerCommand('vscode-ollama.openChat', () => {
		const panel = vscode.window.createWebviewPanel(
			'ollamaChat',
			'Ollama Chat',
			vscode.ViewColumn.One,
			{
				enableScripts: true
			}
		);

		const config = getOllamaConfig();
		panel.webview.html = getChatWebviewContent(config);

		// Handle messages from the webview
		panel.webview.onDidReceiveMessage(
			async message => {
				if (message.command === 'sendMessage') {
					try {
						const response = await fetch(`${config.baseUrl}/api/chat`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
							},
							body: JSON.stringify({
								model: config.model,
								messages: [
									{ role: 'system', content: 'You are a helpful assistant.' },
									{ role: 'user', content: message.content }
								],
								stream: true
							})
						});

						if (!response.ok) {
							throw new Error(`Failed to send message: ${response.statusText}`);
						}

						// Handle streaming response
						const reader = response.body?.getReader();
						const decoder = new TextDecoder();
						let content = '';

						if (reader) {
							while (true) {
								const { value, done } = await reader.read();
								if (done) break;

								const chunk = decoder.decode(value);
								const lines = chunk.split('\n').filter(line => line.trim());
								
								for (const line of lines) {
									const data = JSON.parse(line) as OllamaChatResponse;
									content += data.message.content;
									panel.webview.postMessage({
										command: 'streamMessage',
										content: data.message.content,
										done: data.done
									});
								}
							}
						}
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						vscode.window.showErrorMessage(`Chat error: ${errorMessage}`);
					}
				}
			},
			undefined,
			context.subscriptions
		);
	});

	context.subscriptions.push(chatCommand);

	// Add refresh models command
	let refreshModelsCommand = vscode.commands.registerCommand('vscode-ollama.refreshModels', async () => {
		const config = getOllamaConfig();
		try {
			const models = await getAvailableModels(config.baseUrl);
			vscode.window.showInformationMessage(`Found ${models.length} models`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to refresh models: ${errorMessage}`);
		}
	});

	context.subscriptions.push(refreshModelsCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
