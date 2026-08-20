import * as fs from 'fs';
import * as path from 'path';
import { ToolContext } from './types';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_DIFF_LINES = 2000; // 超过此规模跳过完整 diff,避免 LCS 内存爆炸

export interface EditOperation {
	oldText: string;
	newText: string;
}

// ---------- 归一化(对齐 pi 的 edit-diff 模糊匹配) ----------

interface Normalized {
	text: string;
	/** srcIndex[i]:归一化后第 i 个字符对应的原始字符串索引(用于把匹配区间映射回原始内容) */
	srcIndex: number[];
}

function normalizePlain(s: string): string {
	return s
		.normalize('NFKC')
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/[\u2013\u2014]/g, '-')
		.replace(/\u00A0/g, ' ')
		.replace(/\r\n?/g, '\n');
}

function normalizeWithMap(input: string): Normalized {
	const text: string[] = [];
	const srcIndex: number[] = [];
	const codePoints = Array.from(input);
	for (let i = 0; i < codePoints.length; i++) {
		let ch = codePoints[i];
		if (ch === '\r') {
			continue; // CRLF -> LF:丢弃 \r,后面的 \n 会映射到其原始位置
		}
		ch = normalizePlain(ch);
		for (const c of Array.from(ch)) {
			text.push(c);
			srcIndex.push(i);
		}
	}
	srcIndex.push(codePoints.length);
	return { text: text.join(''), srcIndex };
}

interface LocatedEdit {
	index: number;
	start: number;
	end: number;
	oldText: string;
	newText: string;
}

function locateEdit(content: string, norm: Normalized, oldText: string): { start: number; end: number } | null {
	// 精确匹配优先(模型通常会原样复制读到的文本)
	const exact = content.indexOf(oldText);
	if (exact >= 0) {
		return { start: exact, end: exact + oldText.length };
	}
	// 归一化模糊匹配,并映射回原始偏移
	const oldNorm = normalizePlain(oldText);
	const idx = norm.text.indexOf(oldNorm);
	if (idx < 0) {
		return null;
	}
	return { start: norm.srcIndex[idx], end: norm.srcIndex[idx + oldNorm.length] };
}

export function applyEdits(
	content: string,
	edits: EditOperation[]
): { updated: string; applied: LocatedEdit[]; errors: string[] } {
	const norm = normalizeWithMap(content);
	const located: LocatedEdit[] = [];
	const errors: string[] = [];

	for (let i = 0; i < edits.length; i++) {
		const edit = edits[i];
		if (!edit || typeof edit.oldText !== 'string' || edit.oldText.length === 0) {
			errors.push(`edit #${i + 1}: "oldText" is required and must be non-empty.`);
			continue;
		}
		const match = locateEdit(content, norm, edit.oldText);
		if (!match) {
			errors.push(`edit #${i + 1}: "oldText" not found. Read the file first to get the exact text.`);
			continue;
		}
		located.push({
			index: i,
			start: match.start,
			end: match.end,
			oldText: edit.oldText,
			newText: edit.newText ?? ''
		});
	}

	// 重叠检测(按原始偏移)
	located.sort((a, b) => a.start - b.start);
	for (let i = 0; i < located.length; i++) {
		for (let j = i + 1; j < located.length; j++) {
			if (located[j].start < located[i].end) {
				errors.push(
					`edit #${located[i].index + 1} and edit #${located[j].index + 1} overlap. Merge them into a single edit.`
				);
			}
		}
	}

	if (errors.length > 0) {
		return { updated: content, applied: [], errors };
	}

	// 从后往前应用,避免偏移错位
	let updated = content;
	for (let i = located.length - 1; i >= 0; i--) {
		const e = located[i];
		updated = updated.slice(0, e.start) + e.newText + updated.slice(e.end);
	}

	return { updated, applied: located, errors: [] };
}

// ---------- 统一 diff ----------

type DiffOp = { type: 'equal' | 'delete' | 'insert'; text: string };

function diffLines(a: string[], b: string[]): DiffOp[] {
	const n = a.length;
	const m = b.length;
	// LCS 动态规划;由 MAX_DIFF_LINES 限制规模
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			ops.push({ type: 'equal', text: a[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({ type: 'delete', text: a[i] });
			i++;
		} else {
			ops.push({ type: 'insert', text: b[j] });
			j++;
		}
	}
	while (i < n) {
		ops.push({ type: 'delete', text: a[i] });
		i++;
	}
	while (j < m) {
		ops.push({ type: 'insert', text: b[j] });
		j++;
	}
	return ops;
}

export function createUnifiedDiff(oldText: string, newText: string, fileLabel: string, context = 3): string {
	const a = oldText.split('\n');
	const b = newText.split('\n');

	if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
		return `(diff omitted: file has ${Math.max(a.length, b.length)} lines)`;
	}

	const ops = diffLines(a, b);
	const changed = ops.map(o => o.type !== 'equal');

	// 计算每个 op 起始处的 old/new 行号(1-based)
	const oldLineAt: number[] = new Array(ops.length + 1).fill(1);
	const newLineAt: number[] = new Array(ops.length + 1).fill(1);
	let oldLn = 1;
	let newLn = 1;
	for (let i = 0; i < ops.length; i++) {
		oldLineAt[i] = oldLn;
		newLineAt[i] = newLn;
		const op = ops[i];
		if (op.type !== 'insert') {
			oldLn++;
		}
		if (op.type !== 'delete') {
			newLn++;
		}
	}
	oldLineAt[ops.length] = oldLn;
	newLineAt[ops.length] = newLn;

	// 收集 hunks(变化区间 + context)
	const hunks: Array<{ start: number; end: number }> = [];
	let idx = 0;
	while (idx < ops.length) {
		if (!changed[idx]) {
			idx++;
			continue;
		}
		let end = idx;
		while (end < ops.length && changed[end]) {
			end++;
		}
		let start = idx;
		for (let c = 0; c < context && start > 0; c++, start--) {
			// 向前扩展 context 行
		}
		for (let c = 0; c < context && end < ops.length; c++, end++) {
			// 向后扩展 context 行
		}
		if (hunks.length > 0 && start <= hunks[hunks.length - 1].end) {
			hunks[hunks.length - 1].end = end;
		} else {
			hunks.push({ start, end });
		}
		idx = end;
	}

	const out: string[] = [`--- ${fileLabel}`, `+++ ${fileLabel}`];

	for (const hunk of hunks) {
		let del = 0;
		let ins = 0;
		for (let k = hunk.start; k < hunk.end; k++) {
			if (ops[k].type === 'delete') {
				del++;
			} else if (ops[k].type === 'insert') {
				ins++;
			}
		}
		const oldStart = oldLineAt[hunk.start];
		const newStart = newLineAt[hunk.start];
		out.push(`@@ -${oldStart},${del} +${newStart},${ins} @@`);

		for (let k = hunk.start; k < hunk.end; k++) {
			const op = ops[k];
			if (op.type === 'equal') {
				out.push(' ' + op.text);
			} else if (op.type === 'delete') {
				out.push('-' + op.text);
			} else {
				out.push('+' + op.text);
			}
		}
	}

	return out.join('\n');
}

// ---------- edit 工具 ----------

function parseEdits(raw: unknown): EditOperation[] | null {
	if (!Array.isArray(raw)) {
		return null;
	}
	const edits: EditOperation[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') {
			return null;
		}
		const obj = item as Record<string, unknown>;
		const oldText = obj.oldText ?? obj.old_string;
		const newText = obj.newText ?? obj.new_string;
		if (typeof oldText !== 'string' || typeof newText !== 'string') {
			return null;
		}
		edits.push({ oldText, newText });
	}
	return edits;
}

export async function edit(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
	if (!args.path) {
		return 'Error: "path" is required.';
	}
	const edits = parseEdits(args.edits);
	if (!edits || edits.length === 0) {
		return 'Error: "edits" must be a non-empty array of {oldText, newText}.';
	}

	const filePath = path.isAbsolute(String(args.path))
		? path.normalize(String(args.path))
		: path.resolve(ctx.workspaceRoot, String(args.path));
	const root = path.resolve(ctx.workspaceRoot);
	if (filePath !== root && !filePath.startsWith(root + path.sep)) {
		return `Error: path "${args.path}" resolves outside the workspace.`;
	}

	let content: string;
	try {
		const stat = await fs.promises.stat(filePath);
		if (!stat.isFile()) {
			return `"${args.path}" is not a file.`;
		}
		if (stat.size > MAX_FILE_SIZE) {
			return `"${args.path}" is too large to edit (${Math.round(stat.size / 1024)} KB).`;
		}
		content = await fs.promises.readFile(filePath, 'utf8');
	} catch (e) {
		return `Error reading "${args.path}": ${e instanceof Error ? e.message : String(e)}`;
	}

	const { updated, applied, errors } = applyEdits(content, edits);
	if (errors.length > 0) {
		return `Edit failed for "${path.relative(ctx.workspaceRoot, filePath)}":\n- ${errors.join('\n- ')}`;
	}

	await fs.promises.writeFile(filePath, updated, 'utf8');

	const rel = path.relative(ctx.workspaceRoot, filePath);
	const diff = createUnifiedDiff(content, updated, rel);
	return `Edited ${rel} (${applied.length} edit${applied.length > 1 ? 's' : ''} applied).\n\n${diff}`;
}
