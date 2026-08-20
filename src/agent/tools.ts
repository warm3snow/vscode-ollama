import { exec, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ToolDefinition, ToolContext } from './types';
import { edit } from './editTool';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_OUTPUT_LENGTH = 50000;
const EXCLUDED_DIRS = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'out',
	'.vscode',
	'.idea',
	'__pycache__',
	'.next',
	'.nuxt',
	'coverage',
	'target'
]);
const DEFAULT_READ_LIMIT = 2000;
const DEFAULT_LS_LIMIT = 500;
const DEFAULT_FIND_LIMIT = 1000;
const DEFAULT_GREP_LIMIT = 100;
const DEFAULT_BASH_TIMEOUT_MS = 120000;

function resolveInWorkspace(ctx: ToolContext, p: string): string {
	const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(ctx.workspaceRoot, p);
	const root = path.resolve(ctx.workspaceRoot);
	if (abs !== root && !abs.startsWith(root + path.sep)) {
		throw new Error(`Path "${p}" resolves outside the workspace.`);
	}
	return abs;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------- read ----------

async function readFileTool(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
	if (!args.path) {
		return 'Error: "path" is required.';
	}
	let filePath: string;
	try {
		filePath = resolveInWorkspace(ctx, String(args.path));
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}

	let stat: fs.Stats;
	try {
		stat = await fs.promises.stat(filePath);
	} catch {
		return `Error: "${args.path}" does not exist.`;
	}
	if (stat.isDirectory()) {
		return `"${args.path}" is a directory. Use ls to list its contents.`;
	}
	if (stat.size > MAX_FILE_SIZE) {
		return `"${args.path}" is too large to read (${formatBytes(stat.size)}). Use grep to search it instead.`;
	}

	const content = await fs.promises.readFile(filePath, 'utf8');
	const lines = content.split('\n');
	const totalLines = lines.length;

	let start = Number(args.offset);
	if (!Number.isFinite(start) || start < 1) {
		start = 1;
	}
	start = Math.floor(start);

	let end: number;
	const limit = Number(args.limit);
	if (Number.isFinite(limit) && limit > 0) {
		end = start + Math.floor(limit) - 1;
	} else {
		end = start + DEFAULT_READ_LIMIT - 1;
	}
	end = Math.min(end, totalLines);

	const selected = lines.slice(start - 1, end);
	let body = selected.join('\n');
	if (selected.length > 0) {
		body += '\n';
	}

	let truncated = false;
	let nextOffset: number | undefined;
	if (end < totalLines) {
		truncated = true;
		nextOffset = end + 1;
	}

	const header = `[read ${path.relative(ctx.workspaceRoot, filePath)} lines ${start}-${end} of ${totalLines}]`;
	let result = header + '\n' + body;
	if (truncated) {
		result += `\n[truncated: ${totalLines - end} more lines. Use offset=${nextOffset} to continue.]`;
	}
	return result;
}

// ---------- write ----------

async function writeFileTool(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
	if (!args.path) {
		return 'Error: "path" is required.';
	}
	if (typeof args.content !== 'string') {
		return 'Error: "content" is required.';
	}
	let filePath: string;
	try {
		filePath = resolveInWorkspace(ctx, String(args.path));
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}

	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
	await fs.promises.writeFile(filePath, args.content, 'utf8');

	return `Wrote ${path.relative(ctx.workspaceRoot, filePath)} (${formatBytes(Buffer.byteLength(args.content))}).`;
}

// ---------- bash ----------

async function bash(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
	const command = String(args.command ?? '').trim();
	if (!command) {
		return 'Error: "command" is required.';
	}

	const timeoutSec = Number(args.timeout);
	const timeoutMs = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : DEFAULT_BASH_TIMEOUT_MS;

	try {
		const { stdout, stderr } = await execAsync(command, {
			cwd: ctx.workspaceRoot,
			timeout: timeoutMs,
			maxBuffer: 8 * 1024 * 1024
		});

		let output = stdout.trim();
		if (stderr.trim()) {
			output = output ? `${output}\n${stderr.trim()}` : stderr.trim();
		}
		if (!output) {
			return '(no output)';
		}
		if (output.length > MAX_OUTPUT_LENGTH) {
			output = output.slice(0, MAX_OUTPUT_LENGTH) + `\n[truncated: output was ${output.length} chars]`;
		}
		return output;
	} catch (e) {
		const err = e as { code?: string | number; stdout?: string; stderr?: string; killed?: boolean; message?: string };
		if (err.killed) {
			return `Error: command timed out after ${Math.round(timeoutMs / 1000)}s.`;
		}
		const parts: string[] = [];
		if (err.stdout?.trim()) {
			parts.push(err.stdout.trim());
		}
		if (err.stderr?.trim()) {
			parts.push(err.stderr.trim());
		}
		if (parts.length > 0) {
			return `Command exited with error (code ${err.code ?? 'unknown'}):\n${parts.join('\n')}`;
		}
		return `Command failed: ${err.message || String(e)}`;
	}
}

// ---------- grep ----------

interface RgEvent {
	type?: string;
	data?: {
		path?: { text?: string };
		lines?: { text?: string };
		line_number?: number;
		submatches?: unknown[];
	};
}

async function runRipgrep(
	pattern: string,
	glob: string,
	ignoreCase: boolean,
	literal: boolean,
	context: number,
	limit: number,
	cwd: string,
	ctx: ToolContext
): Promise<string> {
	// 对齐 pi 的 grep:ripgrep + --hidden,默认尊重 .gitignore
	const rgArgs = ['--json', '--line-number', '--color=never', '--no-heading', '--hidden'];
	if (ignoreCase) {
		rgArgs.push('-i');
	}
	if (literal) {
		rgArgs.push('-F');
	}
	if (Number.isFinite(context) && context > 0) {
		rgArgs.push('-C', String(Math.floor(context)));
	}
	if (glob) {
		rgArgs.push('--glob', glob);
	}
	rgArgs.push('--', pattern);

	const { stdout } = await execFileAsync('rg', rgArgs, {
		cwd,
		timeout: 30000,
		maxBuffer: 8 * 1024 * 1024
	});

	const results: string[] = [];
	let realMatchCount = 0;
	for (const line of stdout.split('\n')) {
		if (!line.trim()) {
			continue;
		}
		let ev: RgEvent;
		try {
			ev = JSON.parse(line);
		} catch {
			continue;
		}
		if (ev.type !== 'match' || !ev.data?.path?.text || !ev.data?.lines?.text) {
			continue;
		}
		const isReal = (ev.data.submatches?.length ?? 0) > 0;
		if (isReal) {
			if (realMatchCount >= limit) {
				break;
			}
			realMatchCount++;
		}
		const rel = path.relative(ctx.workspaceRoot, path.resolve(cwd, ev.data.path.text));
		const ln = ev.data.line_number ?? 0;
		const text = ev.data.lines.text.replace(/\r?\n$/, '').slice(0, 200).trim();
		results.push(`${rel}:${ln}: ${text}`);
	}

	if (results.length === 0) {
		return `No matches found for "${pattern}".`;
	}
	const suffix = glob ? ` (glob: ${glob})` : '';
	return `Found ${realMatchCount} match(es) for "${pattern}"${suffix}:\n${results.join('\n')}`;
}

async function runGrepFallback(
	pattern: string,
	glob: string,
	ignoreCase: boolean,
	literal: boolean,
	context: number,
	limit: number,
	cwd: string,
	ctx: ToolContext
): Promise<string> {
	// ripgrep 不可用时的降级:用 POSIX grep(自带于 macOS / 大多数 Linux)
	const grepArgs: string[] = ['-rn', '-E', '--color=never'];
	if (ignoreCase) {
		grepArgs.push('-i');
	}
	if (literal) {
		grepArgs.push('-F');
	}
	if (Number.isFinite(context) && context > 0) {
		grepArgs.push('-C', String(Math.floor(context)));
	}
	if (glob) {
		grepArgs.push(`--include=${glob}`);
	}
	for (const dir of EXCLUDED_DIRS) {
		grepArgs.push(`--exclude-dir=${dir}`);
	}
	grepArgs.push('--', pattern);

	const { stdout } = await execFileAsync('grep', grepArgs, {
		cwd,
		timeout: 30000,
		maxBuffer: 8 * 1024 * 1024
	});

	const results: string[] = [];
	for (const line of stdout.split('\n')) {
		if (!line.trim() || results.length >= limit) {
			continue;
		}
		// grep -n 输出: file:line:content(-C 时的 "--" 分隔符不会匹配,自然跳过)
		const m = line.match(/^(.+?):(\d+):(.*)$/);
		if (!m) {
			continue;
		}
		const [, file, ln, text] = m;
		const rel = path.relative(ctx.workspaceRoot, path.resolve(cwd, file));
		results.push(`${rel}:${ln}: ${text.trim()}`);
	}

	if (results.length === 0) {
		return `No matches found for "${pattern}".`;
	}
	const suffix = glob ? ` (glob: ${glob})` : '';
	return `Found ${results.length} match(es) for "${pattern}"${suffix}:\n${results.join('\n')}`;
}

async function grep(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
	const pattern = String(args.pattern ?? '').trim();
	if (!pattern) {
		return 'Error: "pattern" is required.';
	}
	const glob = args.glob ? String(args.glob) : '';
	const ignoreCase = Boolean(args.ignoreCase);
	const literal = Boolean(args.literal);
	const context = Number(args.context);
	const limit = Math.min(Number(args.limit) || DEFAULT_GREP_LIMIT, 1000);
	const cwd = args.path ? resolveInWorkspace(ctx, String(args.path)) : path.resolve(ctx.workspaceRoot);

	// 优先用 ripgrep;rg 未安装 (ENOENT) 时降级到 POSIX grep,避免 agent 卡住要用户装工具。
	try {
		return await runRipgrep(pattern, glob, ignoreCase, literal, context, limit, cwd, ctx);
	} catch (e) {
		const err = e as { code?: string | number; message?: string };
		if (err.code === 'ENOENT') {
			try {
				return await runGrepFallback(pattern, glob, ignoreCase, literal, context, limit, cwd, ctx);
			} catch (e2) {
				const err2 = e2 as { code?: string | number; message?: string };
				if (err2.code === 1) {
					return `No matches found for "${pattern}".`;
				}
				if (err2.code === 'ENOENT') {
					return 'Error: neither ripgrep (rg) nor grep is available in PATH. Install one (e.g. `brew install ripgrep`).';
				}
				return `grep failed: ${err2.message || String(e2)}`;
			}
		}
		if (err.code === 1) {
			return `No matches found for "${pattern}".`;
		}
		return `grep failed: ${err.message || String(e)}`;
	}
}

// ---------- find ----------

function matchesGlob(name: string, pattern: string): boolean {
	// 将 glob 转成正则(支持 * 与 **)
	const re = new RegExp(
		'^' +
			pattern
				.split('/')
				.map(seg => {
					if (seg === '**') {
						return '(?:.*/)?';
					}
					return seg.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/[.+^${}()|[\]\\]/g, '\\$&');
				})
				.join('/') +
			'$'
	);
	return re.test(name);
}

async function findWithFallback(pattern: string, cwd: string, limit: number, ctx: ToolContext): Promise<string[]> {
	// 优先用 fd(默认尊重 .gitignore),不存在则递归降级
	try {
		const { stdout } = await execFileAsync(
			'fd',
			['--color=never', '--hidden', '--type', 'f', '--glob', pattern, '--max-results', String(limit), '--', cwd],
			{ timeout: 20000, maxBuffer: 4 * 1024 * 1024 }
		);
		const out = stdout.trim();
		if (out) {
			return out.split('\n').map(p => path.relative(ctx.workspaceRoot, path.resolve(cwd, p)));
		}
	} catch {
		// fd 不存在或出错,走递归降级
	}

	const results: string[] = [];
	const walk = async (dir: string, depth: number): Promise<void> => {
		if (results.length >= limit || depth > 20) {
			return;
		}
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (results.length >= limit) {
				return;
			}
			if (entry.isDirectory()) {
				if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
					continue;
				}
				await walk(path.join(dir, entry.name), depth + 1);
			} else {
				const rel = path.relative(ctx.workspaceRoot, path.join(dir, entry.name)).split(path.sep).join('/');
				if (matchesGlob(rel, pattern)) {
					results.push(rel);
				}
			}
		}
	};
	await walk(cwd, 0);
	return results;
}

async function find(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
	const pattern = String(args.pattern ?? '').trim();
	if (!pattern) {
		return 'Error: "pattern" (glob) is required.';
	}
	const limit = Math.min(Number(args.limit) || DEFAULT_FIND_LIMIT, 10000);
	const cwd = args.path ? resolveInWorkspace(ctx, String(args.path)) : path.resolve(ctx.workspaceRoot);

	const results = await findWithFallback(pattern, cwd, limit, ctx);
	if (results.length === 0) {
		return `No files found matching "${pattern}".`;
	}
	const truncated = results.length >= limit;
	return `Found ${results.length}${truncated ? '+' : ''} file(s) matching "${pattern}":\n${results.join('\n')}`;
}

// ---------- ls ----------

async function ls(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
	const limit = Math.min(Number(args.limit) || DEFAULT_LS_LIMIT, 10000);
	const dir = args.path ? resolveInWorkspace(ctx, String(args.path)) : path.resolve(ctx.workspaceRoot);

	let stat: fs.Stats;
	try {
		stat = await fs.promises.stat(dir);
	} catch {
		return `Error: "${args.path ?? '.'}" does not exist.`;
	}
	if (!stat.isDirectory()) {
		return `"${args.path ?? '.'}" is not a directory.`;
	}

	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	entries.sort((a, b) => {
		if (a.isDirectory() !== b.isDirectory()) {
			return a.isDirectory() ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});

	const lines: string[] = [];
	for (const entry of entries) {
		if (lines.length >= limit) {
			break;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			lines.push(`${path.relative(ctx.workspaceRoot, full)}/`);
		} else {
			try {
				const s = await fs.promises.stat(full);
				lines.push(`${path.relative(ctx.workspaceRoot, full)} (${formatBytes(s.size)})`);
			} catch {
				lines.push(path.relative(ctx.workspaceRoot, full));
			}
		}
	}

	const header = `[ls ${path.relative(ctx.workspaceRoot, dir) || '.'}]`;
	let result = header + '\n' + lines.join('\n');
	if (entries.length > limit) {
		result += `\n[truncated: ${entries.length - limit} more entries]`;
	}
	return result;
}

// ---------- tool registry ----------

export function createAgentTools(): ToolDefinition[] {
	return [
		{
			name: 'read',
			description:
				'Read a text file from the local filesystem. Returns content with line numbers and truncates large files. Use offset/limit to page through long files. Read a file before editing it.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative or absolute path of the file to read' },
					offset: { type: 'integer', description: 'First line number to read (1-based, default 1)' },
					limit: { type: 'integer', description: 'Number of lines to read (default 2000)' }
				},
				required: ['path']
			},
			requiresConfirmation: false,
			execute: readFileTool
		},
		{
			name: 'write',
			description: 'Create or overwrite a file with the given content. Creates parent directories as needed. Use only for new files or complete rewrites.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative or absolute path of the file to write' },
					content: { type: 'string', description: 'Full content to write to the file' }
				},
				required: ['path', 'content']
			},
			requiresConfirmation: false,
			execute: writeFileTool
		},
		{
			name: 'edit',
			description:
				'Apply one or more precise edits to a file in a single call. Each edit is {oldText, newText}; oldText is matched exactly, with fuzzy fallback for smart quotes/dashes/whitespace. Overlapping edits are rejected. Returns a unified diff. Prefer this for targeted changes. Requires user confirmation.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative or absolute path of the file to edit' },
					edits: {
						type: 'array',
						description: 'Array of edits to apply',
						items: {
							type: 'object',
							properties: {
								oldText: { type: 'string', description: 'Exact text to replace' },
								newText: { type: 'string', description: 'Replacement text' }
							},
							required: ['oldText', 'newText']
						}
					}
				},
				required: ['path', 'edits']
			},
			requiresConfirmation: false,
			execute: edit
		},
		{
			name: 'grep',
			description:
				'Search file contents for a regex or literal pattern. Returns file:line matches with optional context lines. Uses ripgrep when available; falls back to POSIX grep so it works on any machine. Use for exact patterns; prefer find when locating files by name.',
			parameters: {
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'Search pattern (regex, or literal string if literal=true)' },
					path: { type: 'string', description: 'Optional directory or file to search (default: workspace root)' },
					glob: { type: 'string', description: "Optional file glob filter, e.g. '*.ts' or '**/*.spec.ts'" },
					ignoreCase: { type: 'boolean', description: 'Case-insensitive search (default false)' },
					literal: { type: 'boolean', description: 'Treat pattern as literal string instead of regex (default false)' },
					context: { type: 'integer', description: 'Lines of context before/after each match (default 0)' },
					limit: { type: 'integer', description: 'Maximum matches to return (default 100)' }
				},
				required: ['pattern']
			},
			requiresConfirmation: false,
			execute: grep
		},
		{
			name: 'find',
			description:
				'Find files by glob pattern (respects .gitignore). Returns relative file paths. Use to locate files by name, e.g. pattern "*.ts" or "src/**/*.spec.ts".',
			parameters: {
				type: 'object',
				properties: {
					pattern: { type: 'string', description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'" },
					path: { type: 'string', description: 'Optional directory to search in (default: workspace root)' },
					limit: { type: 'integer', description: 'Maximum results (default 1000)' }
				},
				required: ['pattern']
			},
			requiresConfirmation: false,
			execute: find
		},
		{
			name: 'ls',
			description: 'List the contents of a directory, showing subdirectories and files with sizes.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Optional directory to list (default: workspace root)' },
					limit: { type: 'integer', description: 'Maximum entries to return (default 500)' }
				}
			},
			requiresConfirmation: false,
			execute: ls
		},
		{
			name: 'bash',
			description:
				'Execute a bash command in the workspace directory. Use for git, build/test commands, package managers, and other shell operations.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'Bash command to execute' },
					timeout: { type: 'integer', description: 'Timeout in seconds (default 120)' }
				},
				required: ['command']
			},
			requiresConfirmation: false,
			execute: bash
		}
	];
}
