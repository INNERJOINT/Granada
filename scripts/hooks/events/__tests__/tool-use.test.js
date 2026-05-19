import { describe, it, expect } from 'vitest';
import { runHook, baseInput } from './helper.js';

describe('PreToolUse', () => {
  it('exits 0 with allow for read-only tools', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test.js' },
      tool_use_id: 'tu_001',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(json.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('denies dangerous rm -rf / commands', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
      tool_use_id: 'tu_002',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('asks for config file writes', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Write',
      tool_input: { file_path: '/project/.env', content: 'KEY=val' },
      tool_use_id: 'tu_003',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('allows and modifies npm publish with --dry-run', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'npm publish' },
      tool_use_id: 'tu_004',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(json.hookSpecificOutput.updatedInput.command).toContain('--dry-run');
  });

  it('exits 0 with no output for normal Bash commands', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      tool_use_id: 'tu_005',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('PostToolUse', () => {
  it('exits 0 with no output for normal tool results', async () => {
    const input = baseInput('PostToolUse', {
      tool_name: 'Read',
      tool_input: { file_path: 'test.js' },
      tool_response: 'file content',
      tool_use_id: 'tu_010',
    });
    const { exitCode, json } = await runHook('post-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });

  it('warns about generated files', async () => {
    const input = baseInput('PostToolUse', {
      tool_name: 'Write',
      tool_input: { file_path: '/project/dist/bundle.min.js', content: 'x' },
      tool_response: 'ok',
      tool_use_id: 'tu_011',
    });
    const { exitCode, json } = await runHook('post-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.additionalContext).toContain('generated');
  });
});

describe('PostToolUseFailure', () => {
  it('injects context for build failures', async () => {
    const input = baseInput('PostToolUseFailure', {
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' },
      tool_use_id: 'tu_020',
      error: 'exit code 1',
      is_interrupt: false,
    });
    const { exitCode, json } = await runHook('post-tool-use-failure.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('PostToolUseFailure');
    expect(json.hookSpecificOutput.additionalContext).toContain('Build failed');
  });

  it('exits 0 with no output for non-build failures', async () => {
    const input = baseInput('PostToolUseFailure', {
      tool_name: 'Read',
      tool_input: { file_path: 'missing.js' },
      tool_use_id: 'tu_021',
      error: 'file not found',
      is_interrupt: false,
    });
    const { exitCode, json } = await runHook('post-tool-use-failure.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('PostToolBatch', () => {
  it('returns additionalContext summarizing the batch', async () => {
    const input = baseInput('PostToolBatch', {
      tool_results: [
        { tool_name: 'Read', tool_use_id: 'tu1', tool_input: { file_path: 'a.js' }, tool_response: 'ok' },
        { tool_name: 'Grep', tool_use_id: 'tu2', tool_input: { pattern: 'foo' }, tool_response: 'found' },
      ],
    });
    const { exitCode, json } = await runHook('post-tool-batch.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.additionalContext).toContain('Read');
    expect(json.hookSpecificOutput.additionalContext).toContain('Grep');
  });

  it('blocks on critical build failures', async () => {
    const input = baseInput('PostToolBatch', {
      tool_results: [
        { tool_name: 'Bash', tool_use_id: 'tu1', tool_input: { command: 'npm run build' }, error: 'exit 1' },
      ],
    });
    const { exitCode, json } = await runHook('post-tool-batch.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.decision).toBe('block');
    expect(json.reason).toContain('Build failed');
  });
});
