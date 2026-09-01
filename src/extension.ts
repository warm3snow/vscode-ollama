// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { getSettingsWebviewContent } from './webview/settingsWebview';
import { OllamaModelsResponse } from './types';
import { getChatWebviewContent } from './webview/chatWebview';
import type { ConfirmRequest } from './agent/types';
import {
	DEFAULT_AGENT_TOOLS,
	DEFAULT_CONFIRM_TOOLS,
	PiAgentRunner
} from './pi/piRunner';

interface OllamaConfig {
	baseUrl: string;
	model: string;
	maxTokens: number;
	keepAlive: string;
	systemPrompt: string;
}

interface ChatMessage {
	role: string;
	content: string;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'deepseek-r1:32b';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_KEEP_ALIVE = '5 minutes';
const DEFAULT_SYSTEM_PROMPT =
	'Given the following conversation, relevant context, and a follow up question, reply with an answer to the current question the user is asking. Return only your response to the question given the above information following the users instructions as needed.';

// 将 getOllamaConfig 移到 activate 函数外部
export function getOllamaConfig(): OllamaConfig {
	const config = vscode.workspace.getConfiguration('vscode-ollama');

	return {
		baseUrl: normalizeOllamaBaseUrl(config.get<string>('baseUrl') || DEFAULT_BASE_URL),
		model: config.get<string>('model') || DEFAULT_MODEL,
		maxTokens: config.get<number>('maxTokens') || DEFAULT_MAX_TOKENS,
		keepAlive: config.get<string>('keepAlive') || DEFAULT_KEEP_ALIVE,
		systemPrompt: config.get<string>('systemPrompt') || DEFAULT_SYSTEM_PROMPT
	};
}

/**
 * 把 `localhost` 标准化成 `127.0.0.1`。Electron 的 Chromium fetch 解析 `localhost`
 * 时优先尝试 IPv6 `::1`，但 Ollama 默认只监听 IPv4 回环，会导致
 * `ECONNREFUSED`；IPv4 字面量在两套 fetch 里都能稳定连通。
 */
export function normalizeOllamaBaseUrl(rawUrl: string): string {
	return rawUrl.replace(/^([a-z]+:\/\/)localhost(:\d+)?\b/i, (_m, scheme, port) => `${scheme}127.0.0.1${port ?? ''}`);
}

/** 清理助手回复里伪造的 <tool_response> 块及其转义形式，避免模型把工具结果编造进正文。 */
function sanitizeAssistantContent(content: string): string {
	return content
		.replace(/\\u003c/gi, '<')
		.replace(/\\u003e/gi, '>')
		.replace(/<tool_response\b[^>]*>[\s\S]*?<\/tool_response\s*>/gi, '')
		.trim();
}

// 按 token 上限管理消息历史：保留系统提示词 + 最新的若干条消息（保持原有顺序）
function manageMessageHistory(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
	const systemMessages = messages.filter(m => m.role === 'system');
	const history = messages.filter(m => m.role !== 'system');

	// 粗略估计token数（每个字符约1个token）
	let totalLength = systemMessages.reduce((sum, m) => sum + m.content.length, 0);

	// 从最新的消息开始保留，tail 用 unshift 保持“旧在前、新在后”的顺序
	const tail: ChatMessage[] = [];
	for (let i = history.length - 1; i >= 0; i--) {
		const message = history[i];
		if (totalLength + message.content.length > maxTokens) {
			break;
		}
		tail.unshift(message);
		totalLength += message.content.length;
	}

	return [...systemMessages, ...tail];
}

let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let activeConversationId: string | null = null;
let activeAgentController: AbortController | null = null;

/**
 * 向 Ollama 发起流式聊天请求并把增量内容转发给 webview。
 * 使用行缓冲解析，避免 JSON 被 chunk 边界截断导致解析失败。
 */
async function streamChatResponse(
	panel: vscode.WebviewPanel,
	config: OllamaConfig,
	conversationId: string,
	messages: ChatMessage[],
	onComplete?: (fullContent: string) => void
): Promise<void> {
	const url = `${config.baseUrl}/v1/chat/completions`;
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: config.model,
				messages,
				stream: true,
				max_tokens: config.maxTokens
			})
		});
	} catch (e) {
		const cause = e instanceof Error && (e as Error & { cause?: unknown }).cause ? ` (cause: ${String((e as Error & { cause?: unknown }).cause)})` : '';
		throw new Error(`无法连接到 Ollama (${url}): ${e instanceof Error ? e.message : String(e)}${cause}`);
	}

	if (!response.ok) {
		let detail = '';
		try {
			detail = (await response.text()).slice(0, 500);
		} catch {
			// 忽略
		}
		throw new Error(`Ollama request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
	}

	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('Failed to get response reader');
	}
	currentReader = reader;

	const decoder = new TextDecoder();
	let buffer = '';
	let fullContent = '';
	let isFirstChunk = true;

	const postStream = (content: string, done: boolean) => {
		panel.webview.postMessage({
			command: 'streamMessage',
			content,
			done,
			newMessage: !done && isFirstChunk,
			conversationId
		});
		isFirstChunk = false;
	};

	const handleLine = (line: string) => {
		if (!line) {
			return;
		}
		// OpenAI 兼容 SSE 格式:"data: {...}" / "data: [DONE]"
		if (!line.startsWith('data:')) {
			return;
		}
		const payload = line.slice(5).trim();
		if (!payload || payload === '[DONE]') {
			return;
		}
		let data: { choices?: Array<{ delta?: { content?: string } }> };
		try {
			data = JSON.parse(payload);
		} catch {
			return;
		}
		const chunk = data.choices?.[0]?.delta?.content ?? '';
		if (chunk) {
			fullContent += chunk;
			postStream(chunk, false);
		}
	};

	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });

			let newlineIndex: number;
			while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				handleLine(line);
			}
		}
		// 处理流末尾残留的（无换行结尾的）内容
		if (buffer.trim()) {
			handleLine(buffer.trim());
		}
		// 流正常结束:触发完成回调并通知 webview
		onComplete?.(sanitizeAssistantContent(fullContent));
		fullContent = '';
		postStream('', true);
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			panel.webview.postMessage({
				command: 'streamMessage',
				content: '\n[已终止生成]',
				done: true,
				newMessage: false,
				conversationId
			});
			return;
		}
		throw error;
	} finally {
		currentReader = null;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	let panel: vscode.WebviewPanel | undefined;
	let settingsPanel: vscode.WebviewPanel | undefined;
	let messageHistory: ChatMessage[] = [];
	let pendingConfirmResolver: ((approved: boolean) => void) | null = null;

	// Pi Coding Agent 会话：跨多轮复用，配置变化时自动重建。
	let piRunner: PiAgentRunner | undefined;
	let piRunnerKey = '';

	/** 解析逗号分隔的工具名单；为空时回退到默认名单。 */
	function parseToolList(raw: string | undefined, fallback: readonly string[]): string[] {
		const list = (raw ?? '')
			.split(',')
			.map(item => item.trim())
			.filter(item => item.length > 0);
		return list.length > 0 ? list : [...fallback];
	}

	function getAgentSettings(): {
		tools: string[];
		confirmTools: string[];
		requireConfirmation: boolean;
		appendSystemPrompt: string;
	} {
		const config = vscode.workspace.getConfiguration('vscode-ollama');
		const tools = parseToolList(config.get<string>('agent.tools'), DEFAULT_AGENT_TOOLS);
		return {
			tools,
			confirmTools: parseToolList(config.get<string>('agent.confirmTools'), DEFAULT_CONFIRM_TOOLS),
			requireConfirmation: config.get<boolean>('agent.requireConfirmation', true),
			appendSystemPrompt: config.get<string>('agent.appendSystemPrompt', '')
		};
	}

	function createAgentRunner(config: OllamaConfig): PiAgentRunner {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
		const agent = getAgentSettings();
		return new PiAgentRunner({
			workspaceRoot,
			// Pi 的全局目录放在扩展自己的存储区，避免读写用户的 ~/.pi。
			agentDir: path.join(context.globalStorageUri.fsPath, 'pi-agent'),
			baseUrl: config.baseUrl,
			model: config.model,
			maxTokens: config.maxTokens,
			appendSystemPrompt: agent.appendSystemPrompt,
			tools: agent.tools,
			confirmTools: agent.confirmTools,
			requireConfirmation: agent.requireConfirmation,
			// Skills 目录：优先工作区的 skills/，其次扩展内置的 skills/。
			skillsDirs: [path.join(workspaceRoot, 'skills'), path.join(context.extensionPath, 'skills')]
		});
	}

	/** 获取（必要时重建）Agent 会话。 */
	async function ensureAgentRunner(config: OllamaConfig): Promise<PiAgentRunner> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
		const key = JSON.stringify([workspaceRoot, config.baseUrl, config.model, config.maxTokens]);
		if (piRunner && piRunnerKey === key) {
			return piRunner;
		}
		await disposeAgentRunner();
		piRunner = createAgentRunner(config);
		piRunnerKey = key;
		return piRunner;
	}

	async function disposeAgentRunner(): Promise<void> {
		const runner = piRunner;
		piRunner = undefined;
		piRunnerKey = '';
		if (runner) {
			await runner.dispose();
		}
	}

	/**
	 * Agent 模式：驱动 Pi 会话，并把其事件映射成 webview 已有的消息协议
	 * （streamMessage / agentStatus / confirmAction）。
	 */
	async function runAgentChat(
		webviewPanel: vscode.WebviewPanel,
		config: OllamaConfig,
		userContent: string,
		conversationId: string,
		signal?: AbortSignal
	): Promise<void> {
		if (!vscode.workspace.workspaceFolders?.length) {
			const errorMessage = 'Agent 模式需要一个打开的文件夹（workspace）。请先打开一个项目文件夹。';
			vscode.window.showErrorMessage(errorMessage);
			webviewPanel.webview.postMessage({
				command: 'streamMessage',
				content: `\n[错误: ${errorMessage}]`,
				done: true,
				newMessage: false,
				conversationId
			});
			return;
		}

		// /plan 前缀：Pi 没有独立的计划模式，改写成显式指令交给模型。
		let userMessage = userContent.trim();
		if (userMessage.startsWith('/plan')) {
			userMessage = `先给出实施计划，等用户确认后再动手执行：\n${userMessage.replace(/^\/plan\s*/, '')}`;
		}

		const runner = await ensureAgentRunner(config);
		let isFirstChunk = true;

		const requestConfirmation = (request: ConfirmRequest): Promise<boolean> => new Promise<boolean>(resolve => {
			let settled = false;
			let timeout: ReturnType<typeof setTimeout>;
			const onAbort = () => finish(false);
			const finish = (approved: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeout);
				signal?.removeEventListener('abort', onAbort);
				if (pendingConfirmResolver === finish) {
					pendingConfirmResolver = null;
				}
				resolve(approved);
			};
			timeout = setTimeout(() => finish(false), 5 * 60 * 1000);
			pendingConfirmResolver = finish;
			signal?.addEventListener('abort', onAbort, { once: true });
			webviewPanel.webview.postMessage({ command: 'confirmAction', request });
		});

		await runner.run(
			userMessage,
			{
				onStatus: event => {
					webviewPanel.webview.postMessage({ command: 'agentStatus', event });
				},
				onStream: chunk => {
					webviewPanel.webview.postMessage({
						command: 'streamMessage',
						content: chunk,
						done: false,
						newMessage: isFirstChunk,
						conversationId
					});
					isFirstChunk = false;
				},
				onRequestConfirmation: requestConfirmation
			},
			signal
		);

		webviewPanel.webview.postMessage({
			command: 'streamMessage',
			content: '',
			done: true,
			newMessage: false,
			conversationId
		});
	}

	async function getAvailableModels(baseUrl: string): Promise<string[]> {
		try {
			const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/tags`);
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
	const settingsCommand = vscode.commands.registerCommand('vscode-ollama.settings', () => {
		if (settingsPanel) {
			settingsPanel.reveal(vscode.ViewColumn.One);
			return;
		}

		settingsPanel = vscode.window.createWebviewPanel(
			'ollamaSettings',
			'Ollama Settings',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);
		context.subscriptions.push(settingsPanel);

		const updateWebview = () => {
			if (settingsPanel) {
				settingsPanel.webview.html = getSettingsWebviewContent(getOllamaConfig(), settingsPanel.webview);
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
									models
								});
							}
						} catch (error) {
							vscode.window.showErrorMessage(`Failed to refresh models: ${error}`);
						}
						return;
					case 'saveSettings':
						try {
							const config = vscode.workspace.getConfiguration('vscode-ollama');
							// 保存时也做一次标准化，避免 `localhost` 持久化
							await config.update('baseUrl', normalizeOllamaBaseUrl(message.settings.baseUrl), true);
							await config.update('model', message.settings.model, true);
							await config.update('maxTokens', message.settings.maxTokens, true);
							await config.update('keepAlive', message.settings.keepAlive, true);
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
							settingsPanel?.webview.postMessage({
								command: 'testConnectionResult',
								success: response.ok
							});
						} catch {
							settingsPanel?.webview.postMessage({
								command: 'testConnectionResult',
								success: false
							});
						}
						return;
					case 'webviewError':
						vscode.window.showErrorMessage(`Settings webview 脚本错误: ${message.message}`);
						return;
						return;
				}
			},
			undefined,
			context.subscriptions
		);
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
		context.subscriptions.push(panel);

		const config = getOllamaConfig();
		panel.webview.html = getChatWebviewContent(config, panel.webview, context.extensionUri);

		// 在 webview 准备好后立即发送模型名称
		panel.webview.onDidReceiveMessage(
			async message => {
				if (!panel) {
					return;
				}

				if (message.command === 'webviewReady') {
					panel.webview.postMessage({ command: 'welcomeMessage' });
					panel.webview.postMessage({
						command: 'updateModelName',
						modelName: config.model
					});
				} else if (message.command === 'resetContext') {
					// 重新初始化消息历史 + 释放 Agent 会话上下文
					messageHistory = [];
					await disposeAgentRunner();
				} else if (message.command === 'clearChat') {
					// Webview 端 Clear Chat 按钮:清空普通对话历史 + 释放 Agent 会话上下文。
					// 若 Agent 正在运行,先中止当前任务,避免其后续输出污染已清空的视图,
					// 也避免 dispose 一个仍在 prompt 中的 session。
					activeAgentController?.abort();
					activeAgentController = null;
					if (pendingConfirmResolver) {
						pendingConfirmResolver(false);
						pendingConfirmResolver = null;
					}
					if (currentReader) {
						currentReader.cancel().catch(() => { /* ignore */ });
						currentReader = null;
					}
					activeConversationId = null;
					messageHistory = [];
					// Agent 会话上下文由 Pi 会话持有，重置时需要连同会话一起释放。
					await disposeAgentRunner();
					panel.webview.postMessage({ command: 'resetChat' });
				} else if (message.command === 'sendMessage') {
					try {
						const currentConfig = getOllamaConfig();

						// 处理 /reset 命令：直接清空本地上下文，无需调用 Ollama API
						if (message.content.trim() === '/reset') {
							messageHistory = [];
							// Agent 会话上下文由 Pi 会话持有，重置时需要连同会话一起释放。
							await disposeAgentRunner();
							panel.webview.postMessage({ command: 'resetChat' });
							return;
						}

						// Agent 模式(常驻):让模型通过工具调用搜索/理解/修改代码库并执行 git 命令。
						if (message.agentMode) {
							if (activeAgentController) {
								panel.webview.postMessage({
									command: 'streamMessage',
									content: '\n[Agent 正在运行，请先停止当前任务]',
									done: true,
									newMessage: false,
									conversationId: activeConversationId
								});
								return;
							}
							const conversationId = Date.now().toString();
							const controller = new AbortController();
							activeAgentController = controller;
							activeConversationId = conversationId;
							try {
								await runAgentChat(panel, currentConfig, message.content, conversationId, controller.signal);
							} catch (error) {
								if (!controller.signal.aborted) {
									const errorMessage = error instanceof Error ? error.message : String(error);
									vscode.window.showErrorMessage(`Agent error: ${errorMessage}`);
									panel.webview.postMessage({
										command: 'streamMessage',
										content: `\n[Agent 错误: ${errorMessage}]`,
										done: true,
										newMessage: false,
										conversationId
									});
								}
							} finally {
								if (activeAgentController === controller) {
									activeAgentController = null;
								}
								activeConversationId = null;
							}
							return;
						}

						// 初始化消息数组，确保至少包含系统提示词
						const messages: ChatMessage[] = [];
						const existingSystem = messageHistory.find(msg => msg.role === 'system');
						if (existingSystem) {
							messages.push(existingSystem);
						} else {
							messages.push({ role: 'system', content: currentConfig.systemPrompt });
						}

						// 添加用户新消息
						messages.push({ role: 'user', content: message.content });

						// 生成新的会话ID
						const conversationId = Date.now().toString();
						activeConversationId = conversationId;

						await streamChatResponse(panel, currentConfig, conversationId, messages, fullContent => {
							// 更新消息历史
							messages.push({ role: 'assistant', content: fullContent });
							messageHistory = manageMessageHistory(messages, currentConfig.maxTokens);
						});

						activeConversationId = null;

						// 更新模型名称
						panel.webview.postMessage({
							command: 'updateModelName',
							modelName: currentConfig.model
						});
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						vscode.window.showErrorMessage(`Chat error: ${errorMessage}`);
						const failedConversationId = activeConversationId;
						activeConversationId = null;
						if (panel) {
							panel.webview.postMessage({
								command: 'streamMessage',
								content: `\n[错误: ${errorMessage}]`,
								done: true,
								newMessage: false,
								conversationId: failedConversationId
							});
						}
					}
				} else if (message.command === 'stopGeneration') {
					activeAgentController?.abort();
					if (pendingConfirmResolver) {
						pendingConfirmResolver(false);
						pendingConfirmResolver = null;
					}
					if (currentReader) {
						currentReader.cancel().catch(() => { /* ignore */ });
						currentReader = null;
					}
					// 立即通知 webview 结束，避免依赖流的取消行为
					panel.webview.postMessage({
						command: 'streamMessage',
						content: '\n[已终止生成]',
						done: true,
						newMessage: false,
						conversationId: activeConversationId
					});
					activeConversationId = null;
				} else if (message.command === 'confirmActionResult') {
					// 用户对 agent 工具调用确认/拒绝
					if (pendingConfirmResolver) {
						pendingConfirmResolver(Boolean(message.approved));
						pendingConfirmResolver = null;
					}
				} else if (message.command === 'webviewError') {
					// webview 脚本运行错误(可见化,便于排查)
					vscode.window.showErrorMessage(`Chat webview 脚本错误: ${message.message}`);
				} else if (message.command === 'toggleTheme') {
					try {
						// 获取当前主题配置
						const workbenchConfig = vscode.workspace.getConfiguration('workbench');
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
						panel.webview.postMessage({
							command: 'themeChanged',
							isDark: !isDark // 切换后的状态
						});
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
			activeAgentController?.abort();
			activeAgentController = null;
			if (pendingConfirmResolver) {
				pendingConfirmResolver(false);
				pendingConfirmResolver = null;
			}
			messageHistory = [];
			currentReader = null;
			activeConversationId = null;
			void disposeAgentRunner();
			panel = undefined;
		}, null, context.subscriptions);
	});

	// Add all commands to the context subscriptions
	context.subscriptions.push(settingsCommand);
	context.subscriptions.push(refreshModelsCommand);
	context.subscriptions.push(chatCommand);
	// 扩展停用时释放 Pi 会话（例如卸载/禁用/重载窗口）。
	context.subscriptions.push({ dispose: () => void disposeAgentRunner() });

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
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Webview panels are disposed automatically via context.subscriptions
}
