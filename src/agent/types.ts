// Shared types for the coding agent

export interface ToolDefinition {
	name: string;
	description: string;
	/** JSON Schema for the tool arguments */
	parameters: Record<string, unknown>;
	/** Tools that modify the codebase or execute commands require user confirmation */
	requiresConfirmation: boolean;
	execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export interface ToolContext {
	workspaceRoot: string;
	signal?: AbortSignal;
}

export interface ToolCall {
	/** OpenAI-compatible tool call id (used to pair tool messages via tool_call_id) */
	id?: string;
	index?: number;
	type?: string;
	function: {
		name: string;
		/** JSON string of the arguments, as produced by the model */
		arguments: string;
	};
}

export interface OllamaMessage {
	role: string;
	content: string;
	tool_calls?: ToolCall[];
	/** Required on tool messages (OpenAI-compatible API) to pair them with their tool_call */
	tool_call_id?: string;
}

export interface AgentStatusEvent {
	type: 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error';
	toolName?: string;
	args?: string;
	result?: string;
	message?: string;
}

export interface ConfirmRequest {
	requestId: string;
	/** 'tool' = 单个工具调用确认; 'plan' = 实施计划确认 */
	kind: 'tool' | 'plan';
	toolName: string;
	description: string;
	args: string;
}

export interface AgentCallbacks {
	onStatus: (event: AgentStatusEvent) => void;
	onStream: (content: string) => void;
	onRequestConfirmation: (request: ConfirmRequest) => Promise<boolean>;
	onCompleted: () => void;
}

export interface AgentConfig {
	baseUrl: string;
	model: string;
	maxTokens: number;
	keepAlive: string;
	systemPrompt?: string;
}
