const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		// 删除这些调试日志
		// build.onStart(() => {
		//     console.log('[watch] build started');
		// });
		// build.onEnd((result) => {
		//     result.errors.forEach(({ text, location }) => {
		//         console.error(`✘ [ERROR] ${text}`);
		//         console.error(`    ${location.file}:${location.line}:${location.column}:`);
		//     });
		//     console.log('[watch] build finished');
		// });
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			// 删除调试插件
			// esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	// console.error('Build failed:', e);
	process.exit(1);
});
