// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getSettingsWebviewContent } from './webview/settingsWebview';
import { OllamaModelsResponse, SearchResult } from './types';
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
const DEFAULT_SEARCH_PROVIDER = 'bing';

// 添加搜索结果模板
const search_answer_zh_template = `# 以下内容是基于用户发送的消息的搜索结果:
{search_results}
在我给你的搜索结果中，每个结果都是[webpage X begin]...[webpage X end]格式的，X代表每篇文章的数字索引。请在适当的情况下在句子末尾引用上下文。请按照引用编号[citation:X]的格式在答案中对应部分引用上下文。如果一句话源自多个上下文，请列出所有相关的引用编号，例如[citation:3][citation:5]，切记不要将引用集中在最后返回引用编号，而是在答案对应部分列出。
在回答时，请注意以下几点：
- 今天是{cur_date}。
- 并非搜索结果的所有内容都与用户的问题密切相关，你需要结合问题，对搜索结果进行甄别、筛选。
- 对于列举类的问题（如列举所有航班信息），尽量将答案控制在10个要点以内，并告诉用户可以查看搜索来源、获得完整信息。优先提供信息完整、最相关的列举项；如非必要，不要主动告诉用户搜索结果未提供的内容。
- 对于创作类的问题（如写论文），请务必在正文的段落中引用对应的参考编号，例如[citation:3][citation:5]，不能只在文章末尾引用。你需要解读并概括用户的题目要求，选择合适的格式，充分利用搜索结果并抽取重要信息，生成符合用户要求、极具思想深度、富有创造力与专业性的答案。你的创作篇幅需要尽可能延长，对于每一个要点的论述要推测用户的意图，给出尽可能多角度的回答要点，且务必信息量大、论述详尽。
- 如果回答很长，请尽量结构化、分段落总结。如果需要分点作答，尽量控制在5个点以内，并合并相关的内容。
- 对于客观类的问答，如果问题的答案非常简短，可以适当补充一到两句相关信息，以丰富内容。
- 你需要根据用户要求和回答内容选择合适、美观的回答格式，确保可读性强。
- 你的回答应该综合多个相关网页来回答，不能重复引用一个网页。
- 除非用户要求，否则你回答的语言需要和用户提问的语言保持一致。

# 用户消息为：
{question}`;

const search_answer_en_template = `# The following contents are the search results related to the user's message:
{search_results}
In the search results I provide to you, each result is formatted as [webpage X begin]...[webpage X end], where X represents the numerical index of each article. Please cite the context at the end of the relevant sentence when appropriate. Use the citation format [citation:X] in the corresponding part of your answer. If a sentence is derived from multiple contexts, list all relevant citation numbers, such as [citation:3][citation:5]. Be sure not to cluster all citations at the end; instead, include them in the corresponding parts of the answer.
When responding, please keep the following points in mind:
- Today is {cur_date}.
- Not all content in the search results is closely related to the user's question. You need to evaluate and filter the search results based on the question.
- For listing-type questions (e.g., listing all flight information), try to limit the answer to 10 key points and inform the user that they can refer to the search sources for complete information. Prioritize providing the most complete and relevant items in the list. Avoid mentioning content not provided in the search results unless necessary.
- For creative tasks (e.g., writing an essay), ensure that references are cited within the body of the text, such as [citation:3][citation:5], rather than only at the end of the text. You need to interpret and summarize the user's requirements, choose an appropriate format, fully utilize the search results, extract key information, and generate an answer that is insightful, creative, and professional. Extend the length of your response as much as possible, addressing each point in detail and from multiple perspectives, ensuring the content is rich and thorough.
- If the response is lengthy, structure it well and summarize it in paragraphs. If a point-by-point format is needed, try to limit it to 5 points and merge related content.
- For objective Q&A, if the answer is very brief, you may add one or two related sentences to enrich the content.
- Choose an appropriate and visually appealing format for your response based on the user's requirements and the content of the answer, ensuring strong readability.
- Your answer should synthesize information from multiple relevant webpages and avoid repeatedly citing the same webpage.
- Unless the user requests otherwise, your response should be in the same language as the user's question.

# The user's message is:
{question}`;

// 添加语言检测函数
function isChineseContent(text: string): boolean {
	// 使用正则表达式检测是否包含中文字符
	const chinesePattern = /[\u4e00-\u9fa5]/;
	return chinesePattern.test(text);
}

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
							case 'testConnection':
								try {
									const response = await fetch(`${message.baseUrl}/api/version`);
									if (response.ok) {
										settingsPanel?.webview.postMessage({
											command: 'testConnectionResult',
											success: true
										});
									} else {
										settingsPanel?.webview.postMessage({
											command: 'testConnectionResult',
											success: false
										});
									}
								} catch (error) {
									settingsPanel?.webview.postMessage({
										command: 'testConnectionResult',
										success: false
									});
								}
								return;
						}
					},
					undefined,
					context.subscriptions
				);
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
					} else if (message.command === 'resetContext') {
						// 重新初始化消息历史，不包含系统提示词
						messageHistory = [];
						console.log('Reset message history:', messageHistory);
						return;
					} else if (message.command === 'sendMessage') {
						try {
							const currentConfig = getOllamaConfig();
							// 初始化消息数组
							let messages: Array<{role: string, content: string}> = [];
							
							// 检查是否是 reset 命令
							if (message.content.startsWith('/reset')) {
								// 发送空消息数组
								const response = await fetch(`${currentConfig.baseUrl}/api/chat`, {
									method: 'POST',
									headers: {
										'Content-Type': 'application/json',
									},
									body: JSON.stringify({
										model: currentConfig.model,
										messages: [],
										stream: true
									})
								});

								if (!response.ok) {
									throw new Error(`Failed to send message: ${response.statusText}`);
								}

								// 其他处理保持不变
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
								return;
							}

							// 非 reset 命令的原有逻辑
							const searchProvider = vscode.workspace.getConfiguration('vscode-ollama').get('searchProvider', DEFAULT_SEARCH_PROVIDER);
							
							console.log('Message received:', {
								content: message.content,
								webSearch: message.webSearch,
								searchProvider,
								rawMessage: message
							});

							// 初始化消息数组，确保至少包含系统提示词
							const systemMessage = messageHistory.find(msg => msg.role === 'system');
							if (systemMessage) {
								messages.push(systemMessage);
							} else {
								messages.push({ 
									role: 'system', 
									content: currentConfig.systemPrompt 
								});
							}

							if (message.webSearch) {
								try {
									console.log('Starting web search with Bing...');
									// 强制使用 bing 作为搜索引擎
									const searchResults = await searchWeb('bing', message.content);
									console.log('Search results received:', searchResults);

									if (searchResults.results.length > 0) {
										// 检测语言并选择相应的模板
										const isChineseQuery = isChineseContent(message.content);
										const template = isChineseQuery ? search_answer_zh_template : search_answer_en_template;
										
										// 获取当前日期
										const currentDate = new Date().toLocaleDateString(
											isChineseQuery ? 'zh-CN' : 'en-US',
											{ year: 'numeric', month: 'long', day: 'numeric' }
										);
										
										// 构建系统消息
										const systemMessage = template
											.replace('{search_results}', searchResults.context)
											.replace('{cur_date}', currentDate)
											.replace('{question}', message.content);
										
										messages.push({ 
											role: 'user', 
											content: systemMessage
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

							console.log('Messages to send to ollama: ', messages);

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
											// 更新消息历史
											messages.push({ role: 'assistant', content });
											messageHistory = manageMessageHistory(messages, currentConfig.maxTokens);
											
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
