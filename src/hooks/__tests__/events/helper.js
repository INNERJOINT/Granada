import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const HOOKS_DIR = resolve(import.meta.dirname, '../../../../scripts/hooks/events');

/**
 * Run a hook script with JSON input via stdin.
 * Returns { stdout, stderr, exitCode, json }.
 */
export function runHook(hookFile, input, options = {}) {
  const { timeout = 5000, env = {}, cwd, args = [] } = options;
  const scriptPath = resolve(HOOKS_DIR, hookFile);
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input);

  return new Promise((res) => {
    const child = spawn('node', [scriptPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      cwd,
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      let json = null;
      if (exitCode === 0 && stdout.trim().startsWith('{')) {
        try { json = JSON.parse(stdout.trim()); } catch (e) { /* not json */ }
      }
      res({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode, json });
    });

    child.stdin.write(inputStr);
    child.stdin.end();
  });
}

/**
 * Build a base hook input object with required common fields.
 */
export function baseInput(eventName, extra = {}) {
  return {
    session_id: 'test-session-001',
    transcript_path: '/tmp/test-transcript.jsonl',
    cwd: '/tmp',
    hook_event_name: eventName,
    permission_mode: 'default',
    ...extra,
  };
}
