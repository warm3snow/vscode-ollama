import * as fs from 'fs';
import * as path from 'path';
import type { AgentStatusEvent, AgentUsageInfo, ConfirmRequest } from '../agent/types';
import {
	buildOllamaProviderConfig,
	DEFAULT_CONTEXT_WINDOW,
	fetchOllamaModels,
	OLLAMA_PROVIDER_ID,
	OllamaModelInfo
} from './ollamaModels';
import {
	loadPiSdk,
	PiExtensionApi,
	PiModelRuntime,
	PiResourceLoader,
	PiSdk,
	PiSession,
	PiSessionEvent
} from './piSdk';
import { createSubagentExtension, SubagentContext } from './subagent';

/** Pi 内置的编码工具集。 */
export const DEFAULT_AGENT_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

/** 对模型输出影响较大、默认需要用户确认的工具。 */
export const DEFAULT_CONFIRM_TOOLS = ['bash', 'write', 'edit'];

const MAX_EVENT_TEXT_LENGTH = 4000;

export interface PiAgentRunnerOptions {
	/** 工作区根目录，工具调用的作用域。 */
	workspaceRoot: string;
	/** Pi 的"全局"配置目录，放在扩展的 globalStorage 里，避免污染用户 ~/.pi。 */
	agentDir: string;
	/** Ollama 服务地址，例如 http://127.0.0.1:11434。 */
	baseUrl: string;
	model: string;
	maxTokens: number;
	/** 追加到 Pi 系统提示末尾的自定义指令。 */
	appendSystemPrompt?: string;
	/** 允许模型使用的工具名。 */
	tools: readonly string[];
	/** 需要用户确认后才执行的工具名。 */
	confirmTools: readonly string[];
	requireConfirmation: boolean;
	/** 额外的 skills 目录（Agent Skills 规范）。 */
	skillsDirs: readonly string[];
}

export interface PiRunHooks {
	onStatus: (event: AgentStatusEvent) => void;
	onStream: (chunk: string) => void;
	onRequestConfirmation: (request: ConfirmRequest) => Promise<boolean>;
}

/**
 * 基于 Pi Coding Agent SDK 的编码 Agent。
 *
 * 一个 runner 复用同一个 Pi 会话（多轮共享上下文）；当模型、地址、工作区或
 * 工具集变化时会自动重建会话。
 */
export class PiAgentRunner {
	private session: PiSession | undefined;
	private signature = '';
	/** 会话级扩展（确认门禁）在工厂创建后就不能再改，因此通过字段读取当前 hooks。 */
	private hooks: PiRunHooks | undefined;
	private disposed = false;
	/** 当前一轮 prompt 累计的 token 用量（跨多个 model turn 求和）。 */
	private accumulatedUsage: AgentUsageInfo | undefined;
	/** 工具调用的开始时刻表，用于计算耗时。 */
	private toolCallStarts = new Map<string, number>();
	/** 当前是否处于 thinking 流式输出中。 */
	private thinkingActive = false;
	/** thinking 开始时刻，用于算 thinking 耗时。 */
	private thinkingStartTime: number | undefined;

	constructor(private readonly options: PiAgentRunnerOptions) {}

	async run(userMessage: string, hooks: PiRunHooks, signal?: AbortSignal): Promise<void> {
		if (this.disposed) {
			throw new Error('Pi Agent 会话已释放，请重新发起对话。');
		}
		const sdk = await loadPiSdk();
		const session = await this.ensureSession(sdk);
		this.hooks = hooks;

		const unsubscribe = session.subscribe(event => this.handleEvent(event, hooks));
		const onAbort = (): void => {
			void session.abort().catch(() => undefined);
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		try {
			await session.prompt(userMessage);
			const errorMessage = session.agent?.state?.errorMessage;
			if (errorMessage) {
				const friendly = /timed out|timeout|ETIMEDOUT/i.test(errorMessage)
					? `${errorMessage}\n（可能原因：Ollama 正在冷加载 ${this.options.model}，请再发起一次对话；或确认 Ollama 服务与配置的网络可达）`
					: errorMessage;
				hooks.onStatus({ type: 'error', message: friendly });
			}
		} finally {
			signal?.removeEventListener('abort', onAbort);
			unsubscribe();
		}
	}

	/** 释放会话与相关资源。 */
	async dispose(): Promise<void> {
		this.disposed = true;
		this.hooks = undefined;
		const session = this.session;
		this.session = undefined;
		this.signature = '';
		if (!session) {
			return;
		}
		try {
			session.dispose();
		} catch {
			// 释放失败时忽略，扩展进程退出时资源会一并回收。
		}
	}

	private buildSignature(): string {
		const {
			workspaceRoot,
			baseUrl,
			model,
			maxTokens,
			appendSystemPrompt,
			tools,
			confirmTools,
			requireConfirmation,
			skillsDirs
			} = this.options;
		return JSON.stringify([
			workspaceRoot,
			baseUrl,
			model,
			maxTokens,
			appendSystemPrompt ?? '',
			[...tools].join(','),
			`${requireConfirmation ? 'confirm' : 'auto'}:${[...confirmTools].join(',')}`,
			skillsDirs.filter(dir => fs.existsSync(dir)).join(',')
			]);
	}

	private async ensureSession(sdk: PiSdk): Promise<PiSession> {
		const signature = this.buildSignature();
		if (this.session && signature === this.signature) {
			return this.session;
		}
		await this.disposeDisposableSession();

		const { workspaceRoot, agentDir } = this.options;
		fs.mkdirSync(agentDir, { recursive: true });

		const modelRuntime = await sdk.ModelRuntime.create({
			authPath: path.join(agentDir, 'auth.json'),
			// 不读取用户 ~/.pi/agent/models.json，全部由本扩展按需注册。
			modelsPath: null,
			modelsStorePath: path.join(agentDir, 'models-store.json'),
			// 本地模型不需要联网拉取模型目录，也避免扩展启动时产生外部请求。
			allowModelNetwork: false,
			refreshOnCreate: false
		});

		await this.registerOllamaProvider(modelRuntime);

		// 预热模型，避免首次请求撞上 Ollama 的冷加载（5GB+ 的模型可能 30~60s）
		// 而被底层 fetch 的 headersTimeout 判为 timeout。
		await this.prewarmOllamaModel();

		// `modelRuntime.getModel()` 经过 SDK 的处理后会丢失 `input`/`reasoning`/
		// `cost`/`name`/`maxTokens` 等关键字段，openai-completions 适配器调用
		// `model.input.includes(...)` 时会抛 `Cannot read properties of undefined`。
		// 这里直接基于配置构造完整 model 对象后再传给 createAgentSession。
		const model = this.buildModelObject(modelRuntime);

		const settingsManager = sdk.SettingsManager.create(workspaceRoot, agentDir);
		const resourceLoader = await this.createResourceLoader(sdk, settingsManager, modelRuntime, model);

		const { session, extensionsResult } = await sdk.createAgentSession({
			cwd: workspaceRoot,
			agentDir,
			model,
			modelRuntime,
			// 默认开启 reasoning：模型支持就走 think，不支持就由 Pi 自动忽略
			thinkingLevel: 'medium',
			// `tools` 是 allowlist，会过滤掉没列入的工具（包括 subagent 这类 extension 注册的工具）。
			// subagent 是扩展自带的能力，不应被用户配置过滤，所以无论用户怎么配 `agent.tools`，
			// 都需要保证它可用。
			tools: [...this.options.tools, 'subagent'],
			resourceLoader,
			settingsManager,
			// 会话历史保留在内存里：聊天记录由 webview 自己维护，避免长时间累积噪音文件。
			sessionManager: sdk.SessionManager.inMemory(workspaceRoot)
		});

		const errors = extensionsResult?.errors ?? [];
		if (errors.length > 0) {
			const detail = errors.map(item => `${item.path}: ${item.error}`).join('; ');
			this.hooks?.onStatus({ type: 'error', message: `加载 Pi 扩展失败：${detail}` });
		}

		this.session = session;
		this.signature = signature;
		return session;
	}

	private async createResourceLoader(
		sdk: PiSdk,
		settingsManager: unknown,
		modelRuntime: PiModelRuntime,
		model: unknown
	): Promise<PiResourceLoader> {
		const { workspaceRoot, agentDir, appendSystemPrompt } = this.options;
		const skillPaths = this.options.skillsDirs.filter(dir => fs.existsSync(dir));

		// subagent 扩展复用已注册 Ollama 的 modelRuntime 与 model，
		// 在扩展宿主进程内创建嵌套会话，无需外部 `pi` 命令。
		const subagentContext: SubagentContext = {
			sdk,
			modelRuntime,
			model,
			agentDir,
			workspaceRoot,
			skillsDirs: skillPaths,
			builtinAgentsDir: path.join(__dirname, 'subagent', 'agents'),
			defaultTools: [...this.options.tools]
		};

		const loader = new sdk.DefaultResourceLoader({
			cwd: workspaceRoot,
			agentDir,
			settingsManager,
			// TUI 主题与模板对 VS Code 内的会话没有意义，跳过加载。
			noThemes: true,
			noPromptTemplates: true,
			additionalSkillPaths: skillPaths,
			appendSystemPrompt: appendSystemPrompt?.trim() ? [appendSystemPrompt.trim()] : [],
			// 通过 inline extension 把工具确认接入 VS Code 的确认弹窗，并注册 subagent 工具。
			extensionFactories: [this.createConfirmationExtension(), createSubagentExtension(subagentContext)]
		});
		await loader.reload();
		return loader;
	}

	/**
	 * 注册 Ollama provider。
	 *
	 * 优先用 `/api/tags` 的真实模型列表（能拿到准确的 context window），
	 * 拉取失败时退化为只注册当前配置的模型，保证会话仍可创建。
	 */
	private async registerOllamaProvider(runtime: {
		registerProvider: (id: string, config: Record<string, unknown>) => void;
	}): Promise<void> {
		const { baseUrl, model, maxTokens } = this.options;
		let models: OllamaModelInfo[];
		try {
			models = await fetchOllamaModels(baseUrl);
		} catch {
			models = [];
		}
		if (models.length === 0) {
			models = [{ id: model, contextWindow: DEFAULT_CONTEXT_WINDOW }];
		} else if (!models.some(item => item.id === model)) {
			models = [...models, { id: model, contextWindow: DEFAULT_CONTEXT_WINDOW }];
		}
		runtime.registerProvider(OLLAMA_PROVIDER_ID, buildOllamaProviderConfig(baseUrl, models, maxTokens));
	}

	/**
	 * 触发一次极短的 Ollama 推理请求，把模型加载进显存，避免 Agent 首轮请求
	 * 撞上 Ollama 的冷加载（5GB+ 的模型可能要 30~60s）而被底层 fetch 的
	 * `headersTimeout` 判为 timeout。失败时不抛错，让会话照常建立。
	 */
	private async prewarmOllamaModel(): Promise<void> {
		const { baseUrl, model } = this.options;
		const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
		try {
			await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model,
					messages: [{ role: 'user', content: '.' }],
					max_tokens: 1,
					stream: false
				}),
				signal: AbortSignal.timeout(90_000)
			});
		} catch {
			// 预热失败不阻塞会话建立；后续 Agent 请求会自行处理。
		}
	}

	/**
	 * 直接构造一个完整的 model 对象。
	 *
	 * 绕开 `modelRuntime.getModel()` —— 当前 SDK 版本在组合 provider 时会丢失
	 * `input` / `reasoning` / `cost` / `name` / `maxTokens` 等字段，
	 * openai-completions 适配器在流式请求时调用 `model.input.includes("image")`，
	 * 会在 `qwen3` 等模型上抛 `Cannot read properties of undefined (reading 'includes')`。
	 * 自行拼一个完整字段的 model 对象即可绕过此问题。
	 */
	private buildModelObject(modelRuntime: PiModelRuntime): unknown {
		const { baseUrl, model, maxTokens } = this.options;
		// 复用 provider 注册时已经准备好的配置（保证 model.id 一定在目录里）。
		const runtime = modelRuntime as unknown as { extensionProviders?: Map<string, { models?: Array<{ contextWindow?: number; maxTokens?: number }> }> };
		const registered = runtime.extensionProviders?.get(OLLAMA_PROVIDER_ID)?.models ?? [];
		const contextWindow = registered.find(item => item.contextWindow !== undefined)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
		return {
			id: model,
			name: model,
			provider: OLLAMA_PROVIDER_ID,
			api: 'openai-completions',
			baseUrl: `${baseUrl.replace(/\/+$/, '')}/v1`,
			reasoning: true,
			input: ['text'],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow,
			maxTokens,
			headers: undefined,
			// 关键：必须显式声明 compat。这里绕过了 modelRuntime.getModel()，
			// 因此 provider 注册时写的 compat 不会生效；若不声明，SDK 会用
			// detectCompat 按默认规则推断出与 Ollama 实际行为不符的值：
			//   - supportsDeveloperRole: true  → system prompt 会以 developer role
			//     发送，Ollama 不认，导致「先调用工具」的指令整段丢失。
			//   - supportsReasoningEffort: true → 误发 reasoning_effort 字段。
			//   - maxTokensField: 'max_completion_tokens' → Ollama 只认 max_tokens。
			compat: {
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
				maxTokensField: 'max_tokens'
			}
		};
	}

	private createConfirmationExtension(): Record<string, unknown> {
		const confirmTools = new Set(this.options.confirmTools);
		const enabled = this.options.requireConfirmation;
		return {
			name: 'vscode-ollama-confirmations',
			factory: (pi: PiExtensionApi): void => {
				if (!enabled) {
					return;
				}
				pi.on('tool_call', async (event: Record<string, unknown>): Promise<{ block: boolean; reason: string } | undefined> => {
					const toolName = typeof event.toolName === 'string' ? event.toolName : '';
					if (!confirmTools.has(toolName)) {
						return undefined;
					}
					const hooks = this.hooks;
					if (!hooks) {
						return undefined;
					}
					const requestId = typeof event.toolCallId === 'string' ? event.toolCallId : `${toolName}-${Date.now()}`;
					const approved = await hooks.onRequestConfirmation({
						requestId,
						kind: 'tool',
						toolName,
						description: `Pi Agent 请求执行 ${toolName}`,
						args: truncate(JSON.stringify(event.input ?? {}, null, 2))
					});
					if (!approved) {
						return { block: true, reason: '用户拒绝执行该操作' };
					}
					return undefined;
				});
			}
		};
	}

	private handleEvent(event: PiSessionEvent, hooks: PiRunHooks): void {
		switch (event.type) {
			case 'agent_start':
				// 新一轮开始，重置 token 累计、工具调用计时与 thinking 状态。
				// thinking 块的 start 事件是「延迟」触发的——只会在第一个 thinking_delta 真正到达时才发。
				this.accumulatedUsage = undefined;
				this.toolCallStarts.clear();
				this.thinkingActive = false;
				this.thinkingStartTime = undefined;
				break;
			case 'message_update': {
				const inner = event.assistantMessageEvent;
				if (!inner) {
					break;
				}
				if (inner.type === 'text_delta' && typeof inner.delta === 'string' && inner.delta.length > 0) {
					// 文本回复开始，意味着 thinking 阶段结束
					if (this.thinkingActive) {
						this.endThinking(hooks);
					}
					hooks.onStream(inner.delta);
				} else if (inner.type === 'thinking_delta' && typeof inner.delta === 'string' && inner.delta.length > 0) {
					// 首条 thinking_delta 才触发 thinking_start
					if (!this.thinkingActive) {
						this.thinkingActive = true;
						this.thinkingStartTime = Date.now();
						hooks.onStatus({ type: 'thinking_start' });
					}
					hooks.onStatus({ type: 'thinking_delta', thinkingDelta: inner.delta });
				}
				break;
			}
			case 'message_end': {
				// assistant 消息带有本次 LLM 请求的 usage，累加（多轮工具调用会有多个 message_end）。
				const usage = event.message?.usage;
				if (usage && typeof usage.input === 'number' && typeof usage.output === 'number') {
					const prev = this.accumulatedUsage;
					this.accumulatedUsage = {
						input: (prev?.input ?? 0) + usage.input,
						output: (prev?.output ?? 0) + usage.output,
						total: (prev?.total ?? 0) + usage.totalTokens
					};
				}
				break;
			}
			case 'tool_execution_start': {
				const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
				if (toolCallId) {
					this.toolCallStarts.set(toolCallId, Date.now());
				}
				hooks.onStatus({
					type: 'tool_call',
					toolCallId,
					toolName: event.toolName ?? 'tool',
					args: truncate(JSON.stringify(event.args ?? {}, null, 2))
				});
				break;
			}
			case 'tool_execution_end': {
				const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
				const startTime = toolCallId ? this.toolCallStarts.get(toolCallId) : undefined;
				const duration = typeof startTime === 'number' ? Date.now() - startTime : undefined;
				if (toolCallId) {
					this.toolCallStarts.delete(toolCallId);
				}
				hooks.onStatus({
					type: 'tool_result',
					toolCallId,
					toolName: event.toolName ?? 'tool',
					result: truncate(toolResultToText(event.result)) + (event.isError ? '\n(工具执行出错)' : ''),
					isError: event.isError === true,
					duration
				});
				break;
			}
			case 'agent_end':
				if (this.thinkingActive) {
					this.endThinking(hooks);
				}
				hooks.onStatus({ type: 'done' });
				if (this.accumulatedUsage) {
					hooks.onStatus({ type: 'usage', usage: this.accumulatedUsage });
				}
				break;
			default:
				break;
		}
	}

	private endThinking(hooks: PiRunHooks): void {
		const duration = typeof this.thinkingStartTime === 'number'
		? Date.now() - this.thinkingStartTime
		: undefined;
		hooks.onStatus({ type: 'thinking_end', duration });
		this.thinkingActive = false;
		this.thinkingStartTime = undefined;
	}

	private async disposeDisposableSession(): Promise<void> {
		const session = this.session;
		this.session = undefined;
		this.signature = '';
		if (!session) {
			return;
		}
		try {
			session.dispose();
		} catch {
			// 忽略释放异常。
		}
	}
}

function truncate(text: string): string {
	if (!text) {
		return '';
	}
	return text.length > MAX_EVENT_TEXT_LENGTH ? `${text.slice(0, MAX_EVENT_TEXT_LENGTH)}\n… (已截断)` : text;
}

function toolResultToText(result: unknown): string {
	const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
	if (!Array.isArray(content)) {
		return '';
	}
	return content
		.filter(part => part && typeof part.text === 'string')
		.map(part => part.text as string)
		.join('\n');
}
