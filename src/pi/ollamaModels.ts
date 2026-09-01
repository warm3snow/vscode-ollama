/**
 * 把本地 Ollama 包装成 Pi 可用的模型目录（provider）。
 *
 * Ollama 暴露 OpenAI 兼容接口（`/v1/chat/completions`），因此 Pi 侧注册为
 * `openai-completions` provider，baseUrl 指向 `<ollama>/v1`，apiKey 用固定占位符。
 */

export const DEFAULT_CONTEXT_WINDOW = 32768;
export const OLLAMA_PROVIDER_ID = 'ollama';
/** Ollama 不做鉴权，但 OpenAI 兼容层要求有 key，填一个占位值即可。 */
export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama';

export interface OllamaModelInfo {
	id: string;
	contextWindow: number;
}

function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, '');
}

/**
 * 读取本机 Ollama 已安装的模型列表（`/api/tags`）。
 */
export async function fetchOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<OllamaModelInfo[]> {
	const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/tags`, signal ? { signal } : undefined);
	if (!response.ok) {
		throw new Error(`获取 Ollama 模型列表失败：${response.status} ${response.statusText}`);
	}
	const data = (await response.json()) as {
		models?: Array<{ model?: string; details?: { context_length?: number } }>;
	};
	return (data.models ?? [])
		.filter(item => typeof item.model === 'string' && item.model.length > 0)
		.map(item => ({
			id: item.model as string,
			contextWindow: item.details?.context_length ?? DEFAULT_CONTEXT_WINDOW
		}));
}

/**
 * 构造注册给 Pi 的 provider 配置。
 */
export function buildOllamaProviderConfig(
	baseUrl: string,
	models: readonly OllamaModelInfo[],
	maxTokens: number
): Record<string, unknown> {
	return {
		name: 'Ollama (local)',
		baseUrl: `${trimTrailingSlash(baseUrl)}/v1`,
		api: 'openai-completions',
		apiKey: OLLAMA_PLACEHOLDER_API_KEY,
		authHeader: true,
		// Ollama 的 OpenAI 兼容层不支持 developer role 与 reasoning effort。
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
		models: models.map(model => ({
			id: model.id,
			name: model.id,
			reasoning: false,
			input: ['text'],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: model.contextWindow,
			maxTokens
		})),
		refreshModels: async (): Promise<OllamaModelInfo[]> => await fetchOllamaModels(baseUrl)
	};
}
