import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../core/decorators.js';
import { handleTimestampArtifactHook } from '../../events/post-tool-use/timestamp-artifact/index.js';
import type { HookDeps, HookInput } from '../../types/hook.js';

const handleTimestampArtifactEntry = composeHandlers(handleTimestampArtifactHook, [
  (handler) => withWarningBoundary(handler, {
    hookEventName: 'PostToolUse',
    label: 'markdown timestamp warning',
  }),
  withResultNormalization,
]);

export function handle(input: HookInput, deps: HookDeps) {
  return handleTimestampArtifactEntry(input, deps);
}
