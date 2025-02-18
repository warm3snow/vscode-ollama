// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getSettingsWebviewContent } from './webview/settingsWebview';
import { OllamaModelsResponse } from './types';
import { getChatWebviewContent } from './webview/chatWebview';
import { searchWeb } from './webSearch';

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

// 在文件开头添加类型定义
interface AbortError extends Error {
	name: 'AbortError';
}

let settingsPanel: vscode.WebviewPanel | undefined = undefined;
let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let lastMessageDiv: boolean = false;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// 添加详细的激活日志
	const channel = vscode.window.createOutputChannel('Ollama Extension');
	channel.appendLine('Activating vscode-ollama extension...');
	channel.appendLine(`Extension path: ${context.extensionPath}`);
	channel.show();

	try {
		// Get configuration function
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

		// Register settings command
		channel.appendLine('Registering settings command...');
		let settingsCommand = vscode.commands.registerCommand('vscode-ollama.settings', () => {
			channel.appendLine('Executing settings command...');
			console.log('Executing vscode-ollama.settings command');
			if (settingsPanel) {
				settingsPanel.reveal(vscode.ViewColumn.One);
			} else {
				settingsPanel = vscode.window.createWebviewPanel(
					'ollamaSettings',
					'Ollama Settings',
					vscode.ViewColumn.One,
					{
						enableScripts: true,
						retainContextWhenHidden: true
					}
				);

				const updateWebview = () => {
					if (settingsPanel) {
						settingsPanel.webview.html = getSettingsWebviewContent(getOllamaConfig());
					}
				};

				updateWebview();

				settingsPanel.onDidDispose(
					() => {
						settingsPanel = undefined;
					},
					null,
					context.subscriptions
				);

				// 监听配置变化
				context.subscriptions.push(
					vscode.workspace.onDidChangeConfiguration(e => {
						if (e.affectsConfiguration('vscode-ollama')) {
							updateWebview();
						}
					})
				);

				// 处理 webview 消息
				settingsPanel.webview.onDidReceiveMessage(
					async message => {
						switch (message.command) {
							case 'openSettings':
								vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-ollama');
								return;
							case 'refreshModels':
								try {
									if (settingsPanel) {
										const models = await getAvailableModels(message.baseUrl);
										settingsPanel.webview.postMessage({
											command: 'updateModels',
											models: models
										});
									}
								} catch (error) {
									vscode.window.showErrorMessage(`Failed to refresh models: ${error}`);
								}
								return;
							case 'saveSettings':
								try {
									const config = vscode.workspace.getConfiguration('vscode-ollama');
									await config.update('baseUrl', message.settings.baseUrl, true);
									await config.update('model', message.settings.model, true);
									await config.update('maxTokens', message.settings.maxTokens, true);
									await config.update('keepAlive', message.settings.keepAlive, true);
									await config.update('performanceMode', message.settings.performanceMode, true);
									vscode.window.showInformationMessage('Settings saved successfully');
									settingsPanel?.webview.postMessage({ command: 'saveSuccess' });
								} catch (error) {
									vscode.window.showErrorMessage(`Failed to save settings: ${error}`);
								}
								return;
						}
					},
					undefined,
					context.subscriptions
				);
			}
		});

		// Register test connection command
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

		// Register refresh models command
		const refreshModelsCommand = vscode.commands.registerCommand('vscode-ollama.refreshModels', async () => {
			const config = getOllamaConfig();
			try {
				const models = await getAvailableModels(config.baseUrl);
				vscode.window.showInformationMessage(`Found ${models.length} models`);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to refresh models: ${error}`);
			}
		});

		// Register chat command
		const chatCommand = vscode.commands.registerCommand('vscode-ollama.openChat', () => {
			const panel = vscode.window.createWebviewPanel(
				'ollamaChat',
				'Ollama Chat',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true
				}
			);

			const config = getOllamaConfig();
			panel.webview.html = getChatWebviewContent(config);

			// 在 webview 准备好后立即发送模型名称
			panel.webview.onDidReceiveMessage(
				async message => {
					if (message.command === 'webviewReady') {
						// 发送欢迎消息和模型名称
						panel.webview.postMessage({
							command: 'welcomeMessage'
						});
						panel.webview.postMessage({
							command: 'updateModelName',
							modelName: config.model // 发送当前配置的模型名称
						});
					} else if (message.command === 'sendMessage') {
						try {
							const currentConfig = getOllamaConfig();
							const messages = message.resetContext ? [] : [
								{ role: 'system', content: 'You are a helpful assistant.' }
							];

							if (message.webSearch) {
								const searchResults = await searchWeb(message.content);
								if (searchResults.length > 0) {
									const searchContext = `Web search results for "${message.content}":\n\n` + 
										searchResults.map((result, index) => 
											`[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.snippet}\n`
										).join('\n');

									messages.push({ 
										role: 'system', 
										content: `Here are the latest web search results:\n${searchContext}\n\n` +
												`Please use this information to help answer the user's question.`
									});
								}
							}

							messages.push({ role: 'user', content: message.content });

							const response = await fetch(`${currentConfig.baseUrl}/api/chat`, {
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
								},
								body: JSON.stringify({
									model: currentConfig.model,
									messages: messages,
									stream: true
								})
							});

							if (!response.ok) {
								throw new Error(`Failed to send message: ${response.statusText}`);
							}

							// 修复 reader 的类型检查
							const reader = response.body?.getReader();
							if (!reader) {
								throw new Error('Failed to get response reader');
							}
							currentReader = reader;
							const decoder = new TextDecoder();
							let content = '';

							try {
								while (true) {
									const { value, done } = await currentReader.read();
									if (done) break;

									const chunk = decoder.decode(value);
									const lines = chunk.split('\n').filter(line => line.trim());
									
									for (const line of lines) {
										const data = JSON.parse(line) as OllamaChatResponse;
										content += data.message.content;
										
										// 如果是新消息且上一条消息已完成，创建新的消息 div
										if (!lastMessageDiv) {
											panel.webview.postMessage({
												command: 'streamMessage',
												content: data.message.content,
												done: false,
												newMessage: true  // 标记新消息开始
											});
											lastMessageDiv = true;
										} else {
											// 继续追加到当前消息
											panel.webview.postMessage({
												command: 'streamMessage',
												content: data.message.content,
												done: false,
												newMessage: false
											});
										}

										// 如果消息完成，重置标记
										if (data.done) {
											panel.webview.postMessage({
												command: 'streamMessage',
												content: '',
												done: true,
												newMessage: false
											});
											lastMessageDiv = false;
										}
									}
								}
							} catch (error: unknown) {
								if (error instanceof Error && error.name === 'AbortError') {
									// 正常的终止，不需要显示错误
									panel.webview.postMessage({
										command: 'streamMessage',
										content: '\n[已终止生成]',
										done: true
									});
								} else {
									throw error;
								}
							} finally {
								currentReader = null;
							}

							// 在发送新消息时也更新模型名称
							panel.webview.postMessage({
								command: 'updateModelName',
								modelName: currentConfig.model
							});
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error);
							vscode.window.showErrorMessage(`Chat error: ${errorMessage}`);
							panel.webview.postMessage({
								command: 'streamMessage',
								content: `\n[错误: ${errorMessage}]`,
								done: true
							});
						}
					} else if (message.command === 'stopGeneration') {
						if (currentReader) {
							currentReader.cancel();
							currentReader = null;
						}
					}
				},
				undefined,
				context.subscriptions
			);
		});

		// Add all commands to the context subscriptions
		context.subscriptions.push(settingsCommand);
		context.subscriptions.push(testConnectionCommand);
		context.subscriptions.push(refreshModelsCommand);
		context.subscriptions.push(chatCommand);

		// 确认激活完成
		channel.appendLine('vscode-ollama extension activated successfully');
		vscode.window.showInformationMessage('Ollama extension is now active');
	} catch (error) {
		channel.appendLine(`Error during activation: ${error}`);
		vscode.window.showErrorMessage(`Failed to activate Ollama extension: ${error}`);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (settingsPanel) {
		settingsPanel.dispose();
	}
}
