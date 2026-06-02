import type { HookDeps, HookInput } from '../../types/hook.js';
import { handleTimestampArtifactHook } from '../../events/post-tool-use/timestamp-artifact/index.js';

export function handle(input: HookInput, deps: HookDeps) {
  return handleTimestampArtifactHook(input, deps);
}
