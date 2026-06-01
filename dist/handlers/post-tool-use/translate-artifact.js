import { handlePostToolUseHook } from '../../events/post-tool-use/index.js';
export function handle(input, deps) {
    return handlePostToolUseHook(input, deps);
}
