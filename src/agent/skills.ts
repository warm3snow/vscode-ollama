import * as fs from 'fs';
import * as path from 'path';

export interface AgentSkill {
	name: string;
	description: string;
	content: string;
	/** 绝对路径,指向 SKILL.md 或顶层 *.md。 */
	filePath?: string;
	/** skill 所在目录;skill 内容里的相对路径都相对它解析。 */
	baseDir?: string;
	/** Agent Skills 规范:为 true 时模型不得自动调用,只能显式触发。 */
	disableModelInvocation?: boolean;
}

// Agent Skills 规范限制
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

// 匹配 `---\n<frontmatter>\n---\n<body>`;frontmatter 行为 `key: value`。
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | null {
	const m = raw.match(FRONTMATTER_RE);
	if (!m) {
		return null;
	}
	const meta: Record<string, string> = {};
	for (const line of m[1].split(/\r?\n/)) {
		const idx = line.indexOf(':');
		if (idx > 0) {
			meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
		}
	}
	return { meta, body: m[2].trim() };
}

function isValidName(name: string): boolean {
	return (
		name.length > 0 &&
		name.length <= MAX_NAME_LENGTH &&
		/^[a-z0-9-]+$/.test(name) &&
		!name.startsWith('-') &&
		!name.endsWith('-') &&
		!name.includes('--')
	);
}

function loadSkillFromFile(filePath: string): AgentSkill | null {
	const isDeclaredSkill = path.basename(filePath) === 'SKILL.md';

	let raw: string;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch {
		return null;
	}

	const parsed = parseFrontmatter(raw);
	if (!parsed) {
		return null;
	}
	const { meta, body } = parsed;

	const description = (meta.description ?? '').trim();
	if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
		return null;
	}

	// name 优先取 frontmatter;SKILL.md 缺省时退回父目录名。
	let name = (meta.name ?? '').trim();
	if (!name && isDeclaredSkill) {
		name = path.basename(path.dirname(filePath));
	}
	if (!isValidName(name)) {
		return null;
	}

	const disableModelInvocation = meta['disable-model-invocation'] === 'true';

	return {
		name,
		description,
		content: body,
		filePath,
		baseDir: path.dirname(filePath),
		disableModelInvocation
	};
}

/**
 * 从目录加载 skills,发现规则对齐 Agent Skills 规范(参考 pi 的 coding-agent):
 * - 目录包含 SKILL.md -> 视为 skill 根,只加载它,不再递归;
 * - 顶层(仅第一层)的 *.md 视为独立 skill(向后兼容当前 skills/ 下的扁平文件);
 * - 子目录递归查找 SKILL.md。
 */
export function loadSkillsFromDirectory(dir: string): AgentSkill[] {
	const skills: AgentSkill[] = [];

	const loadDir = (current: string, includeRootFiles: boolean) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}

		// skill 根:找到 SKILL.md 就加载并停止。
		const skillMd = entries.find(e => e.isFile() && e.name === 'SKILL.md');
		if (skillMd) {
			const skill = loadSkillFromFile(path.join(current, skillMd.name));
			if (skill) {
				skills.push(skill);
			}
			return;
		}

		for (const entry of entries) {
			if (entry.name.startsWith('.')) {
				continue;
			}
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'node_modules') {
					continue;
				}
				loadDir(fullPath, false);
			} else if (entry.isFile() && includeRootFiles && entry.name.endsWith('.md')) {
				const skill = loadSkillFromFile(fullPath);
				if (skill) {
					skills.push(skill);
				}
			}
		}
	};

	loadDir(dir, true);
	return skills;
}

/**
 * 将 skills 格式化为注入 system prompt 的 <available_skills> 片段(Agent Skills 规范)。
 * disableModelInvocation 的 skill 不出现在提示中,只能显式触发。
 * 与 pi 不同的是:本 agent 用 use_skill 工具直接加载内容,而非让模型读文件。
 */
export function formatSkillsForPrompt(skills: AgentSkill[]): string {
	const visible = skills.filter(s => !s.disableModelInvocation);
	if (visible.length === 0) {
		return '';
	}

	const lines = [
		'\n\nThe following skills provide specialized instructions for specific tasks.',
		'When the user\u2019s task matches a skill\u2019s description, call the use_skill tool with that skill\u2019s name to load its full instructions before doing the work.',
		'',
		'<available_skills>'
	];

	for (const skill of visible) {
		lines.push('  <skill>');
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push('  </skill>');
	}

	lines.push('</available_skills>');
	return lines.join('\n');
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
