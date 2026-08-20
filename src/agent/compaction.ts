import { OllamaMessage } from './types';

// Pi 采用 chars/4 的粗略 token 估算(约等于英文每 4 字符 1 token)。
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
	if (!text) {
		return 0;
	}
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(messages: OllamaMessage[]): number {
	let total = 0;
	for (const m of messages) {
		total += estimateTokens(m.content ?? '');
		for (const tc of m.tool_calls ?? []) {
			total += estimateTokens(tc.function?.name ?? '');
			total += estimateTokens(tc.function?.arguments ?? '');
		}
	}
	return total;
}

/**
 * 找到压缩切分点:保留 system(第 0 条)与末尾 keepTokens 预算内的最近消息,
 * 返回 messages[0..cutPoint) 中需要被总结的区间上界。
 * 返回 0 表示无需总结(内容还不足)。
 */
export function findCompactionCutPoint(messages: OllamaMessage[], keepTokens: number): number {
	// 从末尾往前累积最近消息,直到超出预算
	let tailTokens = 0;
	let cutPoint = messages.length;
	for (let i = messages.length - 1; i >= 1; i--) {
		const tokens = estimateMessageTokens([messages[i]]);
		if (tailTokens + tokens > keepTokens) {
			break;
		}
		tailTokens += tokens;
		cutPoint = i;
	}
	// 可被总结的区间为 [1, cutPoint);若只剩 system,无需总结
	return cutPoint <= 1 ? 0 : cutPoint;
}

/**
 * 将待总结的消息序列化为文本,并要求模型输出结构化 checkpoint。
 */
export function buildCompactionPrompt(messages: OllamaMessage[]): string {
	const transcript = messages
		.map(m => {
			let line = `[${m.role}]`;
			for (const tc of m.tool_calls ?? []) {
				line += ` ${tc.function?.name}(${tc.function?.arguments ?? ''})`;
			}
			if (m.content) {
				line += ` ${m.content}`;
			}
			return line;
		})
		.join('\n');

	return `Summarize the following agent conversation into a concise checkpoint that preserves all context needed to continue the task.

Include, when present:
- The user's original goal and any constraints.
- Files read, created, or modified (with exact paths).
- Key findings, decisions, and the reasoning behind them.
- Commands run and their outcomes.
- Any errors encountered and how they were addressed.
- What still needs to be done next.

Be dense and factual. Do not drop file paths or command results that matter.

<conversation>
${transcript}
</conversation>

Return only the checkpoint summary.`;
}
