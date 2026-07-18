import { spawn as nodeSpawn } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { createLogger } from '../shared/logger.js';
import { handle as handleEnqueueArtifact } from '../handlers/post-tool-use/enqueue-artifact.js';
import { handle as handleDrainArtifacts } from '../handlers/stop/drain-artifacts.js';
const TOOL_INPUT_PREVIEW_CHARS = 500;
function readAll(stream) {
    return new Promise((resolve, reject) => {
        let raw = '';
        stream.setEncoding('utf8');
        stream.on('data', chunk => { raw += chunk; });
        stream.on('error', reject);
        stream.on('end', () => resolve(raw));
    });
}
function parseInput(raw) {
    try {
        const parsed = JSON.parse(raw || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function sanitizeWarning(message) {
    return String(message || 'hook failed')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .slice(0, 500);
}
function warningOutput(message) {
    return { systemMessage: `hook warning: ${sanitizeWarning(message)}` };
}
function writeJson(runtime, value) {
    runtime.stdout.write(JSON.stringify(value));
}
function stripOptionalQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
export function extractCodexPatchedFiles(command) {
    if (typeof command !== 'string' || !command)
        return [];
    const paths = [];
    let currentPath = null;
    const flush = () => {
        if (currentPath && !paths.includes(currentPath))
            paths.push(currentPath);
        currentPath = null;
    };
    for (const line of command.split(/\r?\n/)) {
        const add = line.match(/^\*\*\* Add File:\s*(.+)$/);
        if (add) {
            flush();
            currentPath = stripOptionalQuotes(add[1]);
            continue;
        }
        const update = line.match(/^\*\*\* Update File:\s*(.+)$/);
        if (update) {
            flush();
            currentPath = stripOptionalQuotes(update[1]);
            continue;
        }
        if (/^\*\*\* Delete File:/.test(line)) {
            flush();
            continue;
        }
        const move = line.match(/^\*\*\* Move to:\s*(.+)$/);
        if (move && currentPath) {
            currentPath = stripOptionalQuotes(move[1]);
            continue;
        }
        if (line === '*** End Patch')
            flush();
    }
    flush();
    return paths.filter(Boolean);
}
export function normalizeCodexHookInputs(input) {
    if (input.hook_event_name !== 'PostToolUse' || input.tool_name !== 'apply_patch')
        return [input];
    const paths = extractCodexPatchedFiles(input.tool_input?.command);
    return paths.map(filePath => ({
        ...input,
        tool_name: 'Edit',
        tool_input: {
            ...input.tool_input,
            file_path: filePath,
        },
        tool_response: {
            filePath,
            codexResponse: input.tool_response,
        },
    }));
}
function mergeOutputs(outputs) {
    const defined = outputs.filter((value) => !!value);
    if (defined.length === 0)
        return null;
    if (defined.length === 1)
        return defined[0];
    const systemMessages = defined
        .map(output => output.systemMessage)
        .filter((message) => typeof message === 'string' && !!message);
    return {
        ...defined[defined.length - 1],
        ...(systemMessages.length > 0 ? { systemMessage: systemMessages.join('\n') } : {}),
    };
}
function previewInput(input) {
    const toolInput = input.tool_input;
    if (!toolInput || typeof toolInput !== 'object')
        return JSON.stringify(input);
    const command = toolInput.command;
    if (typeof command !== 'string' || command.length <= TOOL_INPUT_PREVIEW_CHARS)
        return JSON.stringify(input);
    return JSON.stringify({
        ...input,
        tool_input: {
            ...toolInput,
            command: `${command.slice(0, TOOL_INPUT_PREVIEW_CHARS)}… [+${command.length - TOOL_INPUT_PREVIEW_CHARS} chars]`,
        },
    });
}
async function run(runtime) {
    const input = parseInput(await readAll(runtime.stdin));
    if (!input)
        return;
    const handlerName = runtime.argv[2];
    if (handlerName !== 'enqueue-artifact' && handlerName !== 'drain-artifacts')
        return;
    const logger = createLogger({
        env: runtime.env,
        stderr: runtime.stderr,
        prefix: `granada:codex:${input.hook_event_name || 'unknown'}:${handlerName}`,
    });
    logger.log('V', `input ${previewInput(input)}`);
    const deps = {
        fs: runtime.fs,
        spawn: runtime.spawn,
        env: { ...runtime.env, GRANADA_RUNTIME: 'codex' },
        cwd: runtime.cwd,
        pluginRoot: runtime.pluginRoot,
        skillPathArg: runtime.argv[3],
        pid: runtime.pid,
        now: runtime.now,
        logger,
    };
    if (handlerName === 'drain-artifacts') {
        const output = await handleDrainArtifacts(input, deps);
        if (output)
            writeJson(runtime, output);
        return;
    }
    const outputs = [];
    for (const normalizedInput of normalizeCodexHookInputs(input)) {
        outputs.push(await handleEnqueueArtifact(normalizedInput, deps));
    }
    const output = mergeOutputs(outputs);
    if (output)
        writeJson(runtime, output);
}
export async function main(runtime = {}) {
    const resolvedRuntime = {
        argv: runtime.argv || process.argv,
        stdin: runtime.stdin || process.stdin,
        stdout: runtime.stdout || process.stdout,
        stderr: runtime.stderr || process.stderr,
        env: runtime.env || process.env,
        cwd: runtime.cwd || process.cwd(),
        pluginRoot: runtime.pluginRoot,
        pid: runtime.pid || process.pid,
        now: runtime.now || Date.now,
        spawn: runtime.spawn || nodeSpawn,
        fs: runtime.fs || nodeFs,
    };
    try {
        await run(resolvedRuntime);
    }
    catch (error) {
        writeJson(resolvedRuntime, warningOutput(error instanceof Error ? error.message : String(error)));
    }
}
