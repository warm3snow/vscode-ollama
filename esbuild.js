const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** Copy marked (UMD build) into dist so the webview can load it locally
 *  instead of from a CDN (which VS Code's default webview CSP blocks). */
function copyMarkedToDist() {
	const src = require.resolve("marked/marked.min.js");
	const destDir = path.join(__dirname, "dist", "webview");
	fs.mkdirSync(destDir, { recursive: true });
	fs.copyFileSync(src, path.join(destDir, "marked.min.js"));
}

/** Copy the built-in subagent agents/prompts markdown into dist so the
 *  subagent extension can discover them at runtime via __dirname. */
function copySubagentResources() {
	const dirs = ["agents", "prompts"];
	for (const dir of dirs) {
		const srcDir = path.join(__dirname, "src", "pi", "subagent", dir);
		const destDir = path.join(__dirname, "dist", "subagent", dir);
		fs.mkdirSync(destDir, { recursive: true });
		for (const file of fs.readdirSync(srcDir)) {
			if (file.endsWith(".md")) {
				fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
			}
		}
	}
}

async function buildExtension() {
	const ctx = await esbuild.context({
		entryPoints: ["src/extension.ts"],
		bundle: true,
		format: "cjs",
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: "node",
		target: "node16",
		outfile: "dist/extension.js",
		// pi-coding-agent 是纯 ESM 包且体积较大：作为运行期依赖随扩展分发，不内联进产物。
		external: ["vscode", "@earendil-works/pi-coding-agent"],
		logLevel: "silent",
	});

	if (watch) {
		await ctx.watch();
		console.log("[watch] build started, watching for changes...");
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

async function main() {
	copyMarkedToDist();
	copySubagentResources();
	await buildExtension();
}

main().catch((e) => {
	console.error("[esbuild] build failed:", e);
	process.exit(1);
});
