function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function defaultLogger() {
  return { log() {} };
}

export function createHookContext(input, deps = {}, overrides = {}) {
  const safeInput = asObject(input);
  const eventName = overrides.eventName ?? safeInput.hook_event_name ?? null;
  const toolName = overrides.toolName ?? safeInput.tool_name ?? null;
  const cwd = typeof safeInput.cwd === 'string' && safeInput.cwd ? safeInput.cwd : deps.cwd;
  const logger = deps.logger || defaultLogger();
  const now = typeof deps.now === 'function' ? deps.now : Date.now;

  const context = {
    input: safeInput,
    eventName,
    hookEventName: eventName,
    toolName,
    matcher: toolName,
    fs: deps.fs,
    spawn: deps.spawn,
    env: deps.env || {},
    cwd,
    skillPathArg: deps.skillPathArg,
    pid: deps.pid,
    now,
    logger,
  };

  context.deps = {
    ...deps,
    env: context.env,
    cwd: context.cwd,
    now: context.now,
    logger,
  };

  return context;
}
