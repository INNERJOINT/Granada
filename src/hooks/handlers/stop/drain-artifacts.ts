import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../core/decorators.js';
import { handleDrainArtifactsHook } from '../../events/stop/drain-artifacts/index.js';
import type { HookDeps, HookInput } from '../../types/hook.js';

const handleDrainArtifactsEntry = composeHandlers(handleDrainArtifactsHook, [
  (handler) => withWarningBoundary(handler, {
    label: 'artifact drain warning',
  }),
  withResultNormalization,
]);

export function handle(input: HookInput, deps: HookDeps) {
  return handleDrainArtifactsEntry(input, deps);
}
