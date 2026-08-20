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
		external: ["vscode"],
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
	await buildExtension();
}

main().catch((e) => {
	console.error("[esbuild] build failed:", e);
	process.exit(1);
});
