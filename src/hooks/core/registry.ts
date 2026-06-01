import type { HookContext, HookEntry, HookObjectOutput } from '../types/hook.js';

function normalizeEntry(entry: HookEntry): HookEntry {
  if (!entry || typeof entry !== 'object') throw new TypeError('hook entry is required');
  if (typeof entry.event !== 'string' || !entry.event) throw new TypeError('hook entry event is required');
  if (entry.matcher !== undefined && entry.matcher !== null && typeof entry.matcher !== 'string' && typeof entry.matcher !== 'function') {
    throw new TypeError('hook entry matcher must be a string or function');
  }
  if (typeof entry.handler !== 'function') throw new TypeError('hook entry handler is required');
  return { event: entry.event, matcher: entry.matcher, handler: entry.handler };
}

export function matchesHookEntry(entry: HookEntry, context: HookContext): boolean {
  if (entry.event !== context.eventName) return false;
  if (entry.matcher === undefined || entry.matcher === null) return true;
  if (typeof entry.matcher === 'function') return Boolean(entry.matcher(context));
  return entry.matcher === context.toolName;
}

export async function collectHookOutputs(context: HookContext, entries: HookEntry[]): Promise<HookObjectOutput[]> {
  const outputs: HookObjectOutput[] = [];
  for (const entry of entries) {
    if (!matchesHookEntry(entry, context)) continue;
    const output = await entry.handler(context.input, context.deps, context);
    if (output !== null && output !== undefined) outputs.push(output);
  }
  return outputs;
}

export async function dispatchHook(context: HookContext, entries: HookEntry[]): Promise<HookObjectOutput | null> {
  const outputs = await collectHookOutputs(context, entries);
  return outputs.length > 0 ? outputs[0] : null;
}

export function createHookRegistry(initialEntries: HookEntry[] = []) {
  const entries: HookEntry[] = [];
  const registry = {
    registerHook(entry: HookEntry) {
      const normalized = normalizeEntry(entry);
      entries.push(normalized);
      return () => {
        const index = entries.indexOf(normalized);
        if (index !== -1) entries.splice(index, 1);
      };
    },
    collectHookOutputs(context: HookContext) {
      return collectHookOutputs(context, entries);
    },
    dispatchHook(context: HookContext) {
      return dispatchHook(context, entries);
    },
    entries() {
      return entries.slice();
    },
  };

  for (const entry of initialEntries) registry.registerHook(entry);
  return registry;
}
