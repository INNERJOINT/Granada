import { describe, it, expect } from 'vitest';
import { runHook, baseInput } from './helper.js';

describe('SessionStart', () => {
  it('exits 0 and returns hookSpecificOutput with env and additionalContext', async () => {
    const input = baseInput('SessionStart', { source: 'startup', model: 'opus' });
    const { exitCode, json } = await runHook('session-start.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(json.hookSpecificOutput.env).toBeDefined();
    expect(json.hookSpecificOutput.additionalContext).toBeTypeOf('string');
  });

  it('includes env vars PROJECT_ROOT and SESSION_SOURCE', async () => {
    const input = baseInput('SessionStart', { source: 'resume', model: 'sonnet' });
    const { json } = await runHook('session-start.cjs', input);
    expect(json.hookSpecificOutput.env.PROJECT_ROOT).toBe('/tmp');
    expect(json.hookSpecificOutput.env.SESSION_SOURCE).toBe('resume');
  });
});

describe('Setup', () => {
  it('exits 0 and returns hookSpecificOutput with env', async () => {
    const input = baseInput('Setup', { trigger: 'init' });
    const { exitCode, json } = await runHook('setup.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('Setup');
    expect(json.hookSpecificOutput.env.SETUP_COMPLETED).toBe('true');
    expect(json.hookSpecificOutput.env.SETUP_TRIGGER).toBe('init');
  });

  it('handles maintenance trigger', async () => {
    const input = baseInput('Setup', { trigger: 'maintenance' });
    const { json } = await runHook('setup.cjs', input);
    expect(json.hookSpecificOutput.env.SETUP_TRIGGER).toBe('maintenance');
  });
});

describe('SessionEnd', () => {
  it('exits 0 with no JSON output', async () => {
    const input = baseInput('SessionEnd', { reason: 'other' });
    const { exitCode, json } = await runHook('session-end.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});
