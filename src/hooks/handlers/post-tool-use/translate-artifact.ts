import type { HookDeps, HookInput } from '../../types/hook.js';
import { handlePostToolUseHook } from '../../events/post-tool-use/index.js';

export function handle(input: HookInput, deps: HookDeps) {
  return handlePostToolUseHook(input, deps);
}
