import { createHookContext } from '../../core/context.js';
import { createHookRegistry } from '../../core/registry.js';
import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../core/decorators.js';
import type { HookDeps, HookInput } from '../../types/hook.js';
import { handleTranslateArtifactHook } from './translate-artifact/index.js';

function createPostToolUseRegistry() {
  const registry = createHookRegistry();
  registry.registerHook({
    event: 'PostToolUse',
    matcher: 'Write',
    handler: composeHandlers(handleTranslateArtifactHook, [
      (handler) => withWarningBoundary(handler, {
        hookEventName: 'PostToolUse',
        label: 'markdown translation warning',
      }),
      withResultNormalization,
    ]),
  });
  return registry;
}

export const postToolUseRegistry = createPostToolUseRegistry();

export function createPostToolUseContext(input: HookInput, deps: HookDeps) {
  return createHookContext(input, deps, { eventName: input?.hook_event_name ?? null, toolName: input?.tool_name ?? null });
}

export async function handlePostToolUseHook(input: HookInput, deps: HookDeps) {
  const context = createPostToolUseContext(input, deps);
  return postToolUseRegistry.dispatchHook(context);
}
