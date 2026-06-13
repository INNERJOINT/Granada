import { spawn as nodeSpawn } from 'node:child_process';
import * as nodeFs from 'node:fs';
const ROUTES = Object.freeze({
    PostToolUse: Object.freeze({
        'enqueue-artifact': '../handlers/post-tool-use/enqueue-artifact.js',
        'translate-artifact': '../handlers/post-tool-use/translate-artifact.js',
        'timestamp-artifact': '../handlers/post-tool-use/timestamp-artifact.js',
    }),
    Stop: Object.freeze({
        'drain-artifacts': '../handlers/stop/drain-artifacts.js',
    }),
});
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
        return JSON.parse(raw || '{}');
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
    return {
        systemMessage: `hook warning: ${sanitizeWarning(message)}`,
    };
}
const TOOL_INPUT_CONTENT_PREVIEW_CHARS = 500;
function truncatePreview(value, limit = TOOL_INPUT_CONTENT_PREVIEW_CHARS) {
    if (value.length <= limit)
        return value;
    return `${value.slice(0, limit)}… [+${value.length - limit} chars]`;
}
function inputForVerboseLog(input) {
    const toolInput = input.tool_input;
    if (!toolInput || typeof toolInput !== 'object')
        return input;
    const content = toolInput.content;
    if (typeof content !== 'string' || content.length <= TOOL_INPUT_CONTENT_PREVIEW_CHARS)
        return input;
    return {
        ...input,
        tool_input: {
            ...toolInput,
            content: truncatePreview(content),
        },
    };
}
function formatInputForVerboseLog(input) {
    return JSON.stringify(inputForVerboseLog(input));
}
function writeJson(runtime, value) {
    runtime.stdout.write(JSON.stringify(value));
}
function resolveRoute(eventName, handlerName) {
    if (typeof eventName !== 'string' || !(eventName in ROUTES))
        return null;
    const eventRoutes = ROUTES[eventName];
    return eventRoutes[handlerName] || null;
}
async function run(runtime) {
    const input = parseInput(await readAll(runtime.stdin));
    if (!input)
        return;
    const handlerName = runtime.argv[2];
    const route = resolveRoute(input.hook_event_name, handlerName);
    if (!route)
        return;
    try {
        const [{ createLogger }, handlerModule] = await Promise.all([
            import('../shared/logger.js'),
            import(route),
        ]);
        const logger = createLogger({
            env: runtime.env,
            stderr: runtime.stderr,
            prefix: `granada:${input.hook_event_name}:${handlerName || 'index'}`,
        });
        logger.log('V', `input ${formatInputForVerboseLog(input)}`);
        const output = await handlerModule.handle(input, {
            fs: runtime.fs,
            spawn: runtime.spawn,
            env: runtime.env,
            cwd: runtime.cwd,
            pluginRoot: runtime.pluginRoot,
            skillPathArg: runtime.argv[3],
            pid: runtime.pid,
            now: runtime.now,
            logger,
        });
        if (output !== null && output !== undefined)
            writeJson(runtime, output);
    }
    catch (error) {
        writeJson(runtime, warningOutput(error instanceof Error ? error.message : String(error)));
    }
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
