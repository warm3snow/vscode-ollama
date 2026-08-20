// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { getSettingsWebviewContent } from './webview/settingsWebview';
import { OllamaModelsResponse } from './types';
import { getChatWebviewContent } from './webview/chatWebview';
import { searchWeb } from './webSearch';
import { runAgentLoop, isContinuePrompt } from './agent/agentLoop';
import { createAgentTools } from './agent/tools';
import { AgentCallbacks, AgentConfig, ConfirmRequest, OllamaMessage } from './agent/types';
import { AgentSkill, loadSkillsFromDirectory } from './agent/skills';

interface OllamaConfig {
	baseUrl: string;
	model: string;
	maxTokens: number;
	keepAlive: string;
	performanceMode: string;
	systemPrompt: string;
}

interface ChatMessage {
	role: string;
	content: string;
}

/** 发起联网搜索并返回构造好的系统消息。失败/禁用/未启用时返回空数组。 */
async function collectWebSearchContext(
	panel: vscode.WebviewPanel,
	message: { webSearch?: boolean; content: string }
): Promise<ChatMessage[]> {
	if (!message.webSearch) {
		return [];
	}

	const searchConfig = getWebSearchConfig();
	if (!searchConfig.enabled) {
		panel.webview.postMessage({
			command: 'searchStatus',
			status: 'Web search is disabled in settings'
		});
		return [];
	}

	try {
		panel.webview.postMessage({
			command: 'searchStatus',
			status: 'Searching...'
		});

		const searchResults = await searchWeb(message.content, {
			provider: searchConfig.provider,
			cacheTimeoutMinutes: searchConfig.cacheTimeout,
			requestsPerMinute: searchConfig.requestsPerMinute
		});

		if (searchResults.results.length === 0) {
			panel.webview.postMessage({
				command: 'searchStatus',
				status: 'No results found'
			});
			return [];
		}

		const isChineseQuery = /[\u4e00-\u9fa5]/.test(message.content);
		const template = isChineseQuery ? search_answer_zh_template : search_answer_en_template;
		const systemContent = template
			.replace('{search_results}', searchResults.context)
			.replace('{cur_date}', new Date().toLocaleDateString())
			.replace('{question}', message.content);

		panel.webview.postMessage({
			command: 'searchStatus',
			status: 'Search completed'
		});

		return [{ role: 'system', content: systemContent }];
	} catch (error: unknown) {
		console.error('Search failed:', error);
		panel.webview.postMessage({
			command: 'searchStatus',
			status: 'Search failed: ' + (error instanceof Error ? error.message : 'Unknown error')
		});
		return [];
	}
}

interface WebSearchConfig {
	enabled: boolean;
	cacheTimeout: number;
	requestsPerMinute: number;
	provider: string;
}

const DEFAULT_SEARCH_PROVIDER = 'bing';
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'deepseek-r1:32b';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_KEEP_ALIVE = '5 minutes';
const DEFAULT_PERFORMANCE_MODE = 'Base (Default)';
const DEFAULT_SYSTEM_PROMPT =
	'Given the following conversation, relevant context, and a follow up question, reply with an answer to the current question the user is asking. Return only your response to the question given the above information following the users instructions as needed.';

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

// 将 getOllamaConfig 移到 activate 函数外部
export function getOllamaConfig(): OllamaConfig {
	const config = vscode.workspace.getConfiguration('vscode-ollama');

	return {
		baseUrl: config.get<string>('baseUrl') || DEFAULT_BASE_URL,
		model: config.get<string>('model') || DEFAULT_MODEL,
		maxTokens: config.get<number>('maxTokens') || DEFAULT_MAX_TOKENS,
		keepAlive: config.get<string>('keepAlive') || DEFAULT_KEEP_ALIVE,
		performanceMode: config.get<string>('performanceMode') || DEFAULT_PERFORMANCE_MODE,
		systemPrompt: config.get<string>('systemPrompt') || DEFAULT_SYSTEM_PROMPT
	};
}

function getWebSearchConfig(): WebSearchConfig {
	const config = vscode.workspace.getConfiguration('vscode-ollama');
	return {
		enabled: config.get<boolean>('webSearch.enabled', true),
		cacheTimeout: config.get<number>('webSearch.cacheTimeout', 60),
		requestsPerMinute: config.get<number>('webSearch.requestsPerMinute', 10),
		provider: config.get<string>('searchProvider', DEFAULT_SEARCH_PROVIDER)
	};
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
		onComplete?.(fullContent);
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

	// Agent 模式的多轮对话历史(独立于普通聊天的 messageHistory)。
	// 每次调用 runAgentLoop 都会传入上一轮的 messages,以保持上下文连续;
	// 循环结束后把最新 messages 回写,以便下一轮继续。
	let agentMessageHistory: OllamaMessage[] = [];

	/** Agent 模式下运行的辅助函数：构造回调、管理确认请求与流式输出。 */
	async function runAgentChat(
		webviewPanel: vscode.WebviewPanel,
		config: OllamaConfig,
		userContent: string,
		conversationId: string,
		planFirst: boolean,
		extraSystemMessages?: OllamaMessage[]
	): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Agent 模式需要一个打开的文件夹（workspace）。请先打开一个项目文件夹。');
			webviewPanel.webview.postMessage({
				command: 'streamMessage',
				content: '\n[错误: Agent 模式需要打开一个工作区文件夹]',
				done: true,
				newMessage: false,
				conversationId
			});
			return;
		}

		// 加载 skills:优先工作区的 skills/ 目录,其次是扩展自带的 skills/
		const skills: AgentSkill[] = [];
		for (const dir of [path.join(workspaceRoot, 'skills'), path.join(context.extensionPath, 'skills')]) {
			skills.push(...loadSkillsFromDirectory(dir));
		}

		// 支持 /plan 前缀:强制启用 plan-first
		let shouldPlanFirst = planFirst;
		let userMessage = userContent;
		if (userContent.trim().startsWith('/plan')) {
			shouldPlanFirst = true;
			userMessage = userContent.replace(/^\/plan\s*/, '').trim();
		}

		const tools = createAgentTools();

		// web_search 作为工具注册:由 LLM 根据问题自主决定是否联网搜索,
		// 而非每次请求都强制搜索。
		if (getWebSearchConfig().enabled) {
			tools.push({
				name: 'web_search',
				description:
					'Search the web for up-to-date information. You MUST call this tool for any question that requires current/recent data (weather, news, prices, scores, latest versions, anything with "今天/今日/现在/最新/today/current/latest"). Do NOT refuse these questions by saying you lack real-time info — call this tool and use its results. For codebase questions, prefer grep / find / ls / read instead.',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'The search query to send to the search engine' }
					},
					required: ['query']
				},
				requiresConfirmation: false,
				execute: async (args: Record<string, unknown>) => {
					const query = String(args.query ?? '').trim();
					if (!query) {
						return 'Error: "query" is required.';
					}
					try {
						const cfg = getWebSearchConfig();
						const result = await searchWeb(query, {
							provider: cfg.provider,
							cacheTimeoutMinutes: cfg.cacheTimeout,
							requestsPerMinute: cfg.requestsPerMinute
						});
						return result.context;
					} catch (e) {
						return `Web search failed: ${e instanceof Error ? e.message : String(e)}`;
					}
				}
			});
		}

		let isFirstChunk = true;

		const callbacks: AgentCallbacks = {
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
			onRequestConfirmation: (request: ConfirmRequest) => new Promise<boolean>(resolve => {
				pendingConfirmResolver = resolve;
				webviewPanel.webview.postMessage({ command: 'confirmAction', request });
			}),
			onCompleted: () => {
				webviewPanel.webview.postMessage({
					command: 'streamMessage',
					content: '',
					done: true,
					newMessage: false,
					conversationId
				});
			}
		};

		const agentConfig: AgentConfig = {
			baseUrl: config.baseUrl,
			model: config.model,
			maxTokens: config.maxTokens,
			keepAlive: config.keepAlive
		};

		// 检测 "vibe"/"go on" 等继续信号:开启自主执行模式,让 agent 一路推进到任务完成。
		const autoContinue = isContinuePrompt(userMessage);

		const result = await runAgentLoop({
			config: agentConfig,
			userMessage: userMessage,
			workspaceRoot,
			tools,
			callbacks,
			initialMessages: agentMessageHistory,
			skills,
			planFirst: shouldPlanFirst,
			extraSystemMessages,
			autoContinue
		});

		// 把本轮最终 messages 回写,供下一轮保持上下文连续
		agentMessageHistory = result.messages;
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
					// 重新初始化消息历史
					messageHistory = [];
				} else if (message.command === 'sendMessage') {
					try {
						const currentConfig = getOllamaConfig();

						// 处理 /reset 命令：直接清空本地上下文，无需调用 Ollama API
						if (message.content.trim() === '/reset') {
							messageHistory = [];
							agentMessageHistory = [];
							panel.webview.postMessage({ command: 'resetChat' });
							return;
						}

						// Agent 模式(常驻):让模型通过工具调用搜索/理解/修改代码库并执行 git 命令。
						// web search 已作为工具由 LLM 自主决策,不再在每次请求时自动搜索。
						if (message.agentMode) {
							const conversationId = Date.now().toString();
							activeConversationId = conversationId;
							try {
								// plan-first 仅由显式 /plan 前缀触发(在 runAgentChat 内部判断),
								// 是否进入 plan-first 不再用正则猜测意图,交给 LLM 自主决策。
								await runAgentChat(panel, currentConfig, message.content, conversationId, false);
							} catch (error) {
								const errorMessage = error instanceof Error ? error.message : String(error);
								vscode.window.showErrorMessage(`Agent error: ${errorMessage}`);
								panel.webview.postMessage({
									command: 'streamMessage',
									content: `\n[Agent 错误: ${errorMessage}]`,
									done: true,
									newMessage: false,
									conversationId
								});
							} finally {
								activeConversationId = null;
							}
							return;
						}

						// 普通聊天模式:web search 仍通过按钮开关手动触发
						const extraSystemMessages = await collectWebSearchContext(panel, message);

						// 初始化消息数组，确保至少包含系统提示词
						const messages: ChatMessage[] = [];
						const existingSystem = messageHistory.find(msg => msg.role === 'system');
						if (existingSystem) {
							messages.push(existingSystem);
						} else {
							messages.push({ role: 'system', content: currentConfig.systemPrompt });
						}

						// 把搜索上下文追加到消息数组
						if (extraSystemMessages && extraSystemMessages.length > 0) {
							for (const m of extraSystemMessages) {
								if (m && m.role && m.content) {
									messages.push({ role: m.role, content: m.content });
								}
							}
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
			messageHistory = [];
			agentMessageHistory = [];
			currentReader = null;
			activeConversationId = null;
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
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Webview panels are disposed automatically via context.subscriptions
}
