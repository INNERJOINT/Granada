import { describe, it, expect } from 'vitest';
import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../../../dist/core/decorators.js';

describe('hook decorators seam', () => {
  it('preserves successful hook output objects and normalizes undefined to null', async () => {
    const output = { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'ok' } };

    await expect(withResultNormalization(() => output)()).resolves.toBe(output);
    await expect(withResultNormalization(() => undefined)()).resolves.toBeNull();
  });

  it('converts thrown errors to hook warning output without throwing', async () => {
    const logs = [];
    const handler = withWarningBoundary(() => {
      throw new Error(`boom${String.fromCharCode(0)}bad`);
    }, {
      hookEventName: 'PostToolUse',
      label: 'markdown translation warning',
    });

    const output = await handler({}, { logger: { log: (level, message) => logs.push({ level, message }) } });

    expect(output.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(output.hookSpecificOutput.additionalContext).toBe('markdown translation warning: boombad');
    expect(logs).toEqual([{ level: 'E', message: 'boombad' }]);
  });

  it('composes decorators while preserving the handler result shape', async () => {
    const handler = composeHandlers(
      () => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'ok' } }),
      [withWarningBoundary, withResultNormalization],
    );

    await expect(handler({}, {})).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'ok',
      },
    });
  });
});
