import { handleTimestampArtifactHook } from '../../events/post-tool-use/timestamp-artifact/index.js';
export function handle(input, deps) {
    return handleTimestampArtifactHook(input, deps);
}
