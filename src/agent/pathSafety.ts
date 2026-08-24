import * as fs from 'fs';
import * as path from 'path';

export function resolveInWorkspace(workspaceRoot: string, candidate: string): string {
	const abs = path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(workspaceRoot, candidate);
	const root = path.resolve(workspaceRoot);
	if (abs !== root && !abs.startsWith(root + path.sep)) {
		throw new Error(`Path "${candidate}" resolves outside the workspace.`);
	}
	return abs;
}

export async function assertRealPathInWorkspace(
	workspaceRoot: string,
	candidate: string,
	allowMissing = false
): Promise<void> {
	const root = await fs.promises.realpath(workspaceRoot);
	let target: string;
	try {
		target = await fs.promises.realpath(candidate);
	} catch (error) {
		if (!allowMissing) {
			throw error;
		}

		let probe = path.dirname(candidate);
		while (true) {
			try {
				target = await fs.promises.realpath(probe);
				break;
			} catch {
				const parent = path.dirname(probe);
				if (parent === probe) {
					throw error;
				}
				probe = parent;
			}
		}
	}

	if (target !== root && !target.startsWith(root + path.sep)) {
		throw new Error(`Path "${candidate}" resolves outside the workspace.`);
	}
}
