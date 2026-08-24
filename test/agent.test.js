const test = require('node:test');
const assert = require('node:assert/strict');

const { findCompactionCutPoint } = require('../out/agent/compaction.js');
const {
    parseToolArguments,
    sanitizeAssistantContent,
    shouldNudgeContinuation
} = require('../out/agent/agentLoop.js');
const { applyEdits } = require('../out/agent/editTool.js');
const { assertRealPathInWorkspace } = require('../out/agent/pathSafety.js');
const { runNodeGrep } = require('../out/agent/tools.js');

test('compaction keeps assistant tool calls with all tool results', () => {
    const messages = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'old request' },
        { role: 'assistant', content: '', tool_calls: [
            { id: 'call-1', function: { name: 'read', arguments: '{}' } },
            { id: 'call-2', function: { name: 'read', arguments: '{}' } }
        ] },
        { role: 'tool', tool_call_id: 'call-1', content: 'first result' },
        { role: 'tool', tool_call_id: 'call-2', content: 'second result' },
        { role: 'user', content: 'new request' }
    ];

    const cutPoint = findCompactionCutPoint(messages, 8);

    assert.notEqual(messages[cutPoint]?.role, 'tool');
    assert.notDeepEqual(messages.slice(cutPoint, cutPoint + 2).map(message => message.role), ['tool', 'tool']);
});

test('invalid tool arguments are reported instead of becoming empty arguments', () => {
    const parsed = parseToolArguments('{invalid');

    assert.deepEqual(parsed.args, {});
    assert.match(parsed.error, /valid JSON/i);
});

test('valid tool arguments are parsed as an object', () => {
    assert.deepEqual(parseToolArguments('{"path":"src/index.ts"}'), {
        args: { path: 'src/index.ts' }
    });
});

test('assistant content removes fabricated tool response blocks', () => {
    assert.equal(
        sanitizeAssistantContent('<tool_response>fake result</tool_response>'),
        ''
    );
});

test('assistant content removes escaped fabricated tool response blocks', () => {
    assert.equal(
        sanitizeAssistantContent('\\u003ctool_response\\u003efake\\u003c/tool_response\\u003e'),
        ''
    );
});

test('assistant content preserves real answer around fabricated tool response blocks', () => {
    assert.equal(
        sanitizeAssistantContent('<tool_response>fake</tool_response>\nActual answer.'),
        'Actual answer.'
    );
});

test('continuation nudges a model that only announces the next action', () => {
    assert.equal(shouldNudgeContinuation({
        autoContinue: true,
        content: "Let's list the contents of the root directory to see what's available.",
        userRequest: 'understand the architecture of this project',
        nudgeCount: 0,
        toolCallCount: 0,
        hasToolEvidence: false
    }), true);
});

test('continuation does not nudge a completed run with tool evidence', () => {
    assert.equal(shouldNudgeContinuation({
        autoContinue: true,
        content: 'The architecture is documented above.',
        nudgeCount: 0,
        toolCallCount: 2,
        hasToolEvidence: true
    }), false);
});

test('ambiguous edits fail instead of changing the first occurrence', () => {
    const result = applyEdits('const value = 1;\nconst value = 1;\n', [
        { oldText: 'const value = 1;', newText: 'const value = 2;' }
    ]);

    assert.equal(result.updated, 'const value = 1;\nconst value = 1;\n');
    assert.match(result.errors[0], /multiple times/i);
});

test('edits preserve UTF-16 offsets for non-BMP characters', () => {
    const result = applyEdits('const message = "😀 hello";\n', [
        { oldText: '😀 hello', newText: '😀 world' }
    ]);

    assert.equal(result.updated, 'const message = "😀 world";\n');
    assert.equal(result.errors.length, 0);
});

test('workspace path validation rejects symlink escapes', async () => {
    const fs = require('node:fs/promises');
    const os = require('node:os');
    const path = require('node:path');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-ollama-agent-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-ollama-outside-'));
    const link = path.join(root, 'link');
    await fs.symlink(outside, link, 'dir');

    await assert.rejects(
        assertRealPathInWorkspace(root, path.join(link, 'file.txt'), true),
        /outside the workspace/i
    );

    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
});

test('node grep supports literal and glob searches without system grep flags', async () => {
    const fs = require('node:fs/promises');
    const os = require('node:os');
    const path = require('node:path');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-ollama-grep-'));
    await fs.writeFile(path.join(root, 'main.ts'), 'const target = 1;\n', 'utf8');
    await fs.writeFile(path.join(root, 'notes.txt'), 'const target = 2;\n', 'utf8');

    const result = await runNodeGrep('target = 1', '**/*.ts', true, true, 0, 100, root, {
        workspaceRoot: root
    });

    assert.match(result, /main\.ts:1: const target = 1/);
    assert.doesNotMatch(result, /notes\.txt/);
    await fs.rm(root, { recursive: true, force: true });
});
