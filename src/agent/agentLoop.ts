import { AgentCallbacks, AgentConfig, OllamaMessage, ToolCall, ToolDefinition } from './types';
import { AgentSkill, formatSkillsForPrompt } from './skills';
import { estimateMessageTokens, findCompactionCutPoint, buildCompactionPrompt } from './compaction';

const MAX_ITERATIONS = 15;
const MAX_TOOL_RESULT_LENGTH = 8000;

// 上下文压缩阈值(基于 chars/4 的粗略 token 估算)。
// 超过 COMPACTION_THRESHOLD_TOKENS 时,把较早的消息总结为 checkpoint,
// 只保留最近 KEEP_RECENT_TOKENS 的原始消息。
const COMPACTION_THRESHOLD_TOKENS = 4000;
const KEEP_RECENT_TOKENS = 1500;

const BASE_AGENT_PROMPT = `You are a coding agent running inside VS Code, powered by a local Ollama model. You work in the workspace: {workspaceRoot}

Today's date is {currentDate}.

# Mission
Help the user understand, search, and modify their codebase, and run git/shell commands.

# CRITICAL: Tool usage rules
- You MUST call the appropriate tool to answer any question about the codebase. NEVER answer with general advice or assumptions about code you have not actually read.
- When the user asks to "search", "find", "look at", "explore", "understand", "what is in", "show me", "tell me about", "architecture", "structure", "design", "overview", "components", "modules", "dependencies", or "how does X work" about the project, your FIRST response MUST be to call grep (search contents) or find / ls (structure and file names) — NEVER web_search.
- When the user asks to "read", "show", "view", or "open" a specific file, call read.
- Do NOT respond with tutorial-style text when the user wants you to actually look at their code. Call a tool first.
- Do NOT fabricate tool results in your output (e.g. fake <tool_response>...</tool_response> blocks). Tool results only come back from a real tool call.
- Only when tools are not relevant (e.g. pure chat, design questions) should you respond with text alone.

# CRITICAL: Real-time / external questions (MUST use web_search)
- If the user's question requires UP-TO-DATE information that your training data cannot answer, you MUST call web_search BEFORE writing any reply. This includes (non-exhaustive):
  - Weather / forecast / temperature for any city (今天/明天/本周天气, 气温, 下雨, 几度, weather, forecast, temperature, ...)
  - Today's date, current time in a timezone
  - News, current events, recent announcements
  - Stock / crypto / commodity prices, exchange rates
  - Sports scores, schedules, rankings
  - Latest version of a package or framework, recent releases, CVEs
  - Anything containing 今天/今日/现在/最新/this week/right now/today/current/latest
- For these questions you are FORBIDDEN from responding with phrases like "I cannot provide real-time info" / "I don't have access to the internet" / "please check a weather app". Those are wrong — call web_search and use the result.
- Only answer from your own knowledge when the question is timeless (programming concepts, language syntax, algorithms, math, well-established APIs).

# Tools
- read(path, offset?, limit?): read a text file with line numbers (truncates large files). ALWAYS read a file before editing it.
- write(path, content): create or overwrite a file (creates parent dirs). Use for new files or complete rewrites.
- edit(path, edits[]): apply one or more precise edits. Each edit is {oldText, newText}; returns a unified diff. Prefer this for targeted changes.
- grep(pattern, path?, glob?, ignoreCase?, literal?, context?, limit?): search file contents via ripgrep (respects .gitignore), returns file:line matches.
- find(pattern, path?, limit?): find files by glob pattern (e.g. "*.ts"), respects .gitignore.
- ls(path?, limit?): list a directory's contents.
- bash(command, timeout?): execute a bash command (git, build/test, package managers, etc.).
- web_search(query): search the web for up-to-date information. Use it ONLY when the question is about recent events, current facts, external APIs, or topics that are clearly NOT in the user's workspace. For ANY question about the user's own project (architecture, files, code, structure, components, dependencies), use grep / find / ls / read — NEVER web_search. Web results for "project architecture" type questions are useless.
- use_skill(name): load expert instructions for a matching skill. Call this BEFORE starting work when the user's task matches one of the available skills below, then follow the loaded guidance.

# Working strategy
1. UNDERSTAND: search and read the relevant files first. Trace how things work before changing anything.
2. PLAN: decide the minimal set of changes needed to satisfy the request.
3. ACT: make small, precise edits. Never rewrite large files unnecessarily.
4. VERIFY: after changes, use bash to run git diff, build, or tests to confirm the result works.

# Rules
- Use relative paths (from the workspace root) for all file tools.
- Do not repeat a tool call with the same arguments unless something changed; reuse information you already have.
- If a tool returns an error, read the error carefully and adjust. Retry once if the fix is obvious.
- If the user rejects an action, do NOT retry it unless they explicitly ask.
- Keep tool arguments small and JSON-serializable.
- After completing, give a concise summary: what you changed and why, with file paths.
- You are an autonomous agent. NEVER ask the user to run a command, install a package, or approve a step for you. If something needs to run, call bash yourself; if a file needs changing, call write/edit yourself.
- Do not stop after a single step. Keep using tools until the whole task is finished, then give a final summary. Do not wait for the user to say "go on" — complete the work yourself.
- If the request is ambiguous, ask a clarifying question via a short text response instead of guessing.`;

const PLAN_FIRST_INSTRUCTION = `Before doing any work, produce a concise implementation plan only.

The plan must be plain text (no tool calls) and cover:
- What you understand the task to be.
- Which files you will create or modify, and why.
- Which commands (git/build/test) you will run to verify.
- The order of steps.

Do NOT call any tools now. Wait for the user to approve the plan, then execute it step by step.`;

// "vibe" / "go on" 等继续信号:让 agent 自主推进任务直到完成,而不是等用户反复催。
// 注意:这属于"继续执行"的用户指令(类似 /plan、/reset),不是意图判断。
const CONTINUE_KEYWORDS = [
	'vibe', 'go on', 'go ahead', 'keep going', 'carry on', 'keep working',
	'finish it', 'finish the task',
	'继续', '接着', '自动', '不用问', '不要停'
];
const MAX_NUDGES = 3;
const CONTINUE_INSTRUCTION = `The user just sent a "keep going" signal (e.g. "vibe"). Treat this as: continue working autonomously until the ENTIRE task is fully finished.

- Do NOT ask the user to run any command, install anything, or approve a step. Call the bash / read / edit / write / grep / find / ls tools yourself.
- If previous work is incomplete or a command failed, fix it and keep going.
- Keep using tools step by step until the job is done, then give a concise final summary of what you changed and why.`;

const CONTINUE_NUDGE = 'You stopped without completing the task. Continue now: if more work is needed, call the next tool. If the task is truly complete, reply with a one-line final summary and call no tool. Never ask the user to run a command yourself.';

export function isContinuePrompt(text: string): boolean {
	const t = text.toLowerCase();
	return CONTINUE_KEYWORDS.some(k => t.includes(k));
}

// 与 AGENT_SYSTEM_PROMPT 中的工具定义一一对应
const TOOL_DESCRIPTIONS: Record<string, string> = {
	read: 'read a text file from the workspace (with optional line range)',
	write: 'create or overwrite a file in the workspace',
	edit: 'apply one or more precise edits to a file (edits[] of {oldText,newText}), returns a unified diff',
	grep: 'search file contents with ripgrep (respects .gitignore), returns file:line matches',
	find: 'find files by glob pattern (respects .gitignore)',
	ls: 'list the contents of a directory',
	bash: 'execute a bash command in the workspace',
	web_search: 'search the web for up-to-date information'
};

function buildSystemPrompt(workspaceRoot: string, skills: AgentSkill[]): string {
	let prompt = BASE_AGENT_PROMPT
		.replace('{workspaceRoot}', workspaceRoot)
		.replace('{currentDate}', new Date().toDateString());

	prompt += formatSkillsForPrompt(skills);

	return prompt;
}

interface ChatCompletionResult {
	content: string;
	toolCalls: ToolCall[];
}

/**
 * 流式调用 Ollama 的 OpenAI 兼容接口(/v1/chat/completions)。
 * 解析 SSE 流,收集增量内容与 tool_calls(按 index 合并 arguments 分片)。
 */
async function chatWithTools(
	config: AgentConfig,
	messages: OllamaMessage[],
	tools: ToolDefinition[],
	onStream: (content: string) => void
): Promise<ChatCompletionResult> {
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
				tools: tools.length > 0 ? tools.map(t => ({
					type: 'function',
					function: {
						name: t.name,
						description: `${TOOL_DESCRIPTIONS[t.name] ?? t.description}`,
						parameters: t.parameters
					}
				})) : undefined,
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

	const decoder = new TextDecoder();
	let buffer = '';
	let content = '';
	// 按 index 合并原生 tool_calls(arguments 可能分片)
	const nativeCallsByIndex = new Map<number, ToolCall>();

	const handleSseLine = (line: string) => {
		if (!line) {
			return;
		}
		// SSE 格式:"data: {...}" 或 "data: [DONE]"
		if (!line.startsWith('data:')) {
			return;
		}
		const payload = line.slice(5).trim();
		if (!payload || payload === '[DONE]') {
			return;
		}
		let data: {
			choices?: Array<{
				delta?: {
					content?: string;
					tool_calls?: Array<{
						index?: number;
						id?: string;
						type?: string;
						function?: { name?: string; arguments?: string };
					}>;
				};
			}>;
		};
		try {
			data = JSON.parse(payload);
		} catch {
			return;
		}
		const delta = data.choices?.[0]?.delta;
		if (!delta) {
			return;
		}
		if (delta.content) {
			content += delta.content;
		}
		if (delta.tool_calls) {
			for (const tc of delta.tool_calls) {
				const idx = tc.index ?? 0;
				const existing = nativeCallsByIndex.get(idx) ?? {
					id: tc.id,
					index: idx,
					type: tc.type ?? 'function',
					function: { name: '', arguments: '' }
				};
				if (tc.id) {
					existing.id = tc.id;
				}
				if (tc.function?.name) {
					existing.function.name = tc.function.name;
				}
				if (tc.function?.arguments) {
					existing.function.arguments += tc.function.arguments;
				}
				nativeCallsByIndex.set(idx, existing);
			}
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
				handleSseLine(line);
			}
		}
		if (buffer.trim()) {
			handleSseLine(buffer.trim());
		}
	} finally {
		reader.releaseLock();
	}

	const nativeToolCalls: ToolCall[] = [...nativeCallsByIndex.values()];

	// Fallback: 某些模型(如 qwen2.5-coder)不支持原生 tool calling,
	// 把 tool_call 写成 content 里的伪 JSON / <tool_call>...</tool_call>。
	const pseudoCalls = tryParseToolCallFromContent(content);

	// 剔除所有 tool_call 原始文本,得到干净的 prose
	let prose = content;
	for (const call of pseudoCalls) {
		prose = prose.split(call.rawText).join('');
	}
	prose = prose.trim();

	// 只把干净的 prose 推给用户(工具调用文本不显示)
	if (prose) {
		onStream(prose);
	}

	// 原生 tool_calls 优先;否则用伪调用(每个生成唯一 id 以便 tool 消息配对)
	let toolCalls: ToolCall[];
	if (nativeToolCalls.length > 0) {
		toolCalls = nativeToolCalls;
	} else {
		toolCalls = pseudoCalls.map(p => ({
			id: `pseudo-${Math.random().toString(36).slice(2, 10)}`,
			type: 'function',
			function: { name: p.name, arguments: JSON.stringify(p.arguments) }
		}));
	}

	return { content: prose, toolCalls };
}

function parseToolArgs(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw || '{}');
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function truncate(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	return text.slice(0, max) + '\n... (truncated)';
}

interface ParsedToolCall {
	name: string;
	arguments: Record<string, unknown>;
	/** 匹配到的原始文本,用于从 prose 中剔除 */
	rawText: string;
}

// 从 content 中提取伪 tool_call。一些模型/代理不会输出原生 tool_calls 字段,
// 而是输出 `<tool_call>{...}</tool_call>` 标签或裸 JSON 对象 {name, arguments}。
function tryParseToolCallFromContent(content: string): ParsedToolCall[] {
	if (!content) {
		return [];
	}
	const matches: ParsedToolCall[] = [];
	const seen = new Set<string>();

	const pushIfValid = (rawText: string) => {
		if (seen.has(rawText)) {
			return;
		}
		const objMatch = rawText.match(/\{[\s\S]*\}/);
		if (!objMatch) {
			return;
		}
		try {
			const obj = JSON.parse(objMatch[0]);
			if (obj && typeof obj === 'object' && typeof obj.name === 'string') {
				seen.add(rawText);
				matches.push({
					name: obj.name,
					arguments: obj.arguments && typeof obj.arguments === 'object' ? obj.arguments : {},
					rawText
				});
			}
		} catch {
			// 不是合法 JSON,放弃
		}
	};

	// 1) XML 风格标签
	const tagRe = /<tool_call>[\s\S]*?<\/tool_call>/g;
	let m: RegExpExecArray | null;
	while ((m = tagRe.exec(content)) !== null) {
		pushIfValid(m[0]);
	}

	// 2) 裸 JSON 对象 { "name": "...", "arguments": {...} }。
	//    从 "name" 出现的位置向左回溯到最近的 '{',向右做花括号平衡匹配,
	//    以支持嵌套的 arguments 对象。
	//    同时把外层可选的 ```json ... ``` / ``` ... ``` markdown 围栏一起识别,
	//    以便从 prose 中整段剔除(避免 ```json / ``` 残留干扰用户看到的文本)。
	const nameIdx = content.indexOf('"name"');
	if (nameIdx >= 0) {
		const open = content.lastIndexOf('{', nameIdx);
		if (open >= 0) {
			let depth = 0;
			let end = -1;
			for (let i = open; i < content.length; i++) {
				if (content[i] === '{') {
					depth++;
				} else if (content[i] === '}') {
					depth--;
					if (depth === 0) {
						end = i + 1;
						break;
					}
				}
			}
			if (end > 0) {
				let rawText = content.slice(open, end);

				// 向前尝试吞掉 ```json / ``` 围栏起始(允许前面有空白或换行)
				const before = content.slice(0, open);
				const fenceStart = before.match(/```(?:json)?[^\n`]*\s*$/i);
				if (fenceStart) {
					rawText = before.slice(before.length - fenceStart[0].length) + rawText;
				}

				// 向后尝试吞掉 ``` 围栏结束(允许后面有空白或换行)
				const after = content.slice(end);
				const fenceEnd = after.match(/^\s*```/);
				if (fenceEnd) {
					rawText = rawText + after.slice(0, fenceEnd[0].length);
				}

				pushIfValid(rawText);
			}
		}
	}

	return matches;
}

/**
 * 执行 agent 主循环:
 * 模型输出 -> 若含 tool_calls 则依次执行并把结果作为 tool 消息回填 -> 再次调用模型,直到模型不再请求工具。
 *
 * @param skills   可用的 skill 列表,按用户请求自动匹配并注入 system prompt
 * @param planFirst 先输出实施计划、经用户确认后再执行
 */
export async function runAgentLoop(params: {
	config: AgentConfig;
	userMessage: string;
	workspaceRoot: string;
	tools: ToolDefinition[];
	callbacks: AgentCallbacks;
	skills?: AgentSkill[];
	planFirst?: boolean;
	/** 外部注入的系统消息(例如 web 搜索结果上下文),会拼到基础提示词之后、用户消息之前。 */
	extraSystemMessages?: OllamaMessage[];
	/**
	 * 上一轮会话历史(多轮对话连续性)。
	 * - 第一条必须是 system 提示词(若与当前提示词不一致,会替换为当前提示词以反映 skills/配置变更)。
	 * - 接下来是 user/assistant/tool 消息,直到当前 userMessage 之前。
	 * 循环结束后,扩展后的 messages 会通过返回值传出,供调用方保存为下一轮的 initialMessages。
	 */
	initialMessages?: OllamaMessage[];
	/** 用户发送 "vibe"/"go on" 等继续信号时置 true:agent 会自主推进直到任务完成。 */
	autoContinue?: boolean;
}): Promise<{ messages: OllamaMessage[] }> {
	const { config, userMessage, workspaceRoot, tools, callbacks } = params;
	const autoContinue = params.autoContinue === true;
	const skills = params.skills ?? [];
	// 可被模型自动调用的 skills(排除 Agent Skills 规范里 disable-model-invocation 的 skill)
	const usableSkills = skills.filter(s => !s.disableModelInvocation);

	const baseSystemPrompt = buildSystemPrompt(workspaceRoot, skills);

	// 恢复多轮上下文;若首条 system 与当前不一致(skills/配置已变更),替换它。
	let history: OllamaMessage[] = [];
	if (params.initialMessages && params.initialMessages.length > 0) {
		history = [...params.initialMessages];
		if (history[0]?.role === 'system') {
			history[0] = { role: 'system', content: baseSystemPrompt };
		} else {
			history.unshift({ role: 'system', content: baseSystemPrompt });
		}
	} else {
		history = [{ role: 'system', content: baseSystemPrompt }];
	}

	// 注入外部上下文(例如 web 搜索结果):紧跟 system 提示词,但在历史消息之前
	if (params.extraSystemMessages && params.extraSystemMessages.length > 0) {
		// 在 system 提示词之后、其他消息之前插入
		const extras = params.extraSystemMessages.filter(m => m && m.role && m.content);
		history.splice(1, 0, ...extras);
	}

	let messages: OllamaMessage[] = [...history, { role: 'user', content: userMessage }];

	// "vibe"/"go on" 继续信号:在用户消息后紧跟一条指令,要求模型自主推进直到完成。
	if (autoContinue) {
		messages.push({ role: 'system', content: CONTINUE_INSTRUCTION });
	}

	// 动态注册 use_skill 工具:由 LLM 根据任务自主决策调用哪个 skill(而非预注入)
	const allTools: ToolDefinition[] = usableSkills.length > 0
		? [
				...tools,
				{
					name: 'use_skill',
					description: `Load expert instructions for a skill by name. Call this BEFORE starting work when the user's task matches one of the skills below, then follow the returned guidance.\nAvailable skills:\n${usableSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`,
					parameters: {
						type: 'object',
						properties: {
							name: { type: 'string', description: `Skill name. One of: ${usableSkills.map(s => s.name).join(', ')}` }
						},
						required: ['name']
					},
					requiresConfirmation: false,
					execute: async (args: Record<string, unknown>) => {
						const name = String(args.name ?? '').trim();
						const skill = usableSkills.find(s => s.name === name);
						if (!skill) {
							return `Error: unknown skill "${name}". Available skills: ${usableSkills.map(s => s.name).join(', ')}`;
						}
						return `[Skill: ${skill.name}] ${skill.description}\n\n${skill.content}`;
					}
				}
			]
		: tools;

	let iterations = 0;
	let nudgeCount = 0;

	// ---- Plan-first 模式:让模型在执行前输出计划文本(作为对用户可见的进度),
	//      然后自动继续执行 — 无需用户确认。计划文本会显示在聊天区域,
	//      后续真实工具调用再依次执行。
	if (params.planFirst) {
		callbacks.onStatus({ type: 'thinking' });
		const planResult = await chatWithTools(
			config,
			[...messages, { role: 'system', content: PLAN_FIRST_INSTRUCTION }],
			[], // 不提供工具,确保模型只输出文本计划
			callbacks.onStream
		);

		if (planResult.content.trim()) {
			messages.push({ role: 'assistant', content: planResult.content });
			messages.push({
				role: 'system',
				content: 'Plan noted. Now execute it step by step using the available tools. Do NOT ask for approval — proceed automatically.'
			});
		}
	}

	// ---- 主循环 ----
	while (iterations < MAX_ITERATIONS) {
		iterations++;
		callbacks.onStatus({ type: 'thinking' });

		// 上下文压缩:累计消息过大时,把较早消息总结为 checkpoint,保留最近消息。
		// 每次进入循环前检查一次,工具结果累积后会自动触发。
		if (estimateMessageTokens(messages) > COMPACTION_THRESHOLD_TOKENS) {
			const cutPoint = findCompactionCutPoint(messages, KEEP_RECENT_TOKENS);
			if (cutPoint > 1) {
				const toSummarize = messages.slice(1, cutPoint);
				const recent = messages.slice(cutPoint);
				try {
					const summaryResult = await chatWithTools(
						config,
						[{ role: 'user', content: buildCompactionPrompt(toSummarize) }],
						[],
						() => {}
					);
					const summary = summaryResult.content.trim();
					if (summary) {
						messages = [
							messages[0], // 保留原始 system prompt
							{ role: 'system', content: '## Conversation checkpoint (summary of earlier turns)\n' + summary },
							...recent
						];
					}
				} catch {
					// 摘要失败不阻塞主流程,继续用未压缩的上下文
				}
			}
		}

		const { content: rawContent, toolCalls } = await chatWithTools(config, messages, allTools, callbacks.onStream);

		// 模型有时会把伪造的工具响应(<tool_response>...</tool_response>)写进 prose,
		// 例如明明没调用 web_search,却在内容里虚构一段"<tool_response>搜索结果</tool_response>"。
		// 这些不是真正的工具结果,而是 prose 文本 — 直接从 content 中剔除,避免污染聊天显示。
		const content = rawContent && /<tool_response>/i.test(rawContent)
			? rawContent.replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, '').trim()
			: rawContent;

		messages.push({
			role: 'assistant',
			content,
			tool_calls: toolCalls.length > 0 ? toolCalls : undefined
		});

		// 模型没有请求工具:说明它判断当前无需调用工具(或已完成任务),
		// 意图判断完全交给 LLM,不再用正则兜底。
		if (!toolCalls || toolCalls.length === 0) {
			// autoContinue(vibe)模式:模型可能过早停下(输出"请你运行以下命令"之类的 prose,
			// 而不是真正调用工具)。检测到这种"把工作甩回给用户"的信号时,注入继续指令
			// 让 LLM 自己判断是继续还是真正完成,并强制它推进任务(用少量 nudge 兜底防死循环)。
			if (autoContinue && nudgeCount < MAX_NUDGES) {
				const handoff = /please (?:install|run|execute|try|search|grep|find|build|test|add|remove|delete|fix|update|create|set up)|can you (?:please )?(?:install|run|try|execute|search|grep|find|do it|do this|help)|you (?:can|should|need to) (?:install|run|try|execute|search|grep|find|do it|do this|test|build)|(?:install|run|try) (?:it|this|the|again|once more)|once installed|let me know|would you like|feel free to|brew install|npm (?:install|i )|pip install|apt[ -]get install|choco install|请(?:安装|运行|执行|手动)|你(?:可以|需要)|手动|自己跑|自己安装|运行以下|安装以下|运行一下|安装一下/i.test(content);
				if (handoff || content.trim().length === 0) {
					nudgeCount++;
					messages.push({ role: 'system', content: CONTINUE_NUDGE });
					continue;
				}
			}
			callbacks.onCompleted();
			callbacks.onStatus({ type: 'done' });
			return { messages };
		}

		// 依次执行工具调用
		for (const call of toolCalls) {
			const fn = call.function;
			const tool = allTools.find(t => t.name === fn.name);
			const args = parseToolArgs(fn.arguments);
			const argsRaw = fn.arguments || '{}';

			callbacks.onStatus({
				type: 'tool_call',
				toolName: fn.name,
				args: truncate(argsRaw, 500)
			});

			let result: string;
			if (!tool) {
				result = `Error: unknown tool "${fn.name}". Available tools: ${tools.map(t => t.name).join(', ')}`;
			} else if (tool.requiresConfirmation) {
				const approved = await callbacks.onRequestConfirmation({
					requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					kind: 'tool',
					toolName: fn.name,
					description: tool.description,
					args: truncate(argsRaw, 500)
				});
				if (!approved) {
					result = 'The user rejected this action. Do not retry it unless the user explicitly asks.';
				} else {
					try {
						result = await tool.execute(args, { workspaceRoot });
					} catch (e) {
						result = `Error executing ${fn.name}: ${e instanceof Error ? e.message : String(e)}`;
					}
				}
			} else {
				try {
					result = await tool.execute(args, { workspaceRoot });
				} catch (e) {
					result = `Error executing ${fn.name}: ${e instanceof Error ? e.message : String(e)}`;
				}
			}

			result = truncate(result, MAX_TOOL_RESULT_LENGTH);

			callbacks.onStatus({
				type: 'tool_result',
				toolName: fn.name,
				result: truncate(result, 500)
			});
			// OpenAI 兼容接口:tool 消息用 tool_call_id 与 assistant 消息的 tool_calls[].id 配对
			messages.push({ role: 'tool', tool_call_id: call.id ?? fn.name, content: result });
		}
	}

	callbacks.onStatus({
		type: 'error',
		message: `Reached the maximum of ${MAX_ITERATIONS} tool-calling iterations.`
	});
	callbacks.onCompleted();
	return { messages };
}
