import { composeHandlers, withResultNormalization, withWarningBoundary } from '../../core/decorators.js';
import { handleTranslateArtifactHook } from '../../events/post-tool-use/translate-artifact/index.js';
const handleTranslateArtifactEntry = composeHandlers(handleTranslateArtifactHook, [
    (handler) => withWarningBoundary(handler, {
        hookEventName: 'PostToolUse',
        label: 'markdown translation warning',
    }),
    withResultNormalization,
]);
export function handle(input, deps) {
    return handleTranslateArtifactEntry(input, deps);
}
