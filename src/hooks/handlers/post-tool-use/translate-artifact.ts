import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../core/decorators.js';
import { handleTranslateArtifactHook } from '../../events/post-tool-use/translate-artifact/index.js';
import type { HookDeps, HookInput } from '../../types/hook.js';

const handleTranslateArtifactEntry = composeHandlers(handleTranslateArtifactHook, [
  (handler) => withWarningBoundary(handler, {
    hookEventName: 'PostToolUse',
    label: 'markdown translation warning',
  }),
  withResultNormalization,
]);

export function handle(input: HookInput, deps: HookDeps) {
  return handleTranslateArtifactEntry(input, deps);
}
