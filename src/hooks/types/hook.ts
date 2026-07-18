import type * as fsModule from 'node:fs';
import type { spawn as nodeSpawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E';

export interface Logger {
  log(level: LogLevel, message: string): void;
}

export type FileSystem = Pick<typeof fsModule, 'readFileSync' | 'writeFileSync' | 'existsSync' | 'copyFileSync' | 'renameSync' | 'unlinkSync' | 'readdirSync' | 'mkdirSync' | 'statSync' | 'lstatSync' | 'rmSync' | 'rmdirSync' | 'openSync' | 'closeSync'>;
export type Spawn = typeof nodeSpawn;

export interface HookInput {
  session_id?: string;
  turn_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  permission_mode?: string;
  model?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    command?: string;
    [key: string]: unknown;
  };
  tool_response?: string | null | {
    filePath?: string;
    [key: string]: unknown;
  };
  duration_ms?: number;
  [key: string]: unknown;
}

export type HookObjectOutput = Record<string, unknown>;
export type HookOutput = HookObjectOutput | null | undefined;

export interface HookDeps {
  fs?: FileSystem;
  spawn?: Spawn;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  pluginRoot?: string;
  skillPathArg?: string;
  pid?: number;
  now?: () => number;
  logger?: Logger;
}

export interface HookContext {
  input: HookInput;
  eventName: string | null;
  hookEventName: string | null;
  toolName: string | null;
  matcher: string | null;
  fs?: FileSystem;
  spawn?: Spawn;
  env: NodeJS.ProcessEnv;
  cwd?: string;
  skillPathArg?: string;
  pid?: number;
  now: () => number;
  logger: Logger;
  deps: HookDeps & {
    env: NodeJS.ProcessEnv;
    cwd?: string;
    pluginRoot?: string;
    now: () => number;
    logger: Logger;
  };
}

export type HookHandler = (input: HookInput, deps: HookDeps, context?: HookContext) => HookOutput | Promise<HookOutput>;

export interface HookEntry {
  event: string;
  matcher?: string | ((context: HookContext) => boolean) | null;
  handler: HookHandler;
}

export interface HookRuntime {
  argv: string[];
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  env: NodeJS.ProcessEnv;
  cwd: string;
  pluginRoot?: string;
  pid: number;
  now: () => number;
  spawn: Spawn;
  fs: typeof fsModule;
}
