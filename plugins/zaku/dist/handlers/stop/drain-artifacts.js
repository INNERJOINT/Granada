import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../core/decorators.js';
import { handleDrainArtifactsHook } from '../../events/stop/drain-artifacts/index.js';
const handleDrainArtifactsEntry = composeHandlers(handleDrainArtifactsHook, [
    (handler) => withWarningBoundary(handler, {
        label: 'artifact drain warning',
    }),
    withResultNormalization,
]);
export function handle(input, deps) {
    return handleDrainArtifactsEntry(input, deps);
}
