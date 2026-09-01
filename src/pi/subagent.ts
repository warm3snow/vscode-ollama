/**
 * Subagent 工具扩展。
 *
 * 给主 Agent 注册一个 `subagent` 工具，用于把任务委派给专门的子 Agent，
 * 每个子 Agent 拥有独立的上下文窗口（通过嵌套的 Pi 会话实现），
 * 从而避免把大量侦察/实现细节污染到主对话里。
 *
 * 与原版 subagent 示例（spawn 独立的 `pi` CLI 进程）不同，这里复用扩展已经
 * 加载的 Pi SDK 与已注册的 Ollama provider，直接在扩展宿主进程里创建嵌套会话，
 * 无需用户额外安装 `pi` 命令或配置 `~/.pi`。
 *
 * 支持三种模式：
 *   - single:   { agent: "name", task: "..." }
 *   - parallel: { tasks: [{ agent, task }, ...] }
 *   - chain:    { chain: [{ agent, task: "... {previous} ..." }, ...] }
 */

import * as fs from 'fs';
import * as path from 'path';
import { Type } from 'typebox';
import type { PiModelRuntime, PiSdk, PiSession } from './piSdk';

/** 并行任务数量上限。 */
const MAX_PARALLEL_TASKS = 8;
/** 并行执行的并发数上限。 */
const MAX_CONCURRENCY = 4;
/** 并行模式下单个任务输出的截断上限（字节）。 */
const PER_TASK_OUTPUT_CAP = 50 * 1024;

export type AgentScope = 'user' | 'project' | 'both';

interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: 'user' | 'project';
	filePath: string;
}

interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

interface UsageStats {
	input: number;
	output: number;
	total: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	task: string;
	exitCode: number;
	output: string;
	stderr: string;
	usage: UsageStats;
	stopReason?: string;
	errorMessage?: string;
}

/** 创建嵌套会话与发现 agents 所需的上下文。 */
export interface SubagentContext {
	sdk: PiSdk;
	/** 已注册 Ollama provider 的运行时（嵌套会话复用，保证 provider 注册不丢失）。 */
	modelRuntime: PiModelRuntime;
	/** 复用主会话构造的完整 model 对象。 */
	model: unknown;
	agentDir: string;
	workspaceRoot: string;
	skillsDirs: string[];
	/** 扩展内置 agents 目录（打包后位于 dist/subagent/agents）。 */
	builtinAgentsDir: string;
	defaultTools: string[];
}

function emptyUsage(): UsageStats {
	return { input: 0, output: 0, total: 0, turns: 0 };
}

function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === 'error' || result.stopReason === 'aborted';
}

function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, 'utf8');
	if (byteLength <= PER_TASK_OUTPUT_CAP) {
		return output;
	}
	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, 'utf8') > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, 'utf8')} bytes omitted]`;
}

// ---------------------------------------------------------------------------
// Frontmatter 解析（简化版：只处理 `key: value` 标量，足够 agents/prompts 使用）
// ---------------------------------------------------------------------------

function parseScalar(value: string): unknown {
	const trimmed = value.trim();
	// 去掉首尾引号
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	// 数组字面量 [a, b]
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		return trimmed
			.slice(1, -1)
			.split(',')
			.map(item => item.trim())
			.filter(Boolean);
	}
	return trimmed;
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) {
		return { frontmatter: {}, body: content };
	}
	const frontmatter: Record<string, unknown> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const idx = line.indexOf(':');
		if (idx <= 0) {
			continue;
		}
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		frontmatter[key] = parseScalar(value);
	}
	return { frontmatter, body: match[2] };
}

function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
	const tools = raw
		.filter((t): t is string => typeof t === 'string')
		.map(t => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

// ---------------------------------------------------------------------------
// Agents 发现
// ---------------------------------------------------------------------------

function loadAgentsFromDir(dir: string, source: 'user' | 'project'): AgentConfig[] {
	const agents: AgentConfig[] = [];
	if (!fs.existsSync(dir)) {
		return agents;
	}
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}
	for (const entry of entries) {
		if (!entry.name.endsWith('.md')) {
			continue;
		}
		if (!entry.isFile() && !entry.isSymbolicLink()) {
			continue;
		}
		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, 'utf-8');
		} catch {
			continue;
		}
		const { frontmatter, body } = parseFrontmatter(content);
		if (typeof frontmatter.name !== 'string' || typeof frontmatter.description !== 'string') {
			continue;
		}
		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseToolList(frontmatter.tools),
			model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
			systemPrompt: body,
			source,
			filePath
		});
	}
	return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, '.pi', 'agents');
		try {
			if (fs.statSync(candidate).isDirectory()) {
				return candidate;
			}
		} catch {
			// 不存在，继续向上。
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return null;
		}
		currentDir = parentDir;
	}
}

function discoverAgents(ctx: SubagentContext, cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const builtinAgents = scope === 'project' ? [] : loadAgentsFromDir(ctx.builtinAgentsDir, 'user');
	const projectAgents = scope === 'user' || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, 'project');

	const agentMap = new Map<string, AgentConfig>();
	if (scope === 'both') {
		for (const agent of builtinAgents) {
			agentMap.set(agent.name, agent);
		}
		for (const agent of projectAgents) {
			agentMap.set(agent.name, agent);
		}
	} else if (scope === 'user') {
		for (const agent of builtinAgents) {
			agentMap.set(agent.name, agent);
		}
	} else {
		for (const agent of projectAgents) {
			agentMap.set(agent.name, agent);
		}
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

// ---------------------------------------------------------------------------
// 嵌套会话运行单个子 Agent
// ---------------------------------------------------------------------------

interface NestedRunOutcome {
	output: string;
	usage: UsageStats;
	stopReason?: string;
	errorMessage?: string;
}

/** 从 agent_end 的 messages 里取最后一个 assistant 文本。 */
function extractFinalOutput(messages: Array<Record<string, unknown>>): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== 'assistant') {
			continue;
		}
		const content = msg.content;
		if (Array.isArray(content)) {
			for (const part of content) {
				if (part && typeof part === 'object' && (part as { type?: string }).type === 'text') {
					const text = (part as { text?: string }).text;
					if (typeof text === 'string' && text.length > 0) {
						return text;
					}
				}
			}
		}
	}
	return '';
}

function aggregateUsage(messages: Array<Record<string, unknown>>): UsageStats {
	const usage = emptyUsage();
	for (const msg of messages) {
		if (msg.role !== 'assistant') {
			continue;
		}
		usage.turns++;
		const u = msg.usage as { input?: number; output?: number; totalTokens?: number } | undefined;
		if (u) {
			usage.input += u.input ?? 0;
			usage.output += u.output ?? 0;
			usage.total += u.totalTokens ?? 0;
		}
	}
	return usage;
}

async function runNestedSession(
	ctx: SubagentContext,
	agent: AgentConfig,
	task: string,
	cwd: string,
	signal: AbortSignal | undefined
): Promise<NestedRunOutcome> {
	const tools = agent.tools ?? ctx.defaultTools;

	const settingsManager = ctx.sdk.SettingsManager.create(cwd, ctx.agentDir);
	const loader = new ctx.sdk.DefaultResourceLoader({
		cwd,
		agentDir: ctx.agentDir,
		settingsManager,
		noThemes: true,
		noPromptTemplates: true,
		additionalSkillPaths: ctx.skillsDirs.filter(dir => fs.existsSync(dir)),
		// 子 Agent 的 systemPrompt 追加到基础系统提示末尾。
		appendSystemPrompt: agent.systemPrompt.trim() ? [agent.systemPrompt.trim()] : [],
		// 不注册任何扩展：子 Agent 不能递归委派，也不需要确认门禁。
		extensionFactories: []
	});
	await loader.reload();

	const { session } = await ctx.sdk.createAgentSession({
		cwd,
		agentDir: ctx.agentDir,
		modelRuntime: ctx.modelRuntime,
		model: ctx.model,
		thinkingLevel: 'medium',
		tools,
		resourceLoader: loader,
		settingsManager,
		sessionManager: ctx.sdk.SessionManager.inMemory(cwd)
	});

	return await new Promise<NestedRunOutcome>(resolve => {
		let settled = false;
		let outcome: NestedRunOutcome = { output: '', usage: emptyUsage() };

		const finish = (value: NestedRunOutcome) => {
			if (settled) {
				return;
			}
			settled = true;
			outcome = value;
			try {
				session.dispose();
			} catch {
				// 忽略释放异常。
			}
			resolve(value);
		};

		// 累积每个 turn 的 text_delta，最后一个 turn 的输出就是子 Agent 的最终回答。
		// fallback 链：当前仍在流的 text → 最后一个已完成的 turn → agent_end.messages 提取。
		let currentTurnOutput = '';
		const completedTurnOutputs: string[] = [];

		const unsubscribe = session.subscribe(event => {
			if (event.type === 'message_update') {
				const inner = event.assistantMessageEvent;
				if (inner && inner.type === 'text_delta' && typeof inner.delta === 'string') {
					currentTurnOutput += inner.delta;
				}
			} else if (event.type === 'message_end') {
				// 一个 assistant message 完成了（即一个 turn 结束）
				if (currentTurnOutput.length > 0) {
					completedTurnOutputs.push(currentTurnOutput);
					currentTurnOutput = '';
				}
			} else if (event.type === 'agent_end') {
				const messages = Array.isArray(event.messages) ? event.messages : [];
				const usage = aggregateUsage(messages);
				const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
				const stopReason =
					typeof lastAssistant?.stopReason === 'string'
						? (lastAssistant.stopReason as string)
						: undefined;
				const errorMessage =
					typeof lastAssistant?.errorMessage === 'string'
						? (lastAssistant.errorMessage as string)
						: undefined;

				// 三个候选源，按可靠度从高到低：
				const streamedTail = currentTurnOutput;
				const lastTurn = completedTurnOutputs[completedTurnOutputs.length - 1] ?? '';
				const fromMessages = extractFinalOutput(messages);
				const finalOutput = streamedTail || lastTurn || fromMessages || extractAllAssistantText(messages);

				finish({ output: finalOutput, usage, stopReason, errorMessage });
			}
		});

		const onAbort = (): void => {
			void session.abort().catch(() => undefined);
			finish({ output: '', usage: emptyUsage(), stopReason: 'aborted' });
		};
		if (signal) {
			if (signal.aborted) {
				onAbort();
			} else {
				signal.addEventListener('abort', onAbort, { once: true });
			}
		}

		session
			.prompt(task)
			.then(() => {
				// prompt 正常结束但没有 agent_end（例如模型不支持）。兜底用累积的最后一个 turn 输出。
				if (!settled) {
					const lastTurn = completedTurnOutputs[completedTurnOutputs.length - 1] ?? '';
					const streamedTail = currentTurnOutput;
					finish({
						output: streamedTail || lastTurn,
						usage: outcome.usage,
						stopReason: outcome.stopReason,
						errorMessage: outcome.errorMessage
					});
				}
			})
			.catch(error => {
				finish({
					output: '',
					usage: emptyUsage(),
					stopReason: 'error',
					errorMessage: error instanceof Error ? error.message : String(error)
				});
			})
			.finally(() => {
				unsubscribe();
				if (signal) {
					signal.removeEventListener('abort', onAbort);
				}
			});
	});
}

/** 兜底：把 messages 里所有 assistant message 的 text content 拼起来。 */
function extractAllAssistantText(messages: Array<Record<string, unknown>>): string {
	const parts: string[] = [];
	for (const msg of messages) {
		if (msg.role !== 'assistant') {
			continue;
		}
		const content = msg.content;
		if (Array.isArray(content)) {
			for (const part of content) {
				if (part && typeof part === 'object' && (part as { type?: string }).type === 'text') {
					const text = (part as { text?: string }).text;
					if (typeof text === 'string' && text.length > 0) {
						parts.push(text);
					}
				}
			}
		}
	}
	return parts.join('\n\n').trim();
}

async function runSingleAgent(
	ctx: SubagentContext,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string,
	signal: AbortSignal | undefined
): Promise<SingleResult> {
	const agent = agents.find(a => a.name === agentName);
	if (!agent) {
		const available = agents.map(a => `"${a.name}"`).join(', ') || 'none';
		return {
			agent: agentName,
			task,
			exitCode: 1,
			output: '',
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: emptyUsage()
		};
	}

	try {
		const outcome = await runNestedSession(ctx, agent, task, cwd, signal);
		return {
			agent: agentName,
			task,
			exitCode: outcome.stopReason === 'error' || outcome.stopReason === 'aborted' ? 1 : 0,
			output: outcome.output,
			stderr: '',
			usage: outcome.usage,
			stopReason: outcome.stopReason,
			errorMessage: outcome.errorMessage
		};
	} catch (error) {
		return {
			agent: agentName,
			task,
			exitCode: 1,
			output: '',
			stderr: error instanceof Error ? error.message : String(error),
			usage: emptyUsage(),
			stopReason: 'error'
		};
	}
}

function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || result.output || '(no output)';
	}
	return result.output || '(no output)';
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
	if (items.length === 0) {
		return [];
	}
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) {
				return;
			}
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

// ---------------------------------------------------------------------------
// 参数 schema（typebox）
// ---------------------------------------------------------------------------

const TaskItem = Type.Object({
	agent: Type.String({ description: 'Name of the agent to invoke' }),
	task: Type.String({ description: 'Task to delegate to the agent' }),
	cwd: Type.Optional(Type.String({ description: 'Working directory for the agent' }))
});

const ChainItem = Type.Object({
	agent: Type.String({ description: 'Name of the agent to invoke' }),
	task: Type.String({ description: 'Task with optional {previous} placeholder for prior output' }),
	cwd: Type.Optional(Type.String({ description: 'Working directory for the agent' }))
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: 'Name of the agent to invoke (single mode)' })),
	task: Type.Optional(Type.String({ description: 'Task to delegate (single mode)' })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: 'Array of {agent, task} for parallel execution' })),
	chain: Type.Optional(Type.Array(ChainItem, { description: 'Array of {agent, task} for sequential execution' })),
	agentScope: Type.Optional(
		Type.Union([Type.Literal('user'), Type.Literal('project'), Type.Literal('both')], {
			description: 'Which agent directories to use. Default: "user" (built-in agents). Use "both" to include project-local agents.'
		})
	),
	cwd: Type.Optional(Type.String({ description: 'Working directory (single mode)' }))
});

// ---------------------------------------------------------------------------
// 扩展工厂
// ---------------------------------------------------------------------------

export function createSubagentExtension(ctx: SubagentContext): Record<string, unknown> {
	return {
		name: 'vscode-ollama-subagent',
		factory: (pi: { registerTool(tool: Record<string, unknown>): void }): void => {
			pi.registerTool({
				name: 'subagent',
				label: 'Subagent',
				description: [
					'Delegate tasks to specialized subagents with isolated context.',
					'Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).',
					'Default agent scope is "user" (built-in agents: codebase-search, plan, implement, review).',
					'To enable project-local agents in .pi/agents, set agentScope to "both" (or "project").'
				].join(' '),
				// 让模型在系统提示的「Available tools」里看到 subagent，
				// 否则它会倾向用内置 read/grep/ls 直接调研。
				promptSnippet:
					'Delegate tasks to specialized subagents (codebase-search / plan / implement / review) with isolated context windows.',
				promptGuidelines: [
					'Use the subagent tool for multi-step investigation or implementation chains; this keeps large reconnaissance and edits out of the main context.',
					'Built-in agents: "codebase-search" (codebase recon), "plan" (implementation plan), "implement" (full-capability executor), "review" (code review).'
				],
				parameters: SubagentParams,
				renderShell: 'default',

				async execute(
					_toolCallId: string,
					params: Record<string, unknown>,
					signal: AbortSignal | undefined
				): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
					const agentScope: AgentScope =
						params.agentScope === 'project' || params.agentScope === 'both' ? params.agentScope : 'user';
					const cwd = typeof params.cwd === 'string' && params.cwd ? params.cwd : ctx.workspaceRoot;

					const discovery = discoverAgents(ctx, cwd, agentScope);
					const agents = discovery.agents;

					const chain = Array.isArray(params.chain) ? (params.chain as Array<{ agent?: string; task?: string; cwd?: string }>) : [];
					const tasks = Array.isArray(params.tasks) ? (params.tasks as Array<{ agent?: string; task?: string; cwd?: string }>) : [];
					const hasChain = chain.length > 0;
					const hasTasks = tasks.length > 0;
					const hasSingle = typeof params.agent === 'string' && typeof params.task === 'string';
					const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

					if (modeCount !== 1) {
						const available = agents.map(a => `${a.name} (${a.source})`).join(', ') || 'none';
						return {
							content: [{ type: 'text', text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}` }]
						};
					}

					if (hasChain) {
						const results: SingleResult[] = [];
						let previousOutput = '';
						for (let i = 0; i < chain.length; i++) {
							const step = chain[i];
							const taskWithContext = (step.task ?? '').replace(/\{previous\}/g, previousOutput);
							const result = await runSingleAgent(
								ctx,
								agents,
								step.agent ?? '',
								taskWithContext,
								step.cwd ?? cwd,
								signal
							);
							results.push(result);
							if (isFailedResult(result)) {
								return {
									content: [
										{ type: 'text', text: `Chain stopped at step ${i + 1} (${step.agent}): ${getResultOutput(result)}` }
									],
									isError: true
								};
							}
							previousOutput = result.output;
						}
						return {
							content: [{ type: 'text', text: results[results.length - 1]?.output || '(no output)' }]
						};
					}

					if (hasTasks) {
						if (tasks.length > MAX_PARALLEL_TASKS) {
							return {
								content: [
									{ type: 'text', text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` }
								]
							};
						}

						const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async t =>
							runSingleAgent(ctx, agents, t.agent ?? '', t.task ?? '', t.cwd ?? cwd, signal)
						);

						const successCount = results.filter(r => !isFailedResult(r)).length;
						const summaries = results.map(r => {
							const output = truncateParallelOutput(getResultOutput(r));
							const status = isFailedResult(r)
								? `failed${r.stopReason && r.stopReason !== 'end' ? ` (${r.stopReason})` : ''}`
								: 'completed';
							return `### [${r.agent}] ${status}\n\n${output}`;
						});
						return {
							content: [
								{
									type: 'text',
									text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join('\n\n---\n\n')}`
								}
							],
							isError: successCount < results.length
						};
					}

					// single 模式
					const result = await runSingleAgent(ctx, agents, params.agent as string, params.task as string, cwd, signal);
					if (isFailedResult(result)) {
						return {
							content: [{ type: 'text', text: `Agent ${result.stopReason || 'failed'}: ${getResultOutput(result)}` }],
							isError: true
						};
					}
					return {
						content: [{ type: 'text', text: result.output || '(no output)' }]
					};
				}
			});
		}
	};
}
