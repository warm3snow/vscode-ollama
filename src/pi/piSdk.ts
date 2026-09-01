/**
MIT License

Copyright (c) 2026 warm3snow

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */
/**
 * Pi Coding Agent SDK 的惰性加载与最小类型封装。
 *
 * SDK 是纯 ESM 包（package.json 只声明了 `import` 导出条件，没有 `require`），
 * 无法在打包成 CommonJS 的 VS Code 扩展里静态 require，因此统一走动态 import()。
 * 另外它体积较大且依赖 Node >= 22.19，只有在真正进入 Agent 模式时才加载。
 */

const SDK_MODULE_ID = '@earendil-works/pi-coding-agent';

/** 模型单次请求的 token 用量（Pi `Usage` 类型的最小投影）。 */
export interface PiUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	totalTokens: number;
	cost?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

/** 会话事件的最小结构（只保留本扩展用到的字段）。 */
export interface PiSessionEvent {
	type: string;
	assistantMessageEvent?: {
		type?: string;
		delta?: string;
	};
	/** `message_end` 事件里携带的完整消息（assistant 消息带有 usage）。 */
	message?: {
		role?: string;
		usage?: PiUsage;
	};
	/** `tool_execution_*` 事件里把 call 与 result 配对的 id。 */
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
	willRetry?: boolean;
	/** `agent_end` 事件携带的完整消息列表（含 content / usage / stopReason 等）。 */
	messages?: Array<Record<string, unknown>>;
}

/** 会话事件订阅函数返回的取消订阅句柄。 */
export type PiUnsubscribe = () => void;

export interface PiSession {
	prompt(text: string, options?: Record<string, unknown>): Promise<void>;
	abort(): Promise<void>;
	subscribe(listener: (event: PiSessionEvent) => void): PiUnsubscribe;
	dispose(): void;
	getActiveToolNames(): string[];
	readonly systemPrompt: string;
	/** 出错时读取 `agent.state.errorMessage`。 */
	readonly agent?: { state?: { errorMessage?: string } };
}

export interface PiResourceLoader {
	reload(): Promise<void>;
}

export interface PiModelRuntime {
	registerProvider(providerId: string, config: Record<string, unknown>): void;
	getModel(providerId: string, modelId: string): unknown;
	getError(): string | null | undefined;
}

/** 扩展 API（inline extension 里 `pi` 对象的最小形态）。 */
export interface PiExtensionApi {
	on(event: string, handler: (event: Record<string, unknown>) => unknown): void;
	registerTool(tool: Record<string, unknown>): void;
}

export interface PiSdk {
	createAgentSession(options: Record<string, unknown>): Promise<{
		session: PiSession;
		extensionsResult?: { errors?: ReadonlyArray<{ path: string; error: string }> };
	}>;
	ModelRuntime: {
		create(options?: Record<string, unknown>): Promise<PiModelRuntime>;
	};
	SessionManager: {
		inMemory(cwd?: string): unknown;
	};
	SettingsManager: {
		create(cwd?: string, agentDir?: string): unknown;
	};
	DefaultResourceLoader: new (options: Record<string, unknown>) => PiResourceLoader;
	defineTool(tool: Record<string, unknown>): unknown;
}

let cached: Promise<PiSdk> | undefined;

function configurePiEnvironment(): void {
	// 在扩展宿主进程里关闭 Pi 的更新检查与遥测，避免无关的网络请求。
	// 仅在用户没有显式设置时覆盖。
	if (process.env.PI_SKIP_VERSION_CHECK === undefined) {
		process.env.PI_SKIP_VERSION_CHECK = '1';
	}
	if (process.env.PI_TELEMETRY === undefined) {
		process.env.PI_TELEMETRY = '0';
	}
}

/**
 * 加载 Pi Coding Agent SDK。加载失败时会抛出面向用户的中文错误。
 */
export function loadPiSdk(): Promise<PiSdk> {
	if (!cached) {
		configurePiEnvironment();
		cached = (async () => {
			// 用变量而非字面量作为 import 参数：既避免 TS 去解析 SDK 的类型声明，
			// 也避免打包器把整个 SDK 内联进 dist/extension.js（应作为外部依赖随包分发）。
			if (process.versions?.node) {
				const [major, minor] = process.versions.node.split('.').map(Number);
				if (major < 22 || (major === 22 && minor < 19)) {
					throw new Error(
						`Pi Coding Agent 需要 Node >= 22.19，当前扩展宿主为 Node ${process.versions.node}。` +
						'请升级 VS Code，或在普通聊天模式下继续使用。'
					);
				}
			}
			try {
				const mod = (await import(SDK_MODULE_ID)) as unknown as PiSdk;
				return mod;
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				throw new Error(`加载 Pi Coding Agent SDK 失败：${detail}`);
			}
		})();
		cached.catch(() => {
			// 失败后不缓存结果，便于用户修复配置后重试。
			cached = undefined;
		});
	}
	return cached;
}
