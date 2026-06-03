import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../core/decorators.js';
import { handleEnqueueArtifactHook } from '../../events/post-tool-use/enqueue-artifact/index.js';
const handleEnqueueArtifactEntry = composeHandlers(handleEnqueueArtifactHook, [
    (handler) => withWarningBoundary(handler, {
        hookEventName: 'PostToolUse',
        label: 'artifact enqueue warning',
    }),
    withResultNormalization,
]);
export function handle(input, deps) {
    return handleEnqueueArtifactEntry(input, deps);
}
