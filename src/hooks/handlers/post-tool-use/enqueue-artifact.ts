import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../core/decorators.js';
import { handleEnqueueArtifactHook } from '../../events/post-tool-use/enqueue-artifact/index.js';
import type { HookDeps, HookInput } from '../../types/hook.js';

const handleEnqueueArtifactEntry = composeHandlers(handleEnqueueArtifactHook, [
  (handler) => withWarningBoundary(handler, {
    hookEventName: 'PostToolUse',
    label: 'artifact enqueue warning',
  }),
  withResultNormalization,
]);

export function handle(input: HookInput, deps: HookDeps) {
  return handleEnqueueArtifactEntry(input, deps);
}
