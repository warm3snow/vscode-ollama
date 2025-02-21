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
	systemPrompt: string;
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
let currentConversationId: string | null = null;

// 在文件开头添加默认搜索引擎配置
const DEFAULT_SEARCH_PROVIDER = 'duckduckgo';

// 在文件顶部添加消息历史存储
let messageHistory: Array<{role: string, content: string}> = [];

// 添加一个函数来管理消息历史大小
function manageMessageHistory(messages: Array<{role: string, content: string}>, maxTokens: number): Array<{role: string, content: string}> {
	// 保留系统提示词
	const systemMessage = messages.find(msg => msg.role === 'system');
	let history = messages.filter(msg => msg.role !== 'system');
	
	// 粗略估计token数（每个字符约1个token）
	let totalLength = systemMessage ? systemMessage.content.length : 0;
	
	// 从最新的消息开始保留
	const managedHistory = [];
	if (systemMessage) {
		managedHistory.push(systemMessage);
	}
	
	// 从最新的消息往前遍历
	for (let i = history.length - 1; i >= 0; i--) {
		const message = history[i];
		const messageLength = message.content.length;
		
		// 如果添加这条消息后仍在限制内，则添加
		if (totalLength + messageLength <= maxTokens) {
			managedHistory.push(message);
			totalLength += messageLength;
		} else {
			break;
		}
	}
	
	// 反转数组以保持正确的顺序（系统消息在前，最新消息在后）
	return managedHistory.reverse();
}

// 将 getOllamaConfig 移到 activate 函数外部
export function getOllamaConfig(): OllamaConfig {
	const config = vscode.workspace.getConfiguration('vscode-ollama');
	const defaultSystemPrompt = "Given the following conversation, relevant context, and a follow up question, reply with an answer to the current question the user is asking. Return only your response to the question given the above information following the users instructions as needed.";
	
	return {
		baseUrl: config.get<string>('baseUrl') || 'http://127.0.0.1:11434',
		model: config.get<string>('model') || 'deepseek-r1:32b',
		maxTokens: config.get<number>('maxTokens') || 4096,
		keepAlive: config.get<string>('keepAlive') || '5 minutes',
		performanceMode: config.get<string>('performanceMode') || 'Base (Default)',
		systemPrompt: config.get<string>('systemPrompt') || defaultSystemPrompt
	};
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	try {
		let panel: vscode.WebviewPanel | undefined;  // 声明在更高的作用域

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
		let settingsCommand = vscode.commands.registerCommand('vscode-ollama.settings', () => {
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
									await config.update('systemPrompt', message.settings.systemPrompt, true);
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
			if (panel) {
				panel.reveal(vscode.ViewColumn.One);
				return;
			}

			panel = vscode.window.createWebviewPanel(
				'ollamaChat',
				'Ollama Chat',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					enableFindWidget: true,
					enableCommandUris: true
				}
			);

			const config = getOllamaConfig();
			panel.webview.html = getChatWebviewContent(config);

			// 在 webview 准备好后立即发送模型名称
			panel.webview.onDidReceiveMessage(
				async message => {
					if (!panel) {
						return;
					}

					if (message.command === 'webviewReady') {
						// 发送欢迎消息和模型名称
						panel.webview.postMessage({
							command: 'welcomeMessage'
						});
						panel.webview.postMessage({
							command: 'updateModelName',
							modelName: config.model
						});
					} else if (message.command === 'sendMessage') {
						try {
							const currentConfig = getOllamaConfig();
							const searchProvider = vscode.workspace.getConfiguration('vscode-ollama').get('searchProvider', DEFAULT_SEARCH_PROVIDER);
							
							console.log('Message received:', {
								content: message.content,
								webSearch: message.webSearch,
								searchProvider,
								rawMessage: message
							});

							const messages = message.resetContext ? [] : manageMessageHistory([...messageHistory], currentConfig.maxTokens);

							// 如果是重置上下文或者消息历史为空，添加系统提示词
							if (message.resetContext || messages.length === 0) {
								messages.push({ role: 'system', content: currentConfig.systemPrompt });
							}

							if (message.webSearch) {
								try {
									console.log('Starting web search...');
									const searchResults = await searchWeb(searchProvider, message.content);
									console.log('Search results received:', searchResults);

									if (searchResults.length > 0) {
										const searchContext = `Web search results for "${message.content}":\n\n` + 
											searchResults.map((result, index) => 
												`[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.snippet}\n`
											).join('\n');

										console.log('Search context created:', searchContext);

										messages.push({ 
											role: 'system', 
											content: `Here are the latest web search results:\n${searchContext}\n\n` +
													`Please use this information to help answer the user's question.`
										});
									} else {
										console.log('No search results found');
										panel.webview.postMessage({
											command: 'searchStatus',
											status: 'No results found'
										});
									}
								} catch (error) {
									console.error('Web search failed:', error);
									panel.webview.postMessage({
										command: 'searchStatus',
										status: 'Search failed'
									});
								}
							}

							// 添加用户新消息
							messages.push({ role: 'user', content: message.content });

							// 生成新的会话ID
							currentConversationId = Date.now().toString();
							lastMessageDiv = false;  // 重置状态

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

							// 修改流式消息处理部分
							try {
								while (true) {
									const { value, done } = await currentReader.read();
									if (done) break;

									const chunk = decoder.decode(value);
									const lines = chunk.split('\n').filter(line => line.trim());
									
									if (!panel) {
										return;
									}

									for (const line of lines) {
										const data = JSON.parse(line) as OllamaChatResponse;
										content += data.message.content;
										
										panel.webview.postMessage({
											command: 'streamMessage',
											content: data.message.content,
											done: false,
											newMessage: !lastMessageDiv,
											conversationId: currentConversationId
										});
										lastMessageDiv = true;

										if (data.done) {
											messageHistory = manageMessageHistory([
												...messages,
												{ role: 'assistant', content: content }
											], currentConfig.maxTokens);
											panel.webview.postMessage({
												command: 'streamMessage',
												content: '',
												done: true,
												newMessage: false,
												conversationId: currentConversationId
											});
											lastMessageDiv = false;
											content = '';
											currentConversationId = null;
										}
									}
								}
							} catch (error: unknown) {
								if (error instanceof Error && error.name === 'AbortError') {
									if (panel) {
										panel.webview.postMessage({
											command: 'streamMessage',
											content: '\n[已终止生成]',
											done: true,
											newMessage: false,
											conversationId: currentConversationId
										});
										currentConversationId = null;
										lastMessageDiv = false;
									}
								} else {
									throw error;
								}
							}

							// 更新模型名称
							if (panel) {
								panel.webview.postMessage({
									command: 'updateModelName',
									modelName: currentConfig.model
								});
							}
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error);
							vscode.window.showErrorMessage(`Chat error: ${errorMessage}`);
							if (panel) {
								panel.webview.postMessage({
									command: 'streamMessage',
									content: `\n[错误: ${errorMessage}]`,
									done: true
								});
							}
						}
					} else if (message.command === 'stopGeneration') {
						if (currentReader) {
							currentReader.cancel();
							currentReader = null;
							lastMessageDiv = false;  // 重置 lastMessageDiv 状态
						}
					} else if (message.command === 'toggleTheme') {
						try {
							// 获取当前主题配置
							const workbenchConfig = vscode.workspace.getConfiguration('workbench');
							const currentTheme = workbenchConfig.get<string>('colorTheme');
							
							// 使用 VS Code 的主题 kind 来判断当前主题
							const currentKind = vscode.window.activeColorTheme.kind;
							const isDark = currentKind === vscode.ColorThemeKind.Dark;
							
							// 根据当前主题状态切换
							const newTheme = isDark ? 'Light+ (default light)' : 'Dark+ (default dark)';
							
							// 更新主题配置
							await workbenchConfig.update(
								'colorTheme',
								newTheme,
								vscode.ConfigurationTarget.Global
							);

							// 发送主题变化消息
							if (panel) {
								panel.webview.postMessage({
									command: 'themeChanged',
									isDark: !isDark // 切换后的状态
								});
							}
						} catch (error) {
							console.error('Failed to toggle theme:', error);
							vscode.window.showErrorMessage('主题切换失败');
						}
					}
				},
				undefined,
				context.subscriptions
			);

			// 当面板关闭时清除引用
			panel.onDidDispose(() => {
				messageHistory = [];
				panel = undefined;
			}, null, context.subscriptions);
		});

		// Add all commands to the context subscriptions
		context.subscriptions.push(settingsCommand);
		context.subscriptions.push(testConnectionCommand);
		context.subscriptions.push(refreshModelsCommand);
		context.subscriptions.push(chatCommand);

		// 添加主题变化监听
		context.subscriptions.push(
			vscode.window.onDidChangeActiveColorTheme(theme => {
				if (panel) {
					panel.webview.postMessage({
						command: 'themeChanged',
						isDark: theme.kind === vscode.ColorThemeKind.Dark
					});
				}
			})
		);
	} catch (error) {
		console.error('Activation failed:', error);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (settingsPanel) {
		settingsPanel.dispose();
	}
}
