/**
 * 验证 webview 生成的 HTML 中内嵌脚本的语法与 CSP 安全性。
 *
 * 背景:webview 的 HTML 是在 TS 模板字符串中拼接的,tsc/esbuild 不会检查
 * 最终生成的 JS 语法。模板字符串的转义(如 \s \S \' \/ \\ )很容易产生
 * 非法 JS,导致整个 webview 脚本无法执行(事件绑定全部失效)。
 *
 * 用法:node scripts/verify-webview.js
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const MOCK_VSCODE = path.join(ROOT, '.verify-mock-vscode.js');

async function buildWebview(entry) {
	const outfile = path.join(ROOT, '.verify-webview.bundle.js');
	await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		outfile,
		external: ['vscode'],
		logLevel: 'silent'
	});
	return outfile;
}

function loadWebviewModule(bundlePath) {
	const Module = require('module');
	const origResolve = Module._resolveFilename;
	Module._resolveFilename = function (request, parent, ...args) {
		if (request === 'vscode') {
			return MOCK_VSCODE;
		}
		return origResolve.call(this, request, parent, ...args);
	};
	fs.writeFileSync(
		MOCK_VSCODE,
		'module.exports = { Uri: { joinPath: () => ({ path: "/ext" }) } };'
	);
	// 同名 bundle 会被多个 webview 复用,必须清除 require 缓存
	delete require.cache[require.resolve(bundlePath)];
	const mod = require(bundlePath);
	Module._resolveFilename = origResolve;
	return mod;
}

function getHtml(name) {
	const bundlePath = path.join(ROOT, '.verify-webview.bundle.js');
	const mod = loadWebviewModule(bundlePath);
	const webview = { cspSource: 'https://res.example', asWebviewUri: u => 'https://res.example' + u.path };
	if (name === 'chat') {
		return mod.getChatWebviewContent({ model: 'test' }, webview, { path: '/ext' });
	}
	return mod.getSettingsWebviewContent(
		{ baseUrl: 'http://127.0.0.1:11434', model: 'test', maxTokens: 1, keepAlive: '5m', performanceMode: 'Base (Default)', systemPrompt: 'x' },
		webview
	);
}

function checkScripts(html, name) {
	const scripts = [...html.matchAll(/<script nonce="[^"]*"[^>]*>([\s\S]*?)<\/script>/g)];
	let ok = true;
	scripts.forEach((m, i) => {
		const code = m[1];
		if (!code.trim()) {
			return;
		}
		try {
			new vm.Script(code, { filename: `${name}-script-${i}.js` });
		} catch (e) {
			ok = false;
			console.error(`FAIL ${name} script #${i}: ${e.message}`);
		}
	});
	return ok;
}

function checkNoInlineHandlers(html, name) {
	// CSP 为 nonce 策略时,内联事件处理器(onclick="...")会被浏览器阻止,
	// 这些功能将"静默失效"。必须全部使用 addEventListener。
	// 注意:匹配必须要求 on 前是空白,避免误匹配 content=" / nonce=" 等属性。
	const inline = (html.match(/\son[a-z]+\s*=\s*"/g) || []).length;
	if (inline > 0) {
		console.error(`FAIL ${name}: ${inline} inline event handler(s) found (blocked by nonce CSP)`);
		return false;
	}
	return true;
}

async function main() {
	let allOk = true;

	for (const [name, entry] of [
		['chat', path.join(ROOT, 'src/webview/chatWebview.ts')],
		['settings', path.join(ROOT, 'src/webview/settingsWebview.ts')]
	]) {
		const bundlePath = await buildWebview(entry);
		const html = getHtml(name);
		allOk = checkScripts(html, name) && allOk;
		allOk = checkNoInlineHandlers(html, name) && allOk;
	}

	fs.rmSync(MOCK_VSCODE, { force: true });
	fs.rmSync(path.join(ROOT, '.verify-webview.bundle.js'), { force: true });

	if (!allOk) {
		process.exit(1);
	}
	console.log('webview verification passed (script syntax + no inline handlers)');
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
