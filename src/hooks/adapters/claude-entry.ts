import { spawn as nodeSpawn } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { createLogger } from '../shared/logger.js';
import type { HookInput, HookObjectOutput, HookRuntime } from '../types/hook.js';

const ROUTES = Object.freeze({
  PostToolUse: Object.freeze({
    'translate-artifact': '../handlers/post-tool-use/translate-artifact.js',
    'timestamp-artifact': '../handlers/post-tool-use/timestamp-artifact.js',
  }),
});

type HookEventName = keyof typeof ROUTES;
type HandlerModule = {
  handle(input: HookInput, deps: HookRuntimeDeps): HookObjectOutput | null | undefined | Promise<HookObjectOutput | null | undefined>;
};

type HookRuntimeDeps = {
  fs: typeof nodeFs;
  spawn: typeof nodeSpawn;
  env: NodeJS.ProcessEnv;
  cwd: string;
  skillPathArg?: string;
  pid: number;
  now: () => number;
  logger: ReturnType<typeof createLogger>;
};

function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => { raw += chunk; });
    stream.on('error', reject);
    stream.on('end', () => resolve(raw));
  });
}

function parseInput(raw: string): HookInput | null {
  try {
    return JSON.parse(raw || '{}') as HookInput;
  } catch {
    return null;
  }
}

function sanitizeWarning(message: unknown): string {
  return String(message || 'hook failed')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, 500);
}

function warningOutput(eventName: string | undefined, message: unknown): HookObjectOutput {
  return {
    hookSpecificOutput: {
      hookEventName: eventName || 'PostToolUse',
      additionalContext: `hook warning: ${sanitizeWarning(message)}`,
    },
  };
}

function writeJson(runtime: HookRuntime, value: HookObjectOutput): void {
  runtime.stdout.write(JSON.stringify(value));
}

function resolveRoute(eventName: unknown, handlerName: string | undefined): string | null {
  if (typeof eventName !== 'string' || !(eventName in ROUTES)) return null;
  const eventRoutes = ROUTES[eventName as HookEventName];
  return eventRoutes[handlerName as keyof typeof eventRoutes] || null;
}

async function run(runtime: HookRuntime): Promise<void> {
  const input = parseInput(await readAll(runtime.stdin));
  if (!input) return;

  const handlerName = runtime.argv[2];
  const route = resolveRoute(input.hook_event_name, handlerName);
  if (!route) return;

  const [{ createLogger }, handlerModule] = await Promise.all([
    import('../shared/logger.js'),
    import(route) as Promise<HandlerModule>,
  ]);

  const output = await handlerModule.handle(input, {
    fs: runtime.fs,
    spawn: runtime.spawn,
    env: runtime.env,
    cwd: runtime.cwd,
    skillPathArg: runtime.argv[3],
    pid: runtime.pid,
    now: runtime.now,
    logger: createLogger({
      env: runtime.env,
      stderr: runtime.stderr,
      prefix: `granada:${input.hook_event_name}:${handlerName || 'index'}`,
    }),
  });

  if (output !== null && output !== undefined) writeJson(runtime, output);
}

export async function main(runtime: Partial<HookRuntime> = {}): Promise<void> {
  const resolvedRuntime: HookRuntime = {
    argv: runtime.argv || process.argv,
    stdin: runtime.stdin || process.stdin,
    stdout: runtime.stdout || process.stdout,
    stderr: runtime.stderr || process.stderr,
    env: runtime.env || process.env,
    cwd: runtime.cwd || process.cwd(),
    pid: runtime.pid || process.pid,
    now: runtime.now || Date.now,
    spawn: runtime.spawn || nodeSpawn,
    fs: runtime.fs || nodeFs,
  };

  try {
    await run(resolvedRuntime);
  } catch (error) {
    writeJson(resolvedRuntime, warningOutput('PostToolUse', error instanceof Error ? error.message : String(error)));
  }
}
