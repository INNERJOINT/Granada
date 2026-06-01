import { describe, it, expect } from 'vitest';
import { createHookContext } from '../context.js';

describe('hook context seam', () => {
  it('constructs HookContext fields from hook input and shim deps', () => {
    const fs = {};
    const spawn = () => {};
    const logger = { log() {} };
    const now = () => 123;

    const context = createHookContext(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        cwd: '/from-input',
      },
      {
        fs,
        spawn,
        env: { GRANADA_DEBUG: 'D' },
        cwd: '/from-deps',
        skillPathArg: 'skills/translate-md-zh/SKILL.md',
        pid: 42,
        now,
        logger,
      },
    );

    expect(context.eventName).toBe('PostToolUse');
    expect(context.hookEventName).toBe('PostToolUse');
    expect(context.toolName).toBe('Write');
    expect(context.matcher).toBe('Write');
    expect(context.fs).toBe(fs);
    expect(context.spawn).toBe(spawn);
    expect(context.env.GRANADA_DEBUG).toBe('D');
    expect(context.cwd).toBe('/from-input');
    expect(context.skillPathArg).toBe('skills/translate-md-zh/SKILL.md');
    expect(context.pid).toBe(42);
    expect(context.now).toBe(now);
    expect(context.logger).toBe(logger);
    expect(context.deps.cwd).toBe('/from-input');
    expect(context.deps.logger).toBe(logger);
  });

  it('handles malformed or null input without requiring a TypeScript runtime', () => {
    const context = createHookContext(null, { cwd: '/repo' });

    expect(context.input).toEqual({});
    expect(context.eventName).toBeNull();
    expect(context.toolName).toBeNull();
    expect(context.cwd).toBe('/repo');
    expect(typeof context.logger.log).toBe('function');
  });
});
