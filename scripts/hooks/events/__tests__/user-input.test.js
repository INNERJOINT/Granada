import { describe, it, expect } from 'vitest';
import { runHook, baseInput } from './helper.js';

describe('UserPromptSubmit', () => {
  it('exits 0 and returns additionalContext for normal prompts', async () => {
    const input = baseInput('UserPromptSubmit', { prompt: 'hello world' });
    const { exitCode, json } = await runHook('user-prompt-submit.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(json.hookSpecificOutput.additionalContext).toBeTypeOf('string');
  });

  it('exits 2 when prompt contains a secret pattern', async () => {
    const input = baseInput('UserPromptSubmit', { prompt: 'set password: hunter2' });
    const { exitCode, stderr } = await runHook('user-prompt-submit.cjs', input);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('secret');
  });
});

describe('UserPromptExpansion', () => {
  it('exits 0 and returns additionalContext', async () => {
    const input = baseInput('UserPromptExpansion', {
      command_name: 'review',
      original_command: '/review',
      expanded_prompt: 'Review this code',
    });
    const { exitCode, json } = await runHook('user-prompt-expansion.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('UserPromptExpansion');
    expect(json.hookSpecificOutput.additionalContext).toContain('/review');
  });
});
