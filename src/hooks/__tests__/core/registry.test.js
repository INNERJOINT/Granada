import { describe, it, expect } from 'vitest';
import { createHookContext } from '../../../../dist/core/context.js';
import { createHookRegistry } from '../../../../dist/core/registry.js';

describe('hook registry seam', () => {
  it('dispatches matching event and matcher handlers', async () => {
    const registry = createHookRegistry();
    registry.registerHook({
      event: 'PostToolUse',
      matcher: 'Write',
      handler(input, deps, context) {
        expect(input.tool_name).toBe('Write');
        expect(deps.cwd).toBe('/repo');
        expect(context.toolName).toBe('Write');
        return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'ok' } };
      },
    });

    const output = await registry.dispatchHook(createHookContext({ hook_event_name: 'PostToolUse', tool_name: 'Write' }, { cwd: '/repo' }));

    expect(output.hookSpecificOutput.additionalContext).toBe('ok');
  });

  it('returns null for unsupported events and matchers', async () => {
    const registry = createHookRegistry([
      { event: 'PostToolUse', matcher: 'Write', handler: () => ({ decision: 'block' }) },
    ]);

    await expect(registry.dispatchHook(createHookContext({ hook_event_name: '../PostToolUse', tool_name: 'Write' }, {}))).resolves.toBeNull();
    await expect(registry.dispatchHook(createHookContext({ hook_event_name: 'PostToolUse', tool_name: 'Read' }, {}))).resolves.toBeNull();
  });

  it('collects multiple matching handler outputs and dispatches the first stdout object', async () => {
    const registry = createHookRegistry();
    registry.registerHook({ event: 'PostToolUse', matcher: 'Write', handler: () => null });
    registry.registerHook({ event: 'PostToolUse', matcher: 'Write', handler: () => ({ order: 1 }) });
    registry.registerHook({ event: 'PostToolUse', matcher: 'Write', handler: () => ({ order: 2 }) });

    const context = createHookContext({ hook_event_name: 'PostToolUse', tool_name: 'Write' }, {});

    await expect(registry.collectHookOutputs(context)).resolves.toEqual([{ order: 1 }, { order: 2 }]);
    await expect(registry.dispatchHook(context)).resolves.toEqual({ order: 1 });
  });

  it('supports unregistering handlers without user-controlled imports', async () => {
    const registry = createHookRegistry();
    const unregister = registry.registerHook({ event: 'PostToolUse', matcher: 'Write', handler: () => ({ ok: true }) });
    const context = createHookContext({ hook_event_name: 'PostToolUse', tool_name: 'Write' }, {});

    await expect(registry.dispatchHook(context)).resolves.toEqual({ ok: true });
    unregister();
    await expect(registry.dispatchHook(context)).resolves.toBeNull();
  });
});
