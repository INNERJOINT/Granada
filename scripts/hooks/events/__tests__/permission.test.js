import { describe, it, expect } from 'vitest';
import { runHook, baseInput } from './helper.js';

describe('PermissionRequest', () => {
  it('auto-allows safe git commands', async () => {
    const input = baseInput('PermissionRequest', {
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    });
    const { exitCode, json } = await runHook('permission-request.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(json.hookSpecificOutput.decision.behavior).toBe('allow');
  });

  it('includes updatedPermissions when allowing git commands', async () => {
    const input = baseInput('PermissionRequest', {
      tool_name: 'Bash',
      tool_input: { command: 'git log --oneline' },
    });
    const { json } = await runHook('permission-request.cjs', input);
    expect(json.hookSpecificOutput.updatedPermissions).toBeDefined();
    expect(json.hookSpecificOutput.updatedPermissions[0].type).toBe('addRules');
  });

  it('denies rm -rf / commands', async () => {
    const input = baseInput('PermissionRequest', {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });
    const { json } = await runHook('permission-request.cjs', input);
    expect(json.hookSpecificOutput.decision.behavior).toBe('deny');
    expect(json.hookSpecificOutput.decision.message).toBeTypeOf('string');
  });

  it('adds --dry-run to npm publish', async () => {
    const input = baseInput('PermissionRequest', {
      tool_name: 'Bash',
      tool_input: { command: 'npm publish' },
    });
    const { json } = await runHook('permission-request.cjs', input);
    expect(json.hookSpecificOutput.decision.behavior).toBe('allow');
    expect(json.hookSpecificOutput.decision.updatedInput.command).toContain('--dry-run');
  });

  it('exits 0 with no output for non-matching commands', async () => {
    const input = baseInput('PermissionRequest', {
      tool_name: 'Write',
      tool_input: { file_path: 'test.js', content: 'x' },
    });
    const { exitCode, json } = await runHook('permission-request.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('PermissionDenied', () => {
  it('returns retry:true for safe commands that were incorrectly denied', async () => {
    const input = baseInput('PermissionDenied', {
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      tool_use_id: 'tu_001',
      reason: 'auto-denied',
    });
    const { exitCode, json } = await runHook('permission-denied.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('PermissionDenied');
    expect(json.hookSpecificOutput.retry).toBe(true);
  });

  it('does not retry for non-safe commands', async () => {
    const input = baseInput('PermissionDenied', {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/stuff' },
      tool_use_id: 'tu_002',
      reason: 'auto-denied',
    });
    const { exitCode, json } = await runHook('permission-denied.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});
