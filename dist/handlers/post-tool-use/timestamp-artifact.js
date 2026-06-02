import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../core/decorators.js';
import { handleTimestampArtifactHook } from '../../events/post-tool-use/timestamp-artifact/index.js';
const handleTimestampArtifactEntry = composeHandlers(handleTimestampArtifactHook, [
    (handler) => withWarningBoundary(handler, {
        hookEventName: 'PostToolUse',
        label: 'markdown timestamp warning',
    }),
    withResultNormalization,
]);
export function handle(input, deps) {
    return handleTimestampArtifactEntry(input, deps);
}
