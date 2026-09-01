// Shared types for the coding agent (Pi SDK integration)

/** 汇总后的 token 用量，用于在 webview 中展示。 */
export interface AgentUsageInfo {
	input: number;
	output: number;
	total: number;
}

export interface AgentStatusEvent {
	type: 'thinking_start' | 'thinking_delta' | 'thinking_end' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'usage';
	/** 关联同一次工具调用的 start / end 事件，webview 用来把调用与结果合并成一张卡片。 */
	toolCallId?: string;
	toolName?: string;
	args?: string;
	result?: string;
	/** 工具执行是否失败。 */
	isError?: boolean;
	/** 工具执行耗时（毫秒），仅在 tool_result 上有。 */
	duration?: number;
	message?: string;
	/** `thinking_delta` 事件里携带的增量文本。 */
	thinkingDelta?: string;
	usage?: AgentUsageInfo;
}

export interface ConfirmRequest {
	requestId: string;
	/** 'tool' = 单个工具调用确认; 'plan' = 实施计划确认 */
	kind: 'tool' | 'plan';
	toolName: string;
	description: string;
	args: string;
}
